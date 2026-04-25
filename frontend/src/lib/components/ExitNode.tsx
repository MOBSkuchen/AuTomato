import { memo } from "react";
import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import { EXEC_IN, DATA_EXIT_CODE } from "../types";
import { useWorkflow } from "../store";

type NodeData = { instance: { id: string } };

function ExitNode({ data, id, selected }: NodeProps) {
  const instance = (data as NodeData).instance;
  const removeNode = useWorkflow((s) => s.removeNode);
  const wiredCode = useWorkflow((s) =>
    s.workflow.edges.some((e) => e.to.nodeId === instance.id && e.to.port === DATA_EXIT_CODE),
  );

  return (
    <>
      <NodeResizer
        minWidth={160}
        minHeight={80}
        isVisible={selected}
        lineStyle={{ borderColor: "var(--accent)", borderWidth: 1 }}
        handleStyle={{ width: 6, height: 6, background: "var(--accent)", borderColor: "var(--accent)", borderRadius: 1 }}
      />
      <div className={"an-node cat-return" + (selected ? " selected" : "")}>
        <Handle type="target" position={Position.Top} id={EXEC_IN} className="exec-handle exec-in" />
        <header style={{ background: "color-mix(in srgb, #e0a94c 18%, var(--bg-3))" }}>
          <div className="title">
            <span className="cat-badge" style={{ background: "#e0a94c" }}>exit</span>
            <span className="comp-name">Exit</span>
          </div>
          <button className="remove-btn nodrag" onClick={(e) => { e.stopPropagation(); removeNode(id); }} title="Remove node" tabIndex={-1}>×</button>
        </header>
        <div className="ports">
          <div className="col inputs">
            <div className="port in">
              <Handle
                type="target"
                position={Position.Left}
                id={DATA_EXIT_CODE}
                style={{ background: "var(--t-int)", borderColor: "var(--t-int)", width: 12, height: 12 }}
              />
              <span className="label">code</span>
              <span className="ty" style={{ color: "var(--t-int)" }}>int</span>
              {!wiredCode && <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>(optional)</span>}
            </div>
          </div>
          <div className="col outputs" />
        </div>
      </div>
    </>
  );
}

export default memo(ExitNode);
