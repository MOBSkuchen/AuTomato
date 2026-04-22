import { findModule, findComponent } from "./registry";
import { nodeCategory } from "./store";
import type { Workflow } from "./types";

export function exportAst(workflow: Workflow): unknown {
  return {
    id: workflow.id,
    name: workflow.name,
    version: workflow.version,
    custom_types: workflow.customTypes.map((t) => ({
      name: t.name,
      fields: t.fields.map((f) => ({ name: f.name, type: f.type })),
      source_module: t.sourceModule ?? null,
    })),
    nodes: workflow.nodes.map((n) => {
      const mod = findModule(n.moduleId);
      const comp = findComponent(n.moduleId, n.componentName);
      return {
        id: n.id,
        kind: n.kind ?? "module",
        category: nodeCategory(n) ?? null,
        module_id: n.moduleId,
        component: n.componentName,
        module_version: mod?.version ?? "0.0.0",
        module_url: mod?.sourceUrl ?? null,
        literal_inputs: n.literalInputs,
        parallel_group: n.parallelGroup ?? null,
        retry_policy: n.retryPolicy ?? null,
        constant_type: n.constantType ?? null,
        constant_value: n.constantValue ?? null,
        has_error: !!comp?.errorType,
      };
    }),
    edges: workflow.edges.map((e) => ({
      id: e.id,
      from_node: e.from.nodeId,
      from_port: e.from.port,
      to_node: e.to.nodeId,
      to_port: e.to.port,
      kind: e.kind,
    })),
    entry:
      workflow.nodes.find((n) => nodeCategory(n) === "trigger")?.id ?? null,
  };
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
