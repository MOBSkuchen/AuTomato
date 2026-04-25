# Auto-fetching modules — cache-based

Plan for letting users install modules from remote sources (HTTP tarballs, Git repos)
into a backend-managed cache, plus a live, backend-driven module registry that
the frontend consumes.

This is **not** a package manager. There is no SemVer, no dependency graph, and
no upgrade-in-place. Each install captures one specific version, identified by a
synthetic ID derived from `(kind, url, version)`. Two installs of the same source
collapse onto the same cache directory.

## Decisions in scope

- **Two module classes**:
  - **Bundled**: ship with the repo under `modules/automato/*`. Stable IDs from
    `metadata.json` (e.g. `automato/cron`). Never evicted.
  - **Cached**: installed via the UI. Live under `modules/.cache/<id>/`. ID is
    derived from `cache_<base64url(kind|url|version)>`. Subject to TTL eviction.
- **TTL eviction.** A cache entry that has not been requested for 24 hours is
  deleted. "Requested" = served by `GET /modules`, `GET /modules/:id`, or
  referenced by `POST /compile` / `POST /build`.
- **Workflows are self-sufficient.** A `Workflow` snapshot embeds the layout
  (components + exported types) of every module it uses, plus the install source
  spec. If the cache is GC'd between sessions, the workflow stays editable
  using the snapshot, and the frontend can re-`POST /modules/install` to
  re-fetch on demand.
- **Source mutation is out of scope.** A pinned version is treated as immutable.
  If upstream rewrites the same tag, the cache key — and therefore the
  workflow's reference — is unaffected.
- **No auth.** All sources are public.

## Out of scope

- Authenticated registries.
- SemVer resolution / `^x.y.z`.
- Publishing flow.
- Trust delegation: bundled vs cached is the only distinction.
- Reproducibility lockfile (`automato.lock`). The workflow file is the
  "lockfile"; installation is on-demand, by source spec.

---

## Cache ID scheme

For an install request `{kind, url, version}`:

```
id = "cache_" + base64url_no_pad(<kind> "|" <url> "|" <version>)
```

- `kind` ∈ `{"git", "http-tar"}`.
- For `git`, `version` is the ref (tag/branch/commit).
- For `http-tar`, `version` is the SHA-256 of the tarball (also used as the
  integrity check).

Idempotency: re-installing the same `(kind, url, version)` is a no-op that
just bumps the LRU timestamp.

## Storage layout

```
modules/
  automato/                                 <- bundled (stable ids, no eviction)
    cron/...
    log/...
  .cache/                                   <- cache (synthetic ids)
    cache_aGl0LXRhcnxodHRwczo.../...
    cache_Z2l0fGh0dHBzOi8vL2Zvby8.../...
.automato/
  cache.json                                <- last-used timestamps for cache_* ids
```

`.cache/` is a hidden directory under `modules/` so it sits next to the bundled
namespace without colliding with module IDs (no real module starts with a `.`).

---

## Backend: registry HTTP API

| Method | Path                       | Purpose                                                                                          |
|--------|----------------------------|--------------------------------------------------------------------------------------------------|
| GET    | `/modules`                 | List all modules (bundled + cached). Bumps LRU timestamps for served `cache_*` ids.              |
| GET    | `/modules/:id`             | Single module. 404 if missing. Bumps timestamp.                                                  |
| GET    | `/modules/events`          | SSE stream. Emits `{type:"changed"}` on install, eviction, or filesystem edits.                  |
| POST   | `/modules/install`         | Body: `{kind, url, version}`. Idempotent. Returns the cached module's `ModuleView`.              |
| DELETE | `/modules/:id`             | Manual eviction. Refuses bundled IDs. 404 if not found.                                          |

### Install flow

1. **Parse body**: `{kind: "git" | "http-tar", url: string, version: string}`.
   - For `http-tar`, `version` must be a 64-char lowercase hex string (SHA-256).
2. **Compute id** = `cache_<base64url_no_pad(kind|url|version)>`.
3. **Idempotent check**: if `modules/.cache/<id>/metadata.json` already exists,
   touch the LRU and return the existing view.
4. **Fetch into a temp dir**:
   - `git`: shell out to `git clone --depth 1 --branch <version> <url> <tmp>`.
   - `http-tar`: stream into a SHA-256 hasher; reject on hash mismatch; ungzip
     and untar into the temp dir.
