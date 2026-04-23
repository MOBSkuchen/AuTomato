import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge as FlowEdge,
  type IsValidConnection,
  type OnConnect,
  type NodeChange,
  type EdgeChange,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ModuleNode from "./ModuleNode";
import ConstantNode from "./ConstantNode";
import BranchNode from "./BranchNode";
import LoopNode from "./LoopNode";
import StructNode from "./StructNode";
import { useWorkflow } from "../store";
import { findComponent, findCustomType } from "../registry";
import { canConnect } from "../typecheck";
import {
  isExecPort,
  isPassthroughHandle,
  passthroughSourceInput,
  EXEC_IN,
  EXEC_ERR,
  DATA_ERRVAL,
  DATA_LOOP_ITEM,
  type NodeKind,
  type WorkflowType,
} from "../types";

const nodeTypes = {
  module: ModuleNode,
  constant: ConstantNode,
  branch: BranchNode,
  loop: LoopNode,
  construct: StructNode,
  destruct: StructNode,
};

function nodeType(kind: NodeKind | undefined): string {
  return kind ?? "module";
}

export default function Canvas() {
  const wf = useWorkflow((s) => s.workflow);
  const selectedNodeId = useWorkflow((s) => s.selectedNodeId);
  const setSelected = useWorkflow((s) => s.setSelected);
  const moveNode = useWorkflow((s) => s.moveNode);
  const resizeNode = useWorkflow((s) => s.resizeNode);
  const removeNode = useWorkflow((s) => s.removeNode);
  const addEdge = useWorkflow((s) => s.addEdge);
  const removeEdge = useWorkflow((s) => s.removeEdge);
  const addModuleNode = useWorkflow((s) => s.addModuleNode);
  const addConstant = useWorkflow((s) => s.addConstant);
  const addBranch = useWorkflow((s) => s.addBranch);
  const addLoop = useWorkflow((s) => s.addLoop);
  const addConstruct = useWorkflow((s) => s.addConstruct);
  const addDestruct = useWorkflow((s) => s.addDestruct);

  const { screenToFlowPosition } = useReactFlow();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const invalidTimer = useRef<number | null>(null);

  const flashInvalid = useCallback((msg: string) => {
    setInvalid(msg);
    if (invalidTimer.current) window.clearTimeout(invalidTimer.current);
    invalidTimer.current = window.setTimeout(() => setInvalid(null), 2200);
  }, []);

  useEffect(() => () => {
    if (invalidTimer.current) window.clearTimeout(invalidTimer.current);
  }, []);

  const nodes = useMemo<Node[]>(
    () =>
      wf.nodes.map((n) => {
        const node: Node = {
          id: n.id,
          type: nodeType(n.kind),
          position: n.position,
          data: { instance: n },
          selected: selectedNodeId === n.id,
        };
        if (n.size) {
          node.width = n.size.width;
          node.height = n.size.height;
          node.style = { width: n.size.width, height: n.size.height };
        }
        return node;
      }),
    [wf.nodes, selectedNodeId],
  );

  const edges = useMemo<FlowEdge[]>(
    () =>
      wf.edges.map((e) => {
        const isExec = e.kind === "exec";
        const isErr = e.from.port === EXEC_ERR || e.from.port === DATA_ERRVAL;
        let stroke = "var(--fg-2)";
        let dash: string | undefined;
        if (isExec) {
          stroke = isErr ? "var(--err)" : "var(--accent)";
          dash = undefined;
        } else if (isErr) {
          stroke = "var(--err)";
          dash = "4 3";
        }
        return {
          id: e.id,
          source: e.from.nodeId,
          sourceHandle: e.from.port,
          target: e.to.nodeId,
          targetHandle: e.to.port,
          type: isExec ? "step" : "smoothstep",
          className: isExec ? "exec-edge" : "",
          style: {
            stroke,
            strokeWidth: isExec ? 2.2 : 1.5,
            strokeDasharray: dash,
          },
          data: { kind: e.kind },
        };
      }),
    [wf.edges],
  );

  const resolvePortType = useCallback(
    (
      nodeId: string,
      port: string,
      side: "source" | "target",
    ): WorkflowType | undefined => {
      const node = wf.nodes.find((n) => n.id === nodeId);
      if (!node) return undefined;
      const kind: NodeKind = node.kind ?? "module";

      if (isExecPort(port)) return undefined;

      if (kind === "constant") {
        if (side === "source" && port === "value") return node.constantType;
        return undefined;
      }
      if (kind === "branch") {
        if (side === "target" && port === "condition") return { kind: "bool" };
        return undefined;
      }
      if (kind === "loop") {
        if (side === "target" && port === "iter")
          return { kind: "array", of: { kind: "any" } };
        if (side === "source" && port === DATA_LOOP_ITEM)
          return node.loopItemType ?? { kind: "any" };
        return undefined;
      }
      if (kind === "construct" || kind === "destruct") {
        const tName = node.targetType;
        if (!tName) return undefined;
        const td =
          findCustomType(tName) ??
          wf.customTypes.find((t) => t.name === tName);
        if (!td || td.kind === "enum" || td.sealed) return undefined;
        if ((td.kind ?? "struct") !== "struct") return undefined;
        if (kind === "construct") {
          if (side === "source" && port === "value")
            return { kind: "custom", name: tName };
          if (side === "target") {
            return td.fields.find((f) => f.name === port)?.type;
          }
          return undefined;
        }
        if (side === "target" && port === "value")
          return { kind: "custom", name: tName };
        if (side === "source")
          return td.fields.find((f) => f.name === port)?.type;
        return undefined;
      }

      const comp = findComponent(node.moduleId, node.componentName);
      if (!comp) return undefined;
      if (side === "source") {
        if (port === DATA_ERRVAL) return comp.errorType;
        if (isPassthroughHandle(port)) {
          const ptIn = passthroughSourceInput(port);
          if (!ptIn) return undefined;
          const input = comp.inputs.find(
            (i) => i.name === ptIn && i.consumption === "passthrough",
          );
          return input?.type;
        }
        return comp.outputs.find((o) => o.name === port)?.type;
      }
      return comp.inputs.find((i) => i.name === port)?.type;
    },
    [wf.nodes, wf.customTypes],
  );

  const isValidConnection = useCallback<IsValidConnection>(
    (conn) => {
      if (!conn.source || !conn.target) return false;
      if (conn.source === conn.target) return false;

      const srcHandle = conn.sourceHandle ?? "";
      const tgtHandle = conn.targetHandle ?? "";
      const srcExec = isExecPort(srcHandle);
      const tgtExec = isExecPort(tgtHandle);

      if (srcExec !== tgtExec) {
        flashInvalid(
          srcExec
            ? "exec pin can only connect to another exec pin"
            : "data pin cannot connect to an exec pin",
        );
        return false;
      }

      if (srcExec) {
        if (tgtHandle !== EXEC_IN) {
          flashInvalid("exec targets must be the exec-in pin (top)");
          return false;
        }
        const sourceExecUsed = wf.edges.some(
          (e) =>
            e.kind === "exec" &&
            e.from.nodeId === conn.source &&
            e.from.port === srcHandle,
        );
        if (sourceExecUsed) {
          flashInvalid("exec output already has a connection (fork via Branch)");
          return false;
        }
        return true;
      }

      const srcType = resolvePortType(conn.source, srcHandle, "source");
      const tgtType = resolvePortType(conn.target, tgtHandle, "target");
      if (!srcType || !tgtType) return false;
      const result = canConnect(srcType, tgtType);
      if (!result.ok) {
        flashInvalid(result.reason);
        return false;
      }

      const tgtNode = wf.nodes.find((n) => n.id === conn.target);
      if (tgtNode) {
        const comp = findComponent(tgtNode.moduleId, tgtNode.componentName);
        const input = comp?.inputs.find((i) => i.name === tgtHandle);
        if (input?.consumption === "consumed") {
          const srcForked = wf.edges.some(
            (e) =>
              e.kind === "data" &&
              e.from.nodeId === conn.source &&
              e.from.port === srcHandle,
          );
          if (srcForked) {
            flashInvalid(
              "target input is 'consumed'; source already wired elsewhere",
            );
            return false;
          }
        }
      }
      return true;
    },
    [resolvePortType, flashInvalid, wf.edges, wf.nodes],
  );

  const onConnect = useCallback<OnConnect>(
    (conn) => {
      if (!conn.source || !conn.target) return;
      const srcHandle = conn.sourceHandle ?? "";
      const tgtHandle = conn.targetHandle ?? "";
      const kind = isExecPort(srcHandle) && isExecPort(tgtHandle) ? "exec" : "data";
      addEdge(
        { nodeId: conn.source, port: srcHandle },
        { nodeId: conn.target, port: tgtHandle },
        kind,
      );
    },
    [addEdge],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      for (const c of changes) {
        if (c.type === "position" && c.position && !c.dragging) {
          moveNode(c.id, c.position);
        } else if (c.type === "dimensions" && c.dimensions && c.resizing) {
          resizeNode(c.id, c.dimensions);
        } else if (c.type === "select") {
          if (c.selected) setSelected(c.id);
          else if (selectedNodeId === c.id) setSelected(null);
        } else if (c.type === "remove") {
          removeNode(c.id);
        }
      }
    },
    [moveNode, resizeNode, removeNode, setSelected, selectedNodeId],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const c of changes) {
        if (c.type === "remove") removeEdge(c.id);
      }
    },
    [removeEdge],
  );

  const onEdgeClick = useCallback<EdgeMouseHandler>(
    (_e, edge) => removeEdge(edge.id),
    [removeEdge],
  );

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_e, node) => setSelected(node.id),
    [setSelected],
  );

  const onPaneClick = useCallback(() => setSelected(null), [setSelected]);

  function parseConstantType(name: string): WorkflowType | null {
    switch (name) {
      case "string": return { kind: "string" };
      case "int": return { kind: "int" };
      case "float": return { kind: "float" };
      case "bool": return { kind: "bool" };
      default: return null;
    }
  }

  const onDrop = useCallback(
    (ev: React.DragEvent<HTMLDivElement>) => {
      ev.preventDefault();
      const payload = ev.dataTransfer.getData("application/automato-module");
      if (!payload) return;
      const [moduleId, componentName] = payload.split("::");
      const position = screenToFlowPosition({
        x: ev.clientX,
        y: ev.clientY,
      });

      if (moduleId === "__branch__") {
        setSelected(addBranch(position).id);
        return;
      }
      if (moduleId === "__loop__") {
        setSelected(addLoop(position).id);
        return;
      }
      if (moduleId === "__constant__") {
        const t =
          parseConstantType(componentName) ??
          (componentName
            ? ({ kind: "custom", name: componentName } as WorkflowType)
            : null);
        if (!t) return;
        setSelected(addConstant(t, position).id);
        return;
      }
      if (moduleId === "__construct__") {
        setSelected(addConstruct(componentName || undefined, position).id);
        return;
      }
      if (moduleId === "__destruct__") {
        setSelected(addDestruct(componentName || undefined, position).id);
        return;
      }
      const node = addModuleNode(moduleId, componentName, position);
      if (!node) {
        flashInvalid("Only one Trigger is allowed per workflow");
        return;
      }
      setSelected(node.id);
    },
    [
      screenToFlowPosition,
      addBranch,
      addLoop,
      addConstant,
      addConstruct,
      addDestruct,
      addModuleNode,
      setSelected,
      flashInvalid,
    ],
  );

  const onDragOver = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (target.isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId) {
        removeNode(selectedNodeId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNodeId, removeNode]);

  return (
    <div
      className="canvas-wrap"
      role="region"
      aria-label="Workflow canvas"
      ref={wrapRef}
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        isValidConnection={isValidConnection}
        onConnect={onConnect}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
      >
        <Controls />
        <Background />
        <MiniMap pannable zoomable />
      </ReactFlow>

      {invalid && <div className="invalid-banner">{invalid}</div>}
    </div>
  );
}
