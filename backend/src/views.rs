use compiler::ast::TypeRef;
use compiler::registry::{ComponentDef, Consumption, DispatchMode, ModuleManifest, PortDef, TweakDef, TypeDecl};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleView {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub license: String,
    pub category: String,
    pub effect_tags: Vec<String>,
    pub exported_types: Vec<TypeView>,
    pub components: Vec<ComponentView>,
    pub docs: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeView {
    pub name: String,
    pub kind: &'static str,
    pub fields: Vec<FieldView>,
    pub variants: Vec<String>,
    pub source_module: String,
    pub sealed: bool,
}

#[derive(Serialize)]
pub struct FieldView {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: TypeRef,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentView {
    pub name: String,
    pub description: String,
    pub category: String,
    pub inputs: Vec<PortView>,
    pub outputs: Vec<PortView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_type: Option<TypeRef>,
    pub tweaks: Vec<TweakViewItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispatch_mode: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispatch_type: Option<TypeRef>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dispatch_input_name: Option<String>,
}

#[derive(Serialize)]
pub struct PortView {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: TypeRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consumption: Option<&'static str>,
}

#[derive(Serialize)]
pub struct TweakViewItem {
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub ty: TypeRef,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<Value>,
}

pub fn view_module(m: &ModuleManifest) -> ModuleView {
    let exported_types = m
        .types
        .iter()
        .map(|t| view_type(t, &m.id))
        .collect();
    let mut components: Vec<ComponentView> =
        m.components.values().map(view_component).collect();
    components.sort_by(|a, b| a.name.cmp(&b.name));

    ModuleView {
        id: m.id.clone(),
        name: m.name.clone(),
        version: m.version.clone(),
        description: m.description.clone(),
        author: m.author.clone(),
        license: m.license.clone(),
        category: m.category.clone().unwrap_or_else(|| "Modules".to_string()),
        effect_tags: m.effect_tags.clone(),
        exported_types,
        components,
        docs: m.readme.clone().unwrap_or_default(),
    }
}

fn view_type(t: &TypeDecl, source_module: &str) -> TypeView {
    use compiler::ast::CustomTypeKind;
    let kind = match t.kind {
        CustomTypeKind::Struct => "struct",
        CustomTypeKind::Enum => "enum",
    };
    TypeView {
        name: t.name.clone(),
        kind,
        fields: t
            .fields
            .iter()
            .map(|f| FieldView { name: f.name.clone(), ty: f.ty.clone() })
            .collect(),
        variants: t.variants.clone(),
        source_module: source_module.to_string(),
        sealed: t.sealed,
    }
}

fn view_component(c: &ComponentDef) -> ComponentView {
    ComponentView {
        name: c.name.clone(),
        description: c.description.clone(),
        category: c.category.clone().unwrap_or_else(|| "action".to_string()),
        inputs: c.inputs.iter().map(view_port).collect(),
        outputs: c.outputs.iter().map(view_port).collect(),
        error_type: c.error_type.clone(),
        tweaks: c.tweaks.iter().map(view_tweak).collect(),
        dispatch_mode: c.dispatch_mode.as_ref().map(dispatch_mode_str),
        dispatch_type: c.dispatch_type.clone(),
        dispatch_input_name: c.dispatch_input_name.clone(),
    }
}

fn dispatch_mode_str(m: &DispatchMode) -> &'static str {
    match m {
        DispatchMode::Required => "required",
        DispatchMode::Either => "either",
        DispatchMode::None => "none",
    }
}

fn view_port(p: &PortDef) -> PortView {
    PortView {
        name: p.name.clone(),
        ty: p.ty.clone(),
        consumption: p.consumption.as_ref().map(consumption_str),
    }
}

fn view_tweak(t: &TweakDef) -> TweakViewItem {
    TweakViewItem {
        name: t.name.clone(),
        description: t.description.clone(),
        ty: t.ty.clone(),
        default: t.default.clone(),
    }
}

fn consumption_str(c: &Consumption) -> &'static str {
    match c {
        Consumption::Consumed => "consumed",
        Consumption::Passthrough => "passthrough",
    }
}
