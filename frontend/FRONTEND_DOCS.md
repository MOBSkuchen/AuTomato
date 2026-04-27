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
    types.ts                     WorkflowType / ModuleDef / NodeInstance / Edge / Workflow; reserved port ids
    typecheck.ts                 data-edge type compatibility (typesEqual, canConnect)
    registry.ts                  live backend registry (GET /modules + SSE /modules/events); install API
    store.ts                     Zustand workflow store + derived selectors (validation, unwired errors)
    export.ts                    Workflow → AST JSON shape
    components/
      Canvas.tsx                 @xyflow/react wrapper: drop, connect validation, node dims
      ModuleNode.tsx             module renderer with data + exec + passthrough + tweak handles
      ConstantNode.tsx           literal-value node with typed data output
      BranchNode.tsx             logic node — fork exec on bool (__true__/__false__)
      LoopNode.tsx               logic node — iterate over array (__body__/__done__ + item)
      StructNode.tsx             construct/destruct node for custom struct types
      OriginNode.tsx             workflow entry (singleton, category "origin")
      ExitNode.tsx               workflow exit (exec in + optional int exit code)
      EnvConstNode.tsx           environment variable constant (string output)
      Palette.tsx                draggable module listing, searchable + install modal trigger
      ConfigPanel.tsx            selected-node editor
      Toolbar.tsx                brand, stats, save/load/export/compile
      TypesEditor.tsx            custom record-types editor
      InstallModal.tsx           backend module install dialog (git / http-tar sources)
