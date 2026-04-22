# Frontend

React 18 + Vite SPA. The editor is the product surface, so nearly all UX code lives here.

## Run

```
npm install
npm run dev
```

## Architecture

```
src/
  main.tsx                       bootstrap
  App.tsx                        layout: Toolbar | Palette | Canvas | ConfigPanel | TypesEditor
  app.css                        design tokens + global + component styles
  lib/
    types.ts                     WorkflowType / ModuleDef / NodeInstance / Edge / Workflow; reserved exec port ids
    typecheck.ts                 data-edge type compatibility (typesEqual, canConnect)
    registry.ts                  mock module registry (inlined for MVP)
    store.ts                     Zustand workflow store + derived selectors (validation, unwired errors)
    export.ts                    Workflow → AST JSON shape
    components/
      Canvas.tsx                 @xyflow/react wrapper: drop, connect validation, node dims
      ModuleNode.tsx             module renderer with data + exec + passthrough handles
      ConstantNode.tsx           literal-value node with typed data output
      BranchNode.tsx             logic node, fork exec on a bool
      LoopNode.tsx               logic node, iterate over an array
      Palette.tsx                draggable module listing, searchable
      ConfigPanel.tsx            selected-node editor
      Toolbar.tsx                brand, stats, save/load/export/compile
      TypesEditor.tsx            custom record-types editor
```

## Node model

Every node has a `kind` (`module | constant | branch | loop`) and, for module nodes, a `category` carried on the component definition:

- **trigger** — no exec in, has exec out. Exactly one per workflow. The trigger's outputs become the arguments of the compiled workflow function.
- **action** — effectful. One exec in, one exec out (+ optional error exec out for `errorType` modules).
- **pure** — data-only, lazily evaluated. No exec pins. (Constants are pure.)
- **logic** — Branch (`__true__` / `__false__` exec outs) or Loop (`__body__` / `__done__` exec outs + `item` data out).
- **return** — exec in, no exec out. At least one per workflow. Compiles to `return F(...inputs...)`.

## Edges

Two edge kinds:

- **data** (`kind: "data"`) — circles on the sides, typed. 1-to-N fan-out allowed unless the target input is marked `consumption: "consumed"`, in which case the source port may not already be wired elsewhere.
- **exec** (`kind: "exec"`) — chevrons on top/bottom. Exec-source is strictly 1-to-1 (fork via a Branch logic node). Exec-target (`__in__`) can receive many incoming edges — those act as ordering constraints.

Reserved port ids live as constants in `types.ts`: `EXEC_IN`, `EXEC_OUT`, `EXEC_ERR`, `EXEC_TRUE`, `EXEC_FALSE`, `EXEC_BODY`, `EXEC_DONE`, `DATA_ERRVAL`, `DATA_LOOP_ITEM`. Passthrough out handles use `<input>__pt`.

## Consumed vs passthrough inputs

Module definitions tag inputs with `consumption: "consumed" | "passthrough"`:

- `consumed` — the target node takes ownership of the value (Rust-style move). UI blocks any further data edge from the same source.
- `passthrough` — the target reads-and-returns the value (Rust-style borrow). A matching data output handle is auto-rendered on the node so the user can chain (e.g., `Log` returns its message).

Inputs with no `consumption` tag are treated as free data inputs (default fan-out allowed).

## Connection validation

`Canvas.tsx::isValidConnection` and `store.ts::addEdge` enforce the rules above. Connection rejection reasons surface as a transient invalid-banner overlay. The banner shows reasons like:

- `exec pin can only connect to another exec pin`
- `exec output already has a connection (fork via Branch)`
- `target input is 'consumed'; source already wired elsewhere`
- `type mismatch: X → Y`

## State model

`store.ts` exports a Zustand store with mutations (`addModuleNode`, `addConstant`, `addBranch`, `addLoop`, `addEdge`, `resizeNode`, `removeNode`, …). Every mutation persists the workflow to `localStorage` under `automato.workflow.v2`. Derived selectors: `computeValidation`, `computeUnwiredErrorBranches`, `nodeCategory`.

## Error branches as exec flow

When a component declares `errorType`, `ModuleNode` renders:

- a red exec output handle at the bottom-right (`__err__`) — this is the error **execution** path,
- a red data output handle on the right (`__errval__`) carrying the typed error value.

`computeUnwiredErrorBranches` reports modules whose `__err__` exec is not wired; the toolbar uses that as a compile gate.

## Resizing

All nodes use `@xyflow/react`'s `NodeResizer` when selected. Sizes are persisted on `NodeInstance.size` and re-applied via `node.style` on reload. The node cards declare `width: 100%; height: 100%` and use flex layout so the content box fills the resized bounding box.

## AST export

`exportAst(workflow)` emits the canonical JSON consumed by the Rust compiler's `ast::Workflow`. Each node carries its `category` and each edge carries its `kind` so the compiler can walk the exec tree. The two schemas are hand-synced for the MVP.

## What's missing

- Undo/redo.
- Multi-select + box select + paste.
- Debugging view (needs a running compiled workflow).
- Backend-backed registry (currently inlined).
- Nested type picker (`array<array<…>>` etc.).
- Auto-layout / alignment helpers.
