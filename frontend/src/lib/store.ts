import { create } from "zustand";
import type {
  CustomTypeDef,
  Edge,
  EdgeKind,
  ModuleSnapshot,
  ModuleSource,
  NodeInstance,
  NodeKind,
  Workflow,
  WorkflowType,
} from "./types";
import {
  defaultConstantValue,
  EXEC_ERR,
  isExecPort,
  isPassthroughHandle,
  passthroughSourceInput,
} from "./types";
import {
  findComponent,
  findCustomType,
  installFromSource,
  setRegistryFallback,
  useRegistryStore,
} from "./registry";

const STORAGE_KEY = "automato.workflow.v2";

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyWorkflow(): Workflow {
  return {
    id: newId("wf"),
    name: "Untitled Workflow",
    version: "0.1.0",
    customTypes: [],
    nodes: [],
    edges: [],
    usedModules: [],
  };
}

function isWorkflowShape(x: unknown): x is Workflow {
  if (!x || typeof x !== "object") return false;
  const w = x as Partial<Workflow>;
  return (
    typeof w.id === "string" &&
    typeof w.name === "string" &&
    Array.isArray(w.nodes) &&
    Array.isArray(w.edges) &&
    Array.isArray(w.customTypes)
  );
}

function normalizeWorkflow(wf: Workflow): Workflow {
  if (Array.isArray(wf.usedModules)) return wf;
  return { ...wf, usedModules: [] };
}

function loadFromStorage(): Workflow {
  if (typeof localStorage === "undefined") return emptyWorkflow();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return emptyWorkflow();
  try {
    const parsed = JSON.parse(raw);
    if (!isWorkflowShape(parsed)) return emptyWorkflow();
    return normalizeWorkflow(parsed);
  } catch {
    return emptyWorkflow();
  }
}

const CACHE_ID_PREFIX = "cache_";

function decodeBase64Url(s: string): string | null {
  try {
    const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
    const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    return atob(b64);
  } catch {
    return null;
  }
}

function decodeCacheSource(id: string): ModuleSource | undefined {
  if (!id.startsWith(CACHE_ID_PREFIX)) return undefined;
  const decoded = decodeBase64Url(id.slice(CACHE_ID_PREFIX.length));
  if (!decoded) return undefined;
  const idx = decoded.indexOf("|");
  if (idx < 0) return undefined;
  const kind = decoded.slice(0, idx);
  const rest = decoded.slice(idx + 1);
  const idx2 = rest.lastIndexOf("|");
  if (idx2 < 0) return undefined;
  const url = rest.slice(0, idx2);
  const version = rest.slice(idx2 + 1);
  if (kind !== "git" && kind !== "http-tar") return undefined;
  if (!url || !version) return undefined;
  return { kind, url, version };
}

function snapshotModuleIfNew(wf: Workflow, moduleId: string): Workflow {
  if (!moduleId || moduleId.startsWith("__")) return wf;
  if (wf.usedModules.some((m) => m.id === moduleId)) return wf;
  const live = useRegistryStore
    .getState()
    .modules.find((m) => m.id === moduleId);
  if (!live) return wf;
  const source = decodeCacheSource(moduleId);
  const snap: ModuleSnapshot = source ? { ...live, source } : { ...live };
  return { ...wf, usedModules: [...wf.usedModules, snap] };
}

function snapshotForCustomType(wf: Workflow, typeName: string | undefined): Workflow {
  if (!typeName) return wf;
  const t = findCustomType(typeName);
  if (!t?.sourceModule) return wf;
  return snapshotModuleIfNew(wf, t.sourceModule);
}

function rehydrateUsedModules(wf: Workflow): void {
  const liveIds = new Set(
    useRegistryStore.getState().modules.map((m) => m.id),
  );
  for (const m of wf.usedModules) {
    if (!m.source) continue;
    if (liveIds.has(m.id)) continue;
    void installFromSource(m.source).catch((err) => {
      console.warn(
        `re-install failed for ${m.id} (${m.source?.kind}@${m.source?.url}): ${err}`,
      );
    });
  }
}

export function rehydrateCurrentWorkflowModules(): void {
  rehydrateUsedModules(useWorkflow.getState().workflow);
}

setRegistryFallback({
  findModule: (id) =>
    useWorkflow.getState().workflow.usedModules.find((m) => m.id === id),
  customTypes: () =>
    useWorkflow.getState().workflow.usedModules.flatMap((m) => m.exportedTypes),
});

function persist(wf: Workflow) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wf));
  } catch {
    /* quota or private mode */
  }
}

