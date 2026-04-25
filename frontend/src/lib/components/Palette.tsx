import { useMemo, useState } from "react";
import { useRegistryStore } from "../registry";
import { useWorkflow } from "../store";
import { typeColor, typeLabel, type ModuleDef, type WorkflowType } from "../types";
import InstallModal from "./InstallModal";

const ENUM_COLOR = "var(--t-custom)";

function startDrag(
  ev: React.DragEvent,
  moduleId: string,
  componentName: string,
) {
  ev.dataTransfer.effectAllowed = "move";
  ev.dataTransfer.setData(
    "application/automato-module",
    `${moduleId}::${componentName}`,
  );
}

const CONSTANT_KINDS: { kind: "string" | "int" | "float" | "bool" }[] = [
  { kind: "string" },
  { kind: "int" },
  { kind: "float" },
  { kind: "bool" },
];

const CATEGORY_ORDER = ["Triggers", "Returns", "Network", "Transform", "Integrations", "Debug"];

function categorySortKey(name: string): string {
  const idx = CATEGORY_ORDER.indexOf(name);
  return idx < 0 ? `z_${name}` : String(idx).padStart(2, "0");
}

export default function Palette() {
  const [search, setSearch] = useState("");
  const [expandedDocs, setExpandedDocs] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const hasOrigin = useWorkflow((s) => s.workflow.nodes.some((n) => n.kind === "origin"));
  const workflowTypes = useWorkflow((s) => s.workflow.customTypes);
  const modules = useRegistryStore((s) => s.modules);
  const moduleTypes = useRegistryStore((s) => s.customTypes);

  const hasAnyEnum = useMemo(() => {
    for (const t of moduleTypes) if (t.kind === "enum") return true;
    for (const t of workflowTypes) if (t.kind === "enum") return true;
    return false;
  }, [workflowTypes, moduleTypes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return modules;
    return modules.filter((m) => {
      const hay = [
        m.name,
        m.id,
        m.description,
        m.category,
        ...m.effectTags,
        ...m.components.map((c) => c.name),
        ...m.components.map((c) => c.category),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [search, modules]);

  const grouped = useMemo(() => {
    const out = new Map<string, ModuleDef[]>();
    for (const m of filtered) {
      const list = out.get(m.category) ?? [];
      list.push(m);
      out.set(m.category, list);
    }
    return Array.from(out.entries()).sort((a, b) =>
      categorySortKey(a[0]).localeCompare(categorySortKey(b[0])),
    );
  }, [filtered]);

  return (
    <aside className="palette">
      <div className="palette-actions">
        <button
          type="button"
          className="install-btn"
          onClick={() => setInstallOpen(true)}
          title="Fetch a module from a remote source into the cache"
        >
          + Install module
        </button>
      </div>
      <div className="search">
        <input
          type="search"
          placeholder="Search modules…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="scroller">
        <div className="group">
          <h3>Control flow</h3>
          <div className="builtins">
            <div
              className={"builtin logic" + (hasOrigin ? " disabled" : "")}
              draggable={!hasOrigin}
              role="button"
              tabIndex={0}
              onDragStart={(ev) => !hasOrigin && startDrag(ev, "__origin__", "origin")}
              title={hasOrigin ? "Only one Origin allowed per workflow" : "Entry point / main function"}
              style={hasOrigin ? { opacity: 0.4, cursor: "not-allowed" } : undefined}
            >
              <span className="bi-icon" style={{ color: "#a78bfa" }}>⬟</span>
              <div className="bi-body">
                <div className="bi-name">Origin</div>
                <div className="bi-sig">entry · main</div>
              </div>
            </div>
            <div
              className="builtin logic"
              draggable
              role="button"
              tabIndex={0}
              onDragStart={(ev) => startDrag(ev, "__exit__", "exit")}
              title="Terminate the program with an optional exit code"
            >
              <span className="bi-icon" style={{ color: "#e0a94c" }}>⏹</span>
              <div className="bi-body">
                <div className="bi-name">Exit</div>
                <div className="bi-sig">terminates process</div>
              </div>
            </div>
            <div
              className="builtin logic"
              draggable
              role="button"
              tabIndex={0}
              onDragStart={(ev) => startDrag(ev, "__env_const__", "env_const")}
              title="Read an environment variable at runtime"
            >
              <span className="bi-icon" style={{ color: "var(--t-string)" }}>$</span>
              <div className="bi-body">
                <div className="bi-name">Env var</div>
                <div className="bi-sig">key → string</div>
              </div>
            </div>
            <div
              className="builtin logic"
              draggable
              role="button"
              tabIndex={0}
              onDragStart={(ev) => startDrag(ev, "__branch__", "branch")}
            >
              <span className="bi-icon logic-color">⑂</span>
              <div className="bi-body">
                <div className="bi-name">Branch</div>
                <div className="bi-sig">if · 2 exec outs</div>
              </div>
            </div>
            <div
              className="builtin logic"
              draggable
              role="button"
              tabIndex={0}
              onDragStart={(ev) => startDrag(ev, "__loop__", "loop")}
            >
              <span className="bi-icon logic-color">↻</span>
              <div className="bi-body">
                <div className="bi-name">Loop</div>
                <div className="bi-sig">for each · body + done</div>
              </div>
            </div>
            <div
              className="builtin constant"
              draggable
              role="button"
              tabIndex={0}
              onDragStart={(ev) => startDrag(ev, "__construct__", "")}
              title="Drop, then pick a custom struct type in the right panel"
            >
              <span className="bi-icon" style={{ color: "var(--t-custom)" }}>
                ⊞
              </span>
              <div className="bi-body">
                <div className="bi-name">Construct</div>
                <div className="bi-sig">fields → struct</div>
              </div>
            </div>
            <div
              className="builtin constant"
              draggable
              role="button"
              tabIndex={0}
              onDragStart={(ev) => startDrag(ev, "__destruct__", "")}
              title="Drop, then pick a custom struct type in the right panel"
            >
              <span className="bi-icon" style={{ color: "var(--t-custom)" }}>
                ⊟
              </span>
              <div className="bi-body">
                <div className="bi-name">Destruct</div>
                <div className="bi-sig">struct → fields</div>
              </div>
            </div>
            {CONSTANT_KINDS.map(({ kind }) => {
              const t: WorkflowType = { kind } as WorkflowType;
              return (
                <div
                  key={kind}
                  className="builtin constant"
                  draggable
                  role="button"
                  tabIndex={0}
                  onDragStart={(ev) => startDrag(ev, "__constant__", kind)}
                >
                  <span className="bi-icon" style={{ color: typeColor(t) }}>
                    ◆
                  </span>
                  <div className="bi-body">
                    <div className="bi-name">const {kind}</div>
                    <div className="bi-sig" style={{ color: typeColor(t) }}>
                      {typeLabel(t)}
                    </div>
                  </div>
                </div>
              );
            })}
            {hasAnyEnum && (
              <div
                className="builtin constant"
                draggable
                role="button"
                tabIndex={0}
                onDragStart={(ev) => startDrag(ev, "__constant__", "__enum__")}
                title="Drop, then pick an enum type and variant"
              >
                <span className="bi-icon" style={{ color: ENUM_COLOR }}>
                  ◆
                </span>
                <div className="bi-body">
                  <div className="bi-name">const enum</div>
                  <div className="bi-sig" style={{ color: ENUM_COLOR }}>
                    pick type → variant
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {grouped.map(([category, mods]) => (
          <div className="group" key={category}>
            <h3>{category}</h3>
            {mods.map((mod) => (
              <div className="module" key={mod.id}>
                <div className="module-head">
                  <div className="module-name">
                    {mod.name}
                    <span className="module-version">v{mod.version}</span>
                  </div>
                  <button
                    className="doc-btn"
                    type="button"
                    onClick={() =>
                      setExpandedDocs(expandedDocs === mod.id ? null : mod.id)
                    }
                    title="Toggle docs"
                    aria-label={`Toggle documentation for ${mod.name}`}
                  >
                    ?
                  </button>
                </div>
                {expandedDocs === mod.id && (
                  <div className="docs">
                    <p>{mod.description}</p>
                    {mod.docs && <p className="sub">{mod.docs}</p>}
                    {mod.effectTags.length > 0 && (
                      <div className="tags">
                        {mod.effectTags.map((t) => (
                          <span className="tag" key={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {mod.components.map((comp) => (
                  <div
                    className={"component cat-" + comp.category}
                    key={comp.name}
                    draggable
                    role="button"
                    tabIndex={0}
                    onDragStart={(ev) => startDrag(ev, mod.id, comp.name)}
                  >
                    <div className="comp-name">
                      <span className="comp-cat">{comp.category}</span>
                      {comp.name}
                    </div>
                    <div className="comp-signature">
                      <span className="sig-group">
                        {comp.inputs.map((inp, i) => (
                          <span key={inp.name}>
                            <span
                              className="ty"
                              style={{ color: typeColor(inp.type) }}
                            >
                              {typeLabel(inp.type)}
                            </span>
                            {i < comp.inputs.length - 1 && (
                              <span className="sep">,</span>
                            )}
                          </span>
                        ))}
                        {comp.inputs.length === 0 && (
                          <span className="ty void">()</span>
                        )}
                      </span>
                      <span className="arrow">→</span>
                      <span className="sig-group">
                        {comp.outputs.map((out, i) => (
                          <span key={out.name}>
                            <span
                              className="ty"
                              style={{ color: typeColor(out.type) }}
                            >
                              {typeLabel(out.type)}
                            </span>
                            {i < comp.outputs.length - 1 && (
                              <span className="sep">,</span>
                            )}
                          </span>
                        ))}
                        {comp.outputs.length === 0 && (
                          <span className="ty void">void</span>
                        )}
                      </span>
                      {comp.errorType && (
                        <span className="err-label" style={{ color: "var(--err)" }}>
                          ! err
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="empty">No modules match "{search}"</div>
        )}
      </div>

      <footer>
        <div className="hint">Drag a component onto the canvas</div>
      </footer>
      {installOpen && <InstallModal onClose={() => setInstallOpen(false)} />}
    </aside>
  );
}
