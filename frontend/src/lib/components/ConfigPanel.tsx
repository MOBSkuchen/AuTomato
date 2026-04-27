import { useMemo } from "react";
import { useWorkflow } from "../store";
import {
  findComponent,
  findModule,
  findCustomType,
  allKnownCustomTypes,
} from "../registry";
import {
  typeColor,
  typeLabel,
  tweakInputHandleId,
  EXEC_ERR,
  type NodeKind,
  type WorkflowType,
  type TweakDef,
  type CustomTypeDef,
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
  const setConstantType = useWorkflow((s) => s.setConstantType);
  const setRetryPolicy = useWorkflow((s) => s.setRetryPolicy);
  const setTargetType = useWorkflow((s) => s.setTargetType);
  const setTweakValue = useWorkflow((s) => s.setTweakValue);
  const setEnvKey = useWorkflow((s) => s.setEnvKey);
  const setEnvDefault = useWorkflow((s) => s.setEnvDefault);

  const node = useMemo(
    () => workflow.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [workflow.nodes, selectedNodeId],
  );

  const nodeKind: NodeKind | null = node ? node.kind ?? "module" : null;
  const isBuiltin =
    !!node &&
    (nodeKind === "constant" ||
      nodeKind === "branch" ||
      nodeKind === "loop" ||
      nodeKind === "construct" ||
      nodeKind === "destruct" ||
      nodeKind === "origin" ||
      nodeKind === "exit" ||
      nodeKind === "env_const");

  const allTypes: CustomTypeDef[] = useMemo(() => {
    const fromModules = allKnownCustomTypes();
    const seen = new Set(fromModules.map((t) => t.name));
    const out = [...fromModules];
    for (const t of workflow.customTypes) {
      if (!seen.has(t.name)) out.push(t);
    }
    return out;
  }, [workflow.customTypes]);

  const availableStructTargets = allTypes.filter(
    (t) => (t.kind ?? "struct") === "struct" && !t.sealed,
  );
  const availableEnumTypes = allTypes.filter((t) => t.kind === "enum");

  const enumForType = (ty: WorkflowType): CustomTypeDef | undefined => {
    if (ty.kind !== "custom") return undefined;
    const t = findCustomType(ty.name) ??
      workflow.customTypes.find((ct) => ct.name === ty.name);
    return t?.kind === "enum" ? t : undefined;
  };

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
          : nodeKind === "loop"
            ? "Loop"
            : nodeKind === "construct"
              ? "Construct"
              : nodeKind === "origin"
                ? "Origin"
                : nodeKind === "exit"
                  ? "Exit"
                  : nodeKind === "env_const"
                    ? "Env Var"
                    : "Destruct";
    const subtitle =
      nodeKind === "constant"
        ? "Literal value with no inputs."
        : nodeKind === "branch"
          ? "Forks control flow on a boolean condition."
          : nodeKind === "loop"
            ? "Iterates over an array; body runs per item, done runs after."
            : nodeKind === "construct"
              ? "Builds a struct from its field inputs."
              : nodeKind === "origin"
                ? "Entry point for the workflow (equivalent to main)."
                : nodeKind === "exit"
                  ? "Terminates the process with an exit code."
                  : nodeKind === "env_const"
                    ? "Reads an environment variable at runtime, falls back to a default."
                    : "Splits a struct into per-field outputs.";
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

        {(nodeKind === "construct" || nodeKind === "destruct") && (
          <section>
            <h3>Target type</h3>
            <select
              value={node.targetType ?? ""}
              onChange={(e) => setTargetType(node.id, e.target.value)}
            >
              <option value="">(pick a struct type)</option>
              {availableStructTargets.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                  {t.sourceModule ? ` · ${t.sourceModule}` : ""}
                </option>
              ))}
            </select>
            {availableStructTargets.length === 0 && (
              <div className="muted" style={{ marginTop: 6 }}>
                No struct types available. Open the Types editor to add one.
              </div>
            )}
          </section>
        )}

        {nodeKind === "env_const" && (
          <section>
            <h3>Configuration</h3>
            <label className="field">
              <span>Env key</span>
              <input
                type="text"
                value={node.envKey ?? ""}
                onChange={(e) => setEnvKey(node.id, e.target.value)}
                placeholder="MY_ENV_VAR"
              />
            </label>
            <label className="field">
              <span>Default value</span>
              <input
                type="text"
                value={node.envDefault ?? ""}
                onChange={(e) => setEnvDefault(node.id, e.target.value)}
                placeholder="fallback"
              />
            </label>
          </section>
        )}

        {nodeKind === "exit" && (
          <section>
            <TweakRow
                key="code"
                tweak={{name: "code", description: "Exit code", type: {kind: "int"}, default: "0"}}
                value={
                  node.tweakValues?.["code"] !== undefined
                      ? node.tweakValues["code"]
                      : "0"
                }
                onChange={(v) => setTweakValue(node.id, "code", v)}
                enumDef={enumForType({ kind: "int" })}
            />
          </section>
        )}

        {nodeKind === "constant" && node.constantType && (
          <section>
            <h3>Value</h3>
            <div className="kv">
              <span>type</span>
              <span style={{ color: typeColor(node.constantType) }}>
                {typeLabel(node.constantType)}
              </span>
            </div>
            {node.constantType.kind === "custom" ? (
              <>
                <label className="field">
                  <span>Enum type</span>
                  <select
                    value={node.constantType.name}
                    onChange={(e) =>
                      setConstantType(node.id, {
                        kind: "custom",
                        name: e.target.value,
                      })
                    }
                  >
                    {!enumForType(node.constantType) && (
                      <option value="">(pick enum type)</option>
                    )}
                    {availableEnumTypes.map((t) => (
                      <option key={t.name} value={t.name}>
                        {t.name}
                        {t.sourceModule ? ` · ${t.sourceModule}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {enumForType(node.constantType) && (
                  <label className="field">
                    <span>Variant</span>
                    <select
                      value={
                        typeof node.constantValue === "string"
                          ? node.constantValue
                          : ""
                      }
                      onChange={(e) =>
                        setConstantValue(node.id, e.target.value)
                      }
                    >
                      {(enumForType(node.constantType)!.variants ?? []).map(
                        (v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                {availableEnumTypes.length === 0 && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    No enum types available. Define one in the Types editor.
                  </div>
                )}
              </>
            ) : node.constantType.kind === "bool" ? (
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

      {comp.tweaks && comp.tweaks.length > 0 && (
        <section>
          <h3>Tweaks</h3>
          {comp.tweaks.map((t) => {
            const handleId = t.inputFallback ? tweakInputHandleId(t.name) : null;
            const wired = handleId ? wiredInputs.has(handleId) : false;
            return (
              <TweakRow
                key={t.name}
                tweak={t}
                value={
                  node.tweakValues?.[t.name] !== undefined
                    ? node.tweakValues[t.name]
                    : t.default
                }
                onChange={(v) => setTweakValue(node.id, t.name, v)}
                enumDef={enumForType(t.type)}
                wired={wired}
              />
            );
          })}
        </section>
      )}

      {comp.category === "trigger" && comp.dispatchMode && comp.dispatchMode !== "none" && comp.dispatchInputName && (
        <section>
          <h3>Dispatch</h3>
          {(() => {
            const inputName = comp.dispatchInputName!;
            const wired = workflow.edges.some(
              (e) => e.kind === "data" && e.to.nodeId === node.id && e.to.port === inputName,
            );
            return (
              <div className={"err-status " + (wired ? "wired" : "unwired")}>
                {wired
                  ? `✓ dispatch wired (input "${inputName}")`
                  : comp.dispatchMode === "required"
                    ? `⚠ wire a Dispatch node into input "${inputName}"`
                    : `○ standalone trigger — wire input "${inputName}" to use a Dispatch`}
              </div>
            );
          })()}
        </section>
      )}

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

interface TweakRowProps {
  tweak: TweakDef;
  value: unknown;
  onChange: (v: unknown) => void;
  enumDef?: CustomTypeDef;
  wired?: boolean;
}

function TweakRow({ tweak, value, onChange, enumDef, wired }: TweakRowProps) {
  const ty = tweak.type;
  const color = typeColor(ty);
  return (
    <div className="input-row">
      <div className="input-head">
        <span className="in-name">{tweak.name}</span>
        <span className="in-ty" style={{ color }}>
          {typeLabel(ty)}
        </span>
        {tweak.inputFallback ? (
          wired
            ? <span className="pill">wired</span>
            : <span className="pill literal">tweak (fallback)</span>
        ) : (
          <span className="pill literal">tweak</span>
        )}
      </div>
      {tweak.description && (
        <div className="muted" style={{ fontSize: 11, fontStyle: "normal" }}>
          {tweak.description}
        </div>
      )}
      {wired ? (
        <div className="muted">Value provided by connected input.</div>
      ) : enumDef ? (
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {(enumDef.variants ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : ty.kind === "bool" ? (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{value ? "true" : "false"}</span>
        </label>
      ) : ty.kind === "int" || ty.kind === "float" ? (
        <input
          type="number"
          step={ty.kind === "float" ? "any" : "1"}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return;
            const n = ty.kind === "int" ? parseInt(raw, 10) : parseFloat(raw);
            if (!Number.isNaN(n)) onChange(n);
          }}
        />
      ) : (
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
