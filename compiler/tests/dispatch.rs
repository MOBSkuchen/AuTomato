use compiler::{ast, emit, registry::Registry, typecheck};
use serde_json::json;
use std::path::{Path, PathBuf};

fn modules_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("modules")
}

fn origin_dispatch_workflow() -> serde_json::Value {
    json!({
        "id": "wf_dispatch",
        "name": "Dispatch",
        "version": "0.1.0",
        "custom_types": [],
        "entries": ["n_origin"],
        "nodes": [
            { "id": "n_origin", "kind": "origin", "module_id": "__origin__", "component": "origin" },
            { "id": "n_addr", "kind": "constant", "module_id": "", "component": "",
              "constant_type": { "kind": "string" }, "constant_value": ":8080" },
            { "id": "n_dispatch", "kind": "module", "module_id": "automato/webhook",
              "component": "http_dispatch" },
            { "id": "n_route1", "kind": "module", "module_id": "automato/webhook",
              "component": "on_route",
              "tweak_values": { "path": "/foo", "method": "GET" } },
            { "id": "n_resp1", "kind": "module", "module_id": "automato/webhook",
              "component": "respond",
              "literal_inputs": { "status": 200, "body": "hello foo" } },
            { "id": "n_route2", "kind": "module", "module_id": "automato/webhook",
              "component": "on_route",
              "tweak_values": { "path": "/bar", "method": "POST" } },
            { "id": "n_resp2", "kind": "module", "module_id": "automato/webhook",
              "component": "respond",
              "literal_inputs": { "status": 201, "body": "hello bar" } }
        ],
        "edges": [
            { "id": "e_origin_dispatch", "from_node": "n_origin", "from_port": "__out__",
              "to_node": "n_dispatch", "to_port": "__in__", "kind": "exec" },
            { "id": "e_addr", "from_node": "n_addr", "from_port": "value",
              "to_node": "n_dispatch", "to_port": "address", "kind": "data" },
            { "id": "e_d_r1", "from_node": "n_dispatch", "from_port": "dispatch",
              "to_node": "n_route1", "to_port": "dispatch", "kind": "data" },
            { "id": "e_d_r2", "from_node": "n_dispatch", "from_port": "dispatch",
              "to_node": "n_route2", "to_port": "dispatch", "kind": "data" },
            { "id": "e_r1_resp", "from_node": "n_route1", "from_port": "__out__",
              "to_node": "n_resp1", "to_port": "__in__", "kind": "exec" },
            { "id": "e_r1_ctx", "from_node": "n_route1", "from_port": "ctx",
              "to_node": "n_resp1", "to_port": "ctx", "kind": "data" },
            { "id": "e_r2_resp", "from_node": "n_route2", "from_port": "__out__",
              "to_node": "n_resp2", "to_port": "__in__", "kind": "exec" },
            { "id": "e_r2_ctx", "from_node": "n_route2", "from_port": "ctx",
              "to_node": "n_resp2", "to_port": "ctx", "kind": "data" }
        ]
    })
}

#[test]
fn typecheck_accepts_origin_dispatch() {
    let reg = Registry::load(&modules_dir()).unwrap();
    let wf: ast::Workflow = serde_json::from_value(origin_dispatch_workflow()).unwrap();
    typecheck::validate(&wf, &reg).expect("origin+dispatch workflow should validate");
}

#[test]
fn emit_origin_dispatch_generates_origin_entry() {
    let reg = Registry::load(&modules_dir()).unwrap();
    let wf: ast::Workflow = serde_json::from_value(origin_dispatch_workflow()).unwrap();
    let go = emit::emit_main(&wf, &reg).expect("emit must succeed");
    let body = &go.body;
    eprintln!("=== generated ===\n{body}\n=== end ===");
    assert!(body.contains("func OriginEntry()"), "missing OriginEntry");
    assert!(body.contains("OriginEntry()"), "main should call OriginEntry");
    assert!(
        body.contains("NewHTTPDispatch(var_n_addr_value)"),
        "dispatch ctor should be called with the wired address"
    );
    assert!(body.contains("Register(\"/foo\""), "route1 register missing");
    assert!(body.contains("Register(\"/bar\""), "route2 register missing");
    assert!(body.contains(".Run()"), "Run() call missing");
    assert!(body.contains("func WorkflowEntry_n_route1"), "route1 handler fn missing");
    assert!(body.contains("func WorkflowEntry_n_route2"), "route2 handler fn missing");
}

