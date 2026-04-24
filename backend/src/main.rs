mod cache;
mod install;
mod registry_state;
mod views;

use anyhow::{anyhow, bail, Context, Result};
use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use cache::CacheTracker;
use futures::stream::StreamExt;
use install::{InstallSource, install as do_install, uninstall};
use registry_state::{spawn_watcher, RegistryState};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::convert::Infallible;
use std::fs;
use std::io::Write as IoWrite;
use std::net::SocketAddr;
use std::path::{Path as StdPath, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio_stream::wrappers::BroadcastStream;
use views::{view_module, ModuleView};
use zip::write::FullFileOptions;

const CACHE_TTL_SECONDS: u64 = 24 * 3600;
const CACHE_GC_INTERVAL_SECONDS: u64 = 15 * 60;

#[derive(Clone)]
struct AppState {
    registry: Arc<RegistryState>,
    cache: Arc<CacheTracker>,
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

#[derive(Deserialize)]
struct BuildRequest {
    ast: serde_json::Value,
    target: String,
    #[serde(default)]
    options: BuildOptions,
}

#[derive(Deserialize, Default, Clone, Debug)]
struct BuildOptions {
    #[serde(default)]
    optimize: Option<String>,
    #[serde(default)]
    strip: bool,
    #[serde(default)]
    trimpath: bool,
    #[serde(default)]
    goos: Option<String>,
    #[serde(default)]
    goarch: Option<String>,
    #[serde(default)]
    docker: Option<DockerOptions>,
}

#[derive(Deserialize, Clone, Debug)]
struct DockerOptions {
    #[serde(default)]
    enable: bool,
    #[serde(default = "default_docker_port")]
    port: u16,
    #[serde(default = "default_true")]
    expose: bool,
}

fn default_docker_port() -> u16 {
    8080
}

fn default_true() -> bool {
    true
}

impl DockerOptions {
    fn to_config(&self) -> compiler::workspace::DockerConfig {
        compiler::workspace::DockerConfig {
            enable: self.enable,
            port: self.port,
            expose: self.expose,
        }
    }
}

#[tokio::main]
async fn main() {
    let modules_dir = modules_dir();
    fs::create_dir_all(&modules_dir).ok();
    fs::create_dir_all(cache::cache_dir(&modules_dir)).ok();

    // Index lives outside modules_dir so writes don't trip the file watcher.
    let cache_index = cache_index_path(&modules_dir);
    if let Some(parent) = cache_index.parent() {
        fs::create_dir_all(parent).ok();
    }
    let cache_tracker = Arc::new(CacheTracker::load(cache_index));

    let registry = RegistryState::new(modules_dir.clone());
    let _watcher = match spawn_watcher(registry.clone()) {
        Ok(w) => Some(w),
        Err(e) => {
            eprintln!("warning: filesystem watcher failed to start: {e:#}");
            None
        }
    };

    let state = AppState {
        registry: registry.clone(),
        cache: cache_tracker.clone(),
    };

    spawn_gc_task(state.clone());

    let app = Router::new().without_v07_checks()
        .route("/health", get(health))
        .route("/modules", get(list_modules))
        .route("/modules/events", get(modules_events))
        .route("/modules/install", post(install_module))
        .route("/modules/{*id}", get(get_module).delete(delete_module))
        .route("/compile", post(compile))
        .route("/build", post(build))
        .with_state(state)
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

async fn list_modules(State(state): State<AppState>) -> Json<Vec<ModuleView>> {
    let r = state.registry.current();
    let mut views: Vec<ModuleView> = r.modules().map(view_module).collect();
    views.sort_by(|a, b| a.id.cmp(&b.id));
    state
        .cache
        .touch_many(views.iter().map(|v| v.id.as_str()));
    Json(views)
}

async fn get_module(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    let r = state.registry.current();
    match r.module(&id) {
        Some(m) => {
            state.cache.touch(&id);
            Json(view_module(m)).into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            format!("module '{id}' not found"),
        )
            .into_response(),
    }
}

async fn modules_events(
    State(state): State<AppState>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    let rx = state.registry.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|res| async move {
        match res {
            Ok(_) => Some(Ok(Event::default().event("changed").data("{}"))),
            Err(_) => None,
        }
    });
    Sse::new(stream).keep_alive(KeepAlive::default())
}

#[derive(Serialize)]
struct InstallResponse {
    id: String,
    already_present: bool,
    module: ModuleView,
}

async fn install_module(
    State(state): State<AppState>,
    Json(source): Json<InstallSource>,
) -> Response {
    let modules_dir = state.registry.modules_dir().to_path_buf();

    let job = tokio::task::spawn_blocking(move || do_install(&modules_dir, &source));
    let outcome = match job.await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                format!("{e:#}"),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                format!("install task panicked: {e}"),
            )
                .into_response();
        }
    };

    state.cache.touch(&outcome.id);

    if !outcome.already_present {
        if let Err(e) = state.registry.reload() {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
                format!(
                    "module written to disk but registry reload failed: {e:#}"
                ),
            )
                .into_response();
        }
    }

    let r = state.registry.current();
    match r.module(&outcome.id) {
        Some(m) => Json(InstallResponse {
            id: outcome.id.clone(),
            already_present: outcome.already_present,
            module: view_module(m),
        })
        .into_response(),
        None => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            format!(
                "module '{}' was installed to disk but the registry didn't pick it up",
                outcome.id
            ),
        )
            .into_response(),
    }
}

