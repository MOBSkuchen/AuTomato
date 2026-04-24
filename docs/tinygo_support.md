# TinyGo support

Plan for adding a TinyGo workspace-export target to AuTomato.

## Goal

Let the user tick a **"TinyGo"** toggle under the compile menu's **Go workspace (.zip)** target. When on:

- The generated workspace builds with `tinygo build` instead of `go build` (Dockerfile, DOCS.md, and any helper scripts are rewritten accordingly).
- If Docker is also enabled, the Dockerfile uses a TinyGo base image.
- A `-target` text field replaces `GOOS`/`GOARCH` in the menu (e.g. `wasi`, `wasm`, `microbit`). Stored as `tinygo_target` in build options.
- The toggle is **disabled** in the UI when any module on the canvas is not `tinygo_compliant`.
- The toggle shows a **warning** (not a refusal) when the chosen `-target` appears in any used module's `tinygo_disallowed_targets`. We don't actually build, so this is informational.
- The toggle is **not offered** for the **Binary executable** target — AuTomato does not support building TinyGo binaries server-side. Workspace-zip only.

## Out of scope

- Server-side TinyGo binary builds (`/build` with `target=binary` + tinygo). Not implemented.
- Live TinyGo version detection. We document `tinygo >= 0.31` (for `go.work` support) in the generated DOCS.
- Non-Go targets.

---

## Module metadata changes

Add two optional fields to every `modules/<id>/metadata.json`:

```json
{
  "tinygo_compliant": true,
  "tinygo_disallowed_targets": ["wasi", "wasm"]
}
```

- `tinygo_compliant` (`bool`, default `false`): module compiles and runs under TinyGo on at least one target. Required for the workspace toggle to enable.
- `tinygo_disallowed_targets` (`string[]`, default `[]`): TinyGo `-target` values known to break for this module. Surfaced as a warning if the user picks one.

### Seed values for bundled modules

| Module                        | `tinygo_compliant` | `tinygo_disallowed_targets` | Notes                                                                 |
|-------------------------------|--------------------|------------------------------|-----------------------------------------------------------------------|
| `automato/cron`               | `true`             | `[]`                         | Pure `time.Sleep`.                                                    |
| `automato/log`                | `true`             | `[]`                         | `fmt.Println`. Works everywhere.                                      |
| `automato/string`             | `true`             | `[]`                         | `strconv` + `+`. No reflection.                                       |
| `automato/json-parse`         | `true`             | `[]`                         | `encoding/json` works under TinyGo (heavy reflect, but supported).    |
| `automato/return`             | `true`             | `[]`                         | Stub.                                                                 |
| `automato/http-request-build` | `true`             | `[]`                         | Pure struct construction.                                             |
| `automato/http-request`       | `true`             | `["wasm"]`                   | `net/http.Client` works on `wasi` and native; not on browser `wasm`.  |
| `automato/webhook`            | `false`            | —                            | `net/http.Server` is broken under TinyGo. See refactor section below. |
| `automato/gmail`              | —                  | —                            | **Module is being removed entirely** (see below).                     |

### gmail module removal

The `automato/gmail` module is **removed in this plan**, independent of TinyGo. Steps:

1. Delete `modules/automato/gmail/` directory.
2. Remove `gmail` entry and its `gmailClientType` / `emailType` `CustomTypeDef`s from `frontend/src/lib/registry.ts` (`MODULES`, `BUILTIN_TYPES`, the `exportedTypes` arrays).
3. Strip the gmail row from `modules/MODULES_DOCS.md`.
4. Delete any leftover references in `tests/smoke.rs` (only if present — verify first).

### Webhook TinyGo refactor (exploratory section)

`automato/webhook` currently uses `net/http.ListenAndServe`, which TinyGo does not support on most targets. Options:

- **`wasi` target with WASI HTTP proxy world (Wasm Components, wasi-http):** experimental but the cleanest path. Requires TinyGo 0.32+ and a wasi-http-aware runtime (e.g. `wasmtime serve`, Spin). The module would expose a `wasi:http/incoming-handler` instead of binding a socket.
- **TCP server hand-rolled on `net.Listen`:** TinyGo supports `net` on `linux/amd64`/`linux/arm64`; we could hand-write a tiny HTTP/1.1 parser. Code size cost; loses keep-alive/multipart correctness. Probably not worth it.
- **Drop webhook from TinyGo workflows entirely:** keep `tinygo_compliant: false`. Acceptable v1 — cron-only TinyGo workflows are still a useful demo.

**Recommendation for v1:** keep `tinygo_compliant: false`. File a follow-up to investigate the wasi-http path once the spec stabilises and TinyGo's WASI Preview 2 support lands fully. No code change to `webhook.go` in this plan.

---

## Compiler changes

`compiler/src/registry.rs`:

