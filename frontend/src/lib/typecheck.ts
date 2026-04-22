import type { WorkflowType } from "./types";

export function typesEqual(a: WorkflowType, b: WorkflowType): boolean {
  if (a.kind === "any" || b.kind === "any") return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "int":
    case "float":
    case "string":
    case "bool":
      return true;
    case "array":
      return typesEqual(a.of, (b as { of: WorkflowType }).of);
    case "dict":
      return typesEqual(a.value, (b as { value: WorkflowType }).value);
    case "custom":
      return a.name === (b as { name: string }).name;
  }
}

export function canConnect(
  source: WorkflowType,
  target: WorkflowType,
): { ok: true } | { ok: false; reason: string } {
  if (source.kind === "any" || target.kind === "any") return { ok: true };
  if (typesEqual(source, target)) return { ok: true };
  if (source.kind === "int" && target.kind === "float") return { ok: true };
  return {
    ok: false,
    reason: `type mismatch: ${describe(source)} → ${describe(target)}`,
  };
}

function describe(t: WorkflowType): string {
  switch (t.kind) {
    case "array": return `array<${describe(t.of)}>`;
    case "dict": return `dict<${describe(t.value)}>`;
    case "custom": return t.name;
    case "any": return "any";
    default: return t.kind;
  }
}
