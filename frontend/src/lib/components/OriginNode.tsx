import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { EXEC_OUT } from "../types";
import { useWorkflow } from "../store";

function OriginNode({ id, selected }: NodeProps) {
  const removeNode = useWorkflow((s) => s.removeNode);

  return (
    <>
      <div className={"an-node cat-origin" + (selected ? " selected" : "")}>
        <header style={{ background: "color-mix(in srgb, #a78bfa 18%, var(--bg-3))" }}>
          <div className="title">
            <span className="cat-badge" style={{ background: "#a78bfa" }}>origin</span>
            <span className="comp-name">main</span>
          </div>
          <button className="remove-btn nodrag" onClick={(e) => { e.stopPropagation(); removeNode(id); }} title="Remove node" tabIndex={-1}>×</button>
        </header>
        <div className="ports">
          <div className="col inputs" />
          <div className="col outputs" />
        </div>
        <Handle type="source" position={Position.Bottom} id={EXEC_OUT} className="exec-handle exec-out" />
      </div>
    </>
  );
}

export default memo(OriginNode);
