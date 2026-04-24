# OUTDATED
This document is only kept for archiving purposes. DO NOT USE IT FOR REFERENCE!!!
# Workflow Automation Platform — Project Specification

A self-hosted, developer-centered workflow automation platform. Workflows are designed visually in a browser-based editor, compiled to Go source code, and exported as standalone projects or Docker containers for local execution.

## Project Philosophy

This project is a developer-first alternative to tools like n8n, Zapier, and Windmill. The defining design choice is that **the visual editor is a compiler, not a runtime**: workflows are not interpreted by a long-running orchestrator but are translated into standalone Go programs that the user runs themselves. This produces fast, portable, auditable artifacts with no runtime dependency on the editor.

The system favors local execution, transparency, and extensibility over breadth of integrations. Integrations are written by the developer using the platform, not maintained as a curated library.

## Core Concepts

### Modules as Typed Functions

Every module is a typed function. Inputs and outputs are typed values; module invocation in the editor corresponds directly to a function call in the compiled output. A workflow is therefore a function composition, and a complete workflow is itself a function that can be called or composed into larger workflows.

### Type System

Types are limited to a small set of primitives — `int`, `float`, `string`, `bool`, arrays, and dicts — extensible with user-defined custom types. Custom types are simple records, e.g. `Email { subject: string, sender: string, body: string }`. Custom types defined inside one module can be reused by others through the registry.

### Errors as Values

There are no exceptions. Effectful functions return `Result<T, E>` where `E` is a custom error type defined alongside the module. The visual editor enforces error handling: a module returning a `Result` cannot have its success branch consumed without the user also wiring its error branch. Standard error-branch terminations include log-and-continue, retry (with configurable policy), and abandon-workflow.

### Effects via Module Metadata

Effectful behavior is not encoded in the type system. Instead, every module carries metadata tags such as `idempotent`, `pure`, `reads_external_state`, `writes_external_state`, and `expensive`. Generic features like retry, caching, parallel execution, and dry-run mode read these tags rather than hardcoding per-module knowledge. This keeps custom-module authoring lightweight while still giving the runtime and editor enough information to behave intelligently.

### Concurrency Model

Workflow execution is sequential by default. The user may explicitly mark independent branches of the DAG as parallel; the runtime will execute those branches concurrently using goroutines. Within a single branch, calls remain async at the implementation level (returning futures) but are awaited in the order they appear. This keeps execution order predictable and reasoning about side effects straightforward.

A workflow run begins in its own goroutine; the runtime exposes its progress through the debugging API described below.

## System Architecture

The system has three components: a frontend SPA, a central Rust backend that hosts the editor and module registry, and a Rust-based compiler that translates workflows into Go projects. The frontend is the focus of this project; the backend is intentionally minimal.

### Frontend (Primary Focus)

A single-page application built with **Svelte** (Svelte 5 / SvelteKit recommended). The frontend is the product surface and should receive the bulk of the design and engineering effort.

Responsibilities of the frontend:

- A node-graph editor where modules appear as nodes and typed connections between them form the workflow. Connections are type-checked at edit time; the editor must visually distinguish valid drop targets from invalid ones during a drag.
- A module palette populated from the registry, with search, categorization by tag, and inline documentation rendered from each module's docs file.
- A custom-type editor for defining records used across the workflow.
- A configuration panel for each node showing its inputs (literal or wired), outputs, error branches, and effect-tag metadata.
- A debugging and analytics view that connects to the internal debugging API exposed by a running compiled workflow, displaying the call tree, per-call inputs and outputs, timing, and any errors.
- Project management: create, load, save, fork, and version workflows. Local autosave is essential.
- Compile and export controls: trigger AST compilation, preview the generated Go project structure, download the AST as compressed JSON, or download the compiled Go project as a zip.

The visual layer is the entire user experience. It should feel responsive, opinionated, and pleasant; the kind of tool a developer chooses to open. Treat the editor's interaction design — drag behavior, connection routing, keyboard shortcuts, multi-select, undo/redo, panning and zoom — as load-bearing.

### Backend

A Rust HTTP server with a deliberately small surface area. Responsibilities:

- Serve the SPA.
- Host the module registry: store uploaded module zip archives, expose them by content-addressed URL, and serve their metadata for the editor's palette.
- Persist user projects (workflows, custom types, configuration) in a simple embedded store such as SQLite.
- Accept compile requests from the frontend, invoke the compiler, and return either the AST artifact or the compiled Go project zip.

