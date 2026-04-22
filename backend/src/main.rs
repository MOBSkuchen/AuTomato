use axum::{
    extract::Path,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Serialize)]
struct ModuleListing {
    id: String,
    name: String,
    version: String,
}

#[derive(Deserialize)]
struct CompileRequest {
    ast: serde_json::Value,
    target: String,
}

#[derive(Serialize)]
struct CompileResponse {
    ok: bool,
    target: String,
    content: Option<String>,
    error: Option<String>,
}

#[tokio::main]
async fn main() {
    let app = Router::new()
        .route("/health", get(health))
        .route("/modules", get(list_modules))
        .route("/modules/:id", get(get_module))
        .route("/compile", post(compile))
        .layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_methods(tower_http::cors::Any)
                .allow_headers(tower_http::cors::Any),
        );

    let addr: SocketAddr = "0.0.0.0:7878".parse().unwrap();
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    println!("automato-backend listening on http://{addr}");
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
    "ok"
}

async fn list_modules() -> Json<Vec<ModuleListing>> {
    Json(vec![])
}

async fn get_module(Path(id): Path<String>) -> impl IntoResponse {
    (StatusCode::NOT_FOUND, format!("module {id} not found"))
}

async fn compile(Json(req): Json<CompileRequest>) -> Json<CompileResponse> {
    let target = req.target.clone();
    let modules_dir = std::env::var("AUTOMATO_MODULES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("modules"));
    let result = compiler::compile_ast(&req.ast, &req.target, &modules_dir);
    match result {
        Ok(content) => Json(CompileResponse {
            ok: true,
            target,
            content: Some(content),
            error: None,
        }),
        Err(e) => Json(CompileResponse {
            ok: false,
            target,
            content: None,
            error: Some(format!("{:#}", e)),
        }),
    }
}
