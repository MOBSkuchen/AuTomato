import { memo, useMemo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { typeColor, typeLabel, type NodeInstance, type WorkflowType } from "../types";
import { useWorkflow } from "../store";
import { findCustomType, allKnownCustomTypes } from "../registry";

type NodeData = { instance: NodeInstance };

function ConstantNode({ data, id, selected }: NodeProps) {
  const instance = (data as NodeData).instance;
  const type: WorkflowType = instance.constantType ?? { kind: "string" };
  const color = typeColor(type);
  const rawLabel = typeLabel(type);
  const label =
    type.kind === "custom" && !type.name ? "enum" : rawLabel;
  const setConstantValue = useWorkflow((s) => s.setConstantValue);
  const setConstantType = useWorkflow((s) => s.setConstantType);
  const removeNode = useWorkflow((s) => s.removeNode);
  const workflowTypes = useWorkflow((s) => s.workflow.customTypes);

  const enumDef =
    type.kind === "custom" && type.name
      ? (findCustomType(type.name) ??
          workflowTypes.find((t) => t.name === type.name))
      : undefined;
  const isEnumSlot = type.kind === "custom";
  const isEnum = enumDef?.kind === "enum";

  const availableEnums = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; sourceModule?: string }[] = [];
    for (const t of allKnownCustomTypes()) {
      if (t.kind === "enum" && !seen.has(t.name)) {
        seen.add(t.name);
        out.push({ name: t.name, sourceModule: t.sourceModule });
      }
    }
    for (const t of workflowTypes) {
      if (t.kind === "enum" && !seen.has(t.name)) {
        seen.add(t.name);
        out.push({ name: t.name });
      }
    }
    return out;
  }, [workflowTypes]);

  function handleTextOrNumber(e: React.ChangeEvent<HTMLInputElement>) {
    if (type.kind === "int") {
      const n = parseInt(e.target.value, 10);
      setConstantValue(id, Number.isNaN(n) ? 0 : n);
    } else if (type.kind === "float") {
      const n = parseFloat(e.target.value);
      setConstantValue(id, Number.isNaN(n) ? 0 : n);
    } else {
      setConstantValue(id, e.target.value);
    }
  }

  const numberValue =
    typeof instance.constantValue === "number" ? instance.constantValue : "";
  const textValue =
    typeof instance.constantValue === "string" ? instance.constantValue : "";

  return (
    <div className={"an-constant" + (selected ? " selected" : "")}>
      <header style={{ borderBottomColor: color }}>
        <span className="icon" style={{ color }}>
          ◆
        </span>
        <span className="title">const</span>
        <span className="ty" style={{ color }}>
          {label}
        </span>
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
        {isEnumSlot ? (
          <>
            <select
              className="nodrag"
              value={type.kind === "custom" ? type.name : ""}
              onChange={(e) =>
                setConstantType(id, { kind: "custom", name: e.target.value })
              }
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {!isEnum && <option value="">(pick enum type)</option>}
              {availableEnums.map((en) => (
                <option key={en.name} value={en.name}>
                  {en.name}
                  {en.sourceModule ? ` · ${en.sourceModule}` : ""}
                </option>
              ))}
            </select>
            {isEnum && (
              <select
                className="nodrag"
                value={
                  typeof instance.constantValue === "string"
                    ? instance.constantValue
                    : ""
                }
                onChange={(e) => setConstantValue(id, e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {(enumDef?.variants ?? []).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            )}
          </>
        ) : type.kind === "bool" ? (
          <label className="bool">
            <input
              type="checkbox"
              className="nodrag"
              checked={!!instance.constantValue}
              onChange={(e) => setConstantValue(id, e.target.checked)}
              onClick={(e) => e.stopPropagation()}
            />
            <span>{instance.constantValue ? "true" : "false"}</span>
          </label>
        ) : type.kind === "int" || type.kind === "float" ? (
          <input
            type="number"
            className="nodrag"
            step={type.kind === "float" ? "any" : "1"}
            value={numberValue}
            onChange={handleTextOrNumber}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          />
        ) : (
          <input
            type="text"
            className="nodrag"
            value={textValue}
            onChange={handleTextOrNumber}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            placeholder="(empty)"
          />
        )}
        <div className="port">
          <span className="label">value</span>
          <Handle
            type="source"
            position={Position.Right}
            id="value"
            style={{
              background: color,
              borderColor: color,
              width: 14,
              height: 14,
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default memo(ConstantNode);