5. **Locate the module dir**: walk the extracted tree for the first directory
   containing `metadata.json` + `definitions.json`. Reject if there are zero
   or more than one.
6. **Validate** by parsing through `compiler::registry::load_manifest`. Reject
   the install on any validation failure with the parser's error.
7. **Rewrite** the candidate's `metadata.json`: overwrite the `id` field with
   the synthetic cache id (the original is discarded — cached modules are
   identified solely by their source spec).
8. **Place atomically**: `fs::rename(candidate, modules/.cache/<id>)`. Fall
   back to copy + remove on cross-mount errors.
9. **Bump LRU; reload registry; broadcast** SSE `changed`.

### Error mapping

- `400` — malformed body, bad URL scheme, malformed sha256.
- `422` — download failed validation: zero or multiple module dirs in archive,
  parse error from `load_manifest`, sha256 mismatch, git clone failure.
- `502` — network error reaching the source URL.

### TTL GC

- Tokio task ticks every 15 minutes.
- For each subdirectory of `modules/.cache/`:
  - If `cache.json` lacks an entry, treat as just-installed and seed `now`.
  - If `now - last_used > 24h`, `fs::remove_dir_all` and drop the entry.
- Persist `cache.json`; if anything was evicted, `state.reload()` fires SSE.

A module is "used" whenever it appears in:

- A `GET /modules` response (every cache entry returned bumps).
- A `GET /modules/:id` response.
- The AST submitted to `POST /compile` or `POST /build` (touch every distinct
  `module_id` referenced).

### DELETE flow

- Refuse if `:id` is bundled (i.e. its directory is not under `.cache/`).
- `fs::remove_dir_all(modules/.cache/<id>)`.
- Drop from `cache.json`.
- `state.reload()`; broadcast SSE.

---

## Frontend: install UI and workflow snapshot

### `+ Install module` modal

- Button in the Palette header.
- Modal fields:
  - **Source**: radio (`git` | `http-tar`).
  - **URL**: text input.
  - **Version**: text input. Label is "Ref (tag/branch/commit)" for git,
    "SHA-256" for http-tar.
- On submit: `POST /modules/install`.
- Success → close modal; SSE refreshes the registry automatically.
- Error → render the backend's report verbatim, leave the modal open.

### Module snapshot in `Workflow`

`Workflow` gains:

```ts
interface ModuleSource {
  kind: "git" | "http-tar";
  url: string;
  version: string;
}
interface ModuleSnapshot {
  id: string;                     // bundled id or cache_*
  source?: ModuleSource;          // omitted for bundled modules
  name: string;
  version: string;                // metadata.json version
  components: ComponentDef[];     // for offline lookup / validation
  exportedTypes: CustomTypeDef[];
}
interface Workflow {
  // ...existing fields...
  usedModules: ModuleSnapshot[];
}
```

- **On node creation**: if the module isn't already in `usedModules`, snapshot
  it from the live registry view.
- **On workflow load**: for each `usedModule.source`, if the registry doesn't
  currently expose its `id`, fire a background `POST /modules/install` with
  the saved source spec. Until the install resolves, lookups
  (`findModule`/`findComponent`/`findCustomType`) fall back to the snapshot,
  so the user can keep editing.
- **Drift handling**: pinned versions are immutable, so re-installation should
  always produce the same layout. If the live view ever differs from the
  snapshot, surface a warning but trust the live version (it's what the
  compiler will use).

---

## Implementation order

1. **Plan doc rewrite** (this document).
2. **Backend `POST /modules/install`** — both source kinds, integrity, atomic
   rename, idempotent.
3. **Cache LRU tracker + GC task**.
4. **`DELETE /modules/:id`**.
5. **Touch points** wired into `/modules`, `/modules/:id`, `/compile`, `/build`.
6. **Frontend install modal**.
7. **Workflow snapshot** — store-side capture, fallback resolution, background
   re-install on load.

Each step is shippable on its own.

---

## Open follow-ups (deferred)

- A "publish" CLI for module authors.
- Module signing / supply-chain attestation.
- Upgrade-assistance UI ("a newer version of this module is available at
  <url>").
- Bulk export of cache contents for offline mirrors.