export interface WorkflowState {
  workflow: Workflow;
  selectedNodeId: string | null;
  setSelected: (id: string | null) => void;
  addModuleNode: (
    moduleId: string,
    componentName: string,
    position: { x: number; y: number },
  ) => NodeInstance | null;
  addConstant: (
    type: WorkflowType,
    position: { x: number; y: number },
  ) => NodeInstance;
  addBranch: (position: { x: number; y: number }) => NodeInstance;
  addLoop: (position: { x: number; y: number }) => NodeInstance;
  addConstruct: (
    typeName: string | undefined,
    position: { x: number; y: number },
  ) => NodeInstance;
  addDestruct: (
    typeName: string | undefined,
    position: { x: number; y: number },
  ) => NodeInstance;
  setTargetType: (nodeId: string, typeName: string) => void;
  setTweakValue: (nodeId: string, name: string, value: unknown) => void;
  removeNode: (id: string) => void;
  moveNode: (id: string, position: { x: number; y: number }) => void;
  resizeNode: (
    id: string,
    size: { width: number; height: number },
  ) => void;
  setLiteralInput: (nodeId: string, port: string, value: unknown) => void;
  setConstantValue: (nodeId: string, value: string | number | boolean) => void;
  setConstantType: (nodeId: string, type: WorkflowType) => void;
  setRetryPolicy: (
    nodeId: string,
    policy: { maxAttempts: number; backoffMs: number } | undefined,
  ) => void;
  addEdge: (
    from: { nodeId: string; port: string },
    to: { nodeId: string; port: string },
    kind: EdgeKind,
  ) => Edge | null;
  removeEdge: (id: string) => void;
  addCustomType: (def: CustomTypeDef) => void;
  removeCustomType: (name: string) => void;
  updateCustomType: (name: string, next: CustomTypeDef) => void;
  setName: (name: string) => void;
  reset: () => void;
  loadWorkflow: (wf: unknown) => { ok: true } | { ok: false; error: string };
}

function mutate(
  set: (fn: (s: WorkflowState) => Partial<WorkflowState>) => void,
  updater: (wf: Workflow) => Workflow,
) {
  set((s) => {
    const next = updater(s.workflow);
    persist(next);
    return { workflow: next };
  });
}

