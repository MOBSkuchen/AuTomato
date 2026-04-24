# Docker-enabled workspaces

Compiled workspaces (`workspace-zip` or `binary` targets) can optionally ship a
`Dockerfile`, `.dockerignore`, and `docker-compose.yml` alongside the generated
Go workspace.

## UI

Toolbar → Compile → caret → **Docker** section (shown when target is
*Go workspace (.zip)* or *Binary executable*):

- **Include Dockerfile + compose** — toggles the whole block. Default off.
- **Port** — container listen port; becomes `ENV PORT` inside the image and
  drives `EXPOSE` + the compose `ports:` publish mapping. Default `8080`.
- **EXPOSE + publish port** — when off, the Dockerfile omits `EXPOSE` and
  compose omits `ports`. Useful for workers that do not serve HTTP.

## Wire

Frontend sends:

```json
{
  "ast": { ... },
  "target": "workspace-zip",
  "options": {
    "docker": { "enable": true, "port": 8080, "expose": true }
  }
}
```

Backend (`backend/src/main.rs`) maps `options.docker` → `BuildOptions` →
`compiler::workspace::DockerConfig` and passes it to
`compiler::compile_to_workspace`.

## Build path

`compiler::workspace::build_workspace` receives `&DockerConfig`. When
`enable` is true it inserts:

- `Dockerfile` — multi-stage build that runs `go work sync` in the workspace
  root then `go build` inside `workflow/`. Final stage is `alpine:latest`
  with `ca-certificates`. Honors the configured port via `ENV PORT` and
  optional `EXPOSE`.
- `.dockerignore` — excludes `_build/`, `*.exe`, `*.zip`.
- `docker-compose.yml` — single `services.<slug>` entry building from `.`,
  with `PORT` env and an optional `ports:` mapping.

The generated `DOCS.md` gains a **Docker** section with `docker build` /
`docker run` / `docker compose up` commands when enabled.

## Defaults

`DockerConfig::default()` / `DockerConfig::disabled()` returns `enable=false`,
which is what callers without Docker awareness (tests, pure Go targets) use.
