# AuTomato

Self-hosted, developer-centered workflow automation platform. Workflows are designed visually, **compiled to source code** (currently Go, but may be expanded), and exported as:
- Standalone projects 
- Docker containers
- Read OOB binaries

no long-running orchestrator, no runtime editor dependency.

See [`PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) (Note: Documentation may become outdated during development) for the full design. This README is a quickstart.

## Status

Early MVP. What works today:

- **Frontend editor** (`frontend/`) — React 18 + Vite. Functional node-graph editor: palette, typed connections, config panel, custom-type editor, error-branch enforcement, retry policy UI, localStorage autosave, AST export.
- **Compiler** (`compiler/`) — AST types defined; Stage 1 (AST → canonical JSON) working. Stage 2 (AST → Go project) stubbed.
- **Backend** (`backend/`) — `axum` skeleton with `/health`, `/modules`, `/compile` routes. Persistence and archive storage not wired yet.
- **Modules** (`modules/`) — Builtin and example modules.

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

1. Add configurable components
2. Module registry wired to `modules/` at dev time; uploaded archives in prod.
3. Make modules downloadable via a single URL
4. Add more basic modules
5. Add AI integration
6. Be able to AI generate a module from an API documentation
7. Automate away every single Integration Engineers job