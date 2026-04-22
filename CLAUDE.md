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
    registry.ts        MODULES array (mock), BUILTIN_TYPES, lookups
    store.ts           Zustand store; localStorage key "automato.workflow.v1"
    export.ts          Workflow → AST JSON for compiler
    components/
      Canvas.tsx       @xyflow/react wrapper; drop, connect, key handlers
      ModuleNode.tsx   custom-node renderer + NodeResizer
      ConstantNode.tsx literal value node
      TriggerNode.tsx  entry (singleton)
      ReturnNode.tsx   terminal
      Palette.tsx      left drawer, drag source
      ConfigPanel.tsx  right drawer, selected-node editor
      Toolbar.tsx      top bar: new/load/save/export/compile
      TypesEditor.tsx  custom-type modal
```

## Data model (current — post-rework)

- `NodeInstance.kind`: `module | constant | branch | loop` (undefined → `module`).
- Node **category** (from `ComponentDef.category` or derived for built-ins): `trigger | action | pure | logic | return`.
  - `trigger`: no exec in, has exec out. Exactly one per workflow.
  - `action`: exec in + exec out (+ optional error exec out).
  - `pure`: no exec pins at all — data only, lazily evaluated by compiler.
  - `logic`: Branch / Loop, multi exec out.
  - `return`: exec in, no exec out. ≥1 per workflow.
- `Edge.kind`: `data | exec`.
  - data rules: 1-to-N fan-out, single edge per target port, unless the target input is marked `consumption: "consumed"` — then the source may not fan out to any other data edge.
  - exec rules: exec-source is strictly 1-to-1; exec-target (`__in__`) may receive many incoming exec edges (ordering).
- Input `consumption`: `consumed | passthrough | undefined`. Passthrough inputs auto-render a matching data output handle with id `foo__pt` carrying the input's value through (Builder-pattern chaining).
- Reserved port IDs (see `types.ts`): `__in__`, `__out__`, `__err__` (error exec out), `__errval__` (error data out), `__true__`/`__false__` (branch), `__body__`/`__done__` (loop), `*__pt` (passthrough).
- `computeUnwiredErrorBranches` now checks the `__err__` exec wire, not a data edge.
- `computeValidation` counts components by category (requires exactly one `trigger`, ≥1 `return`).

## Node-rework status

Phases 1 + 2 of `automato_implementation_plan.md` are **done**. Phase 3/4 (compiler traversal + Go lowering) are untouched. AST export now ships `edge.kind` and per-node `category` so the compiler can traverse exec edges.

## Resize bug fix (shipped)

`.an-node` now declares `width: 100%; height: 100%; display: flex; flex-direction: column` so it fills whatever bounding box `NodeResizer` sets on `.react-flow__node`. Header/tags flex-shrink:0, ports flex:1 to absorb extra height. Size persists across reloads via `resizeNode` + `NodeInstance.size` (see `Canvas.tsx` `onNodesChange` dimension branch).

## Conventions to follow

- Never add source comments. Put explanation in `.md` files (per PROJECT_SPEC).
- Edit existing files in preference to adding new ones.
- Zustand mutations persist to localStorage automatically via `mutate()` wrapper; don't bypass it.
- `Canvas.tsx::resolvePortType` is the single source of truth for what type a given port is — update it when adding port kinds.
- AST export (`export.ts`) must stay compatible with `compiler/src/ast.rs` (hand-synced).
