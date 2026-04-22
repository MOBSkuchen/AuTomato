use compiler::{compile_to_workspace, registry::Registry, typecheck, workspace, ast, emit};
use serde_json::json;
use std::path::{Path, PathBuf};

fn modules_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("modules")
}

fn example_workflow() -> serde_json::Value {
    json!({
        "id": "wf_smoke",
        "name": "Smoke",
        "version": "0.1.0",
        "custom_types": [],
        "entry": "n_trigger",
        "nodes": [
            {
                "id": "n_trigger",
                "kind": "module",
                "category": "trigger",
                "module_id": "automato/webhook",
                "component": "on_request"
            },
            {
                "id": "n_fetch",
                "kind": "module",
                "category": "action",
                "module_id": "automato/http-request",
                "component": "fetch",
                "has_error": true
            },
            {
                "id": "n_log",
                "kind": "module",
                "category": "action",
                "module_id": "automato/log",
                "component": "info"
            },
            {
                "id": "n_resp",
                "kind": "module",
                "category": "return",
                "module_id": "automato/return",
                "component": "http_response"
            },
            {
                "id": "n_err",
                "kind": "module",
                "category": "return",
                "module_id": "automato/return",
                "component": "ok"
            },
            {
                "id": "n_status",
                "kind": "constant",
                "module_id": "",
                "component": "",
                "constant_type": { "kind": "int" },
                "constant_value": 200
            },
            {
                "id": "n_body",
                "kind": "constant",
                "module_id": "",
                "component": "",
                "constant_type": { "kind": "string" },
                "constant_value": "Ping!"
            }
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
    })
}

#[test]
fn modules_dir_exists() {
    assert!(modules_dir().exists(), "modules/ missing at {}", modules_dir().display());
}

#[test]
fn registry_loads_all_modules() {
    let reg = Registry::load(&modules_dir()).unwrap();
    let ids: Vec<_> = reg.modules().map(|m| m.id.clone()).collect();
    for expected in [
        "automato/webhook",
        "automato/cron",
        "automato/return",
        "automato/http-request",
        "automato/json-parse",
        "automato/log",
        "automato/string",
        "automato/http-request-build",
        "automato/gmail",
    ] {
        assert!(ids.iter().any(|i| i == expected), "missing {expected}");
    }
}

#[test]
fn typecheck_accepts_smoke() {
    let reg = Registry::load(&modules_dir()).unwrap();
    let wf: ast::Workflow = serde_json::from_value(example_workflow()).unwrap();
    typecheck::validate(&wf, &reg).unwrap();
}

#[test]
fn emit_main_contains_expected() {
    let reg = Registry::load(&modules_dir()).unwrap();
    let wf: ast::Workflow = serde_json::from_value(example_workflow()).unwrap();
    let go = emit::emit_main(&wf, &reg).unwrap();
    let body = go.body;
    assert!(body.contains("func WorkflowEntry(var_n_trigger_request"), "missing entry signature: {body}");
    assert!(body.contains("mod_automato_webhook.OnRequest(WorkflowEntry)"), "missing callback wiring");
    assert!(body.contains("mod_automato_http_request.Fetch(var_n_trigger_request)"), "missing fetch call");
    assert!(body.contains("if err_n_fetch != nil"), "missing error check");
    assert!(body.contains("mod_automato_log.Info(var_n_log_message__pt"), "expected passthrough hoist for log.message");
    assert!(body.contains("var_n_status_value := int64(200)"), "constant not lowered");
    assert!(body.contains("var_n_body_value := \"Ping!\""), "string constant not lowered");
    assert!(body.contains("mod_automato_return.HttpResponse(var_n_status_value, var_n_body_value)"), "missing return call");
}

#[test]
fn workspace_writes_files() {
    let out = std::env::temp_dir().join(format!(
        "automato_smoke_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let ws = compile_to_workspace(&example_workflow(), &modules_dir(), &out).unwrap();
    assert!(ws.files.contains_key(&PathBuf::from("go.work")));
    assert!(ws.files.contains_key(&PathBuf::from("workflow/main.go")));
    assert!(ws.files.contains_key(&PathBuf::from("workflow/go.mod")));
    assert!(ws.files.contains_key(&PathBuf::from("modules/automato/webhook/go.mod")));
    assert!(ws.files.contains_key(&PathBuf::from("modules/automato/webhook/webhook.go")));
    assert!(ws.files.contains_key(&PathBuf::from("modules/automato/http-request/fetch.go")));
    assert!(out.join("workflow/main.go").exists(), "main.go not written to disk");
    let _ = std::fs::remove_dir_all(&out);
}

#[test]
fn typecheck_rejects_type_mismatch() {
    let reg = Registry::load(&modules_dir()).unwrap();
    let mut v = example_workflow();
    let edges = v.get_mut("edges").unwrap().as_array_mut().unwrap();
    edges.push(json!({
        "id": "e_bad",
        "from_node": "n_status",
        "from_port": "value",
        "to_node": "n_log",
        "to_port": "message",
        "kind": "data"
    }));
    let wf: ast::Workflow = serde_json::from_value(v).unwrap();
    let err = typecheck::validate(&wf, &reg).unwrap_err();
    assert!(format!("{err}").contains("type mismatch") || format!("{err}").contains("incoming edges"), "unexpected error: {err}");
}

#[test]
fn workspace_includes_transitive() {
    let ws = workspace::build_workspace(
        &serde_json::from_value::<ast::Workflow>(example_workflow()).unwrap(),
        &Registry::load(&modules_dir()).unwrap(),
    )
    .unwrap();
    assert!(
        ws.files.contains_key(&PathBuf::from("modules/automato/webhook/webhook.go")),
        "transitive dep webhook not included via http-request"
    );
}
