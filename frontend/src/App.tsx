import { useEffect, useRef, useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import Canvas from "./lib/components/Canvas";
import ConfigPanel from "./lib/components/ConfigPanel";
import Palette from "./lib/components/Palette";
import Toolbar from "./lib/components/Toolbar";
import TypesEditor from "./lib/components/TypesEditor";
import { startRegistrySync, useRegistryStore } from "./lib/registry";
import { rehydrateCurrentWorkflowModules } from "./lib/store";

export default function App() {
  const [typesOpen, setTypesOpen] = useState(false);
  const status = useRegistryStore((s) => s.status);
  const error = useRegistryStore((s) => s.error);
  const reload = useRegistryStore((s) => s.reload);
  const rehydratedRef = useRef(false);

  useEffect(() => {
    startRegistrySync();
  }, []);

  useEffect(() => {
    if (status === "ready" && !rehydratedRef.current) {
      rehydratedRef.current = true;
      rehydrateCurrentWorkflowModules();
    }
  }, [status]);

  if (status === "loading") {
    return (
      <div className="app-loading">
        <div className="spinner" />
        <div>Loading module registry…</div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="app-error">
        <h1>Backend unreachable</h1>
        <p>{error ?? "Failed to load /modules"}</p>
        <p className="muted">
          Start <code>automato-backend</code> on :7878, then retry.
        </p>
        <button className="primary" onClick={() => void reload()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="app">
      <Toolbar onToggleTypes={() => setTypesOpen((v) => !v)} />
      <main>
        <Palette />
        <div className="canvas-area">
          <ReactFlowProvider>
            <Canvas />
          </ReactFlowProvider>
        </div>
        <ConfigPanel />
      </main>
      {typesOpen && <TypesEditor onClose={() => setTypesOpen(false)} />}
    </div>
  );
}
