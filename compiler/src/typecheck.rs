use crate::ast::*;
use crate::registry::{ComponentDef, Consumption, DispatchMode, ModuleManifest, Registry, TweakDef, TypeDecl};
use anyhow::{anyhow, bail, Result};
use std::collections::{BTreeMap, HashMap};

pub fn validate(workflow: &Workflow, reg: &Registry) -> Result<()> {
    let nodes: HashMap<&str, &NodeInstance> =
        workflow.nodes.iter().map(|n| (n.id.as_str(), n)).collect();

    let mut data_in_count: HashMap<(&str, &str), u32> = HashMap::new();
    let mut data_out_targets: HashMap<(&str, &str), u32> = HashMap::new();
    let mut exec_out_count: HashMap<(&str, &str), u32> = HashMap::new();

    for e in &workflow.edges {
        if !nodes.contains_key(e.from_node.as_str()) {
            bail!("edge {} references unknown from_node '{}'", e.id, e.from_node);
        }
        if !nodes.contains_key(e.to_node.as_str()) {
            bail!("edge {} references unknown to_node '{}'", e.id, e.to_node);
        }
        match e.kind {
            EdgeKind::Data => {
                *data_in_count
                    .entry((e.to_node.as_str(), e.to_port.as_str()))
                    .or_insert(0) += 1;
                *data_out_targets
                    .entry((e.from_node.as_str(), e.from_port.as_str()))
                    .or_insert(0) += 1;
            }
            EdgeKind::Exec => {
                *exec_out_count
                    .entry((e.from_node.as_str(), e.from_port.as_str()))
                    .or_insert(0) += 1;
            }
        }
    }

    for ((node, port), n) in &data_in_count {
        if *n > 1 {
            bail!(
                "data port {}.{} has {} incoming edges; at most one is allowed",
                node,
                port,
                n
            );
        }
    }

    for ((node, port), n) in &exec_out_count {
        if *n > 1 {
            bail!(
                "exec source {}.{} has {} outgoing edges; exec sources are strictly 1-to-1",
                node,
                port,
                n
            );
        }
    }

    let mut origin_count = 0;
    let mut return_count = 0;
    let mut main_trigger_count = 0;
    for n in &workflow.nodes {
        let cat = derived_category(n, reg);
        match cat {
            Some(NodeCategory::Origin) => origin_count += 1,
            Some(NodeCategory::Return) => return_count += 1,
            Some(NodeCategory::Trigger) => {
                let module = reg.require(&n.module_id)?;
                let comp = module.component(&n.component).ok_or_else(|| {
                    anyhow!("node {}: unknown component '{}'", n.id, n.component)
                })?;
                let dispatch_input = comp.dispatch_input_name.as_deref();
                let is_wired = dispatch_input
                    .map(|name| {
                        workflow.edges.iter().any(|e| {
                            e.to_node == n.id && e.to_port == name && e.kind == EdgeKind::Data
                        })
                    })
                    .unwrap_or(false);
                match comp.dispatch_mode.as_ref() {
                    Some(DispatchMode::Required) if !is_wired => {
                        bail!(
                            "trigger node {} ({}/{}) requires a dispatch connection but has none",
                            n.id,
                            n.module_id,
                            n.component
                        );
                    }
                    Some(DispatchMode::None) if is_wired => {
                        bail!(
                            "trigger node {} ({}/{}) has dispatch_mode:none and cannot accept a dispatch connection",
                            n.id,
                            n.module_id,
                            n.component
                        );
                    }
                    _ => {}
                }
                if !is_wired {
                    main_trigger_count += 1;
                }
            }
            _ => {}
        }
        validate_node_against_module(n, workflow, reg)?;
    }

    if origin_count > 1 {
        bail!("workflow must have at most one origin node (found {})", origin_count);
    }

    if origin_count == 1 {
        if main_trigger_count > 0 {
            bail!(
                "origin-rooted workflow cannot contain {} standalone trigger(s); all triggers must be sub-triggers wired to a Dispatch node",
                main_trigger_count
            );
        }
    } else {
        if main_trigger_count != 1 {
            bail!(
                "workflow must have exactly one entry: either an origin node or a single standalone trigger (found {} standalone triggers)",
                main_trigger_count
            );
        }
        if return_count == 0 {
            bail!("workflow must have at least one return node");
        }
    }

    let entry_ids: Vec<&str> = if !workflow.entries.is_empty() {
        workflow.entries.iter().map(|s| s.as_str()).collect()
    } else if let Some(entry) = &workflow.entry {
        vec![entry.as_str()]
    } else {
        vec![]
    };

    for entry in entry_ids {
        let n = nodes
            .get(entry)
            .copied()
            .ok_or_else(|| anyhow!("entry '{}' references unknown node", entry))?;
        let cat = derived_category(n, reg);
        if cat != Some(NodeCategory::Trigger) && cat != Some(NodeCategory::Origin) {
            bail!("entry '{}' is not a trigger or origin node", entry);
        }
    }

    for e in &workflow.edges {
        if e.kind != EdgeKind::Data {
            continue;
        }
        let src = nodes[e.from_node.as_str()];
        let dst = nodes[e.to_node.as_str()];
        let src_ty = resolve_port_type(src, &e.from_port, /*is_output=*/ true, workflow, reg)?;
        let dst_ty = resolve_port_type(dst, &e.to_port, /*is_output=*/ false, workflow, reg)?;
        if !types_compatible(&src_ty, &dst_ty) {
            bail!(
                "edge {}: type mismatch — {}.{} : {} cannot connect to {}.{} : {}",
                e.id,
                src.id,
                e.from_port,
                show(&src_ty),
                dst.id,
                e.to_port,
                show(&dst_ty)
            );
        }

        let from_is_dispatch = derived_category(src, reg) == Some(NodeCategory::Dispatch);
        if !from_is_dispatch {
            if let Some(Consumption::Consumed) = consumption_of_input(dst, &e.to_port, reg)? {
                let fanout = data_out_targets
                    .get(&(e.from_node.as_str(), e.from_port.as_str()))
                    .copied()
                    .unwrap_or(0);
                if fanout > 1 {
                    bail!(
                        "edge {}: target input {}.{} is 'consumed' but its source {}.{} fans out to {} edges",
                        e.id,
                        dst.id,
                        e.to_port,
                        src.id,
                        e.from_port,
                        fanout
                    );
                }
            }
        }
    }

    Ok(())
}

