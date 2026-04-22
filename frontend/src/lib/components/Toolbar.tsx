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
  const msgTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (msgTimer.current) window.clearTimeout(msgTimer.current);
    },
    [],
  );

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

  async function onCompile() {
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
    flashMessage("Compiling…");
    try {
      const backend =
        (import.meta as unknown as { env?: { VITE_BACKEND_URL?: string } })
          .env?.VITE_BACKEND_URL ?? "http://localhost:7878";
      const resp = await fetch(`${backend}/compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ast, target: "go" }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        showError(`Backend HTTP ${resp.status}: ${text || resp.statusText}`);
        return;
      }
      const data = (await resp.json()) as {
        ok: boolean;
        content?: string;
        error?: string;
      };
      if (!data.ok || !data.content) {
        showError(data.error ?? "Compile failed with unknown error.");
        return;
      }
      const blob = new Blob([data.content], { type: "text/x-go" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workflow.name.replace(/\s+/g, "-")}.main.go`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
      flashMessage("Compiled: main.go downloaded.");
    } catch (e) {
      showError(
        `Backend unreachable: ${(e as Error).message}. Start automato-backend on :7878.`,
      );
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
        <button className="primary" onClick={onCompile}>
          Compile
        </button>
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
