use compiler::compile_to_workspace;
use serde_json::json;
use std::path::{Path, PathBuf};

fn main() {
    let modules_dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("modules");
    let out = PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| "./tmp/automato_e2e".to_string()));

    let wf = json!({
        "id": "wf_smoke",
        "name": "Smoke",
        "version": "0.1.0",
        "custom_types": [],
        "entry": "n_trigger",
        "nodes": [
            { "id": "n_trigger", "kind": "module", "category": "trigger",
              "module_id": "automato/webhook", "component": "on_request" },
            { "id": "n_fetch", "kind": "module", "category": "action",
              "module_id": "automato/http-request", "component": "fetch", "has_error": true },
            { "id": "n_log", "kind": "module", "category": "action",
              "module_id": "automato/log", "component": "info" },
            { "id": "n_resp", "kind": "module", "category": "return",
              "module_id": "automato/return", "component": "http_response" },
            { "id": "n_err", "kind": "module", "category": "return",
              "module_id": "automato/return", "component": "ok" },
            { "id": "n_status", "kind": "constant", "module_id": "", "component": "",
              "constant_type": { "kind": "int" }, "constant_value": 200 },
            { "id": "n_body", "kind": "constant", "module_id": "", "component": "",
              "constant_type": { "kind": "string" }, "constant_value": "Ping!" }
        ],
        "edges": [
            { "id": "e1", "from_node": "n_trigger", "from_port": "__out__", "to_node": "n_fetch", "to_port": "__in__", "kind": "exec" },
            { "id": "e2", "from_node": "n_trigger", "from_port": "request", "to_node": "n_fetch", "to_port": "request", "kind": "data" },
            { "id": "e3", "from_node": "n_fetch", "from_port": "__out__", "to_node": "n_log", "to_port": "__in__", "kind": "exec" },
            { "id": "e4", "from_node": "n_fetch", "from_port": "body", "to_node": "n_log", "to_port": "message", "kind": "data" },
            { "id": "e5", "from_node": "n_fetch", "from_port": "__err__", "to_node": "n_err", "to_port": "__in__", "kind": "exec" },
            { "id": "e6", "from_node": "n_log", "from_port": "__out__", "to_node": "n_resp", "to_port": "__in__", "kind": "exec" },
            { "id": "e7", "from_node": "n_status", "from_port": "value", "to_node": "n_resp", "to_port": "status", "kind": "data" },
            { "id": "e8", "from_node": "n_body", "from_port": "value", "to_node": "n_resp", "to_port": "body", "kind": "data" }
        ]
    });

    let _ws = compile_to_workspace(&wf, &modules_dir, &out).unwrap();
    println!("workspace written to {}", out.display());
}