pub fn derived_category(node: &NodeInstance, reg: &Registry) -> Option<NodeCategory> {
    if let Some(c) = node.category {
        return Some(c);
    }
    match node.kind {
        NodeKind::Constant => Some(NodeCategory::Pure),
        NodeKind::Branch | NodeKind::Loop => Some(NodeCategory::Logic),
        NodeKind::Construct | NodeKind::Destruct => Some(NodeCategory::Pure),
        NodeKind::Origin => Some(NodeCategory::Origin),
        NodeKind::Exit => Some(NodeCategory::Return),
        NodeKind::EnvConst => Some(NodeCategory::Pure),
        NodeKind::Module => {
            if let Ok(module) = reg.require(&node.module_id) {
                if let Some(comp) = module.component(&node.component) {
                    if let Some(cat) = &comp.category {
                        return match cat.as_str() {
                            "trigger" => Some(NodeCategory::Trigger),
                            "action" => Some(NodeCategory::Action),
                            "pure" => Some(NodeCategory::Pure),
                            "logic" => Some(NodeCategory::Logic),
                            "return" => Some(NodeCategory::Return),
                            "dispatch" => Some(NodeCategory::Dispatch),
                            _ => None,
                        };
                    }
                }
            }
            None
        }
    }
}

pub fn resolve_struct_type<'a>(
    workflow: &'a Workflow,
    reg: &'a Registry,
    name: &str,
) -> Result<StructInfo<'a>> {
    if let Some((_m, td)) = reg.type_decl(name) {
        if td.sealed {
            bail!("type '{}' is sealed and cannot be constructed/destructed", name);
        }
        if td.kind != CustomTypeKind::Struct {
            bail!("type '{}' is not a struct type", name);
        }
        return Ok(StructInfo::Module(td));
    }
    if let Some(ct) = workflow.custom_types.iter().find(|t| t.name == name) {
        if ct.sealed {
            bail!("type '{}' is sealed", name);
        }
        if ct.kind != CustomTypeKind::Struct {
            bail!("type '{}' is not a struct type", name);
        }
        return Ok(StructInfo::Workflow(ct));
    }
    bail!("unknown custom type '{}'", name)
}

