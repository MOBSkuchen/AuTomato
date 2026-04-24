use anyhow::{anyhow, bail, Context, Result};
use axum::{
    body::Body,
    extract::Path,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Write as IoWrite};
use std::net::SocketAddr;
use std::path::{Path as StdPath, PathBuf};
use std::process::Command;
use zip::write::{ExtendedFileOptions, FileOptions, FullFileOptions};

#[derive(Serialize)]
struct ModuleListing {
    id: String,
    name: String,
    version: String,
}

#[derive(Deserialize)]
struct CompileRequest {
    ast: serde_json::Value,
    target: String,
}

#[derive(Serialize)]
struct CompileResponse {
    ok: bool,
    target: String,
    content: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct BuildRequest {
    ast: serde_json::Value,
    target: String,
    #[serde(default)]
    options: BuildOptions,
}

#[derive(Deserialize, Default, Clone, Debug)]
struct BuildOptions {
    #[serde(default)]
    optimize: Option<String>,
    #[serde(default)]
    strip: bool,
    #[serde(default)]
    trimpath: bool,
    #[serde(default)]
    goos: Option<String>,
    #[serde(default)]
    goarch: Option<String>,
    #[serde(default)]
    docker: Option<DockerOptions>,
}

#[derive(Deserialize, Clone, Debug)]
struct DockerOptions {
    #[serde(default)]
    enable: bool,
    #[serde(default = "default_docker_port")]
    port: u16,
    #[serde(default = "default_true")]
    expose: bool,
}

fn default_docker_port() -> u16 {
    8080
}

fn default_true() -> bool {
    true
}

impl DockerOptions {
    fn to_config(&self) -> compiler::workspace::DockerConfig {
        compiler::workspace::DockerConfig {
            enable: self.enable,
            port: self.port,
            expose: self.expose,
        }
    }
}

#[tokio::main]
async fn main() {
    let app = Router::new().without_v07_checks()
        .route("/health", get(health))
        .route("/modules", get(list_modules))
        .route("/modules/:id", get(get_module))
        .route("/compile", post(compile))
        .route("/build", post(build))
        .layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_methods(tower_http::cors::Any)
                .allow_headers(tower_http::cors::Any),
        );

    let addr: SocketAddr = "0.0.0.0:7878".parse().unwrap();
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    println!("automato-backend listening on http://{addr}");
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
    "ok"
}

async fn list_modules() -> Json<Vec<ModuleListing>> {
    Json(vec![])
}

async fn get_module(Path(id): Path<String>) -> impl IntoResponse {
    (StatusCode::NOT_FOUND, format!("module {id} not found"))
}

async fn compile(Json(req): Json<CompileRequest>) -> Json<CompileResponse> {
    let target = req.target.clone();
    let modules_dir = modules_dir();
    let result = compiler::compile_ast(&req.ast, &req.target, &modules_dir);
    match result {
        Ok(content) => Json(CompileResponse {
            ok: true,
            target,
            content: Some(content),
            error: None,
        }),
        Err(e) => Json(CompileResponse {
            ok: false,
            target,
            content: None,
            error: Some(format!("{:#}", e)),
        }),
    }
}

async fn build(Json(req): Json<BuildRequest>) -> Response {
    do_build(req).await.unwrap_or_else(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        format!("{:#}", e),
    ).into_response())
}

async fn do_build(req: BuildRequest) -> Result<Response> {
    let modules = modules_dir();
    let wf_name = req
        .ast
        .get("name")
        .and_then(|v| v.as_str())
        .map(slug)
        .unwrap_or_else(|| "workflow".to_string());

    match req.target.as_str() {
        "go-source" | "go" | "main" => {
            let src = compiler::compile_ast(&req.ast, "go", &modules)
                .context("generating Go source")?;
            Ok(download_response(
                src.into_bytes(),
                &format!("{wf_name}.main.go"),
                "text/x-go; charset=utf-8",
            ))
        }
        "ast-json" | "json" => {
            let src = compiler::compile_ast(&req.ast, "json", &modules)
                .context("serializing AST")?;
            Ok(download_response(
                src.into_bytes(),
                &format!("{wf_name}.ast.json"),
                "application/json; charset=utf-8",
            ))
        }
        "workspace-zip" | "zip" | "workspace" => {
            let docker = req
                .options
                .docker
                .as_ref()
                .map(|d| d.to_config())
                .unwrap_or_default();
            let tmp = tempfile::tempdir().context("creating temp workspace dir")?;
            compiler::compile_to_workspace(&req.ast, &modules, tmp.path(), &docker)
                .context("building Go workspace")?;
            let bytes = zip_dir(tmp.path(), &wf_name).context("zipping workspace")?;
            Ok(download_response(
                bytes,
                &format!("{wf_name}-workspace.zip"),
                "application/zip",
            ))
        }
        "binary" | "exe" => {
            let docker = req
                .options
                .docker
                .as_ref()
                .map(|d| d.to_config())
                .unwrap_or_default();
            let tmp = tempfile::tempdir().context("creating temp workspace dir")?;
            compiler::compile_to_workspace(&req.ast, &modules, tmp.path(), &docker)
                .context("building Go workspace")?;
            let buf: Vec<u8> = Vec::new();
            let (bytes, _) =
                build_binary(tmp.path(), &req.options).context("building binary")?;
            let cursor = std::io::Cursor::new(buf);
            let mut zw = zip::ZipWriter::new(cursor);
            let opts = FullFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .unix_permissions(0o644);
            zw.add_directory("/", opts.clone()).context("building ZIP")?;
            zw.start_file(format!("{wf_name}.exe"), opts).context("building ZIP")?;
            zw.write_all(&bytes)?;
            let cursor = zw.finish()?;
            let ready = cursor.into_inner();
            Ok(download_response(
                ready,
                &format!("{wf_name}.zip"),
                "application/zip",
            ))
        }
        other => bail!("unknown build target: {other}"),
    }
}

