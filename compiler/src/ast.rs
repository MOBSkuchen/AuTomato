use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub name: String,
    pub version: String,
    pub custom_types: Vec<CustomType>,
    pub nodes: Vec<NodeInstance>,
    pub edges: Vec<Edge>,
    #[serde(default)]
    pub entry: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomType {
    pub name: String,
    #[serde(default)]
    pub kind: CustomTypeKind,
    #[serde(default)]
    pub fields: Vec<CustomField>,
    #[serde(default)]
    pub variants: Vec<String>,
    #[serde(default)]
    pub source_module: Option<String>,
    #[serde(default)]
    pub sealed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CustomTypeKind {
    Struct,
    Enum,
}

impl Default for CustomTypeKind {
    fn default() -> Self {
        CustomTypeKind::Struct
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomField {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: TypeRef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TypeRef {
    Int,
    Float,
    String,
    Bool,
    Any,
    Array { of: Box<TypeRef> },
    Dict { value: Box<TypeRef> },
    Custom { name: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Module,
    Constant,
    Branch,
    Loop,
    Construct,
    Destruct,
}

impl Default for NodeKind {
    fn default() -> Self {
        NodeKind::Module
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeCategory {
    Trigger,
    Action,
    Pure,
    Logic,
    Return,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryPolicy {
    #[serde(rename = "maxAttempts")]
    pub max_attempts: u32,
    #[serde(rename = "backoffMs")]
    pub backoff_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeInstance {
    pub id: String,
    #[serde(default)]
    pub kind: NodeKind,
    #[serde(default)]
    pub category: Option<NodeCategory>,
    pub module_id: String,
    pub component: String,
    #[serde(default)]
    pub module_version: String,
    #[serde(default)]
    pub module_url: Option<String>,
    #[serde(default)]
    pub literal_inputs: BTreeMap<String, Value>,
    #[serde(default)]
    pub parallel_group: Option<String>,
    #[serde(default)]
    pub retry_policy: Option<RetryPolicy>,
    #[serde(default)]
    pub constant_type: Option<TypeRef>,
    #[serde(default)]
    pub constant_value: Option<Value>,
    #[serde(default)]
    pub has_error: bool,
    #[serde(default)]
    pub target_type: Option<String>,
    #[serde(default)]
    pub tweak_values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub id: String,
    pub from_node: String,
    pub from_port: String,
    pub to_node: String,
    pub to_port: String,
    pub kind: EdgeKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    Data,
    Exec,
}

pub const EXEC_IN: &str = "__in__";
pub const EXEC_OUT: &str = "__out__";
pub const EXEC_ERR: &str = "__err__";
pub const EXEC_TRUE: &str = "__true__";
pub const EXEC_FALSE: &str = "__false__";
pub const EXEC_BODY: &str = "__body__";
pub const EXEC_DONE: &str = "__done__";
pub const DATA_ERRVAL: &str = "__errval__";
pub const DATA_LOOP_ITEM: &str = "item";
pub const DATA_CONSTRUCT_OUT: &str = "value";
pub const DATA_DESTRUCT_IN: &str = "value";

pub fn is_passthrough_port(port: &str) -> bool {
    port.ends_with("__pt")
}

pub fn passthrough_source_input(port: &str) -> Option<&str> {
    port.strip_suffix("__pt")
}