pub enum StructInfo<'a> {
    Module(&'a TypeDecl),
    Workflow(&'a CustomType),
}

impl<'a> StructInfo<'a> {
    pub fn fields(&self) -> Vec<(&'a str, TypeRef)> {
        match self {
            StructInfo::Module(td) => td
                .fields
                .iter()
                .map(|f| (f.name.as_str(), f.ty.clone()))
                .collect(),
            StructInfo::Workflow(ct) => ct
                .fields
                .iter()
                .map(|f| (f.name.as_str(), f.ty.clone()))
                .collect(),
        }
    }
}

pub fn lookup_enum_variants<'a>(
    workflow: &'a Workflow,
    reg: &'a Registry,
    name: &str,
) -> Option<Vec<String>> {
    if let Some((_m, td)) = reg.type_decl(name) {
        if td.kind == CustomTypeKind::Enum {
            return Some(td.variants.clone());
        }
    }
    if let Some(ct) = workflow.custom_types.iter().find(|t| t.name == name) {
        if ct.kind == CustomTypeKind::Enum {
            return Some(ct.variants.clone());
        }
    }
    None
}

pub fn is_enum_type(workflow: &Workflow, reg: &Registry, name: &str) -> bool {
    lookup_enum_variants(workflow, reg, name).is_some()
}

fn validate_tweaks(
    node: &NodeInstance,
    tweaks: &[TweakDef],
    workflow: &Workflow,
    reg: &Registry,
) -> Result<()> {
    for t in tweaks {
        let supplied = node.tweak_values.get(&t.name).or(t.default.as_ref());
        let v = supplied.ok_or_else(|| {
            anyhow!(
                "node {}: tweak '{}' has no value and no default",
                node.id,
                t.name
            )
        })?;
        validate_literal_for_type(v, &t.ty, workflow, reg).map_err(|e| {
            anyhow!(
                "node {}: tweak '{}': {}",
                node.id,
                t.name,
                e
            )
        })?;
    }
    Ok(())
}

fn validate_literal_for_type(
    v: &serde_json::Value,
    ty: &TypeRef,
    workflow: &Workflow,
    reg: &Registry,
) -> Result<()> {
    use serde_json::Value;
    match (v, ty) {
        (Value::Null, _) => Ok(()),
        (Value::Bool(_), TypeRef::Bool) => Ok(()),
        (Value::Number(_), TypeRef::Int | TypeRef::Float) => Ok(()),
        (Value::String(_), TypeRef::String) => Ok(()),
        (Value::String(s), TypeRef::Custom { name }) => {
            if let Some(variants) = lookup_enum_variants(workflow, reg, name) {
                if variants.iter().any(|v| v == s) {
                    Ok(())
                } else {
                    bail!("'{}' is not a variant of enum {}", s, name)
                }
            } else {
                bail!("expected custom {} but got string", name)
            }
        }
        (_, TypeRef::Any) => Ok(()),
        (Value::Array(arr), TypeRef::Array { of }) => {
            for x in arr {
                validate_literal_for_type(x, of, workflow, reg)?;
            }
            Ok(())
        }
        (Value::Object(obj), TypeRef::Dict { value }) => {
            for (_, x) in obj {
                validate_literal_for_type(x, value, workflow, reg)?;
            }
            Ok(())
        }
        _ => bail!("literal shape does not match expected type"),
    }
}

