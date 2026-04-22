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

pub fn build_workspace(wf: &Workflow, reg: &Registry) -> Result<Workspace> {
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
        docs_md(wf, &included).into_bytes(),
    );

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

fn docs_md(wf: &Workflow, included: &[&ModuleManifest]) -> String {
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
    s.push_str("## Build\n\n");
    s.push_str("```sh\ngo work sync\ncd workflow && go build ./...\n```\n");
    s
}