export const useWorkflow = create<WorkflowState>((set, get) => ({
  workflow: loadFromStorage(),
  selectedNodeId: null,

  setSelected: (id) => set({ selectedNodeId: id }),

  addModuleNode: (moduleId, componentName, position) => {
    const comp = findComponent(moduleId, componentName);
    if (!comp) return null;
    if (comp.category === "trigger") {
      const existing = get().workflow.nodes.find((n) => {
        if (n.kind && n.kind !== "module") return false;
        const c = findComponent(n.moduleId, n.componentName);
        return c?.category === "trigger";
      });
      if (existing) return null;
    }
    const node: NodeInstance = {
      id: newId("n"),
      moduleId,
      componentName,
      kind: "module",
      position,
      literalInputs: {},
    };
    mutate(set, (wf) => {
      const withNode = { ...wf, nodes: [...wf.nodes, node] };
      return snapshotModuleIfNew(withNode, moduleId);
    });
    return node;
  },

  addConstant: (type, position) => {
    let initial: string | number | boolean = defaultConstantValue(type);
    if (type.kind === "custom") {
      const t = findCustomType(type.name) ??
        get().workflow.customTypes.find((ct) => ct.name === type.name);
      if (t?.kind === "enum" && t.variants && t.variants.length > 0) {
        initial = t.variants[0];
      }
    }
    const node: NodeInstance = {
      id: newId("n"),
      moduleId: "__constant__",
      componentName: type.kind === "custom" ? type.name : type.kind,
      kind: "constant",
      constantType: type,
      constantValue: initial,
      position,
      literalInputs: {},
    };
    mutate(set, (wf) => {
      const withNode = { ...wf, nodes: [...wf.nodes, node] };
      if (type.kind === "custom") {
        return snapshotForCustomType(withNode, type.name);
      }
      return withNode;
    });
    return node;
  },

  addBranch: (position) => {
    const node: NodeInstance = {
      id: newId("n"),
      moduleId: "__branch__",
      componentName: "branch",
      kind: "branch",
      position,
      literalInputs: {},
    };
    mutate(set, (wf) => ({ ...wf, nodes: [...wf.nodes, node] }));
    return node;
  },

  addLoop: (position) => {
    const node: NodeInstance = {
      id: newId("n"),
      moduleId: "__loop__",
      componentName: "loop",
      kind: "loop",
      position,
      literalInputs: {},
      loopItemType: { kind: "any" },
    };
    mutate(set, (wf) => ({ ...wf, nodes: [...wf.nodes, node] }));
    return node;
  },

  addConstruct: (typeName, position) => {
    const node: NodeInstance = {
      id: newId("n"),
      moduleId: "__construct__",
      componentName: typeName ?? "",
      kind: "construct",
      targetType: typeName,
      position,
      literalInputs: {},
    };
    mutate(set, (wf) => {
      const withNode = { ...wf, nodes: [...wf.nodes, node] };
      return snapshotForCustomType(withNode, typeName);
    });
    return node;
  },

  addDestruct: (typeName, position) => {
    const node: NodeInstance = {
      id: newId("n"),
      moduleId: "__destruct__",
      componentName: typeName ?? "",
      kind: "destruct",
      targetType: typeName,
      position,
      literalInputs: {},
    };
    mutate(set, (wf) => {
      const withNode = { ...wf, nodes: [...wf.nodes, node] };
      return snapshotForCustomType(withNode, typeName);
    });
    return node;
  },

  setTargetType: (nodeId, typeName) => {
    mutate(set, (wf) => {
      const next = {
        ...wf,
        nodes: wf.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, targetType: typeName, componentName: typeName }
            : n,
        ),
      };
      return snapshotForCustomType(next, typeName);
    });
  },

  setTweakValue: (nodeId, name, value) => {
    mutate(set, (wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const next = { ...(n.tweakValues ?? {}) };
        if (value === undefined) delete next[name];
        else next[name] = value;
        return { ...n, tweakValues: next };
      }),
    }));
  },

  removeNode: (id) => {
    mutate(set, (wf) => ({
      ...wf,
      nodes: wf.nodes.filter((n) => n.id !== id),
      edges: wf.edges.filter(
        (e) => e.from.nodeId !== id && e.to.nodeId !== id,
      ),
    }));
    if (get().selectedNodeId === id) set({ selectedNodeId: null });
  },

  moveNode: (id, position) => {
    mutate(set, (wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
    }));
  },

  resizeNode: (id, size) => {
    mutate(set, (wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => (n.id === id ? { ...n, size } : n)),
    }));
  },

  setLiteralInput: (nodeId, port, value) => {
    mutate(set, (wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const next = { ...n.literalInputs };
        if (value === "" || value === null || value === undefined) {
          delete next[port];
        } else {
          next[port] = value;
        }
        return { ...n, literalInputs: next };
      }),
    }));
  },

  setConstantValue: (nodeId, value) => {
    mutate(set, (wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) =>
        n.id === nodeId ? { ...n, constantValue: value } : n,
      ),
    }));
  },

  setConstantType: (nodeId, type) => {
    mutate(set, (wf) => {
      let initial: string | number | boolean = defaultConstantValue(type);
      if (type.kind === "custom") {
        const t =
          findCustomType(type.name) ??
          wf.customTypes.find((ct) => ct.name === type.name);
        if (t?.kind === "enum" && t.variants && t.variants.length > 0) {
          initial = t.variants[0];
        }
      }
      const componentName =
        type.kind === "custom" ? type.name || "__enum__" : type.kind;
      const next = {
        ...wf,
        nodes: wf.nodes.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                constantType: type,
                constantValue: initial,
                componentName,
              }
            : n,
        ),
      };
      if (type.kind === "custom") {
        return snapshotForCustomType(next, type.name);
      }
      return next;
    });
  },

  setRetryPolicy: (nodeId, policy) => {
    mutate(set, (wf) => ({
      ...wf,
      nodes: wf.nodes.map((n) =>
        n.id === nodeId ? { ...n, retryPolicy: policy } : n,
      ),
    }));
  },

  addEdge: (from, to, kind) => {
    const { workflow } = get();
    if (kind === "exec") {
      if (
        workflow.edges.some(
          (e) =>
            e.kind === "exec" &&
            e.from.nodeId === from.nodeId &&
            e.from.port === from.port,
        )
      ) {
        return null;
      }
    } else {
      const targetInputConsumed = isConsumedTarget(workflow, to);
      if (targetInputConsumed) {
        const alreadyForked = workflow.edges.some(
          (e) =>
            e.kind === "data" &&
            e.from.nodeId === from.nodeId &&
            e.from.port === from.port &&
            !(e.to.nodeId === to.nodeId && e.to.port === to.port),
        );
        if (alreadyForked) return null;
      }
    }
    const edge: Edge = { id: newId("e"), from, to, kind };
    mutate(set, (wf) => {
      const filtered =
        kind === "data"
          ? wf.edges.filter(
              (e) =>
                !(
                  e.kind === "data" &&
                  e.to.nodeId === to.nodeId &&
                  e.to.port === to.port
                ),
            )
          : wf.edges;
      return { ...wf, edges: [...filtered, edge] };
    });
    return edge;
  },

  removeEdge: (id) => {
    mutate(set, (wf) => ({
      ...wf,
      edges: wf.edges.filter((e) => e.id !== id),
    }));
  },

  addCustomType: (def) => {
    mutate(set, (wf) => {
      if (wf.customTypes.some((t) => t.name === def.name)) return wf;
      return { ...wf, customTypes: [...wf.customTypes, def] };
    });
  },

  removeCustomType: (name) => {
    mutate(set, (wf) => ({
      ...wf,
      customTypes: wf.customTypes.filter((t) => t.name !== name),
    }));
  },

  updateCustomType: (name, next) => {
    mutate(set, (wf) => ({
      ...wf,
      customTypes: wf.customTypes.map((t) => (t.name === name ? next : t)),
    }));
  },

  setName: (name) => {
    mutate(set, (wf) => ({ ...wf, name }));
  },

  reset: () => {
    const wf = emptyWorkflow();
    persist(wf);
    set({ workflow: wf, selectedNodeId: null });
  },

  loadWorkflow: (wf) => {
    if (!isWorkflowShape(wf)) {
      return { ok: false, error: "File is not a valid workflow." };
    }
    const normalized = normalizeWorkflow(wf);
    persist(normalized);
    set({ workflow: normalized, selectedNodeId: null });
    rehydrateUsedModules(normalized);
    return { ok: true };
  },
}));