fn validate_node_against_module(
    node: &NodeInstance,
    workflow: &Workflow,
    reg: &Registry,
) -> Result<()> {
    match node.kind {
        NodeKind::Module => {
            let module = reg.require(&node.module_id)?;
            let comp = module.component(&node.component).ok_or_else(|| {
                anyhow!(
                    "node {}: module '{}' has no component '{}'",
                    node.id,
                    node.module_id,
                    node.component
                )
            })?;
            validate_tweaks(node, &comp.tweaks, workflow, reg)?;
        }
        NodeKind::Constant => {
            let ty = node
                .constant_type
                .as_ref()
                .ok_or_else(|| anyhow!("constant node {} is missing constant_type", node.id))?;
            if let (TypeRef::Custom { name }, Some(v)) =
                (ty, node.constant_value.as_ref())
            {
                if let Some(variants) = lookup_enum_variants(workflow, reg, name) {
                    let s = v
                        .as_str()
                        .ok_or_else(|| anyhow!("enum constant {} expects string variant", node.id))?;
                    if !variants.iter().any(|vn| vn == s) {
                        bail!(
                            "constant node {}: '{}' is not a variant of enum '{}'",
                            node.id,
                            s,
                            name
                        );
                    }
                }
            }
        }
        NodeKind::Construct | NodeKind::Destruct => {
            let name = node.target_type.as_ref().ok_or_else(|| {
                anyhow!(
                    "{} node {} is missing target_type",
                    match node.kind {
                        NodeKind::Construct => "construct",
                        _ => "destruct",
                    },
                    node.id
                )
            })?;
            let _ = resolve_struct_type(workflow, reg, name)
                .map_err(|e| anyhow!("node {}: {}", node.id, e))?;
        }
        NodeKind::Branch | NodeKind::Loop => {}
        NodeKind::Origin => {}
        NodeKind::Exit => {}
        NodeKind::EnvConst => {
            node.env_key.as_ref().ok_or_else(|| {
                anyhow!("env_const node {} is missing env_key", node.id)
            })?;
        }
    }
    Ok(())
}

fn consumption_of_input(
    node: &NodeInstance,
    port: &str,
    reg: &Registry,
) -> Result<Option<Consumption>> {
    if !matches!(node.kind, NodeKind::Module) {
        return Ok(None);
    }
    let module = reg.require(&node.module_id)?;
    let comp = module
        .component(&node.component)
        .ok_or_else(|| anyhow!("node {} references unknown component", node.id))?;
    Ok(comp
        .inputs
        .iter()
        .find(|p| p.name == port)
        .and_then(|p| p.consumption.clone()))
}

pub fn resolve_port_type(
    node: &NodeInstance,
    port: &str,
    is_output: bool,
    workflow: &Workflow,
    reg: &Registry,
) -> Result<TypeRef> {
    match node.kind {
        NodeKind::Construct => {
            let name = node
                .target_type
                .as_ref()
                .ok_or_else(|| anyhow!("construct node {} missing target_type", node.id))?;
            let info = resolve_struct_type(workflow, reg, name)?;
            if is_output {
                if port == DATA_CONSTRUCT_OUT {
                    Ok(TypeRef::Custom { name: name.clone() })
                } else {
                    bail!("construct node {} has no output port '{}'", node.id, port)
                }
            } else {
                info.fields()
                    .into_iter()
                    .find(|(n, _)| *n == port)
                    .map(|(_, ty)| ty)
                    .ok_or_else(|| {
                        anyhow!(
                            "construct node {} ({}) has no input port '{}'",
                            node.id,
                            name,
                            port
                        )
                    })
            }
        }
        NodeKind::Destruct => {
            let name = node
                .target_type
                .as_ref()
                .ok_or_else(|| anyhow!("destruct node {} missing target_type", node.id))?;
            let info = resolve_struct_type(workflow, reg, name)?;
            if is_output {
                info.fields()
                    .into_iter()
                    .find(|(n, _)| *n == port)
                    .map(|(_, ty)| ty)
                    .ok_or_else(|| {
                        anyhow!(
                            "destruct node {} ({}) has no output port '{}'",
                            node.id,
                            name,
                            port
                        )
                    })
            } else if port == DATA_DESTRUCT_IN {
                Ok(TypeRef::Custom { name: name.clone() })
            } else {
                bail!("destruct node {} has no input port '{}'", node.id, port)
            }
        }
        NodeKind::Constant => {
            if !is_output {
                bail!("constant node {} has no input ports", node.id);
            }
            node.constant_type
                .clone()
                .ok_or_else(|| anyhow!("constant node {} has no type", node.id))
        }
        NodeKind::Branch => {
            if is_output {
                bail!(
                    "branch node {}: output port '{}' is not a data port",
                    node.id,
                    port
                );
            }
            if port == "cond" {
                Ok(TypeRef::Bool)
            } else {
                bail!("branch node {} has no input port '{}'", node.id, port)
            }
        }
        NodeKind::Loop => {
            if is_output {
                if port == DATA_LOOP_ITEM {
                    Ok(TypeRef::Any)
                } else {
                    bail!("loop node {} has no output port '{}'", node.id, port)
                }
            } else if port == "list" {
                Ok(TypeRef::Array {
                    of: Box::new(TypeRef::Any),
                })
            } else {
                bail!("loop node {} has no input port '{}'", node.id, port)
            }
        }
        NodeKind::Origin => {
            bail!("origin node {} has no data ports", node.id);
        }
        NodeKind::Exit => {
            if is_output {
                bail!("exit node {} has no output ports", node.id);
            }
            if port == DATA_EXIT_CODE {
                Ok(TypeRef::Int)
            } else {
                bail!("exit node {} has no input port '{}'", node.id, port)
            }
        }
        NodeKind::EnvConst => {
            if !is_output {
                bail!("env_const node {} has no input ports", node.id);
            }
            if port == "value" {
                Ok(TypeRef::String)
            } else {
                bail!("env_const node {} has no output port '{}'", node.id, port)
            }
        }
        NodeKind::Module => {
            let module = reg.require(&node.module_id)?;
            let comp = module
                .component(&node.component)
                .ok_or_else(|| anyhow!("node {}: unknown component", node.id))?;
            module_port_type(node, comp, port, is_output)
        }
    }
}

