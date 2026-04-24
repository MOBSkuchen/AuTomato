# Auto-fetching modules

Plan for replacing the hardcoded frontend `MODULES` array with a live, backend-driven module registry — and for letting users install modules from remote sources (HTTP tarballs, Git repos) into the local `modules/` directory.

## Decisions in scope

- **Source of truth = disk.** The Rust backend owns the `modules/` directory. Frontend never reads files; it only talks HTTP.
- **Remote install:** users can pull modules from HTTP tarballs (`.tar.gz`) and Git repos (clone + checkout). Pulled modules land under `modules/` exactly like bundled ones.
- **Lockfile:** every install records its source + commit/sha256 in `automato.lock` (repo root). Re-running `install` against the lockfile is reproducible.
- **File watcher:** the backend watches `modules/` and re-scans on changes; clients receive updates via SSE.
- **No backwards compatibility.** Hardcoded `MODULES` / `BUILTIN_TYPES` in the frontend are removed. If the backend is down, the editor surfaces an error banner instead of falling back.
- **No auth.** All sources are public.

## Out of scope

- Private/authenticated registries.
- SemVer resolution. We pin by exact ref (Git commit) or sha256 (tarball). No "^1.2.0" syntax.
- Publishing flow / signing. Users push to their own Git/HTTP host; AuTomato just consumes.

---

## Backend: registry HTTP API

`backend/src/main.rs` currently has stub `/modules` and `/modules/:id` routes. Implement them and add install/watch.

### New / updated routes

| Method | Path                       | Purpose                                                                                |
|--------|----------------------------|----------------------------------------------------------------------------------------|
| GET    | `/modules`                 | Full list of `ModuleManifest`s, JSON-serialized for the frontend.                      |
| GET    | `/modules/:id`             | Single module (404 if missing). Includes `definitions.json`-equivalent payload.        |
| GET    | `/modules/events`          | SSE stream. Emits `{type: "changed"}` whenever the file watcher fires.                 |
| POST   | `/modules/install`         | Body: `{source: HttpTar | Git, ...}`. Downloads, verifies, writes to disk, updates lockfile. |
| DELETE | `/modules/:id`             | Removes the module directory and the lockfile entry.                                   |
| POST   | `/modules/sync`            | Re-installs every module declared in `automato.lock` (used for fresh checkouts).       |

### Serialization

Reuse `compiler::registry::ModuleManifest` but expose a serializable view. The internal struct contains `PathBuf`s and isn't `Serialize`. Add a sibling `ModuleView` in `backend/src/main.rs` (or in a new `compiler::registry::view` submodule) that mirrors the on-disk JSON shape: `metadata.json` fields + `definitions.json` (`types`, `components`). The compiler already parses both — we serialize back out.

The view must include the new `tinygo_compliant` and `tinygo_disallowed_targets` fields from the TinyGo plan.

### File watcher

