pub mod ast;
pub mod emit;
pub mod registry;
pub mod typecheck;
pub mod workspace;

use anyhow::{anyhow, Result};
use std::path::Path;

pub fn compile_ast(ast: &serde_json::Value, target: &str, modules_dir: &Path) -> Result<String> {
    let workflow: ast::Workflow = serde_json::from_value(ast.clone())
        .map_err(|e| anyhow!("failed to parse workflow AST: {e}"))?;
    match target {
        "ast-json" | "json" => Ok(emit::emit_ast_json(&workflow)?),
        "go-project" | "go" | "main" => {
            let reg = registry::Registry::load(modules_dir)?;
            typecheck::validate(&workflow, &reg)?;
            let go = emit::emit_main(&workflow, &reg)?;
            Ok(go.body)
        }
        other => Err(anyhow!("unknown compile target: {other}")),
    }
}

pub fn compile_to_workspace(
    ast: &serde_json::Value,
    modules_dir: &Path,
    out_dir: &Path,
    docker: &workspace::DockerConfig,
) -> Result<workspace::Workspace> {
    let workflow: ast::Workflow = serde_json::from_value(ast.clone())
        .map_err(|e| anyhow!("failed to parse workflow AST: {e}"))?;
    let reg = registry::Registry::load(modules_dir)?;
    let ws = workspace::build_workspace(&workflow, &reg, docker)?;
    workspace::write_workspace(&ws, out_dir)?;
    Ok(ws)
}