fn module_port_type(
    node: &NodeInstance,
    comp: &ComponentDef,
    port: &str,
    is_output: bool,
) -> Result<TypeRef> {
    if is_output {
        if port == DATA_ERRVAL {
            return comp
                .error_type
                .clone()
                .ok_or_else(|| anyhow!("node {}: __errval__ used but component has no error_type", node.id));
        }
        if let Some(input_name) = passthrough_source_input(port) {
            let pt_input = comp
                .inputs
                .iter()
                .find(|p| p.name == input_name)
                .ok_or_else(|| {
                    anyhow!(
                        "node {}: passthrough port '{}' has no matching input '{}'",
                        node.id,
                        port,
                        input_name
                    )
                })?;
            if pt_input.consumption != Some(Consumption::Passthrough) {
                bail!(
                    "node {}: passthrough port '{}' targets input '{}' which is not marked passthrough",
                    node.id,
                    port,
                    input_name
                );
            }
            return Ok(pt_input.ty.clone());
        }
        let p = comp
            .outputs
            .iter()
            .find(|p| p.name == port)
            .ok_or_else(|| {
                anyhow!(
                    "node {}: component '{}' has no output port '{}'",
                    node.id,
                    comp.name,
                    port
                )
            })?;
        Ok(p.ty.clone())
    } else {
        let p = comp
            .inputs
            .iter()
            .find(|p| p.name == port)
            .ok_or_else(|| {
                anyhow!(
                    "node {}: component '{}' has no input port '{}'",
                    node.id,
                    comp.name,
                    port
                )
            })?;
        Ok(p.ty.clone())
    }
}

pub fn types_compatible(src: &TypeRef, dst: &TypeRef) -> bool {
    match (src, dst) {
        (_, TypeRef::Any) | (TypeRef::Any, _) => true,
        (TypeRef::Int, TypeRef::Float) => true,
        (TypeRef::Int, TypeRef::Int)
        | (TypeRef::Float, TypeRef::Float)
        | (TypeRef::String, TypeRef::String)
        | (TypeRef::Bool, TypeRef::Bool) => true,
        (TypeRef::Array { of: a }, TypeRef::Array { of: b }) => types_compatible(a, b),
        (TypeRef::Dict { value: a }, TypeRef::Dict { value: b }) => types_compatible(a, b),
        (TypeRef::Custom { name: a }, TypeRef::Custom { name: b }) => a == b,
        _ => false,
    }
}

fn show(t: &TypeRef) -> String {
    match t {
        TypeRef::Int => "int".to_string(),
        TypeRef::Float => "float".to_string(),
        TypeRef::String => "string".to_string(),
        TypeRef::Bool => "bool".to_string(),
        TypeRef::Any => "any".to_string(),
        TypeRef::Array { of } => format!("array<{}>", show(of)),
        TypeRef::Dict { value } => format!("dict<{}>", show(value)),
        TypeRef::Custom { name } => name.clone(),
    }
}

#[allow(dead_code)]
fn _unused_btree() -> BTreeMap<String, String> {
    BTreeMap::new()
}

#[allow(dead_code)]
fn _module_alias_probe(m: &ModuleManifest) -> &str {
    &m.alias
}
