# Execution change (no. 2) — v2

Concrete spec for the rework of triggers / origin / dispatch and the smaller built-ins
(Exit, Env constant). Replaces `execution_change_2_v1.md` for implementation work.

Scope: full rework — frontend, module-format, and compiler are all eventually in scope.
This document is **frontend-first**: the data model and editor land first; module
schema and compiler follow once the model is stable. The CLAUDE.md "frontend-only"
clause is treated as outdated for this rework.

---

## 1. Glossary

| concept   | what it is                                                                       |
|-----------|----------------------------------------------------------------------------------|
| Origin    | Built-in entry node, equivalent to `main`. Zero inputs, zero data outputs, one exec-out. Exactly **one** per workflow when present. |
| Dispatch  | Module-provided node. Sibling of Return: terminates the exec flow it sits on. Has one exec-in, one data output (the dispatch struct), zero exec-outs. Multiple may exist; control flow guarantees only one is called per run. |
| Trigger   | Existing event entry node. Now classified by its `dispatchMode`. May be registered on a Dispatch (the new way) or stand alone (the legacy way). |
| Exit      | Built-in terminator. Exec-in, no exec-out. Optional `int` data input (return code). Counts as a Return for validation. |
| Env const | Built-in constant variant. Reads an environment variable at runtime, falls back to a default. Configured by tweaks; outputs a single `string`. |

Two kinds of workflow are supported in parallel:

- **Origin-rooted.** Begins at an Origin node. Its exec graph must reach either a
  Dispatch or a Return/Exit. Triggers in the same workflow must be `dispatchMode`
  ∈ {`required`, `either`} and must be wired to a Dispatch (which itself must be
  reachable from the Origin).
- **Trigger-rooted (legacy).** Exactly one trigger, `dispatchMode` ∈ {`none`,
  `either`} (when `either`, its dispatch input is left unwired and the module's
  default dispatch struct is used at compile time). No Origin, no Dispatch in
  this mode.

---

## 2. Data-model diffs (`frontend/src/lib/types.ts`)

```ts
export type NodeKind =
  | "module"
  | "constant"     // existing literals
  | "branch"
  | "loop"
  | "construct"
  | "destruct"
  | "origin"       // NEW — built-in entry
  | "exit"         // NEW — built-in terminator
  | "env_const";   // NEW — built-in constant variant w/ tweaks

export type NodeCategory =
  | "trigger"
  | "action"
  | "pure"
  | "logic"
  | "return"
  | "origin"       // NEW — categorises Origin
  | "dispatch";    // NEW — categorises Dispatch components
```

`ComponentDef` gains optional fields used only when the component is a trigger or
dispatch:

```ts
export type DispatchMode = "required" | "either" | "none";

export interface ComponentDef {
  // ...existing fields...
  dispatchMode?: DispatchMode;          // triggers only; default "none"
  dispatchType?: WorkflowType;          // triggers only; the dispatch struct type
                                        // they register on. Used for type-check
                                        // and for the synthetic `__dispatch__`
                                        // input pin (see §4).
  dispatchInputName?: string;           // triggers only; default "__dispatch__"
}
```

For dispatch components (`category === "dispatch"`):
- They have **no** declared inputs/outputs in `definitions.json`. The frontend
  derives:
    - one exec-in pin (`__in__`),
    - one data-out pin (`__dispatch__`) of type `dispatchType` (declared on the
      component as `dispatchType: WorkflowType`),
    - no exec-out pin.

`NodeInstance` gains:

```ts
export interface NodeInstance {
  // ...existing fields...
  envKey?: string;       // env_const only
  envDefault?: string;   // env_const only
}
```

Reserved port IDs (`types.ts` constants): add `DISPATCH_OUT = "__dispatch__"`,
`DISPATCH_IN = "__dispatch__"` (same string; source vs target context distinguishes
them), and `DATA_EXIT_CODE = "code"`.

---

## 3. Built-ins

### Origin

- `kind: "origin"`, category `"origin"`.
- Singleton — `addOrigin` rejects creation if one already exists.
- Renders with no inputs, no data outputs, exec-out only (bottom). Header label
  "Origin / main".
- Storage: just a `NodeInstance` with `kind: "origin"` and a position.

### Dispatch

- Module-provided: `category: "dispatch"` in `definitions.json`. Module declares
  `dispatchType: WorkflowType` on the component. The frontend synthesises pins.
- Renders with: exec-in (top), single data-out `__dispatch__` (right side, typed
  as the dispatch struct).