fn modules_dir() -> PathBuf {
    std::env::var("AUTOMATO_MODULES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("modules"))
}

fn slug(s: &str) -> String {
    let out: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "workflow".to_string()
    } else {
        trimmed
    }
}

fn download_response(bytes: Vec<u8>, filename: &str, mime: &str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        )
        .body(Body::from(bytes))
        .unwrap()
}

fn zip_dir(root: &StdPath, archive_root: &str) -> Result<Vec<u8>> {
    let mut buf: Vec<u8> = Vec::new();
    {
        let cursor = std::io::Cursor::new(&mut buf);
        let mut zw = zip::ZipWriter::new(cursor);
        let opts = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);
        zw.add_directory(format!("{}/", archive_root), opts.clone())?;
        zip_visit(root, root, archive_root, &mut zw, &opts)?;
        zw.finish()?;
    }
    Ok(buf)
}

fn zip_visit<W: std::io::Write + std::io::Seek>(
    root: &StdPath,
    dir: &StdPath,
    archive_root: &str,
    zw: &mut zip::ZipWriter<W>,
    opts: &FullFileOptions,
) -> Result<()> {
    for entry in fs::read_dir(dir).with_context(|| format!("reading {}", dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .with_context(|| format!("stripping prefix from {}", path.display()))?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let name = format!("{}/{}", archive_root, rel_str);
        if path.is_dir() {
            zw.add_directory(format!("{}/", name), opts.clone())?;
            zip_visit(root, &path, archive_root, zw, &opts.clone())?;
        } else {
            zw.start_file(&name, opts.clone()).with_context(|| format!("starting file {}", name))?;
            let data = fs::read(&path)
                .with_context(|| format!("reading {}", path.display()))?;
            zw.write_all(&data)?;
        }
    }
    Ok(())
}

fn build_binary(root: &StdPath, opts: &BuildOptions) -> Result<(Vec<u8>, String)> {
    let target_goos = opts
        .goos
        .clone()
        .unwrap_or_else(|| std::env::consts::OS.to_string());
    let bin_name = if target_goos == "windows" {
        "workflow.exe"
    } else {
        "workflow"
    };

    let out_dir = root.join("_build");
    fs::create_dir_all(&out_dir)?;
    let out_path = out_dir.join(bin_name);

    let sync = Command::new("go")
        .arg("work")
        .arg("sync")
        .current_dir(root)
        .output();
    if let Err(e) = &sync {
        bail!(
            "failed to run `go work sync`: {e}. Install Go (>=1.22) and make sure it's on PATH."
        );
    }

    let mut cmd = Command::new("go");
    cmd.current_dir(root.join("workflow"));
    cmd.arg("build").arg("-o").arg(&out_path);

    if opts.trimpath {
        cmd.arg("-trimpath");
    }

    let mut ldflags_parts: Vec<&str> = Vec::new();
    if opts.strip {
        ldflags_parts.push("-s");
        ldflags_parts.push("-w");
    }
    if !ldflags_parts.is_empty() {
        cmd.arg("-ldflags").arg(ldflags_parts.join(" "));
    }

    match opts.optimize.as_deref() {
        Some("none") | Some("debug") => {
            cmd.arg("-gcflags").arg("all=-N -l");
        }
        Some("size") => {
            if !opts.strip {
                cmd.arg("-ldflags").arg("-s -w");
            }
        }
        _ => {}
    }

    if let Some(v) = &opts.goos {
        cmd.env("GOOS", v);
    }
    if let Some(v) = &opts.goarch {
        cmd.env("GOARCH", v);
    }

    let output = cmd
        .output()
        .map_err(|e| anyhow!("failed to invoke `go build`: {e}. Install Go (>=1.22) on PATH."))?;
    if !output.status.success() {
        bail!(
            "go build failed (exit {}):\n--- stdout ---\n{}\n--- stderr ---\n{}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let bytes = fs::read(&out_path)
        .with_context(|| format!("reading produced binary {}", out_path.display()))?;
    Ok((bytes, bin_name.to_string()))
}