async fn delete_module(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Response {
    if !cache::is_cache_id(&id) {
        return (
            StatusCode::FORBIDDEN,
            format!("'{id}' is bundled and cannot be deleted via the API"),
        )
            .into_response();
    }
    let modules_dir = state.registry.modules_dir().to_path_buf();
    let id_for_task = id.clone();
    let job = tokio::task::spawn_blocking(move || uninstall(&modules_dir, &id_for_task));
    match job.await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => {
            let body = format!("{e:#}");
            let lower = body.to_lowercase();
            let status = if lower.contains("not found") {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::UNPROCESSABLE_ENTITY
            };
            return (status, body).into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("delete task panicked: {e}"),
            )
                .into_response();
        }
    }
    state.cache.forget(&id);
    if let Err(e) = state.registry.reload() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("registry reload failed after delete: {e:#}"),
        )
            .into_response();
    }
    (StatusCode::OK, format!("deleted '{id}'")).into_response()
}

async fn compile(
    State(state): State<AppState>,
    Json(req): Json<CompileRequest>,
) -> Json<CompileResponse> {
    touch_ast_modules(&state, &req.ast);
    let target = req.target.clone();
    let modules_dir = state.registry.modules_dir().to_path_buf();
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

async fn build(State(state): State<AppState>, Json(req): Json<BuildRequest>) -> Response {
    touch_ast_modules(&state, &req.ast);
    do_build(&state, req).await.unwrap_or_else(|e| (
        StatusCode::INTERNAL_SERVER_ERROR,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        format!("{:#}", e),
    ).into_response())
}

fn touch_ast_modules(state: &AppState, ast: &serde_json::Value) {
    let mut ids: HashSet<&str> = HashSet::new();
    if let Some(nodes) = ast.get("nodes").and_then(|v| v.as_array()) {
        for n in nodes {
            if let Some(mid) = n.get("module_id").and_then(|v| v.as_str()) {
                ids.insert(mid);
            }
        }
    }
    if !ids.is_empty() {
        state.cache.touch_many(ids.into_iter());
    }
}

async fn do_build(state: &AppState, req: BuildRequest) -> Result<Response> {
    let modules = state.registry.modules_dir().to_path_buf();
    let wf_name = req
        .ast
        .get("name")
        .and_then(|v| v.as_str())
        .map(slug)
        .unwrap_or_else(|| "workflow".to_string());

    match req.target.as_str() {
        "go-source" | "go" | "main" => {
            let src = compiler::compile_ast(&req.ast, "go", &modules)
                .context("generating Go source")?;
            Ok(download_response(
                src.into_bytes(),
                &format!("{wf_name}.main.go"),
                "text/x-go; charset=utf-8",
            ))
        }
        "ast-json" | "json" => {
            let src = compiler::compile_ast(&req.ast, "json", &modules)
                .context("serializing AST")?;
            Ok(download_response(
                src.into_bytes(),
                &format!("{wf_name}.ast.json"),
                "application/json; charset=utf-8",
            ))
        }
        "workspace-zip" | "zip" | "workspace" => {
            let docker = req
                .options
                .docker
                .as_ref()
                .map(|d| d.to_config())
                .unwrap_or_default();
            let tmp = tempfile::tempdir().context("creating temp workspace dir")?;
            compiler::compile_to_workspace(&req.ast, &modules, tmp.path(), &docker)
                .context("building Go workspace")?;
            let bytes = zip_dir(tmp.path(), &wf_name).context("zipping workspace")?;
            Ok(download_response(
                bytes,
                &format!("{wf_name}-workspace.zip"),
                "application/zip",
            ))
        }
        "binary" | "exe" => {
            let docker = req
                .options
                .docker
                .as_ref()
                .map(|d| d.to_config())
                .unwrap_or_default();
            let tmp = tempfile::tempdir().context("creating temp workspace dir")?;
            compiler::compile_to_workspace(&req.ast, &modules, tmp.path(), &docker)
                .context("building Go workspace")?;
            let buf: Vec<u8> = Vec::new();
            let (bytes, _) =
                build_binary(tmp.path(), &req.options).context("building binary")?;
            let cursor = std::io::Cursor::new(buf);
            let mut zw = zip::ZipWriter::new(cursor);
            let opts = FullFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .unix_permissions(0o644);
            zw.add_directory("/", opts.clone()).context("building ZIP")?;
            zw.start_file(format!("{wf_name}.exe"), opts).context("building ZIP")?;
            zw.write_all(&bytes)?;
            let cursor = zw.finish()?;
            let ready = cursor.into_inner();
            Ok(download_response(
                ready,
                &format!("{wf_name}.zip"),
                "application/zip",
            ))
        }
        other => bail!("unknown build target: {other}"),
    }
}

fn modules_dir() -> PathBuf {
    std::env::var("AUTOMATO_MODULES_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("modules"))
}

fn cache_index_path(modules_dir: &StdPath) -> PathBuf {
    if let Ok(p) = std::env::var("AUTOMATO_CACHE_INDEX") {
        return PathBuf::from(p);
    }
    match modules_dir.parent() {
        Some(p) if !p.as_os_str().is_empty() => p.join(".automato").join("cache.json"),
        _ => PathBuf::from(".automato").join("cache.json"),
    }
}

fn slug(s: &str) -> String {
    let out: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "workflow".to_string()
    } else {
        trimmed
    }
}

fn download_response(bytes: Vec<u8>, filename: &str, mime: &str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        )
        .body(Body::from(bytes))
        .unwrap()
}

