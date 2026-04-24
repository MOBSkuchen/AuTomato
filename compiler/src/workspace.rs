use crate::ast::Workflow;
use crate::emit::emit_main;
use crate::registry::{ModuleManifest, Registry};
use crate::typecheck;
use anyhow::{Context, Result};
use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};

const GO_VERSION: &str = "1.22";

pub struct Workspace {
    pub files: BTreeMap<PathBuf, Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct DockerConfig {
    pub enable: bool,
    pub port: u16,
    pub expose: bool,
}

impl Default for DockerConfig {
    fn default() -> Self {
        Self { enable: false, port: 8080, expose: true }
    }
}

impl DockerConfig {
    pub fn disabled() -> Self {
        Self::default()
    }

    pub fn build(&self) -> String {
        let expose_line = if self.expose {
            format!("EXPOSE {}\n\n", self.port)
        } else {
            String::new()
        };
        format!(
            "FROM golang:{GO_VERSION}-alpine AS builder\n\
             \n\
             WORKDIR /workspace\n\
             \n\
             COPY . .\n\
             \n\
             RUN go work sync\n\
             \n\
             WORKDIR /workspace/workflow\n\
             \n\
             RUN CGO_ENABLED=0 GOOS=linux go build -o /app-binary .\n\
             \n\
             FROM alpine:latest\n\
             \n\
             RUN apk --no-cache add ca-certificates\n\
             \n\
             WORKDIR /root/\n\
             \n\
             COPY --from=builder /app-binary .\n\
             \n\
             ENV PORT={port}\n\
             {expose}\
             CMD [\"./app-binary\"]\n",
            port = self.port,
            expose = expose_line,
        )
    }

    pub fn compose(&self, workflow_name: &str) -> String {
        let ports = if self.expose {
            format!("    ports:\n      - \"{p}:{p}\"\n", p = self.port)
        } else {
            String::new()
        };
        format!(
            "services:\n  {name}:\n    build: .\n    image: automato/{name}:latest\n    restart: unless-stopped\n    environment:\n      - PORT={port}\n{ports}",
            name = workflow_name,
            port = self.port,
            ports = ports,
        )
    }
}

pub fn build_workspace(wf: &Workflow, reg: &Registry, docker_config: &DockerConfig) -> Result<Workspace> {
    typecheck::validate(wf, reg)?;
    let go = emit_main(wf, reg)?;

    let direct: Vec<&ModuleManifest> = reg
        .modules()
        .filter(|m| go.imports.contains_key(&m.alias))
        .collect();
    let included = collect_transitive(reg, &direct)?;

    let mut files: BTreeMap<PathBuf, Vec<u8>> = BTreeMap::new();
    files.insert(PathBuf::from("workflow/main.go"), go.body.into_bytes());
    files.insert(
        PathBuf::from("workflow/go.mod"),
        workflow_go_mod(&included).into_bytes(),
    );

    for m in &included {
        let dir = PathBuf::from(&m.workspace_subpath);
        files.insert(dir.join("go.mod"), module_go_mod(m).into_bytes());
        for src in &m.code_files {
            let name = src
                .file_name()
                .ok_or_else(|| anyhow::anyhow!("bad code_file path"))?;
            let bytes =
                fs::read(src).with_context(|| format!("reading {}", src.display()))?;
            files.insert(dir.join(name), bytes);
        }
        let readme = m.source_dir.join("README.md");
        if readme.exists() {
            files.insert(dir.join("README.md"), fs::read(&readme)?);
        }
    }

    files.insert(PathBuf::from("go.work"), go_work(&included).into_bytes());
    files.insert(
        PathBuf::from("DOCS.md"),
        docs_md(wf, &included, docker_config).into_bytes(),
    );

    if docker_config.enable {
        files.insert(PathBuf::from("Dockerfile"), docker_config.build().into_bytes());
        files.insert(
            PathBuf::from(".dockerignore"),
            b"_build/\n*.exe\n*.zip\n".to_vec(),
        );
        let slug = slugify(&wf.name);
        files.insert(
            PathBuf::from("docker-compose.yml"),
            docker_config.compose(&slug).into_bytes(),
        );
    }

    Ok(Workspace { files })
}

pub fn write_workspace(ws: &Workspace, out_dir: &Path) -> Result<()> {
    fs::create_dir_all(out_dir)
        .with_context(|| format!("creating {}", out_dir.display()))?;
    for (rel, bytes) in &ws.files {
        let path = out_dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, bytes).with_context(|| format!("writing {}", path.display()))?;
    }
    Ok(())
}

