# CLAUDE.md — AuTomato

Working notes for Claude sessions on this repo.

## Scope lock

**Frontend only** unless told otherwise. Touch `frontend/`; do not edit `compiler/`, `backend/`, `runtime/`, `modules/`. Spec (`PROJECT_SPEC.md`) says Svelte; **reality is React** — trust the code, not the spec.

## Stack

React 18 · Vite · TypeScript · `@xyflow/react` v12 · Zustand · no CSS framework (raw `app.css`).

Run: `cd frontend && npm run dev` → http://localhost:5173.
Type check: `npm run check`.

No inline code comments (project convention). Docs go in `.md` files.

## Frontend layout

```
src/
  App.tsx              Toolbar | Palette | Canvas | ConfigPanel | TypesEditor
  app.css              ALL styles (tokens + components)
  lib/
    types.ts           WorkflowType, NodeInstance, Edge, Workflow, helpers
    typecheck.ts       typesEqual, canConnect (int→float widening)
    registry.ts        live backend registry; SSE sync; fallback to workflow snapshots
    store.ts           Zustand store; localStorage key "automato.workflow.v2"
    export.ts          Workflow → AST JSON for compiler
    components/
      Canvas.tsx       @xyflow/react wrapper; drop, connect, key handlers
      ModuleNode.tsx   module node renderer with data + exec + passthrough + tweak handles
      ConstantNode.tsx literal value node
      BranchNode.tsx   logic node — fork exec on bool (__true__/__false__)
      LoopNode.tsx     logic node — iterate over array (__body__/__done__ + item)
      StructNode.tsx   construct/destruct node for custom struct types
      OriginNode.tsx   workflow entry (singleton, category "origin")
      ExitNode.tsx     workflow exit (exec in + optional int exit code)
      EnvConstNode.tsx environment variable constant node (string output)
      Palette.tsx      left drawer, drag source, module install modal
      ConfigPanel.tsx  right drawer, selected-node editor
      Toolbar.tsx      top bar: new/load/save/export/compile
      TypesEditor.tsx  custom-type modal
      InstallModal.tsx backend module install dialog (git / http-tar)
```

## Data model (current — post-rework)

- `NodeInstance.kind`: `module | constant | branch | loop | construct | destruct | origin | exit | env_const` (undefined → `module`).
- Node **category** (from `ComponentDef.category` or derived for built-ins): `trigger | action | pure | logic | return | origin | dispatch`.
  - `trigger`: no exec in, has exec out. Standalone trigger = workflow entry without an Origin. A trigger with a `dispatchMode` of `required`/`either` expects a Dispatch data input and acts as a sub-trigger under an Origin.
  - `action`: exec in + exec out (+ optional error exec out).
  - `pure`: no exec pins at all — data only, lazily evaluated. Constants, construct/destruct, env_const are all pure.
  - `logic`: Branch / Loop, multi exec out.
  - `return`: exec in, no exec out. ≥1 per workflow (Exit node has this category).
  - `origin`: the canonical workflow entry (singleton). Has only exec out. Used when multiple sub-triggers (dispatch pattern) feed one Origin.
  - `dispatch`: reserved for future use; `nodeCategory()` never returns it from the current built-ins.
- `Edge.kind`: `data | exec`.
  - data rules: 1-to-N fan-out, single edge per target port, unless the target input is marked `consumption: "consumed"` — then the source may not fan out to any other data edge.
  - exec rules: exec-source is strictly 1-to-1; exec-target (`__in__`) may receive many incoming exec edges (ordering).
- Input `consumption`: `consumed | passthrough | undefined`. Passthrough inputs auto-render a matching data output handle with id `foo__pt` carrying the input's value through (Builder-pattern chaining).
- `TweakDef` — optional module-level inputs that can be set as literals or wired via a data handle. Tweak handles have IDs `__tweak__<name>` (helpers: `tweakInputHandleId`, `isTweakInputHandle`, `tweakNameFromHandle`).
- `DispatchMode` on `ComponentDef`: `required | either | none`. When `required`, the trigger's `dispatchInputName` port must receive a data edge from a Dispatch source. `computeValidation` enforces this.
- Reserved port IDs (see `types.ts`): `__in__`, `__out__`, `__err__` (error exec out), `__errval__` (error data out), `__true__`/`__false__` (branch), `__body__`/`__done__` (loop), `__dispatch__` (dispatch input on sub-triggers), `code` (ExitNode exit-code data in), `*__pt` (passthrough), `__tweak__*` (tweak handles).
- `computeUnwiredErrorBranches` checks the `__err__` exec wire, not a data edge.
- `computeValidation` handles two topologies: (a) Origin-rooted — one Origin, ≥1 Exit/return, no standalone triggers; (b) Trigger-rooted — exactly one standalone trigger, ≥1 return.

## Node-rework status

All four phases of `automato_implementation_plan.md` are **done** (see status section at end of that file). AST export ships `edge.kind`, per-node `category`, tweak values, dispatch metadata, and env-key fields.

## Resize bug fix (shipped)

`.an-node` now declares `width: 100%; height: 100%; display: flex; flex-direction: column` so it fills whatever bounding box `NodeResizer` sets on `.react-flow__node`. Header/tags flex-shrink:0, ports flex:1 to absorb extra height. Size persists across reloads via `resizeNode` + `NodeInstance.size` (see `Canvas.tsx` `onNodesChange` dimension branch).

## Conventions to follow

- Never add source comments. Put explanation in `.md` files (per PROJECT_SPEC).
- Edit existing files in preference to adding new ones.
- Zustand mutations persist to localStorage automatically via `mutate()` wrapper; don't bypass it.
- `Canvas.tsx::resolvePortType` is the single source of truth for what type a given port is — update it when adding port kinds.
- AST export (`export.ts`) must stay compatible with `compiler/src/ast.rs` (hand-synced).