function isConsumedTarget(
  wf: Workflow,
  to: { nodeId: string; port: string },
): boolean {
  if (isExecPort(to.port)) return false;
  const node = wf.nodes.find((n) => n.id === to.nodeId);
  if (!node) return false;
  const kind: NodeKind = node.kind ?? "module";
  if (kind !== "module") return false;
  const comp = findComponent(node.moduleId, node.componentName);
  if (!comp) return false;
  const input = comp.inputs.find((i) => i.name === to.port);
  return input?.consumption === "consumed";
}

export function nodeCategory(node: NodeInstance): string | undefined {
  const kind: NodeKind = node.kind ?? "module";
  if (kind === "constant") return "pure";
  if (kind === "branch" || kind === "loop") return "logic";
  if (kind === "construct" || kind === "destruct") return "pure";
  const comp = findComponent(node.moduleId, node.componentName);
  return comp?.category;
}

export function computeValidation(wf: Workflow): string[] {
  const errs: string[] = [];
  let triggers = 0;
  let returns = 0;
  for (const n of wf.nodes) {
    const cat = nodeCategory(n);
    if (cat === "trigger") triggers += 1;
    else if (cat === "return") returns += 1;
  }
  if (triggers === 0) errs.push("Missing Trigger node (need exactly 1)");
  if (triggers > 1) errs.push(`${triggers} Trigger nodes found (need exactly 1)`);
  if (returns === 0) errs.push("No Return nodes (need at least 1)");
  return errs;
}

export function computeUnwiredErrorBranches(
  wf: Workflow,
): { nodeId: string; component: string }[] {
  const out: { nodeId: string; component: string }[] = [];
  for (const node of wf.nodes) {
    const kind: NodeKind = node.kind ?? "module";
    if (kind !== "module") continue;
    const comp = findComponent(node.moduleId, node.componentName);
    if (!comp || !comp.errorType) continue;
    const wired = wf.edges.some(
      (e) =>
        e.kind === "exec" &&
        e.from.nodeId === node.id &&
        e.from.port === EXEC_ERR,
    );
    if (!wired) out.push({ nodeId: node.id, component: comp.name });
  }
  return out;
}

export function findPassthroughInput(
  nodeId: string,
  handleId: string,
  wf: Workflow,
): { input: string; type?: WorkflowType } | null {
  if (!isPassthroughHandle(handleId)) return null;
  const input = passthroughSourceInput(handleId);
  if (!input) return null;
  const node = wf.nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const comp = findComponent(node.moduleId, node.componentName);
  const portDef = comp?.inputs.find((i) => i.name === input);
  if (!portDef || portDef.consumption !== "passthrough") return null;
  return { input, type: portDef.type };
}
