import { useState } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import Canvas from "./lib/components/Canvas";
import ConfigPanel from "./lib/components/ConfigPanel";
import Palette from "./lib/components/Palette";
import Toolbar from "./lib/components/Toolbar";
import TypesEditor from "./lib/components/TypesEditor";

export default function App() {
  const [typesOpen, setTypesOpen] = useState(false);

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