fn zip_dir(root: &StdPath, archive_root: &str) -> Result<Vec<u8>> {
    let mut buf: Vec<u8> = Vec::new();
    {
        let cursor = std::io::Cursor::new(&mut buf);
        let mut zw = zip::ZipWriter::new(cursor);
        let opts = zip::write::FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);
        zw.add_directory(format!("{}/", archive_root), opts.clone())?;
        zip_visit(root, root, archive_root, &mut zw, &opts)?;
        zw.finish()?;
    }
    Ok(buf)
}

fn zip_visit<W: std::io::Write + std::io::Seek>(
    root: &StdPath,
    dir: &StdPath,
    archive_root: &str,
    zw: &mut zip::ZipWriter<W>,
    opts: &FullFileOptions,
) -> Result<()> {
    for entry in fs::read_dir(dir).with_context(|| format!("reading {}", dir.display()))? {
        let entry = entry?;
        let path = entry.path();
        let rel = path
            .strip_prefix(root)
            .with_context(|| format!("stripping prefix from {}", path.display()))?;
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let name = format!("{}/{}", archive_root, rel_str);
        if path.is_dir() {
            zw.add_directory(format!("{}/", name), opts.clone())?;
            zip_visit(root, &path, archive_root, zw, &opts.clone())?;
        } else {
            zw.start_file(&name, opts.clone()).with_context(|| format!("starting file {}", name))?;
            let data = fs::read(&path)
                .with_context(|| format!("reading {}", path.display()))?;
            zw.write_all(&data)?;
        }
    }
    Ok(())
}

