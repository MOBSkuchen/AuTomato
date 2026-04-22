# AuTomato

Self-hosted, developer-centered workflow automation platform. Workflows are designed visually, **compiled to Go source code**, and exported as standalone projects or Docker containers — no long-running orchestrator, no runtime editor dependency.

See [`PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) for the full design. This README is a quickstart.

## Status

Early MVP. What works today:

- **Frontend editor** (`frontend/`) — React 18 + Vite. Functional node-graph editor: palette, typed connections, config panel, custom-type editor, error-branch enforcement, retry policy UI, localStorage autosave, AST export.
- **Compiler** (`compiler/`) — AST types defined; Stage 1 (AST → canonical JSON) working. Stage 2 (AST → Go project) stubbed.
- **Backend** (`backend/`) — `axum` skeleton with `/health`, `/modules`, `/compile` routes. Persistence and archive storage not wired yet.
- **Runtime** (`runtime/`) — Go support library with `Result[T, E]` and `WithRetry`. Imported by future generated projects.
- **Modules** (`modules/`) — Three example modules: `http-request`, `json-parse`, `log`.

See each component's `DOCS.md` for the current state and roadmap.

## Repo layout

```
.
├── frontend/     React 18 SPA (Vite + @xyflow/react)
├── backend/      Rust axum crate (workspace member)
├── compiler/     Rust library crate (workspace member)
├── runtime/      Go support library
└── modules/      Example module sources
```

`frontend/` is its own npm project. `backend/` + `compiler/` share a Cargo workspace at the repo root. `runtime/` is a standalone Go module.

## Quickstart

### Frontend

Requires Node 20+ and npm.

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

The editor runs standalone — no backend required for the MVP flow (create workflow, wire nodes, export AST as JSON).

### Backend + compiler

```
cargo check           # or: cargo build
cargo run -p automato-backend
```

Listens on http://localhost:7878.

## Documentation

- [`frontend/DOCS.md`](frontend/FRONTEND_DOCS.md)
- [`backend/DOCS.md`](./backend/DOCS.md)
- [`compiler/DOCS.md`](./compiler/DOCS.md)
- [`runtime/DOCS.md`](./runtime/DOCS.md)
- [`modules/DOCS.md`](modules/MODULES_DOCS.md)

Per the project convention, source code carries no inline comments; all explanation lives in these `.md` files.

## Roadmap (short)

1. Compiler Stage 2: emit a runnable Go project from an AST.
2. Backend: SQLite persistence + module zip upload endpoint.
3. Frontend: debugging view against the runtime's debug API.
4. Module registry wired to `modules/` at dev time; uploaded archives in prod.
