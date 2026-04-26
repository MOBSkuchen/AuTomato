import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  EXEC_IN,
  EXEC_TRUE,
  EXEC_FALSE,
  typeColor,
  type NodeInstance,
} from "../types";
import { useWorkflow } from "../store";

type NodeData = { instance: NodeInstance };

function BranchNode({ data, id, selected }: NodeProps) {
  void (data as NodeData).instance;
  const removeNode = useWorkflow((s) => s.removeNode);
  const boolColor = typeColor({ kind: "bool" });

  return (
    <>
      <div className={"an-branch" + (selected ? " selected" : "") + " cat-logic"}>
        <Handle
          type="target"
          position={Position.Top}
          id={EXEC_IN}
          className="exec-handle exec-in"
        />

        <header>
          <span className="cat-badge logic">if</span>
          <span className="title">Branch</span>
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
              id="condition"
              style={{
                background: boolColor,
                borderColor: boolColor,
                width: 12,
                height: 12,
              }}
            />
            <span className="label">condition</span>
            <span className="ty" style={{ color: boolColor }}>
              bool
            </span>
          </div>
        </div>

        <footer>
          <div className="exec-label true">then</div>
          <div className="exec-label false">else</div>
        </footer>

        <Handle
          type="source"
          position={Position.Bottom}
          id={EXEC_TRUE}
          className="exec-handle exec-out exec-true"
          style={{ left: "30%" }}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id={EXEC_FALSE}
          className="exec-handle exec-out exec-false"
          style={{ left: "70%" }}
        />
      </div>
    </>
  );
}

export default memo(BranchNode);
