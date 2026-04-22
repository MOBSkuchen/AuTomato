# Compiler

Rust library crate. Two stages, three phases per stage 2 (per `new_compiler_refactor_plan.md`):

1. **Workflow → AST** — the frontend posts a JSON graph; the compiler deserializes into `ast::Workflow` and re-emits as canonical AST JSON.
2. **AST → Go workspace** — strict type checking (`typecheck`), forward-walk lowering (`emit`), workspace assembly (`workspace`).

## Public API

```rust
pub fn compile_ast(ast: &serde_json::Value, target: &str, modules_dir: &Path) -> Result<String>;
pub fn compile_to_workspace(
    ast: &serde_json::Value,
    modules_dir: &Path,
    out_dir: &Path,
) -> Result<workspace::Workspace>;
```

`compile_ast` targets:
- `ast-json` — canonical AST JSON.
- `go-project` — preview `main.go` only (no module sources, no `go.work`).

`compile_to_workspace` materializes the full Go workspace under `out_dir`.

## Pipeline

### 1. Type check (`typecheck::validate`)
- Every `data` edge: source output type must be compatible with target input type. Compatibility = strict equality, plus int→float widening, plus `any` as wildcard. Custom types match by name.
- Every `data` target port: at most one incoming edge.
- `consumed` discipline: if a target input is `consumption: "consumed"`, its source output port may not have any other outgoing data edge (no fan-out).
- Every `exec` source port: at most one outgoing edge (1-to-1).
- Exactly one `trigger` node, ≥1 `return` node.
- Trigger entry must point at a trigger node.

### 2. Lowering (`emit::emit_main`)
Forward walk along `exec` edges starting from the trigger. For each node:
- Resolve its input arguments by looking *back* along data edges.
  - Constants and pure components are emitted lazily on first reference (each at most once).
  - For `passthrough` inputs the input expression is hoisted into a named variable so the corresponding `<name>__pt` output port can re-export it.
  - The `__errval__` data port resolves to `err_<node>.Error()` for `string` errors or `err_<node>.(<alias>.<TypeName>)` for custom error structs.
- Emit the call:
  - Without error: `var_<id>_<out0>, ..., var_<id>_<outN> := mod_X.Fn(args...)`.
  - With error: `..., err_<id> := mod_X.Fn(args...)` followed by `if err_<id> != nil { ... }`. The `__err__` exec wire defines the body; if absent, the compiler falls back to `fmt.Printf` + `return`.
- `Branch` nodes lower to `if cond { ... } else { ... }` consuming `__true__` and `__false__` exec edges.
- `Loop` nodes lower to `for _, var_<id>_item := range list { ... }` consuming `__body__`, then continue along `__done__`.
- `return`-category nodes terminate the workflow function (emit the call, then `return`).

Variables are always `var_<sanitized-node-id>_<port>` (and `err_<sanitized-node-id>`) so collisions are impossible regardless of what the user names anything.

### 3. Workspace assembly (`workspace::build_workspace`)
Output layout:

```
<out_dir>/
  go.work                                # use ./workflow + each ./modules/<id>
  workflow/
    go.mod                               # module automato.local/workflow
    main.go
  modules/
    automato/<module-id>/
      go.mod                             # module automato.local/automato/<id>
      <code-files>
      README.md                          # copied if present
  DOCS.md                                # generated structure summary
```

Imports in `main.go` are aliased to `mod_<sanitized-id>` so collisions are impossible. The set of included modules is the transitive closure of those the workflow directly imports — discovered by scanning each module's source for `automato.local/<other-id>` references.

After write, the user runs:
```sh
go work sync
cd workflow && go build ./...
```

## Module manifest format

`modules/<...>/metadata.json`:
```json
{
  "id": "automato/webhook",
  "name": "Webhook",
  "version": "0.1.0",
  "description": "...",
  "author": "AuTomato",
  "license": "MIT",
  "package": "webhook",
  "code_files": ["webhook.go"],
  "go_dependencies": [{ "path": "github.com/x/y", "version": "v1.2.3" }]
}
```

`definitions.json`:
```json
{
  "types": [{ "name": "HTTPRequest", "fields": [{ "name": "url", "type": {"kind":"string"} }] }],
  "components": [
    {
      "name": "on_request",
      "category": "trigger",
      "trigger_style": "callback",
      "description": "...",
      "inputs": [],
      "outputs": [{ "name": "request", "type": {"kind": "custom", "name": "HTTPRequest"} }],
      "impl": "OnRequest"
    }
  ]
}
```

`category` ∈ `{ trigger, action, pure, return, logic }`. `trigger_style` ∈ `{ callback, polling }` (required only on triggers).

## Trigger styles

The module author declares either `callback` or `polling`:

- **callback** — `func Impl(handler func(T1, ..., Tn))`. The compiler emits `mod.Impl(WorkflowEntry)` in `main`. The module owns the loop.
- **polling** — `func Impl() (T1, ..., Tn, bool)` where the trailing `bool` is `ok`. The compiler wraps the call in `for { ... if !ok { continue }; WorkflowEntry(...) }`.

## Function signatures the compiler expects

| outputs (N) | error_type | signature                                |
|-------------|------------|------------------------------------------|
| 0           | no         | `func F(args...)`                        |
| 0           | yes        | `func F(args...) error`                  |
| 1           | no         | `func F(args...) T1`                     |
| 1           | yes        | `func F(args...) (T1, error)`            |
| ≥2          | no         | `func F(args...) (T1, ..., Tn)`          |
| ≥2          | yes        | `func F(args...) (T1, ..., Tn, error)`   |

## Status

- Stage 1 (AST JSON): **working**.
- Stage 2 (workspace emit): **working**, depends on `go work sync` + `go build` to produce a binary.
- No `Dockerfile` template yet; planned.
- No detection of unused literal_inputs vs wired ports; the typecheck currently trusts the AST.
