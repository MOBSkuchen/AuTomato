import { useEffect, useMemo, useRef, useState } from "react";
import {
  useWorkflow,
  computeValidation,
  computeUnwiredErrorBranches,
} from "../store";
import { downloadJson, exportAst } from "../export";

interface Props {
  onToggleTypes: () => void;
}

type BuildTarget = "go-source" | "ast-json" | "workspace-zip" | "binary";
type OptLevel = "default" | "none" | "size";

interface BuildOptions {
  optimize: OptLevel;
  strip: boolean;
  trimpath: boolean;
  goos: string;
  goarch: string;
}

const DEFAULT_OPTS: BuildOptions = {
  optimize: "default",
  strip: false,
  trimpath: false,
  goos: "",
  goarch: "",
};

const TARGET_LABELS: Record<BuildTarget, string> = {
  "go-source": "Go source (main.go)",
  "ast-json": "AST JSON",
  "workspace-zip": "Go workspace (.zip)",
  binary: "Binary executable",
};

export default function Toolbar({ onToggleTypes }: Props) {
  const workflow = useWorkflow((s) => s.workflow);
  const setName = useWorkflow((s) => s.setName);
  const reset = useWorkflow((s) => s.reset);
  const loadWorkflow = useWorkflow((s) => s.loadWorkflow);

  const validation = useMemo(() => computeValidation(workflow), [workflow]);
  const unwired = useMemo(
    () => computeUnwiredErrorBranches(workflow),
    [workflow],
  );

  const [message, setMessage] = useState<string | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [target, setTarget] = useState<BuildTarget>("go-source");
  const [opts, setOpts] = useState<BuildOptions>(DEFAULT_OPTS);
  const [busy, setBusy] = useState(false);

  const msgTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(
    () => () => {
      if (msgTimer.current) window.clearTimeout(msgTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(ev.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  function flashMessage(msg: string) {
    setMessage(msg);
    if (msgTimer.current) window.clearTimeout(msgTimer.current);
    msgTimer.current = window.setTimeout(() => setMessage(null), 3000);
  }

  function showError(msg: string) {
    setCompileError(msg);
    setMessage(null);
    if (msgTimer.current) window.clearTimeout(msgTimer.current);
  }

  function onExportAst() {
    const ast = exportAst(workflow);
    downloadJson(ast, `${workflow.name.replace(/\s+/g, "-")}.ast.json`);
  }

  async function onBuild() {
    setCompileError(null);
    if (validation.length > 0) {
      showError(validation.join("\n"));
      return;
    }
    if (unwired.length > 0) {
      showError(
        `${unwired.length} unwired error branch(es). Wire them before compiling.`,
      );
      return;
    }
    if (workflow.nodes.length === 0) {
      flashMessage("Workflow is empty.");
      return;
    }

    const ast = exportAst(workflow);
    const backend =
      (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } })
        .env?.VITE_BACKEND_URL ?? "http://localhost:7878";

    const body: Record<string, unknown> = { ast, target };
    if (target === "binary") {
      const options: Record<string, unknown> = {};
      if (opts.optimize !== "default") options.optimize = opts.optimize;
      if (opts.strip) options.strip = true;
      if (opts.trimpath) options.trimpath = true;
      if (opts.goos.trim()) options.goos = opts.goos.trim();
      if (opts.goarch.trim()) options.goarch = opts.goarch.trim();
      body.options = options;
    }

    setMenuOpen(false);
    setBusy(true);
    flashMessage(target === "binary" ? "Building binary…" : "Compiling…");

    try {
      const resp = await fetch(`${backend}/build`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        showError(text || `Backend HTTP ${resp.status} ${resp.statusText}`);
        return;
      }

      const disposition = resp.headers.get("content-disposition") ?? "";
      const nameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename =
        nameMatch?.[1] ?? defaultFilename(workflow.name, target);

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      flashMessage(`Built: ${filename}`);
    } catch (e) {
      showError(
        `Backend unreachable: ${(e as Error).message}. Start automato-backend on :7878.`,
      );
    } finally {
      setBusy(false);
    }
  }

  function onNew() {
    if (confirm("Discard current workflow and start a new one?")) reset();
  }

  function onSaveFile() {
    downloadJson(
      workflow,
      `${workflow.name.replace(/\s+/g, "-")}.json`,
    );
  }

  async function onLoadFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const input = ev.target;
    const file = input.files?.[0];
    if (!file) return;
    if (!confirm(`Replace current workflow with "${file.name}"?`)) {
      input.value = "";
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = loadWorkflow(parsed);
      if (!result.ok) alert(`Failed to load workflow: ${result.error}`);
    } catch (e) {
      alert("Failed to parse workflow: " + (e as Error).message);
    } finally {
      input.value = "";
    }
  }

  return (
    <header className="toolbar">
      <div className="left">
        <div className="brand">
          <span className="logo">⟲</span>
          <span>AuTomato</span>
        </div>
        <input
          className="name"
          type="text"
          value={workflow.name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="center">
        <span className="stat">{workflow.nodes.length} nodes</span>
        <span className="sep">·</span>
        <span className="stat">{workflow.edges.length} edges</span>
        {unwired.length > 0 && (
          <>
            <span className="sep">·</span>
            <span className="stat warn">
              {unwired.length} unwired error(s)
            </span>
          </>
        )}
        {validation.map((err) => (
          <span key={err} className="stat err" title={err}>
            <span className="sep">·</span> {err}
          </span>
        ))}
      </div>

      <div className="right">
        <button onClick={onToggleTypes}>Types</button>
        <button onClick={onNew}>New</button>
        <label className="file-btn">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            onChange={onLoadFile}
          />
          <span>Load</span>
        </label>
        <button onClick={onSaveFile}>Save</button>
        <button onClick={onExportAst}>Export AST</button>

        <div className="split-btn" ref={menuRef}>
          <button
            className="primary"
            disabled={busy}
            onClick={onBuild}
            title={`Build: ${TARGET_LABELS[target]}`}
          >
            {busy ? "Building…" : "Compile"}
          </button>
          <button
            className="primary caret"
            disabled={busy}
            aria-label="Configure build"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ▾
          </button>

          {menuOpen && (
            <div className="compile-menu" role="menu">
              <div className="menu-section">
                <div className="menu-label">Target</div>
                <div className="menu-targets">
                  {(
                    [
                      "go-source",
                      "ast-json",
                      "workspace-zip",
                      "binary",
                    ] as BuildTarget[]
                  ).map((t) => (
                    <label key={t} className="menu-radio">
                      <input
                        type="radio"
                        name="compile-target"
                        checked={target === t}
                        onChange={() => setTarget(t)}
                      />
                      <span>{TARGET_LABELS[t]}</span>
                    </label>
                  ))}
                </div>
              </div>

              {target === "binary" && (
                <div className="menu-section">
                  <div className="menu-label">Optimizations</div>
                  <label className="menu-field">
                    <span>Mode</span>
                    <select
                      value={opts.optimize}
                      onChange={(e) =>
                        setOpts({
                          ...opts,
                          optimize: e.target.value as OptLevel,
                        })
                      }
                    >
                      <option value="default">default</option>
                      <option value="size">size (-ldflags -s -w)</option>
                      <option value="none">
                        none / debug (-N -l)
                      </option>
                    </select>
                  </label>
                  <label className="menu-checkbox">
                    <input
                      type="checkbox"
                      checked={opts.strip}
                      onChange={(e) =>
                        setOpts({ ...opts, strip: e.target.checked })
                      }
                    />
                    <span>Strip symbols (-s -w)</span>
                  </label>
                  <label className="menu-checkbox">
                    <input
                      type="checkbox"
                      checked={opts.trimpath}
                      onChange={(e) =>
                        setOpts({ ...opts, trimpath: e.target.checked })
                      }
                    />
                    <span>Trim paths (-trimpath)</span>
                  </label>
                  <div className="menu-row">
                    <label className="menu-field compact">
                      <span>GOOS</span>
                      <input
                        type="text"
                        placeholder="host"
                        value={opts.goos}
                        onChange={(e) =>
                          setOpts({ ...opts, goos: e.target.value })
                        }
                      />
                    </label>
                    <label className="menu-field compact">
                      <span>GOARCH</span>
                      <input
                        type="text"
                        placeholder="host"
                        value={opts.goarch}
                        onChange={(e) =>
                          setOpts({ ...opts, goarch: e.target.value })
                        }
                      />
                    </label>
                  </div>
                </div>
              )}

              <div className="menu-footer">
                <button
                  className="menu-reset"
                  onClick={() => setOpts(DEFAULT_OPTS)}
                  disabled={target !== "binary"}
                >
                  Reset opts
                </button>
                <button className="primary" onClick={onBuild} disabled={busy}>
                  Build
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {message && <div className="compile-msg">{message}</div>}
      {compileError && (
        <div className="compile-error" role="alert">
          <div className="compile-error-head">
            <strong>Compile failed</strong>
            <button
              className="compile-error-close"
              onClick={() => setCompileError(null)}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
          <pre className="compile-error-body">{compileError}</pre>
        </div>
      )}
    </header>
  );
}

function defaultFilename(name: string, target: BuildTarget): string {
  const slug = name.replace(/\s+/g, "-") || "workflow";
  switch (target) {
    case "go-source":
      return `${slug}.main.go`;
    case "ast-json":
      return `${slug}.ast.json`;
    case "workspace-zip":
      return `${slug}-workspace.zip`;
    case "binary":
      return slug;
  }
}