fn collect_transitive<'a>(
    reg: &'a Registry,
    direct: &[&'a ModuleManifest],
) -> Result<Vec<&'a ModuleManifest>> {
    let mut included: BTreeMap<String, &'a ModuleManifest> = BTreeMap::new();
    let mut queue: VecDeque<&'a ModuleManifest> = direct.iter().copied().collect();
    while let Some(m) = queue.pop_front() {
        if included.contains_key(&m.id) {
            continue;
        }
        included.insert(m.id.clone(), m);
        for f in &m.code_files {
            let src =
                fs::read_to_string(f).with_context(|| format!("reading {}", f.display()))?;
            for other in reg.modules() {
                if other.id == m.id || included.contains_key(&other.id) {
                    continue;
                }
                let needle = format!("automato.local/{}", other.id);
                if src.contains(&needle) {
                    queue.push_back(other);
                }
            }
        }
    }
    Ok(included.into_values().collect())
}

fn slugify(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = s.trim_matches('-').to_string();
    if trimmed.is_empty() { "workflow".to_string() } else { trimmed }
}

fn workflow_go_mod(_included: &[&ModuleManifest]) -> String {
    let mut s = String::new();
    s.push_str("module automato.local/workflow\n\n");
    s.push_str(&format!("go {}\n", GO_VERSION));
    s
}

fn module_go_mod(m: &ModuleManifest) -> String {
    let mut s = String::new();
    s.push_str(&format!("module {}\n\n", m.import_path));
    s.push_str(&format!("go {}\n", GO_VERSION));
    if !m.go_dependencies.is_empty() {
        s.push_str("\nrequire (\n");
        for d in &m.go_dependencies {
            s.push_str(&format!("\t{} {}\n", d.path, d.version));
        }
        s.push_str(")\n");
    }
    s
}

fn go_work(included: &[&ModuleManifest]) -> String {
    let mut s = String::new();
    s.push_str(&format!("go {}\n\nuse (\n", GO_VERSION));
    s.push_str("\t./workflow\n");
    for m in included {
        s.push_str(&format!("\t./{}\n", m.workspace_subpath));
    }
    s.push_str(")\n");
    s
}

fn docs_md(wf: &Workflow, included: &[&ModuleManifest], docker: &DockerConfig) -> String {
    let mut s = String::new();
    s.push_str(&format!("# {} (generated)\n\n", wf.name));
    s.push_str(&format!(
        "Workflow `{}` v{} compiled by automato.\n\n",
        wf.id, wf.version
    ));
    s.push_str("## Layout\n\n");
    s.push_str("```\n");
    s.push_str("go.work               # virtual workspace\n");
    s.push_str("workflow/\n");
    s.push_str("  go.mod              # module automato.local/workflow\n");
    s.push_str("  main.go             # generated entry point\n");
    s.push_str("modules/\n");
    for m in included {
        s.push_str(&format!(
            "  {}/  # {}\n",
            m.id.trim_start_matches("automato/"),
            m.description
        ));
    }
    s.push_str("```\n\n");
    if docker.enable {
        s.push_str("Dockerfile            # container build\n");
        s.push_str("docker-compose.yml    # one-shot run\n");
        s.push_str(".dockerignore\n");
    }
    s.push_str("```\n\n");
    s.push_str("## Build\n\n");
    s.push_str("```sh\ngo work sync\ncd workflow && go build ./...\n```\n");
    if docker.enable {
        let slug = slugify(&wf.name);
        s.push_str("\n## Docker\n\n");
        s.push_str(&format!(
            "```sh\ndocker build -t automato/{slug}:latest .\ndocker run --rm -p {port}:{port} automato/{slug}:latest\n```\n\n",
            slug = slug,
            port = docker.port,
        ));
        s.push_str("Or with compose:\n\n```sh\ndocker compose up --build\n```\n");
    }
    s
}