- Crate: [`notify`](https://crates.io/crates/notify) (debounced via `notify-debouncer-mini`, ~250 ms window).
- Watcher thread holds the path-to-events `Receiver`. On debounced event:
  1. Re-run `Registry::load(modules_dir)` into a new `Arc<Registry>`.
  2. Atomic-swap an `Arc<RwLock<Arc<Registry>>>` (or `arc-swap`) the HTTP handlers read from.
  3. Broadcast `{"type":"changed"}` to all SSE subscribers via `tokio::sync::broadcast`.
- On startup, the registry is loaded once before serving traffic; if loading fails, log + serve an empty registry and surface the error in `/health`.

### Install flow

```jsonc
// POST /modules/install
{ "source": { "kind": "git",     "url": "https://github.com/foo/bar.git", "ref": "v0.3.0" } }
{ "source": { "kind": "http-tar","url": "https://cdn.example.com/foo.tgz", "sha256": "abc..." } }
```

Steps:

1. Validate the source (URL parse, scheme = `http(s)`, ref/sha format).
2. Download to a temp dir:
   - **Git:** `git clone --depth 1 --branch <ref> <url> <tmp>` (shell out; require git on PATH). Resolve `HEAD` to a full commit SHA.
   - **HTTP tar:** stream into a sha256 hasher; compare to declared `sha256`; reject mismatch.
3. Inspect the extracted tree:
   - Walk for any directory containing both `metadata.json` and `definitions.json`. Each one is a candidate module.
   - For each candidate: parse via `compiler::registry::load_manifest` (expose it `pub` if not already). Reject the whole install if any candidate fails validation.
4. Move each candidate into `modules/<id>/` (atomic-rename a staged directory; refuse to overwrite unless body has `force: true`).
5. Append/replace entries in `automato.lock`:

   ```toml
   [[module]]
   id      = "automato/cron"
   source  = { kind = "git", url = "...", commit = "abc1234" }

   [[module]]
   id      = "third-party/cool"
   source  = { kind = "http-tar", url = "...", sha256 = "..." }
   ```

6. The file watcher will pick up the new directory and broadcast a refresh — no manual reload needed.

### Sync flow (`POST /modules/sync`)

Read `automato.lock`, install each entry, skipping ones whose on-disk content already matches the locked commit/sha256. Used for fresh repo clones.

### Errors

- HTTP 400 for malformed source.
- HTTP 409 if the target ID already exists and `force` is false.
- HTTP 422 if the downloaded tree has no valid module or fails validation. Body: list of validation errors per candidate.

---

## Lockfile format

Path: `<repo-root>/automato.lock`. TOML so it diffs nicely in Git.

```toml
version = 1

[[module]]
id     = "automato/log"
source = { kind = "git", url = "https://github.com/automato-dev/log.git", commit = "9f3c1d7..." }

[[module]]
id     = "automato/cron"
source = { kind = "http-tar", url = "https://example.com/cron-0.2.0.tgz", sha256 = "..." }
```

- Bundled modules in this repo (the ones already under `modules/automato/*`) are **not** lockfile-managed — they're treated as "vendored". `sync` ignores anything not in the lockfile and never deletes such modules.
- A `removed` array (or a top-level `[removed] ids = [...]`) is **not** introduced; deletion is a manual action via `DELETE /modules/:id`, which also drops the lockfile entry.

---

## Frontend: live registry

### Types & loader

- Delete `MODULES` and `BUILTIN_TYPES` literals from `frontend/src/lib/registry.ts`.
- Replace with an async loader and an in-memory store:

  ```ts
  // lib/registry.ts (rewritten)
  export interface RegistrySnapshot {
      modules: ModuleDef[];
      customTypes: CustomTypeDef[];
  }
  export async function fetchRegistry(): Promise<RegistrySnapshot> { ... }
  export const registryStore = create<{
      snapshot: RegistrySnapshot | null;
      error: string | null;
      reload: () => Promise<void>;
  }>(...);
  ```

- `customTypes` is derived from `modules.flatMap(m => m.exportedTypes)` plus user-defined types from the workflow (the existing `TypesEditor` flow stays as today; user types live in `Workflow.customTypes`, not the registry).

### Subscribing to changes

- On app mount: `fetchRegistry()` once. If it fails, show a full-page error banner with a Retry button (no fallback data).
- Open an `EventSource("/modules/events")`. On `changed`, call `reload()`.
- All callers (`Palette`, `Canvas`, `ConfigPanel`, `TypesEditor`, `typecheck`, `export`) read from the store. `findModule` / `findComponent` / `allKnownCustomTypes` become snapshot lookups; their signatures don't change so the rest of the code is mostly untouched.

### Handling registry-driven invalidation

When a refresh removes a module that the open workflow uses, mark the affected nodes as "missing" (existing validation surfaces this as red ports). No automatic deletion.

### UI: install modal

- New button in the Palette header: **"+ Install module"**.
- Modal collects source kind (git | http-tar), url, and ref-or-sha256. POSTs `/modules/install`.
- On success the SSE stream will refresh the registry; no client-side merge needed.
- Errors render the backend's validation report verbatim.

---

## Compiler changes

Minor:

- `Registry::load` already does the right thing. Expose it (and `load_manifest`) as `pub` so the backend's install path can call it for validation without re-implementing the parser.
- Add `Registry::serialize_view(&self) -> Vec<ModuleView>` (or put the view type next to `Registry`) so backend doesn't need to round-trip JSON through disk.

---

## Implementation order (when we start)

1. **Backend `Registry::load` exposed + `/modules` GET implemented** with the existing on-disk content. Frontend keeps hardcoded fallback temporarily for this step only (it's deleted in step 3).
2. **File watcher + SSE.** Verify a manual edit to `metadata.json` triggers a UI refresh.
3. **Frontend rewrite of `lib/registry.ts`** to consume the API + SSE; delete hardcoded `MODULES`/`BUILTIN_TYPES`.
4. **Install endpoint (HTTP tar first — simpler), lockfile read/write.**
5. **Git source.** Requires `git` on PATH; document this.
6. **`/modules/sync` + DELETE.**
7. **Install modal in the Palette.**

Each step is shippable on its own.

---

## Open follow-ups (explicitly deferred)

- SemVer resolution and a `^x.y.z` syntax in the lockfile.
- Module signatures / supply-chain attestation.
- Private registries & auth.
- A "publish" CLI for module authors.
