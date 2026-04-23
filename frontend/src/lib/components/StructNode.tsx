import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  typeColor,
  typeLabel,
  type NodeInstance,
  type WorkflowType,
} from "../types";
import { useWorkflow } from "../store";
import { findCustomType } from "../registry";

type NodeData = { instance: NodeInstance };

function StructNode({ data, id, selected }: NodeProps) {
  const instance = (data as NodeData).instance;
  const removeNode = useWorkflow((s) => s.removeNode);
  const workflowTypes = useWorkflow((s) => s.workflow.customTypes);

  const isConstruct = instance.kind === "construct";
  const typeName = instance.targetType ?? "";
  const typeDef =
    findCustomType(typeName) ?? workflowTypes.find((t) => t.name === typeName);
  const headerLabel = isConstruct ? "construct" : "destruct";
  const headerColor = typeColor({ kind: "custom", name: typeName });
  const wholeType: WorkflowType = { kind: "custom", name: typeName };

  const kind = typeDef?.kind ?? "struct";
  const isStruct = !!typeDef && kind === "struct" && !typeDef.sealed;
  const fields = isStruct ? typeDef!.fields : [];
  const invalid = !typeDef || !isStruct;

  return (
    <div
      className={
        "an-struct" +
        (selected ? " selected" : "") +
        (invalid ? " invalid" : "")
      }
    >
      <header style={{ borderBottomColor: headerColor }}>
        <span className="cat-badge">{headerLabel}</span>
        <span className="title">{typeName || "(no type)"}</span>
        <button
          className="remove-btn nodrag"
          onClick={(e) => {
            e.stopPropagation();
            removeNode(id);
          }}
          title="Remove"
          tabIndex={-1}
        >
          ×
        </button>
      </header>
      <div className="body">
        {invalid && (
          <div className="port">
            <span className="label" style={{ color: "var(--err)" }}>
              {!typeDef
                ? "Pick a custom struct type"
                : typeDef.sealed
                  ? "Sealed types cannot be constructed/destructed"
                  : "Not a struct type"}
            </span>
          </div>
        )}

        {isConstruct ? (
          <>
            {fields.map((f) => (
              <div key={f.name} className="port in">
                <Handle
                  type="target"
                  position={Position.Left}
                  id={f.name}
                  style={{
                    background: typeColor(f.type),
                    borderColor: typeColor(f.type),
                    width: 12,
                    height: 12,
                  }}
                />
                <span className="label">{f.name}</span>
                <span className="ty" style={{ color: typeColor(f.type) }}>
                  {typeLabel(f.type)}
                </span>
              </div>
            ))}
            <div className="port out">
              <span className="ty" style={{ color: headerColor }}>
                {typeLabel(wholeType)}
              </span>
              <span className="label">value</span>
              <Handle
                type="source"
                position={Position.Right}
                id="value"
                style={{
                  background: headerColor,
                  borderColor: headerColor,
                  width: 12,
                  height: 12,
                }}
              />
            </div>
          </>
        ) : (
          <>
            <div className="port in">
              <Handle
                type="target"
                position={Position.Left}
                id="value"
                style={{
                  background: headerColor,
                  borderColor: headerColor,
                  width: 12,
                  height: 12,
                }}
              />
              <span className="label">value</span>
              <span className="ty" style={{ color: headerColor }}>
                {typeLabel(wholeType)}
              </span>
            </div>
            {fields.map((f) => (
              <div key={f.name} className="port out">
                <span className="ty" style={{ color: typeColor(f.type) }}>
                  {typeLabel(f.type)}
                </span>
                <span className="label">{f.name}</span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={f.name}
                  style={{
                    background: typeColor(f.type),
                    borderColor: typeColor(f.type),
                    width: 12,
                    height: 12,
                  }}
                />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(StructNode);
