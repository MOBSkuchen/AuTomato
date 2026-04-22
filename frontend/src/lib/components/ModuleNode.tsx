import { memo } from "react";
import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import { findComponent, findModule } from "../registry";
import {
  typeColor,
  typeLabel,
  passthroughHandleId,
  EXEC_IN,
  EXEC_OUT,
  EXEC_ERR,
  DATA_ERRVAL,
  type NodeInstance,
} from "../types";
import { useWorkflow } from "../store";

type NodeData = { instance: NodeInstance };

function ModuleNode({ data, id, selected }: NodeProps) {
  const instance = (data as NodeData).instance;
  const mod = findModule(instance.moduleId);
  const comp = findComponent(instance.moduleId, instance.componentName);
  const hasError = !!comp?.errorType;
  const category = comp?.category ?? "action";
  const isTrigger = category === "trigger";
  const isReturn = category === "return";
  const isPure = category === "pure";
  const hasExecIn = !isTrigger && !isPure;
  const hasExecOut = !isReturn && !isPure;
  const removeNode = useWorkflow((s) => s.removeNode);

  const accent =
    isTrigger
      ? "#6bc76b"
      : isReturn
        ? "#e0a94c"
        : isPure
          ? "var(--t-custom)"
          : "var(--accent)";

  return (
    <>
      <NodeResizer
        minWidth={220}
        minHeight={120}
        isVisible={selected}
        lineStyle={{ borderColor: "var(--accent)", borderWidth: 1 }}
        handleStyle={{
          width: 6,
          height: 6,
          background: "var(--accent)",
          borderColor: "var(--accent)",
          borderRadius: 1,
        }}
      />
      <div
        className={
          "an-node" +
          (selected ? " selected" : "") +
          " cat-" +
          category
        }
        style={{ borderColor: selected ? accent : undefined }}
      >
        {hasExecIn && (
          <Handle
            type="target"
            position={Position.Top}
            id={EXEC_IN}
            className="exec-handle exec-in"
          />
        )}

        <header style={{ background: `color-mix(in srgb, ${accent} 18%, var(--bg-3))` }}>
          <div className="title">
            <span className="cat-badge" style={{ background: accent }}>
              {category}
            </span>
            <span className="comp-name">{comp?.name ?? "?"}</span>
            <span className="mod-name">· {mod?.name ?? "?"}</span>
          </div>
          <button
            className="remove-btn nodrag"
            onClick={(e) => {
              e.stopPropagation();
              removeNode(id);
            }}
            title="Remove node"
            tabIndex={-1}
          >
            ×
          </button>
        </header>

        <div className="ports">
          <div className="col inputs">
            {comp?.inputs.map((input) => (
              <div
                className={
                  "port in" + (input.consumption === "passthrough" ? " pt" : "")
                }
                key={input.name}
              >
                <Handle
                  type="target"
                  position={Position.Left}
                  id={input.name}
                  style={{
                    background: typeColor(input.type),
                    borderColor: typeColor(input.type),
                    width: 12,
                    height: 12,
                  }}
                />
                <span className="label">
                  {input.name}
                  {input.consumption === "consumed" && (
                    <span className="cons-mark" title="consumed">●</span>
                  )}
                  {input.consumption === "passthrough" && (
                    <span className="cons-mark pt" title="passthrough">○</span>
                  )}
                </span>
                <span className="ty" style={{ color: typeColor(input.type) }}>
                  {typeLabel(input.type)}
                </span>
              </div>
            ))}
            {comp?.inputs.length === 0 && (
              <div className="port-empty">no inputs</div>
            )}
          </div>
          <div className="col outputs">
            {comp?.outputs.map((output) => (
              <div className="port out" key={output.name}>
                <span className="ty" style={{ color: typeColor(output.type) }}>
                  {typeLabel(output.type)}
                </span>
                <span className="label">{output.name}</span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={output.name}
                  style={{
                    background: typeColor(output.type),
                    borderColor: typeColor(output.type),
                    width: 12,
                    height: 12,
                  }}
                />
              </div>
            ))}
            {comp?.inputs
              .filter((i) => i.consumption === "passthrough")
              .map((input) => (
                <div className="port out pt" key={`pt-${input.name}`}>
                  <span className="ty" style={{ color: typeColor(input.type) }}>
                    {typeLabel(input.type)}
                  </span>
                  <span className="label">{input.name}↺</span>
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={passthroughHandleId(input.name)}
                    style={{
                      background: typeColor(input.type),
                      borderColor: typeColor(input.type),
                      width: 10,
                      height: 10,
                      outline: "1px dashed var(--bg-0)",
                    }}
                  />
                </div>
              ))}
            {hasError && comp?.errorType && (
              <div className="port out error">
                <span className="ty" style={{ color: "var(--err)" }}>
                  {typeLabel(comp.errorType)}
                </span>
                <span className="label">err</span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={DATA_ERRVAL}
                  style={{
                    background: "var(--err)",
                    borderColor: "var(--err)",
                    width: 12,
                    height: 12,
                  }}
                />
              </div>
            )}
            {comp && comp.outputs.length === 0 && !hasError && (
              <div className="port-empty right">no outputs</div>
            )}
          </div>
        </div>

        {mod && mod.effectTags.length > 0 && (
          <div className="tags-row">
            {mod.effectTags.map((tag) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {hasExecOut && (
          <Handle
            type="source"
            position={Position.Bottom}
            id={EXEC_OUT}
            className="exec-handle exec-out"
            style={hasError ? { left: "30%" } : undefined}
          />
        )}
        {hasError && (
          <Handle
            type="source"
            position={Position.Bottom}
            id={EXEC_ERR}
            className="exec-handle exec-out exec-err"
            style={{ left: "70%" }}
          />
        )}
      </div>
    </>
  );
}

export default memo(ModuleNode);
