# Backend

Rust HTTP service. Minimal by design — serves the SPA, hosts the module registry, accepts compile requests and delegates them to the `compiler` crate.

## Endpoints

- `GET /health` — liveness probe.
- `GET /modules` — list registered modules (id, name, version).
- `GET /modules/:id` — fetch a module archive by id.
- `POST /compile` — body: `{ ast, target }`. Delegates to `compiler::compile_ast`.

## Status

Stub only. Routes are in place but persistence (SQLite), archive storage, and the full module metadata path are not wired up yet. See `PROJECT_SPEC.md` for the intended shape.

## Run

```
cargo run -p automato-backend
```

Listens on `0.0.0.0:7878`.
