# Modules

Each module is a directory under `modules/` containing:

- **`metadata.json`** — identity (`id`, `version`), implementation hints (`package`, `code_files`, `go_dependencies`).
- **`definitions.json`** — public API: `types` and `components`. Each component declares `category` (`trigger | action | pure | logic | return`), `inputs`, `outputs`, optional `error_type`, optional `trigger_style` (`callback | polling`, only for triggers), and `impl` (the Go function name).
- **One or more `.go` files** — the implementation. Files listed in `metadata.code_files` are copied verbatim into the generated workspace.
- **`README.md`** — free-form docs surfaced by the editor.

Module IDs may contain slashes (e.g. `automato/webhook`); the on-disk path mirrors the ID. The compiler sets the Go import path to `automato.local/<id>` and aliases every import as `mod_<sanitized_id>` to prevent collisions.

## Authoring rules

- Pick a Go `package` identifier — anything valid, but you must avoid Go keywords. See `return/` (uses `ret`), `string/` (uses `strops`), `log/` (uses `logmod`).
- Function signatures must mirror what `definitions.json` declares:
  - **Action / Pure / Return**:
    - No outputs, no error: `func Impl(args...)`
    - No outputs, with error: `func Impl(args...) error`
    - N outputs, no error: `func Impl(args...) (T1, ..., Tn)` (single value if N=1)
    - N outputs, with error: `func Impl(args...) (T1, ..., Tn, error)`
  - **Trigger (polling)**: `func Impl() (T1, ..., Tn, bool)` — last `bool` is `ok`; the workflow loops on it.
  - **Trigger (callback)**: `func Impl(handler func(T1, ..., Tn))` — the module owns the loop and calls `handler` per event.
- Cross-module imports work: write `import "automato.local/<other-module-id>"` in your Go code. The compiler emits a `go.work` so this resolves to the local source.

## Bundled modules

| ID                            | Category   | Notes                                                                |
|-------------------------------|------------|----------------------------------------------------------------------|
| `automato/webhook`            | Trigger    | HTTP server; callback style; defines `HTTPRequest`.                  |
| `automato/cron`               | Trigger    | Polling style; emits a UTC RFC3339 timestamp per tick.               |
| `automato/return`             | Return     | `http_response`, `ok` — stub terminators.                            |
| `automato/http-request`       | Action     | `fetch` returns `(body, status, error)`. Defines `HTTPError`.        |
| `automato/json-parse`         | Pure       | `parse(input) -> dict<string>`. Defines `JSONParseError`.            |
| `automato/log`                | Action     | `info(message)`; passthrough output for builder-style chaining.      |
| `automato/string`             | Pure       | `concat`, `from_int`.                                                |
| `automato/http-request-build` | Pure       | `build(url, method, body) -> HTTPRequest`.                           |
| `automato/gmail`              | Action     | `send(email) -> (message_id, error)`. Defines `Email`.               |
