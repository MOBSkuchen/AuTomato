use crate::ast::{CustomTypeKind, TypeRef};
use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
struct RawMetadata {
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    version: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    license: String,
    package: String,
    #[serde(default)]
    code_file: Option<String>,
    #[serde(default)]
    code_files: Option<Vec<String>>,
    #[serde(default)]
    go_dependencies: Vec<GoDependency>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    effect_tags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GoDependency {
    pub path: String,
    pub version: String,
}

#[derive(Debug, Clone, Deserialize)]
struct RawDefinitions {
    #[serde(default)]
    types: Vec<RawTypeDecl>,
    #[serde(default)]
    components: Vec<RawComponent>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawTypeDecl {
    name: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    fields: Vec<RawField>,
    #[serde(default)]
    variants: Vec<String>,
    #[serde(default)]
    sealed: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct RawField {
    name: String,
    #[serde(rename = "type")]
    ty: TypeRef,
}

#[derive(Debug, Clone, Deserialize)]
struct RawComponent {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    trigger_style: Option<String>,
    #[serde(default)]
    inputs: Vec<RawPort>,
    #[serde(default)]
    outputs: Vec<RawPort>,
    #[serde(default)]
    error_type: Option<TypeRef>,
    #[serde(rename = "impl")]
    #[serde(default)]
    implementation: Option<String>,
    #[serde(default)]
    tweaks: Vec<RawTweak>,
    #[serde(default)]
    dispatch_mode: Option<String>,
    #[serde(default)]
    dispatch_type: Option<TypeRef>,
    #[serde(default)]
    dispatch_input_name: Option<String>,
    #[serde(default)]
    run_method: Option<String>,
    #[serde(default)]
    register_methods: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawPort {
    name: String,
    #[serde(rename = "type")]
    ty: TypeRef,
    #[serde(default)]
    consumption: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawTweak {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(rename = "type")]
    ty: TypeRef,
    #[serde(default)]
    default: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Consumption {
    Consumed,
    Passthrough,
}

#[derive(Debug, Clone)]
pub struct PortDef {
    pub name: String,
    pub ty: TypeRef,
    pub consumption: Option<Consumption>,
}

#[derive(Debug, Clone)]
pub struct TweakDef {
    pub name: String,
    pub description: String,
    pub ty: TypeRef,
    pub default: Option<serde_json::Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TriggerStyle {
    Polling,
    Callback,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DispatchMode {
    Required,
    Either,
    None,
}

#[derive(Debug, Clone)]
pub struct ComponentDef {
    pub name: String,
    pub description: String,
    pub category: Option<String>,
    pub trigger_style: Option<TriggerStyle>,
    pub inputs: Vec<PortDef>,
    pub outputs: Vec<PortDef>,
    pub error_type: Option<TypeRef>,
    pub impl_function: Option<String>,
    pub tweaks: Vec<TweakDef>,
    pub dispatch_mode: Option<DispatchMode>,
    pub dispatch_type: Option<TypeRef>,
    pub dispatch_input_name: Option<String>,
    pub run_method: Option<String>,
    pub register_methods: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct TypeDecl {
    pub name: String,
    pub kind: CustomTypeKind,
    pub fields: Vec<PortDef>,
    pub variants: Vec<String>,
    pub sealed: bool,
}

#[derive(Debug, Clone)]
pub struct ModuleManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub license: String,
    pub package: String,
    pub source_dir: PathBuf,
    pub code_files: Vec<PathBuf>,
    pub go_dependencies: Vec<GoDependency>,
    pub import_path: String,
    pub alias: String,
    pub workspace_subpath: String,
    pub types: Vec<TypeDecl>,
    pub components: HashMap<String, ComponentDef>,
    pub category: Option<String>,
    pub effect_tags: Vec<String>,
    pub readme: Option<String>,
}

impl ModuleManifest {
    pub fn component(&self, name: &str) -> Option<&ComponentDef> {
        self.components.get(name)
    }
}

#[derive(Default)]
pub struct Registry {
    modules: HashMap<String, ModuleManifest>,
    type_owner: HashMap<String, String>,
}

impl Registry {
    pub fn load(modules_dir: &Path) -> Result<Self> {
        let mut modules: HashMap<String, ModuleManifest> = HashMap::new();
        let mut type_owner: HashMap<String, String> = HashMap::new();

        if !modules_dir.exists() {
            return Ok(Self {
                modules,
                type_owner,
            });
        }

        let mut stack = vec![modules_dir.to_path_buf()];
        while let Some(dir) = stack.pop() {
            let entries = match fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };
            let meta_path = dir.join("metadata.json");
            let defs_path = dir.join("definitions.json");
            if meta_path.exists() && defs_path.exists() {
                let manifest = load_manifest(&dir, &meta_path, &defs_path)
                    .with_context(|| format!("loading module at {}", dir.display()))?;
                for t in &manifest.types {
                    type_owner.insert(t.name.clone(), manifest.id.clone());
                }
                if modules.contains_key(&manifest.id) {
                    bail!("duplicate module id '{}' under {}", manifest.id, modules_dir.display());
                }
                modules.insert(manifest.id.clone(), manifest);
                continue;
            }
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    stack.push(p);
                }
            }
        }

        Ok(Self {
            modules,
            type_owner,
        })
    }

    pub fn module(&self, id: &str) -> Option<&ModuleManifest> {
        self.modules.get(id)
    }

    pub fn require(&self, id: &str) -> Result<&ModuleManifest> {
        self.module(id).ok_or_else(|| {
            anyhow!("module '{id}' not found on disk; add it under the modules directory")
        })
    }

    pub fn type_owner(&self, type_name: &str) -> Option<&ModuleManifest> {
        let mid = self.type_owner.get(type_name)?;
        self.modules.get(mid)
    }

    pub fn type_decl(&self, type_name: &str) -> Option<(&ModuleManifest, &TypeDecl)> {
        let m = self.type_owner(type_name)?;
        let td = m.types.iter().find(|t| t.name == type_name)?;
        Some((m, td))
    }

    pub fn modules(&self) -> impl Iterator<Item = &ModuleManifest> {
        self.modules.values()
    }
}

pub fn load_manifest(dir: &Path, meta: &Path, defs: &Path) -> Result<ModuleManifest> {
    let meta_raw: RawMetadata = serde_json::from_slice(&fs::read(meta)?)
        .with_context(|| format!("parsing {}", meta.display()))?;
    let defs_raw: RawDefinitions = serde_json::from_slice(&fs::read(defs)?)
        .with_context(|| format!("parsing {}", defs.display()))?;

    let mut code_files: Vec<PathBuf> = Vec::new();
    if let Some(files) = meta_raw.code_files.as_ref() {
        for f in files {
            code_files.push(dir.join(f));
        }
    }
    if let Some(f) = meta_raw.code_file.as_ref() {
        code_files.push(dir.join(f));
    }
    if code_files.is_empty() {
        bail!(
            "module '{}' has no code_file/code_files in metadata.json",
            meta_raw.id
        );
    }
    for f in &code_files {
        if !f.exists() {
            bail!(
                "module '{}' lists missing source file {}",
                meta_raw.id,
                f.display()
            );
        }
    }

    let alias = sanitize_alias(&meta_raw.id);
    let import_path = format!("automato.local/{}", meta_raw.id);
    let workspace_subpath = format!("modules/{}", meta_raw.id);

    if !is_valid_go_ident(&meta_raw.package) {
        bail!(
            "module '{}': package '{}' is not a valid Go identifier",
            meta_raw.id,
            meta_raw.package
        );
    }

    let mut types: Vec<TypeDecl> = Vec::with_capacity(defs_raw.types.len());
    for t in defs_raw.types {
        let kind = match t.kind.as_deref() {
            None | Some("struct") => CustomTypeKind::Struct,
            Some("enum") => CustomTypeKind::Enum,
            Some(other) => bail!(
                "module '{}': type '{}' has unknown kind '{}'",
                meta_raw.id,
                t.name,
                other
            ),
        };
        if kind == CustomTypeKind::Enum {
            if t.variants.is_empty() {
                bail!(
                    "module '{}': enum '{}' declares no variants",
                    meta_raw.id,
                    t.name
                );
            }
            if !t.fields.is_empty() {
                bail!(
                    "module '{}': enum '{}' may not declare fields",
                    meta_raw.id,
                    t.name
                );
            }
            if t.sealed {
                bail!(
                    "module '{}': enum '{}' cannot be sealed",
                    meta_raw.id,
                    t.name
                );
            }
        }
        types.push(TypeDecl {
            name: t.name,
            kind,
            fields: t
                .fields
                .into_iter()
                .map(|f| PortDef {
                    name: f.name,
                    ty: f.ty,
                    consumption: None,
                })
                .collect(),
            variants: t.variants,
            sealed: t.sealed,
        });
    }

    let mut components = HashMap::new();
    for c in defs_raw.components {
        let trigger_style = match c.trigger_style.as_deref() {
            Some("polling") => Some(TriggerStyle::Polling),
            Some("callback") => Some(TriggerStyle::Callback),
            None => None,
            Some(other) => bail!(
                "module '{}': component '{}' has unknown trigger_style '{}'",
                meta_raw.id,
                c.name,
                other
            ),
        };
        let dispatch_mode = match c.dispatch_mode.as_deref() {
            Some("required") => Some(DispatchMode::Required),
            Some("either") => Some(DispatchMode::Either),
            Some("none") => Some(DispatchMode::None),
            None => None,
            Some(other) => bail!(
                "module '{}': component '{}' has unknown dispatch_mode '{}'",
                meta_raw.id,
                c.name,
                other
            ),
        };
        let inputs: Vec<PortDef> = c
            .inputs
            .into_iter()
            .map(|p| port_from_raw(&meta_raw.id, &c.name, p))
            .collect::<Result<_>>()?;
        let outputs: Vec<PortDef> = c
            .outputs
            .into_iter()
            .map(|p| port_from_raw(&meta_raw.id, &c.name, p))
            .collect::<Result<_>>()?;
        let tweaks: Vec<TweakDef> = c
            .tweaks
            .into_iter()
            .map(|t| TweakDef {
                name: t.name,
                description: t.description,
                ty: t.ty,
                default: t.default,
            })
            .collect();
        components.insert(
            c.name.clone(),
            ComponentDef {
                name: c.name,
                description: c.description,
                category: c.category,
                trigger_style,
                inputs,
                outputs,
                error_type: c.error_type,
                impl_function: c.implementation,
                tweaks,
                dispatch_mode,
                dispatch_type: c.dispatch_type,
                dispatch_input_name: c.dispatch_input_name,
                run_method: c.run_method,
                register_methods: c.register_methods,
            },
        );
    }

    let readme_path = dir.join("README.md");
    let readme = fs::read_to_string(&readme_path).ok();

    Ok(ModuleManifest {
        id: meta_raw.id,
        name: meta_raw.name,
        version: meta_raw.version,
        description: meta_raw.description,
        author: meta_raw.author,
        license: meta_raw.license,
        package: meta_raw.package,
        source_dir: dir.to_path_buf(),
        code_files,
        go_dependencies: meta_raw.go_dependencies,
        import_path,
        alias,
        workspace_subpath,
        types,
        components,
        category: meta_raw.category,
        effect_tags: meta_raw.effect_tags,
        readme,
    })
}

fn port_from_raw(module_id: &str, comp: &str, p: RawPort) -> Result<PortDef> {
    let consumption = match p.consumption.as_deref() {
        None => None,
        Some("consumed") => Some(Consumption::Consumed),
        Some("passthrough") => Some(Consumption::Passthrough),
        Some(other) => bail!(
            "module '{}': component '{}' port '{}' has unknown consumption '{}'",
            module_id,
            comp,
            p.name,
            other
        ),
    };
    Ok(PortDef {
        name: p.name,
        ty: p.ty,
        consumption,
    })
}

fn sanitize_alias(id: &str) -> String {
    let mut out = String::with_capacity(id.len() + 4);
    out.push_str("mod_");
    for c in id.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else {
            out.push('_');
        }
    }
    out
}

fn is_valid_go_ident(s: &str) -> bool {
    let mut chars = s.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_') {
        return false;
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}
