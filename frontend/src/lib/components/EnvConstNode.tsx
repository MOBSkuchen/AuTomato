import { memo } from "react";
import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import type { NodeInstance } from "../types";
import { useWorkflow } from "../store";

type NodeData = { instance: NodeInstance };

function EnvConstNode({ data, id, selected }: NodeProps) {
  const instance = (data as NodeData).instance;
  const removeNode = useWorkflow((s) => s.removeNode);

  return (
    <>
      <NodeResizer
        minWidth={180}
        minHeight={80}
        isVisible={selected}
        lineStyle={{ borderColor: "var(--accent)", borderWidth: 1 }}
        handleStyle={{ width: 6, height: 6, background: "var(--accent)", borderColor: "var(--accent)", borderRadius: 1 }}
      />
      <div className={"an-node cat-pure" + (selected ? " selected" : "")}>
        <header style={{ background: "color-mix(in srgb, var(--t-string) 18%, var(--bg-3))" }}>
          <div className="title">
            <span className="cat-badge" style={{ background: "var(--t-string)" }}>env</span>
            <span className="comp-name">{instance.envKey || "env var"}</span>
          </div>
          <button className="remove-btn nodrag" onClick={(e) => { e.stopPropagation(); removeNode(id); }} title="Remove node" tabIndex={-1}>×</button>
        </header>
        <div className="ports">
          <div className="col inputs" />
          <div className="col outputs">
            <div className="port out">
              <span className="ty" style={{ color: "var(--t-string)" }}>string</span>
              <span className="label">value</span>
              <Handle
                type="source"
                position={Position.Right}
                id="value"
                style={{ background: "var(--t-string)", borderColor: "var(--t-string)", width: 12, height: 12 }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default memo(EnvConstNode);
