use crate::cache;
use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum InstallSource {
    Git {
        url: String,
        version: String,
    },
    #[serde(rename = "http-tar")]
    HttpTar {
        url: String,
        version: String,
    },
}

impl InstallSource {
    pub fn url(&self) -> &str {
        match self {
            InstallSource::Git { url, .. } | InstallSource::HttpTar { url, .. } => url,
        }
    }

    pub fn version(&self) -> &str {
        match self {
            InstallSource::Git { version, .. } | InstallSource::HttpTar { version, .. } => version,
        }
    }

    pub fn kind_str(&self) -> &'static str {
        match self {
            InstallSource::Git { .. } => "git",
            InstallSource::HttpTar { .. } => "http-tar",
        }
    }

    pub fn validate(&self) -> Result<()> {
        let url = self.url();
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            bail!("url must be http(s)");
        }
        let version = self.version();
        if version.is_empty() {
            bail!("version must not be empty");
        }
        if let InstallSource::HttpTar { .. } = self {
            if !is_lower_hex_64(version) {
                bail!("for http-tar, version must be a 64-char lowercase hex SHA-256");
            }
        }
        Ok(())
    }

    pub fn cache_id(&self) -> String {
        let payload = format!("{}|{}|{}", self.kind_str(), self.url(), self.version());
        format!(
            "{}{}",
            cache::CACHE_ID_PREFIX,
            URL_SAFE_NO_PAD.encode(payload.as_bytes())
        )
    }
}

pub struct InstallOutcome {
    pub id: String,
    pub already_present: bool,
}

pub fn install(modules_dir: &Path, source: &InstallSource) -> Result<InstallOutcome> {
    source.validate()?;
    let id = source.cache_id();
    let dest = cache::cache_entry_path(modules_dir, &id);
    if dest.join("metadata.json").exists() && dest.join("definitions.json").exists() {
        return Ok(InstallOutcome {
            id,
            already_present: true,
        });
    }

    let tmp = tempfile::tempdir().context("creating temp dir for install")?;
    let extract_dir = tmp.path().join("src");
    fs::create_dir_all(&extract_dir).context("creating extract dir")?;

    match source {
        InstallSource::Git { url, version } => {
            git_clone(url, version, &extract_dir).context("git clone")?;
        }
        InstallSource::HttpTar { url, version } => {
            http_tar_fetch(url, version, &extract_dir).context("http-tar fetch")?;
        }
    }

    let candidate = find_module_dir(&extract_dir)
        .context("locating module in fetched archive")?;

    // Validate by running the compiler's manifest loader.
    compiler::registry::load_manifest(
        &candidate,
        &candidate.join("metadata.json"),
        &candidate.join("definitions.json"),
    )
    .context("validating module manifest")?;

    // Rewrite metadata.json's id field to the cache id.
    rewrite_metadata_id(&candidate, &id).context("rewriting metadata.json id")?;

    // Place atomically.
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
    }
    if dest.exists() {
        fs::remove_dir_all(&dest)
            .with_context(|| format!("clearing stale {}", dest.display()))?;
    }
    if let Err(rename_err) = fs::rename(&candidate, &dest) {
        // Cross-mount rename can fail; fall back to recursive copy.
        copy_dir(&candidate, &dest).with_context(|| {
            format!("rename failed ({rename_err}); recursive-copy fallback also failed")
        })?;
    }

    Ok(InstallOutcome {
        id,
        already_present: false,
    })
}

pub fn uninstall(modules_dir: &Path, id: &str) -> Result<()> {
    if !cache::is_cache_id(id) {
        bail!("refusing to delete non-cache module '{id}'");
    }
    let dir = cache::cache_entry_path(modules_dir, id);
    if !dir.exists() {
        bail!("cache entry '{id}' not found");
    }
    fs::remove_dir_all(&dir)
        .with_context(|| format!("removing {}", dir.display()))?;
    Ok(())
}

fn git_clone(url: &str, refspec: &str, dest: &Path) -> Result<()> {
    let output = Command::new("git")
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg("--branch")
        .arg(refspec)
        .arg(url)
        .arg(dest)
        .output()
        .map_err(|e| anyhow!("failed to spawn git: {e}. Install git on PATH."))?;
    if !output.status.success() {
        bail!(
            "git clone failed (exit {}): {}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

fn http_tar_fetch(url: &str, expected_sha256: &str, dest: &Path) -> Result<()> {
    let resp = reqwest::blocking::get(url)
        .with_context(|| format!("GET {url}"))?;
    if !resp.status().is_success() {
        bail!("download failed: HTTP {}", resp.status());
    }
    let bytes = resp.bytes().context("reading response body")?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let computed = hex::encode(hasher.finalize());
    if !computed.eq_ignore_ascii_case(expected_sha256) {
        bail!(
            "sha256 mismatch: declared {expected_sha256}, downloaded archive hashes to {computed}"
        );
    }
    let gz = flate2::read::GzDecoder::new(&bytes[..]);
    let mut archive = tar::Archive::new(gz);
    archive.unpack(dest).context("unpacking tar archive")?;
    Ok(())
}

fn find_module_dir(root: &Path) -> Result<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    let mut found: Vec<PathBuf> = Vec::new();
    while let Some(d) = stack.pop() {
        if d.join("metadata.json").is_file() && d.join("definitions.json").is_file() {
            found.push(d);
            continue;
        }
        let entries = match fs::read_dir(&d) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                stack.push(p);
            }
        }
    }
    match found.len() {
        0 => bail!("no metadata.json + definitions.json pair in archive"),
        1 => Ok(found.pop().unwrap()),
        _ => bail!("archive contains {} module candidates; only one is supported per install", found.len()),
    }
}

fn rewrite_metadata_id(dir: &Path, id: &str) -> Result<()> {
    let path = dir.join("metadata.json");
    let raw = fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
    let mut value: serde_json::Value =
        serde_json::from_slice(&raw).with_context(|| format!("parsing {}", path.display()))?;
    let obj = value
        .as_object_mut()
        .ok_or_else(|| anyhow!("metadata.json is not a JSON object"))?;
    obj.insert("id".to_string(), serde_json::Value::String(id.to_string()));
    let written = serde_json::to_vec_pretty(&value)?;
    fs::write(&path, written).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

fn copy_dir(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to)
                .with_context(|| format!("copying {} -> {}", from.display(), to.display()))?;
        }
    }
    Ok(())
}

fn is_lower_hex_64(s: &str) -> bool {
    s.len() == 64 && s.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

#[allow(dead_code)]
pub fn _read_to_vec<R: Read>(mut r: R) -> Result<Vec<u8>> {
    let mut buf = Vec::new();
    r.read_to_end(&mut buf)?;
    Ok(buf)
}