- Behaves like Return for validation purposes (terminates the exec path it's on).
- Multiple Dispatch nodes per workflow are allowed.

### Trigger (updated)

When the component declares `dispatchMode === "required"` or `"either"`:
- Frontend renders an extra **data input** on the trigger node, pin id
  `__dispatch__`, type = `dispatchType`, `consumption: "consumed"` (see §4 for
  the fan-out carve-out).
- For `"required"`: the workflow is invalid if the pin is unwired.
- For `"either"`: pin may be left unwired; module supplies a default at compile.

When `dispatchMode === "none"` (or undefined): unchanged from today — no
dispatch pin.

### Exit

- `kind: "exit"`, category `"return"` (so existing return-counting validation
  works without changes).
- Renders: exec-in, optional data input `code: int` with `consumption: "consumed"`.
  No outputs. Single per workflow is **not** required.

### Env constant

- `kind: "env_const"`, category `"pure"` (no exec pins).
- Tweak-style configuration (stored on the `NodeInstance`, not as `literalInputs`):
    - `envKey: string` (required)
    - `envDefault: string` (required)
- Single data output `value: string`.
- Right-panel editor renders two text fields (envKey, envDefault) styled to look
  like the existing tweak rows for module nodes.

---

## 4. Connection rules

Existing rules unchanged. Two additions:

1. **Dispatch fan-out carve-out.** A data edge sourced from a node with
   `category === "dispatch"` is exempt from the consumed-target fan-out
   restriction. That is, one Dispatch node's `__dispatch__` output may wire to
   the `__dispatch__` input of multiple triggers, even though those inputs are
   marked `consumption: "consumed"`. Source location: `store.ts::addEdge` and
   `Canvas.tsx::isValidConnection`.

   Rationale: from Go's perspective, the dispatch struct is shared by reference;
   each trigger calls `dispatch.RegisterX(...)` on the same value. Marking the
   input `consumed` keeps it visually clear that registration is single-target
   per *trigger*, while the carve-out lets one Dispatch fan out to many
   triggers.

2. **Trigger dispatch input.** The `__dispatch__` input on a trigger may only
   accept edges from a node whose category is `dispatch` and whose
   `dispatchType` matches. Enforced in `isValidConnection`.

---

## 5. Validation (`computeValidation`)

Replace the current "exactly 1 trigger, ≥1 return" rule with a mode-aware check:

```
let origins   = nodes filter origin
let dispatches= nodes filter dispatch
let triggers  = nodes filter trigger
let returns   = nodes filter return    // includes Exit

if origins.len > 1: error "more than one Origin"

if origins.len == 1:
    // Origin-rooted mode
    for t in triggers:
        if t.dispatchMode == "none":
            error "trigger \"<name>\" cannot run in Origin-rooted workflows"
        if t.dispatchMode == "required" and t.__dispatch__ unwired:
            error "trigger \"<name>\" requires a Dispatch wiring"
    // Each Dispatch wired to a trigger must itself be reachable from Origin via exec edges
    for d in dispatches:
        if d not reachable from origin via exec edges:
            error "Dispatch is not reachable from Origin"

else:
    // Trigger-rooted (legacy) mode
    if dispatches.len > 0:
        error "Dispatch nodes require an Origin"
    if triggers.len != 1:
        error "exactly one Trigger required (or use Origin + Dispatch)"
    let t = triggers[0]
    if t.dispatchMode == "required":
        error "trigger \"<name>\" requires Origin + Dispatch"
    // either / none — fine

// Path-level rule (both modes):
// Every exec leaf reachable from Origin or any Trigger must be a Return,
// Exit, or Dispatch. (Reuse existing logic with category set
// {"return", "dispatch"} as terminals.)
if any exec leaf path does not terminate in {return, dispatch}:
    error "execution path does not end in a Return, Exit, or Dispatch"

if origins.len == 0 and triggers.len == 0:
    error "workflow has no entry point"
```

Implement as a small graph traversal in `store.ts`. Move the
"every-flow-ends-in-a-terminal" check out of `computeUnwiredErrorBranches` if
needed — it's a separate concern.

---

## 6. AST export (`export.ts`)

Backwards-compatible additions only (existing fields stay):

- `node.kind` already passes through; new kinds (`origin`, `exit`, `env_const`)
  flow naturally.
- `node.category` already exported; new categories (`origin`, `dispatch`) flow
  naturally.
- For `env_const` nodes, also emit `env_key` and `env_default`.
- For trigger nodes, emit `dispatch_mode` and `dispatch_type` (read from the
  resolved `ComponentDef`) so the compiler can branch without re-reading
  `definitions.json`.
- Workflow-level: drop the single `entry` field in favour of `entries: string[]`.
  An origin-rooted workflow has `[origin_id]`; a legacy workflow has
  `[trigger_id]`. **Note for the compiler-side rework:** old `entry` consumers
  must migrate.

---

## 7. UI changes

### Palette (`Palette.tsx`)

Under "Control flow":
- Add **Origin** (singleton; greyed out when one already exists).
- Add **Exit**.
- Add **const env** alongside the existing primitive constants (drag id
  `__constant__` → `__env__`, mirroring the enum constant pattern).

Module-provided Dispatch components appear naturally in their module's group
because they're listed in `definitions.json`. They render in the palette just
like other components, with category pill `dispatch`.

### Module node (`ModuleNode.tsx`)

- Add a render branch: when `comp.dispatchMode` is `required` or `either`, draw
  a `__dispatch__` data input pin at the top of the inputs column, typed by
  `comp.dispatchType`. Visually mark `required` (e.g. red dot) when unwired.
- Dispatch components: render exec-in, one data output (`__dispatch__`), header
  pill "dispatch". No exec-out, no other inputs/outputs.

### Built-in nodes

- `OriginNode.tsx` — header "Origin / main", single exec-out at bottom.
- `ExitNode.tsx` — header "Exit", exec-in at top, optional `code: int` data
  input.
- `EnvConstNode.tsx` — header "Env const", no inputs, single data output
  `value: string`. Right panel exposes `envKey` + `envDefault` text fields.

`Canvas.tsx::nodeTypes` registers the three new components.

### Config panel (`ConfigPanel.tsx`)

- Origin: identity only.
- Exit: identity + literal editor for `code` if unwired.
- Env const: identity + two text inputs (`envKey`, `envDefault`).
- Trigger with dispatch pin: existing inputs section gets an extra row showing
  `__dispatch__` with a wired/unwired pill (no literal editor — must be wired).

### Store (`store.ts`)

New actions: `addOrigin`, `addExit`, `addEnvConst`, `setEnvKey`, `setEnvDefault`.
The Origin singleton check lives in `addOrigin` (mirrors the trigger singleton
check that we're now removing for `dispatchMode != "none"` triggers).

`addModuleNode` no longer rejects multi-trigger; rejection moves into validation.

---

## 8. `definitions.json` schema (deferred — specified for forward-compat)

Trigger components grow:

```json
{
  "name": "on_request",
  "category": "trigger",
  "dispatch_mode": "required",
  "dispatch_type": { "kind": "custom", "name": "HTTPDispatch" },
  "dispatch_input_name": "dispatch",
  "tweaks": [...],
  "outputs": [...]
}
```

Dispatch components are a new `category`:

```json
{
  "name": "http_dispatch",
  "category": "dispatch",
  "dispatch_type": { "kind": "custom", "name": "HTTPDispatch" },
  "impl": "NewHTTPDispatch"
}
```

The dispatch struct, `RegisterX` methods, and `Run` method live in the module's
Go source. Naming is module-defined; the compiler reads the binding from
`definitions.json` (exact format TBD when the compiler half lands — likely a
sibling block listing `register_methods: { "<trigger-impl>": "<go-method>" }`
and `run_method: "Run"`).

---

## 9. Phased implementation

### Phase A — frontend types + store (no UI yet)
- Extend `NodeKind`, `NodeCategory`, `ComponentDef`, `NodeInstance` per §2.
- Add `addOrigin`, `addExit`, `addEnvConst`, env-tweak setters, dispatch
  carve-out in `addEdge`, removal of trigger-singleton check in
  `addModuleNode`.
- Update `nodeCategory` to handle the new built-in kinds.
- Update `computeValidation` per §5.
- Type-check passes (`npm run check`).

### Phase B — connection / canvas rules
- `resolvePortType` learns `__dispatch__` (both source and target sides).
- `isValidConnection` enforces dispatch-type matching and the consumed
  fan-out carve-out.

### Phase C — node renderers
- `OriginNode`, `ExitNode`, `EnvConstNode` files.
- `ModuleNode` renders the synthetic `__dispatch__` input on triggers and the
  dispatch-component variant.
- Register in `Canvas.tsx::nodeTypes`.

### Phase D — palette + config panel
- Palette entries for the three built-ins.
- Config panel branches for Origin / Exit / Env const, plus the dispatch-pin
  display on triggers.

### Phase E — AST export
- Per §6.

### Phase F — module schema + compiler (separate plan)
- Extend `definitions.json` parsing on the backend.
- Compiler reads `dispatch_mode`, walks Origin path to a Dispatch terminator,
  emits `<DispatchT>{}` construction, registers each wired trigger via its
  `register_methods` entry, ends with `dispatch.Run()`.
- Trigger-rooted (legacy) path stays as today.
- Env const lowers to `os.LookupEnv(key) ?? def`.
- Exit lowers to `os.Exit(code)`.

Phases A–E are the immediate work. F is tracked separately and can land once
the frontend model is stable.

---

## 10. Open follow-ups (not blocking)

- Should Origin gain optional data outputs later (CLI args, process env map)?
  Not for v2; revisit.
- Should `dispatch_input_name` be configurable per trigger, or always
  `__dispatch__`? Defaulting to the constant is simpler — leave configurable
  for later.
- Default-dispatch-struct semantics for `dispatchMode === "either"` need a
  representation in `definitions.json` (`default_dispatch_impl: "NewDefault"`?).
  Specified when compiler half lands.
- Path-reachability validator (§5) is a graph walk; current `computeValidation`
  is a single-pass node count. Performance is fine for editor-scale graphs.