- Extend `RawMetadata` with `tinygo_compliant: bool` (default `false`) and `tinygo_disallowed_targets: Vec<String>` (default empty).
- Surface them on `ModuleManifest` as `pub tinygo_compliant: bool` and `pub tinygo_disallowed_targets: Vec<String>`.

`compiler/src/workspace.rs`:

- Extend `DockerConfig` (or add a sibling `TinyGoConfig`) with:

  ```rust
  pub struct TinyGoConfig {
      pub enable: bool,
      pub target: Option<String>,   // -target value, e.g. "wasi"
  }
  ```

- `build_workspace` takes `&TinyGoConfig`. When `enable`:
  - Validate that **every included module** has `tinygo_compliant == true`. Hard error if not (compiler-side defence; the UI is the soft gate).
  - The `target` value is **not** validated against `tinygo_disallowed_targets` here — warnings are the frontend's job.
  - Rewrite `Dockerfile` to use `tinygo/tinygo:0.31` (or whatever pin we settle on) and run `tinygo build -o /app-binary -target <target?> .`. If `enable && !docker`, the regular Dockerfile is omitted as today.
  - Rewrite `DOCS.md`'s build section to show `tinygo build` invocations and a TinyGo version requirement.
  - Add a top-level `BUILD-TINYGO.md` (or amend DOCS.md) noting installation requirements.
  - `go.work` is still emitted as today (TinyGo ≥0.31 reads it).

`compiler/src/lib.rs`:

- `compile_to_workspace` takes a `&TinyGoConfig` alongside the `&DockerConfig`. Plumb through to `build_workspace`.

### Cross-module test

Extend `compiler/tests/smoke.rs` (after the gmail removal) with one TinyGo workspace test that asserts:

- A workflow using `cron + log` builds a workspace with TinyGo enabled.
- A workflow using `webhook` returns the compliance error when TinyGo is enabled.

---

## Backend changes

`backend/src/main.rs`:

- Extend `BuildOptions` with:

  ```rust
  #[derive(Deserialize, Default, Clone, Debug)]
  struct TinyGoOptions {
      #[serde(default)] enable: bool,
      #[serde(default)] target: Option<String>,
  }

  // in BuildOptions:
  #[serde(default)] tinygo: Option<TinyGoOptions>,
  ```

- In `do_build`, only the `workspace-zip` arm consumes `tinygo`. The `binary` arm ignores it (defensive: log + ignore, since UI shouldn't send it).
- Pass a `TinyGoConfig` into `compile_to_workspace`.
- Existing `GOOS`/`GOARCH` env handling stays untouched (binary target only).

No new endpoint. The `/modules` endpoint stays stubbed for now (revisit in the auto-fetch plan).

---

## Frontend changes

`frontend/src/lib/registry.ts`:

- Add `tinyGoCompliant?: boolean` and `tinyGoDisallowedTargets?: string[]` to `ModuleDef` in `lib/types.ts`.
- Set the seed values from the table above on every module entry.
- Remove the `gmail` module + types as per the removal section.

`frontend/src/lib/components/Toolbar.tsx`:

- Extend `BuildOptions` with `tinygo: { enable: boolean; target: string }`.
- Compute, from the current `workflow`, the set of distinct module IDs in use (existing canvas state).
- Compute two derived values:

  - `tinygoBlockers`: list of in-use module IDs whose `tinyGoCompliant !== true`. If non-empty, the TinyGo checkbox is **disabled** with a tooltip listing them.
  - `tinygoTargetWarnings`: when `opts.tinygo.target` is non-empty, list of in-use module IDs whose `tinyGoDisallowedTargets` includes it. Shown inline as a yellow note next to the input.

- The TinyGo subsection only renders when `target === "workspace-zip"` (not `binary`).
- When TinyGo is on, the GOOS/GOARCH row is **hidden** (it's already binary-only, but document this for future).
- Build payload: include `options.tinygo = { enable: true, target: <string?> }` only when `enable && target === "workspace-zip"`.
- Build button label changes to "Build (TinyGo)" when active, for visibility.

CSS lives in `app.css`; reuse existing `.menu-section` / `.menu-checkbox` / `.menu-field` classes; add a `.menu-warn` rule for the yellow inline warning.

---

## DOCS / smoke updates

- `modules/MODULES_DOCS.md`: add a "TinyGo compliance" subsection explaining the two metadata fields and how to set them. Drop gmail row.
- Update `docs/PROJECT_SPEC.md` only if it references gmail or the compile menu shape — verify, otherwise skip (spec is known-stale).

---

## Implementation order (when we start)

1. **Module metadata + gmail removal** (smallest blast radius, unblocks both compiler + frontend).
2. **Compiler `Registry` + `TinyGoConfig` plumbing**, with the smoke test.
3. **Backend `BuildOptions.tinygo` plumbing.**
4. **Frontend types + registry seeds + Toolbar UI.**
5. **MODULES_DOCS.md** + verify generated DOCS.md content end-to-end with a real export.

Each step compiles in isolation; no big-bang merge.
