# AuTomato

Self-hosted, developer-centered workflow automation platform. Workflows are designed visually, **compiled to source code** (currently Go, but may be expanded), and exported as:
- Standalone projects ready for deployment
  - Also in embedded with TinyGo
- Docker containers
- Ready OOB binaries (not for TinyGo)

no long-running orchestrator, no runtime editor dependency.

See [`PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) (Note: Documentation may become outdated during development) for the full design. This README is a quickstart.

This project is a sister project of [`VisuAlis`](https://github.com/MOBSkuchen/VisuAlis), which provides the UI designer.

### Licensing
This project is licensed under the terms and conditions of the Creative Commons Attribution-NonCommercial 4.0 International Public
License as provided in [`LICENSE`](LICENSE)

## Status

Currently reworking how modules work and adding support for TinyGo (embedded).

What works today:

- **Frontend editor** (`frontend/`) — React 18 + Vite. Functional node-graph editor: palette, typed connections, config panel, custom-type editor, error-branch enforcement, retry policy UI, localStorage autosave, AST export, building, validation.
- **Compiler** (`compiler/`) — Graph to AST, AST to Go, workspace compilation (with optional docker) and binary building
- **Backend** (`backend/`) — health, modules, compile. Currently being reworked.
- **Modules** (`modules/`) — Builtin and example modules.

See each component's `DOCS.md` for the current state and roadmap.

## Repo layout

```
.
├── frontend/     React 18 SPA (Vite + @xyflow/react)
├── backend/      Rust axum crate (workspace member)
├── compiler/     Rust library crate (workspace member)
├── docs/         Documentation and plans for keeping track of state
└── modules/      Buitlin / example modules source
```

`frontend/` is its own npm project. `backend/` + `compiler/` share a Cargo workspace at the repo root.

## Quickstart

### Frontend

Requires Node 20+ and npm.

```
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

The editor runs standalone — no backend required for the MVP flow (create workflow, wire nodes, export AST as JSON).

### Backend + compiler

```
cargo check           # or: cargo build
cargo run -p automato-backend
```

Listens on `http://localhost:7878`.

## Documentation

- [`frontend/DOCS.md`](frontend/FRONTEND_DOCS.md)
- [`backend/DOCS.md`](./backend/DOCS.md)
- [`compiler/DOCS.md`](./compiler/DOCS.md)
- [`modules/DOCS.md`](./modules/MODULES_DOCS.md)

See `./docs` for more.

Per the project convention, source code carries no inline comments; all explanation lives in these `.md` files.

## Roadmap (short)

- ✔ Add configurable components
- ✔ Auto fetch modules from `./modules`
- ✔ Make modules downloadable via a single URL
- ✖ Add more basic modules
- ✖ Add AI integration
- ✖ Be able to AI generate a module from an API documentation
- ✖ Automate away every single Integration Engineers job