```

## Node model

Every node has a `kind` (`module | constant | branch | loop | construct | destruct | origin | exit | env_const`) and a `category` derived by `nodeCategory()` in `store.ts`:

- **trigger** — module-defined. No exec in, has exec out. Acts as the workflow's data source. A standalone trigger (no Dispatch input wired) is the sole entry point of a trigger-rooted workflow.
- **action** — effectful. One exec in, one exec out (+ optional error exec out for `errorType` modules).
- **pure** — data-only, lazily evaluated. No exec pins. Constants, construct, destruct, and env_const nodes are all pure.
- **logic** — Branch (`__true__` / `__false__` exec outs) or Loop (`__body__` / `__done__` exec outs + `item` data out).
- **return** — exec in, no exec out. At least one per workflow. Exit node (`kind: "exit"`) has this category and accepts an optional integer `code` data input.
- **origin** — workflow entry for Origin-rooted workflows. Singleton. Has only exec out (`__out__`). Used when multiple sub-triggers (dispatch pattern) fan into one Origin.

Two workflow topologies are supported:
- **Trigger-rooted**: exactly one standalone trigger node (no Dispatch), ≥1 return/Exit.
- **Origin-rooted**: one Origin node, ≥1 trigger nodes each with a wired Dispatch input, ≥1 return/Exit.

## Edges

Two edge kinds:

- **data** (`kind: "data"`) — circles on the sides, typed. 1-to-N fan-out allowed unless the target input is marked `consumption: "consumed"`, in which case the source port may not already be wired elsewhere.
- **exec** (`kind: "exec"`) — chevrons on top/bottom. Exec-source is strictly 1-to-1 (fork via a Branch logic node). Exec-target (`__in__`) can receive many incoming edges — those act as ordering constraints.

Reserved port ids live as constants in `types.ts`: `EXEC_IN`, `EXEC_OUT`, `EXEC_ERR`, `EXEC_TRUE`, `EXEC_FALSE`, `EXEC_BODY`, `EXEC_DONE`, `DATA_ERRVAL`, `DATA_LOOP_ITEM`, `DISPATCH_PORT` (`__dispatch__`), `DATA_EXIT_CODE` (`code`). Passthrough out handles use `<input>__pt`. Tweak handles use `__tweak__<name>` (helpers: `tweakInputHandleId`, `isTweakInputHandle`, `tweakNameFromHandle`).

## Consumed vs passthrough inputs

Module definitions tag inputs with `consumption: "consumed" | "passthrough"`:

- `consumed` — the target node takes ownership of the value (Rust-style move). UI blocks any further data edge from the same source.
- `passthrough` — the target reads-and-returns the value (Rust-style borrow). A matching data output handle is auto-rendered on the node so the user can chain (e.g., `Log` returns its message).

Inputs with no `consumption` tag are treated as free data inputs (default fan-out allowed).

## Tweaks

`ComponentDef.tweaks` is an optional array of `TweakDef` entries. Each tweak is an input that can be given a literal default in `ComponentDef` or overridden by the user in the config panel. Tweaks also render as wirable data input handles (`__tweak__<name>`) so a computed value can drive them. Tweak values are stored on `NodeInstance.tweakValues` and exported in the AST as `tweak_values`.

## Dispatch pattern

A trigger with `dispatchMode: "required"` must receive a data edge on its `dispatchInputName` port (the `__dispatch__` port by convention). This represents an Origin-rooted workflow where the Origin node starts execution and one or more triggers act as sub-entry points, each dispatched from the origin's output. `computeValidation` enforces: with an Origin present, no standalone triggers are allowed; without an Origin, exactly one standalone trigger is required.

## Connection validation

`Canvas.tsx::isValidConnection` and `store.ts::addEdge` enforce the rules above. Connection rejection reasons surface as a transient invalid-banner overlay. The banner shows reasons like:

- `exec pin can only connect to another exec pin`
- `exec output already has a connection (fork via Branch)`
- `target input is 'consumed'; source already wired elsewhere`
- `type mismatch: X → Y`

## State model

`store.ts` exports a Zustand store with mutations:
- Node creation: `addModuleNode`, `addConstant`, `addBranch`, `addLoop`, `addConstruct`, `addDestruct`, `addOrigin`, `addExit`, `addEnvConst`
- Node mutation: `moveNode`, `resizeNode`, `removeNode`, `setLiteralInput`, `setConstantValue`, `setConstantType`, `setRetryPolicy`, `setTargetType`, `setTweakValue`, `setEnvKey`, `setEnvDefault`
- Edge: `addEdge`, `removeEdge`
- Workflow: `setName`, `reset`, `loadWorkflow`, `addCustomType`, `removeCustomType`, `updateCustomType`

Every mutation persists the workflow to `localStorage` under `automato.workflow.v2`. Derived selectors: `computeValidation`, `computeUnwiredErrorBranches`, `nodeCategory`.

## Error branches as exec flow

When a component declares `errorType`, `ModuleNode` renders:

- a red exec output handle at the bottom-right (`__err__`) — this is the error **execution** path,
- a red data output handle on the right (`__errval__`) carrying the typed error value.

`computeUnwiredErrorBranches` reports modules whose `__err__` exec is not wired; the toolbar uses that as a compile gate.

## Resizing

All nodes use `@xyflow/react`'s `NodeResizer` when selected. Sizes are persisted on `NodeInstance.size` and re-applied via `node.style` on reload. The node cards declare `width: 100%; height: 100%` and use flex layout so the content box fills the resized bounding box.

## Registry

`registry.ts` fetches the live module list from `GET /modules` on the backend (default `http://localhost:7878`, override with `VITE_BACKEND_URL`). It also subscribes to `GET /modules/events` via SSE and reloads on `changed` events. Modules can be installed at runtime via `POST /modules/install` (accepts `{ kind, url, version }`); this is exposed through `InstallModal`. A `RegistryFallback` is registered by `store.ts` so that custom types and modules snapshotted into a saved workflow remain resolvable even when the backend hasn't served them in the current session.

## AST export

`exportAst(workflow)` emits the canonical JSON consumed by the Rust compiler's `ast::Workflow`. Each node carries its `category`, `kind`, `tweak_values`, `dispatch_mode`, `dispatch_type`, `env_key`, and `env_default`; each edge carries its `kind` so the compiler can walk the exec tree. The `entries` field lists the root node id(s) (Origin if present, else the standalone trigger). The two schemas are hand-synced.

## What's missing

- Undo/redo.
- Multi-select + box select + paste.
- Debugging view (needs a running compiled workflow).
- Nested type picker (`array<array<…>>` etc.).
- Auto-layout / alignment helpers.