fn build_binary(root: &StdPath, opts: &BuildOptions) -> Result<(Vec<u8>, String)> {
    let target_goos = opts
        .goos
        .clone()
        .unwrap_or_else(|| std::env::consts::OS.to_string());
    let bin_name = if target_goos == "windows" {
        "workflow.exe"
    } else {
        "workflow"
    };

    let out_dir = root.join("_build");
    fs::create_dir_all(&out_dir)?;
    let out_path = out_dir.join(bin_name);

    let sync = Command::new("go")
        .arg("work")
        .arg("sync")
        .current_dir(root)
        .output();
    if let Err(e) = &sync {
        bail!(
            "failed to run `go work sync`: {e}. Install Go (>=1.22) and make sure it's on PATH."
        );
    }

    let mut cmd = Command::new("go");
    cmd.current_dir(root.join("workflow"));
    cmd.arg("build").arg("-o").arg(&out_path);

    if opts.trimpath {
        cmd.arg("-trimpath");
    }

    let mut ldflags_parts: Vec<&str> = Vec::new();
    if opts.strip {
        ldflags_parts.push("-s");
        ldflags_parts.push("-w");
    }
    if !ldflags_parts.is_empty() {
        cmd.arg("-ldflags").arg(ldflags_parts.join(" "));
    }

    match opts.optimize.as_deref() {
        Some("none") | Some("debug") => {
            cmd.arg("-gcflags").arg("all=-N -l");
        }
        Some("size") => {
            if !opts.strip {
                cmd.arg("-ldflags").arg("-s -w");
            }
        }
        _ => {}
    }

    if let Some(v) = &opts.goos {
        cmd.env("GOOS", v);
    }
    if let Some(v) = &opts.goarch {
        cmd.env("GOARCH", v);
    }

    let output = cmd
        .output()
        .map_err(|e| anyhow!("failed to invoke `go build`: {e}. Install Go (>=1.22) on PATH."))?;
    if !output.status.success() {
        bail!(
            "go build failed (exit {}):\n--- stdout ---\n{}\n--- stderr ---\n{}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    let bytes = fs::read(&out_path)
        .with_context(|| format!("reading produced binary {}", out_path.display()))?;
    Ok((bytes, bin_name.to_string()))
}

fn spawn_gc_task(state: AppState) {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(CACHE_GC_INTERVAL_SECONDS));
        // Skip the immediate first tick.
        tick.tick().await;
        loop {
            tick.tick().await;
            if let Err(e) = run_gc_pass(&state) {
                eprintln!("cache GC pass failed: {e:#}");
            }
        }
    });
}

fn run_gc_pass(state: &AppState) -> Result<()> {
    let cache_root = cache::cache_dir(state.registry.modules_dir());
    if !cache_root.exists() {
        return Ok(());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let snapshot = state.cache.snapshot();
    let mut evicted = 0usize;
    for entry in fs::read_dir(&cache_root)
        .with_context(|| format!("reading {}", cache_root.display()))?
    {
        let entry = entry?;
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = match entry.file_name().to_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        if !cache::is_cache_id(&id) {
            continue;
        }
        let last = match snapshot.get(&id) {
            Some(t) => *t,
            None => {
                // Seed an entry so future passes have something to compare.
                state.cache.touch(&id);
                continue;
            }
        };
        if now.saturating_sub(last) > CACHE_TTL_SECONDS {
            let path = entry.path();
            if let Err(e) = fs::remove_dir_all(&path) {
                eprintln!("GC: failed to remove {}: {e}", path.display());
                continue;
            }
            state.cache.forget(&id);
            evicted += 1;
        }
    }
    if evicted > 0 {
        if let Err(e) = state.registry.reload() {
            eprintln!("GC: registry reload failed: {e:#}");
        }
    }
    Ok(())
}
