export type PrimitiveKind = "int" | "float" | "string" | "bool";

export type WorkflowType =
  | { kind: "int" }
  | { kind: "float" }
  | { kind: "string" }
  | { kind: "bool" }
  | { kind: "array"; of: WorkflowType }
  | { kind: "dict"; value: WorkflowType }
  | { kind: "custom"; name: string }
  | { kind: "any" };

export type NodeKind = "module" | "constant" | "branch" | "loop";

export type NodeCategory = "trigger" | "action" | "pure" | "logic" | "return";

export type InputConsumption = "consumed" | "passthrough";

export interface PortDef {
  name: string;
  type: WorkflowType;
  description?: string;
  consumption?: InputConsumption;
}

export interface ComponentDef {
  name: string;
  description: string;
  category: NodeCategory;
  inputs: PortDef[];
  outputs: PortDef[];
  errorType?: WorkflowType;
}

export type EffectTag =
  | "pure"
  | "idempotent"
  | "reads_external_state"
  | "writes_external_state"
  | "expensive"
  | "retry";

export interface ModuleDef {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  category: string;
  effectTags: EffectTag[];
  exportedTypes: CustomTypeDef[];
  components: ComponentDef[];
  docs: string;
  sourceUrl?: string;
}

export interface CustomTypeField {
  name: string;
  type: WorkflowType;
}

export interface CustomTypeDef {
  name: string;
  fields: CustomTypeField[];
  sourceModule?: string;
}

export interface NodeInstance {
  id: string;
  moduleId: string;
  componentName: string;
  kind?: NodeKind;
  constantType?: WorkflowType;
  constantValue?: string | number | boolean;
  branchCondition?: never;
  loopItemType?: WorkflowType;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  literalInputs: Record<string, unknown>;
  parallelGroup?: string;
  retryPolicy?: { maxAttempts: number; backoffMs: number };
}

export type EdgeKind = "data" | "exec";

export interface Edge {
  id: string;
  from: { nodeId: string; port: string };
  to: { nodeId: string; port: string };
  kind: EdgeKind;
}

export interface Workflow {
  id: string;
  name: string;
  version: string;
  customTypes: CustomTypeDef[];
  nodes: NodeInstance[];
  edges: Edge[];
}

export const EXEC_IN = "__in__";
export const EXEC_OUT = "__out__";
export const EXEC_ERR = "__err__";
export const EXEC_TRUE = "__true__";
export const EXEC_FALSE = "__false__";
export const EXEC_BODY = "__body__";
export const EXEC_DONE = "__done__";
export const DATA_ERRVAL = "__errval__";
export const DATA_LOOP_ITEM = "item";

const EXEC_PORTS = new Set<string>([
  EXEC_IN,
  EXEC_OUT,
  EXEC_ERR,
  EXEC_TRUE,
  EXEC_FALSE,
  EXEC_BODY,
  EXEC_DONE,
]);

export function isExecPort(portId: string): boolean {
  return EXEC_PORTS.has(portId);
}

export function passthroughHandleId(inputName: string): string {
  return `${inputName}__pt`;
}

export function isPassthroughHandle(portId: string): boolean {
  return portId.endsWith("__pt");
}

export function passthroughSourceInput(portId: string): string | null {
  return portId.endsWith("__pt") ? portId.slice(0, -"__pt".length) : null;
}

export function typeLabel(t: WorkflowType): string {
  switch (t.kind) {
    case "int":
    case "float":
    case "string":
    case "bool":
    case "any":
      return t.kind;
    case "array":
      return `array<${typeLabel(t.of)}>`;
    case "dict":
      return `dict<${typeLabel(t.value)}>`;
    case "custom":
      return t.name;
  }
}

export function typeColor(t: WorkflowType): string {
  switch (t.kind) {
    case "int": return "var(--t-int)";
    case "float": return "var(--t-float)";
    case "string": return "var(--t-string)";
    case "bool": return "var(--t-bool)";
    case "array": return "var(--t-array)";
    case "dict": return "var(--t-dict)";
    case "custom": return "var(--t-custom)";
    case "any": return "var(--fg-2)";
  }
}

export function defaultConstantValue(t: WorkflowType): string | number | boolean {
  switch (t.kind) {
    case "int": return 0;
    case "float": return 0.0;
    case "bool": return false;
    default: return "";
  }
}
