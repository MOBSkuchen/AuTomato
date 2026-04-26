import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  EXEC_IN,
  EXEC_BODY,
  EXEC_DONE,
  DATA_LOOP_ITEM,
  typeColor,
  type NodeInstance,
} from "../types";
import { useWorkflow } from "../store";

type NodeData = { instance: NodeInstance };

function LoopNode({ data, id, selected }: NodeProps) {
  void (data as NodeData).instance;
  const removeNode = useWorkflow((s) => s.removeNode);
  const arrColor = typeColor({ kind: "array", of: { kind: "any" } });
  const anyColor = typeColor({ kind: "any" });

  return (
    <>
      <div className={"an-loop" + (selected ? " selected" : "") + " cat-logic"}>
        <Handle
          type="target"
          position={Position.Top}
          id={EXEC_IN}
          className="exec-handle exec-in"
        />

        <header>
          <span className="cat-badge logic">for</span>
          <span className="title">Loop</span>
          <button
            className="remove-btn nodrag"
            onClick={(e) => {
              e.stopPropagation();
              removeNode(id);
            }}
            tabIndex={-1}
          >
            ×
          </button>
        </header>

        <div className="body">
          <div className="port in">
            <Handle
              type="target"
              position={Position.Left}
              id="iter"
              style={{
                background: arrColor,
                borderColor: arrColor,
                width: 12,
                height: 12,
              }}
            />
            <span className="label">iter</span>
            <span className="ty" style={{ color: arrColor }}>
              array&lt;any&gt;
            </span>
          </div>
          <div className="port out">
            <span className="ty" style={{ color: anyColor }}>any</span>
            <span className="label">item</span>
            <Handle
              type="source"
              position={Position.Right}
              id={DATA_LOOP_ITEM}
              style={{
                background: anyColor,
                borderColor: anyColor,
                width: 12,
                height: 12,
              }}
            />
          </div>
        </div>

        <footer>
          <div className="exec-label true">body</div>
          <div className="exec-label false">done</div>
        </footer>

        <Handle
          type="source"
          position={Position.Bottom}
          id={EXEC_BODY}
          className="exec-handle exec-out exec-body"
          style={{ left: "30%" }}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id={EXEC_DONE}
          className="exec-handle exec-out exec-done"
          style={{ left: "70%" }}
        />
      </div>
    </>
  );
}

export default memo(LoopNode);