#[test]
fn typecheck_rejects_required_dispatch_unwired() {
    let reg = Registry::load(&modules_dir()).unwrap();
    let mut v = origin_dispatch_workflow();
    let edges = v.get_mut("edges").unwrap().as_array_mut().unwrap();
    edges.retain(|e| e.get("id").and_then(|x| x.as_str()) != Some("e_d_r2"));
    let wf: ast::Workflow = serde_json::from_value(v).unwrap();
    let err = typecheck::validate(&wf, &reg).expect_err("unwired required dispatch should fail");
    let msg = format!("{err}");
    assert!(msg.contains("dispatch"), "expected dispatch error, got: {msg}");
}

fn legacy_with_dispatch_workflow() -> serde_json::Value {
    json!({
        "id": "wf_legacy_dispatch",
        "name": "Legacy Dispatch",
        "version": "0.1.0",
        "custom_types": [],
        "entries": ["n_tick"],
        "nodes": [
            { "id": "n_tick", "kind": "module", "module_id": "automato/cron",
              "component": "on_tick",
              "tweak_values": { "interval": 5, "unit": "s" } },
            { "id": "n_addr", "kind": "constant", "module_id": "", "component": "",
              "constant_type": { "kind": "string" }, "constant_value": ":9090" },
            { "id": "n_dispatch", "kind": "module", "module_id": "automato/webhook",
              "component": "http_dispatch" },
            { "id": "n_route", "kind": "module", "module_id": "automato/webhook",
              "component": "on_route",
              "tweak_values": { "path": "/x", "method": "ANY" } },
            { "id": "n_resp", "kind": "module", "module_id": "automato/webhook",
              "component": "respond",
              "literal_inputs": { "status": 200, "body": "ok" } }
        ],
        "edges": [
            { "id": "e1", "from_node": "n_tick", "from_port": "__out__",
              "to_node": "n_dispatch", "to_port": "__in__", "kind": "exec" },
            { "id": "e2", "from_node": "n_addr", "from_port": "value",
              "to_node": "n_dispatch", "to_port": "address", "kind": "data" },
            { "id": "e3", "from_node": "n_dispatch", "from_port": "dispatch",
              "to_node": "n_route", "to_port": "dispatch", "kind": "data" },
            { "id": "e4", "from_node": "n_route", "from_port": "__out__",
              "to_node": "n_resp", "to_port": "__in__", "kind": "exec" },
            { "id": "e5", "from_node": "n_route", "from_port": "ctx",
              "to_node": "n_resp", "to_port": "ctx", "kind": "data" }
        ]
    })
}

#[test]
fn legacy_trigger_can_lead_to_dispatch() {
    let reg = Registry::load(&modules_dir()).unwrap();
    let wf: ast::Workflow = serde_json::from_value(legacy_with_dispatch_workflow()).unwrap();
    typecheck::validate(&wf, &reg).expect("legacy + dispatch should validate");
    let go = emit::emit_main(&wf, &reg).unwrap();
    let body = &go.body;
    eprintln!("=== legacy+dispatch ===\n{body}\n=== end ===");
    assert!(body.contains("func WorkflowEntry(var_n_tick_fired_at"), "legacy main entry uses WorkflowEntry");
    assert!(body.contains("func WorkflowEntry_n_route"), "sub-trigger handler missing");
    assert!(body.contains("NewHTTPDispatch(var_n_addr_value)"), "dispatch ctor missing");
    assert!(body.contains(".Run()"), ".Run() missing");
}

#[test]
fn typecheck_rejects_origin_with_standalone_trigger() {
    let reg = Registry::load(&modules_dir()).unwrap();
    let mut v = origin_dispatch_workflow();
    let nodes = v.get_mut("nodes").unwrap().as_array_mut().unwrap();
    nodes.push(json!({
        "id": "n_standalone",
        "kind": "module",
        "module_id": "automato/cron",
        "component": "on_tick"
    }));
    let wf: ast::Workflow = serde_json::from_value(v).unwrap();
    let err = typecheck::validate(&wf, &reg).expect_err("standalone trigger in origin mode should fail");
    let msg = format!("{err}");
    assert!(msg.to_lowercase().contains("standalone"), "expected standalone-trigger error, got: {msg}");
}
