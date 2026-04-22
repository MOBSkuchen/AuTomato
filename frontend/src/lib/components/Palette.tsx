import { useMemo, useState } from "react";
import { MODULES } from "../registry";
import { typeColor, typeLabel, type ModuleDef, type WorkflowType } from "../types";

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return MODULES;
    return MODULES.filter((m) => {
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
  }, [search]);

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
    </aside>
  );
}
