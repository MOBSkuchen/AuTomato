import { useMemo } from "react";
import { useWorkflow } from "../store";
import { findComponent, findModule } from "../registry";
import {
  typeColor,
  typeLabel,
  EXEC_ERR,
  type NodeKind,
  type WorkflowType,
} from "../types";

function isPrimitive(k: WorkflowType["kind"]): boolean {
  return k === "int" || k === "float" || k === "string" || k === "bool";
}

export default function ConfigPanel() {
  const workflow = useWorkflow((s) => s.workflow);
  const selectedNodeId = useWorkflow((s) => s.selectedNodeId);
  const removeNode = useWorkflow((s) => s.removeNode);
  const setLiteralInput = useWorkflow((s) => s.setLiteralInput);
  const setConstantValue = useWorkflow((s) => s.setConstantValue);
  const setRetryPolicy = useWorkflow((s) => s.setRetryPolicy);

  const node = useMemo(
    () => workflow.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [workflow.nodes, selectedNodeId],
  );

  const nodeKind: NodeKind | null = node ? node.kind ?? "module" : null;
  const isBuiltin =
    !!node &&
    (nodeKind === "constant" || nodeKind === "branch" || nodeKind === "loop");

  const comp =
    node && nodeKind === "module"
      ? findComponent(node.moduleId, node.componentName)
      : undefined;
  const mod =
    node && nodeKind === "module" ? findModule(node.moduleId) : undefined;

  const wiredInputs = useMemo(() => {
    const s = new Set<string>();
    if (!node) return s;
    for (const e of workflow.edges) {
      if (e.to.nodeId === node.id) s.add(e.to.port);
    }
    return s;
  }, [workflow.edges, node]);

  const errorBranchWired = useMemo(() => {
    if (!node) return false;
    return workflow.edges.some(
      (e) =>
        e.from.nodeId === node.id &&
        e.from.port === EXEC_ERR &&
        e.kind === "exec",
    );
  }, [workflow.edges, node]);

  function writeLiteral(port: string, ty: WorkflowType, raw: string, bool?: boolean) {
    if (!node) return;
    if (ty.kind === "int") {
      if (raw === "") setLiteralInput(node.id, port, "");
      else {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n)) setLiteralInput(node.id, port, n);
      }
    } else if (ty.kind === "float") {
      if (raw === "") setLiteralInput(node.id, port, "");
      else {
        const n = parseFloat(raw);
        if (!Number.isNaN(n)) setLiteralInput(node.id, port, n);
      }
    } else if (ty.kind === "bool") {
      setLiteralInput(node.id, port, !!bool);
    } else {
      setLiteralInput(node.id, port, raw);
    }
  }

  function toggleRetry() {
    if (!node) return;
    if (node.retryPolicy) setRetryPolicy(node.id, undefined);
    else setRetryPolicy(node.id, { maxAttempts: 3, backoffMs: 250 });
  }

  function setRetryField(field: "maxAttempts" | "backoffMs", v: string) {
    if (!node?.retryPolicy) return;
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return;
    setRetryPolicy(node.id, { ...node.retryPolicy, [field]: n });
  }

  const supportsRetry = mod?.effectTags.includes("retry") ?? false;

  if (!node) {
    return (
      <aside className="config">
        <div className="empty">
          <h2>No selection</h2>
          <p>Click a node on the canvas to edit its configuration.</p>
        </div>
      </aside>
    );
  }

  if (isBuiltin) {
    const title =
      nodeKind === "constant"
        ? "Constant"
        : nodeKind === "branch"
          ? "Branch"
          : "Loop";
    const subtitle =
      nodeKind === "constant"
        ? "Literal value with no inputs."
        : nodeKind === "branch"
          ? "Forks control flow on a boolean condition."
          : "Iterates over an array; body runs per item, done runs after.";
    return (
      <aside className="config">
        <header>
          <div className="title">
            <span className="module">{title}</span>
          </div>
          <div className="subtitle">{subtitle}</div>
        </header>

        <section>
          <h3>Identity</h3>
          <div className="kv">
            <span>ID</span>
            <code>{node.id}</code>
          </div>
          <div className="kv">
            <span>Kind</span>
            <code>{nodeKind}</code>
          </div>
        </section>

        {nodeKind === "constant" && node.constantType && (
          <section>
            <h3>Value</h3>
            <div className="kv">
              <span>type</span>
              <span style={{ color: typeColor(node.constantType) }}>
                {typeLabel(node.constantType)}
              </span>
            </div>
            {node.constantType.kind === "bool" ? (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={!!node.constantValue}
                  onChange={(e) =>
                    setConstantValue(node.id, e.target.checked)
                  }
                />
                <span>{node.constantValue ? "true" : "false"}</span>
              </label>
            ) : node.constantType.kind === "int" ||
              node.constantType.kind === "float" ? (
              <input
                type="number"
                step={node.constantType.kind === "float" ? "any" : "1"}
                value={
                  typeof node.constantValue === "number"
                    ? node.constantValue
                    : ""
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === "") return;
                  const n =
                    node.constantType!.kind === "int"
                      ? parseInt(raw, 10)
                      : parseFloat(raw);
                  if (!Number.isNaN(n)) setConstantValue(node.id, n);
                }}
              />
            ) : (
              <input
                type="text"
                value={
                  typeof node.constantValue === "string"
                    ? node.constantValue
                    : ""
                }
                onChange={(e) => setConstantValue(node.id, e.target.value)}
              />
            )}
          </section>
        )}

        <footer>
          <button onClick={() => removeNode(node.id)} className="danger">
            Delete node
          </button>
        </footer>
      </aside>
    );
  }

  if (!comp || !mod) {
    return (
      <aside className="config">
        <div className="empty error">
          <h2>Unknown module</h2>
          <p>
            Module <code>{node.moduleId}</code> is not registered.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="config">
      <header>
        <div className="title">
          <span className={"cat-pill cat-" + comp.category}>
            {comp.category}
          </span>
          <span className="module">{mod.name}</span>
          <span className="comp">·{comp.name}</span>
        </div>
        <div className="subtitle">{comp.description}</div>
      </header>

      <section>
        <h3>Identity</h3>
        <div className="kv">
          <span>ID</span>
          <code>{node.id}</code>
        </div>
        <div className="kv">
          <span>Module</span>
          <code>
            {node.moduleId}@{mod.version}
          </code>
        </div>
      </section>

      <section>
        <h3>Inputs</h3>
        {comp.inputs.length === 0 && <div className="muted">No inputs.</div>}
        {comp.inputs.map((input) => {
          const wired = wiredInputs.has(input.name);
          const current = node.literalInputs[input.name];
          return (
            <div className="input-row" key={input.name}>
              <div className="input-head">
                <span className="in-name">{input.name}</span>
                <span
                  className="in-ty"
                  style={{ color: typeColor(input.type) }}
                >
                  {typeLabel(input.type)}
                </span>
                {input.consumption && (
                  <span className={"pill cons " + input.consumption}>
                    {input.consumption}
                  </span>
                )}
                {wired ? (
                  <span className="pill">wired</span>
                ) : (
                  <span className="pill literal">literal</span>
                )}
              </div>
              {!wired &&
                (isPrimitive(input.type.kind) ? (
                  input.type.kind === "bool" ? (
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={!!current}
                        onChange={(e) =>
                          writeLiteral(
                            input.name,
                            input.type,
                            "",
                            e.target.checked,
                          )
                        }
                      />
                      <span>{current ? "true" : "false"}</span>
                    </label>
                  ) : input.type.kind === "int" ||
                    input.type.kind === "float" ? (
                    <input
                      type="number"
                      value={
                        typeof current === "number" || typeof current === "string"
                          ? String(current)
                          : ""
                      }
                      step={input.type.kind === "float" ? "any" : "1"}
                      onChange={(e) =>
                        writeLiteral(input.name, input.type, e.target.value)
                      }
                      placeholder={`enter ${input.type.kind}`}
                    />
                  ) : (
                    <input
                      type="text"
                      value={typeof current === "string" ? current : ""}
                      onChange={(e) =>
                        writeLiteral(input.name, input.type, e.target.value)
                      }
                      placeholder="enter string"
                    />
                  )
                ) : (
                  <div className="muted">
                    Wire from another node (no literal editor for{" "}
                    {typeLabel(input.type)})
                  </div>
                ))}
            </div>
          );
        })}
      </section>

      <section>
        <h3>Outputs</h3>
        {comp.outputs.length === 0 && (
          <div className="muted">No outputs.</div>
        )}
        {comp.outputs.map((out) => (
          <div className="kv" key={out.name}>
            <span>{out.name}</span>
            <span style={{ color: typeColor(out.type) }}>
              {typeLabel(out.type)}
            </span>
          </div>
        ))}
      </section>

      {comp.errorType && (
        <section>
          <h3>Error branch</h3>
          <div className="kv">
            <span>value type</span>
            <span style={{ color: "var(--err)" }}>
              {typeLabel(comp.errorType)}
            </span>
          </div>
          <div
            className={
              "err-status " + (errorBranchWired ? "wired" : "unwired")
            }
          >
            {errorBranchWired
              ? "✓ error exec wired"
              : "⚠ error exec unwired — compile will fail"}
          </div>
          {supportsRetry && (
            <div className="retry">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={!!node.retryPolicy}
                  onChange={toggleRetry}
                />
                <span>Enable retry</span>
              </label>
              {node.retryPolicy && (
                <div className="retry-fields">
                  <label>
                    <span>attempts</span>
                    <input
                      type="number"
                      min={1}
                      value={node.retryPolicy.maxAttempts}
                      onChange={(e) =>
                        setRetryField("maxAttempts", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>backoff ms</span>
                    <input
                      type="number"
                      min={0}
                      value={node.retryPolicy.backoffMs}
                      onChange={(e) =>
                        setRetryField("backoffMs", e.target.value)
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section>
        <h3>Effect tags</h3>
        {mod.effectTags.length === 0 && (
          <div className="muted">No tags.</div>
        )}
        <div className="tags">
          {mod.effectTags.map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
        </div>
      </section>

      <footer>
        <button onClick={() => removeNode(node.id)} className="danger">
          Delete node
        </button>
      </footer>
    </aside>
  );
}