The backend should not attempt to execute workflows. Execution happens in whatever environment the user runs the compiled Go binary in.

### Compiler

Also written in Rust, invoked by the backend. The compilation pipeline has two stages:

**Stage 1 — Workflow to AST.** The graph from the frontend is reduced to an AST representing the workflow as a typed expression tree. Each module reference in the AST carries the URL from which its source archive can be fetched, plus the version pin. The AST is the canonical, portable representation of a workflow and is what the user downloads if they choose the JSON export.

**Stage 2 — AST to Go project.** The AST is lowered to a Go project: a `main.go` entry point, generated wrapper code that wires module functions together according to the graph, type definitions for all custom types used, the runtime support library, and a `Dockerfile`. Module sources are fetched from their registry URLs at compile time and included in the project. Only the modules actually used by the workflow are included.

The output is a zip archive ready to `go build` or `docker build` without further setup.

## Module Format

A module is a zip archive containing the following files at its root:

- **`metadata.json`** — Identity and discovery information: name, version, author, description, semver-style version, list of effect tags, license.
- **`definitions.json`** — The module's public API. For each exported component, declares the component's name, its inputs (name and type), its outputs (name and type), its error type if any, a human-readable description, and a pointer to the Go function that implements it (file path and function name within the archive).
- **One or more `.go` files** — The implementation. Functions referenced by `definitions.json` must match the declared signatures. Custom types defined by this module are also declared here.
- **`README.md`** or equivalent — Free-form documentation rendered by the editor.

The compiler resolves each component reference in the AST to a specific function in a specific file, copies the necessary files into the generated project, and generates the wiring code that calls them in workflow order.

## Extensibility

Anyone can author a module. The workflow is: write the Go file, write `definitions.json` describing what the module exports, write `metadata.json`, zip the result, and upload it to the registry through the frontend. The editor picks up new modules from the registry without restart.

Custom types defined by one module are usable by any other module or workflow that imports them. This is the primary mechanism by which the ecosystem grows: shared types like `Email`, `HTTPRequest`, `S3Object`, etc. become a lingua franca that lets independently authored modules connect to each other.

## Documentation Convention

The codebase across all components (frontend, backend, compiler, runtime support library, generated Go output) does not use inline code comments. Documentation lives in dedicated `.md` files alongside the code: one per module, package, or significant component. This applies to generated code as well — the compiler emits clean Go without explanatory comments and produces a separate `DOCS.md` describing the structure of the generated project.

This convention should be followed consistently. If a piece of code requires explanation, that explanation goes in the corresponding doc file, not in the source.

## Recommended Tech Stack

- **Frontend:** Svelte 5 with SvelteKit, TypeScript, a graph rendering library suited to interactive node editors (e.g. Svelte Flow), Tailwind or a similar utility-first styling approach.
- **Backend:** Rust with `axum` or `actix-web`, `sqlx` with SQLite for persistence, `tokio` for async.
- **Compiler:** Rust, structured as a library callable from the backend. AST defined as a `serde`-serializable enum tree.
- **Compiled output target:** Go 1.22+, standard library where possible.
- **Containerization:** `Dockerfile` template included in compiler output, multi-stage build producing a small final image.

## Build Order Suggestion

A roughly sensible order to bring this up, optimized for getting to a usable demo quickly:

1. Define the AST data structure and the module manifest format. These are the contracts everything else depends on.
2. Build the Rust compiler end-to-end on a hand-written AST: AST in, Go project out, with one or two trivial modules. This proves the compilation story works before the editor exists.
3. Build a minimal backend: serve a module registry from disk, accept and store workflow JSON, expose a compile endpoint.
4. Build the frontend: graph editor first, module palette second, configuration panels third, debugging view last. This is where most of the time should go.
5. Iterate on the editor's feel until it is pleasant to use. Then add custom-type editing, version pinning, and the export flows.
6. Add a small standard library of modules (HTTP request, file read/write, JSON parse, log, basic transforms) to demonstrate the system on real workflows.

The AI-related modules can come later as ordinary entries in the standard library — for instance, a `call_local_llm` module that talks to Ollama. Nothing about the architecture privileges or excludes them.
