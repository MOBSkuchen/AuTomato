import { useMemo, useState } from "react";
import { useWorkflow } from "../store";
import { BUILTIN_TYPES, allKnownCustomTypes } from "../registry";
import { typeColor, typeLabel, type CustomTypeDef, type WorkflowType } from "../types";

interface Props {
  onClose: () => void;
}

interface DraftField {
  name: string;
  kind: string;
  custom?: string;
}

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: "int", label: "int" },
  { value: "float", label: "float" },
  { value: "string", label: "string" },
  { value: "bool", label: "bool" },
  { value: "array-string", label: "array<string>" },
  { value: "dict-string", label: "dict<string>" },
  { value: "custom", label: "custom…" },
];

function fieldToType(f: DraftField): WorkflowType {
  if (f.kind === "custom") return { kind: "custom", name: f.custom ?? "" };
  if (f.kind === "array-string")
    return { kind: "array", of: { kind: "string" } };
  if (f.kind === "dict-string")
    return { kind: "dict", value: { kind: "string" } };
  return { kind: f.kind as "int" | "float" | "string" | "bool" };
}

export default function TypesEditor({ onClose }: Props) {
  const workflow = useWorkflow((s) => s.workflow);
  const addCustomType = useWorkflow((s) => s.addCustomType);
  const removeCustomType = useWorkflow((s) => s.removeCustomType);

  const [name, setName] = useState("");
  const [draftKind, setDraftKind] = useState<"struct" | "enum">("struct");
  const [draftFields, setDraftFields] = useState<DraftField[]>([]);
  const [draftVariants, setDraftVariants] = useState<string[]>([]);

  const knownCustom = useMemo(() => {
    const fromWorkflow = workflow.customTypes.map((t) => t.name);
    const fromModules = allKnownCustomTypes().map((t) => t.name);
    return Array.from(new Set([...fromWorkflow, ...fromModules]));
  }, [workflow.customTypes]);

  function addField() {
    setDraftFields((f) => [...f, { name: "", kind: "string" }]);
  }

  function removeField(i: number) {
    setDraftFields((f) => f.filter((_, idx) => idx !== i));
  }

  function updateField(i: number, patch: Partial<DraftField>) {
    setDraftFields((f) =>
      f.map((row, idx) => (idx === i ? { ...row, ...patch } : row)),
    );
  }

  function save() {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (draftKind === "struct") {
      if (draftFields.some((f) => !f.name.trim())) {
        alert("All fields need a name");
        return;
      }
      addCustomType({
        name: trimmed,
        kind: "struct",
        fields: draftFields.map((f) => ({
          name: f.name.trim(),
          type: fieldToType(f),
        })),
      });
    } else {
      const variants = draftVariants
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      if (variants.length === 0) {
        alert("Enums need at least one variant");
        return;
      }
      const def: CustomTypeDef = {
        name: trimmed,
        kind: "enum",
        fields: [],
        variants,
      };
      addCustomType(def);
    }
    setName("");
    setDraftFields([]);
    setDraftVariants([]);
  }

  function handleRemove(n: string) {
    if (confirm(`Remove custom type ${n}?`)) removeCustomType(n);
  }

  return (
    <div
      className="overlay"
      role="button"
      tabIndex={-1}
      aria-label="Close"
      onClick={onClose}
    >
      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-label="Custom types"
        tabIndex={0}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <header>
          <h2>Custom Types</h2>
          <button onClick={onClose}>Close</button>
        </header>

        <section>
          <h3>From modules</h3>
          <div className="type-list">
            {BUILTIN_TYPES.map((t) => (
              <div className="type-card" key={t.name}>
                <div className="type-head">
                  <span className="name" style={{ color: "var(--t-custom)" }}>
                    {t.name}
                    {t.sealed && (
                      <span
                        className="source"
                        style={{ marginLeft: 6, color: "var(--warn)" }}
                      >
                        sealed
                      </span>
                    )}
                    {t.kind === "enum" && (
                      <span
                        className="source"
                        style={{ marginLeft: 6, color: "var(--t-bool)" }}
                      >
                        enum
                      </span>
                    )}
                  </span>
                  <span className="source">{t.sourceModule}</span>
                </div>
                <div className="fields">
                  {t.kind === "enum"
                    ? (t.variants ?? []).map((v) => (
                        <div className="field" key={v}>
                          <span>{v}</span>
                        </div>
                      ))
                    : t.sealed
                      ? (
                          <div className="field">
                            <span style={{ color: "var(--fg-2)" }}>
                              (opaque)
                            </span>
                          </div>
                        )
                      : t.fields.map((f) => (
                          <div className="field" key={f.name}>
                            <span>{f.name}</span>
                            <span style={{ color: typeColor(f.type) }}>
                              {typeLabel(f.type)}
                            </span>
                          </div>
                        ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3>Workflow-local types</h3>
          {workflow.customTypes.length === 0 && (
            <div className="muted">No custom types yet.</div>
          )}
          <div className="type-list">
            {workflow.customTypes.map((t) => (
              <div className="type-card" key={t.name}>
                <div className="type-head">
                  <span className="name" style={{ color: "var(--t-custom)" }}>
                    {t.name}
                    {t.kind === "enum" && (
                      <span
                        className="source"
                        style={{ marginLeft: 6, color: "var(--t-bool)" }}
                      >
                        enum
                      </span>
                    )}
                  </span>
                  <button className="small" onClick={() => handleRemove(t.name)}>
                    remove
                  </button>
                </div>
                <div className="fields">
                  {t.kind === "enum"
                    ? (t.variants ?? []).map((v) => (
                        <div className="field" key={v}>
                          <span>{v}</span>
                        </div>
                      ))
                    : t.fields.map((f) => (
                        <div className="field" key={f.name}>
                          <span>{f.name}</span>
                          <span style={{ color: typeColor(f.type) }}>
                            {typeLabel(f.type)}
                          </span>
                        </div>
                      ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3>New type</h3>
          <div className="new-row">
            <input
              type="text"
              placeholder="TypeName"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select
              value={draftKind}
              onChange={(e) =>
                setDraftKind(e.target.value as "struct" | "enum")
              }
            >
              <option value="struct">struct</option>
              <option value="enum">enum</option>
            </select>
            {draftKind === "struct" ? (
              <button onClick={addField}>+ field</button>
            ) : (
              <button onClick={() => setDraftVariants((v) => [...v, ""])}>
                + variant
              </button>
            )}
            <button className="primary" onClick={save} disabled={!name.trim()}>
              Add type
            </button>
          </div>
          {draftKind === "enum" && (
            <div className="draft-fields">
              {draftVariants.map((v, i) => (
                <div className="draft-field" key={i}>
                  <input
                    type="text"
                    placeholder="VARIANT"
                    value={v}
                    onChange={(e) =>
                      setDraftVariants((arr) =>
                        arr.map((x, idx) => (idx === i ? e.target.value : x)),
                      )
                    }
                  />
                  <button
                    className="small"
                    onClick={() =>
                      setDraftVariants((arr) =>
                        arr.filter((_, idx) => idx !== i),
                      )
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {draftKind === "struct" && (
          <div className="draft-fields">
            {draftFields.map((field, i) => (
              <div className="draft-field" key={i}>
                <input
                  type="text"
                  placeholder="field name"
                  value={field.name}
                  onChange={(e) => updateField(i, { name: e.target.value })}
                />
                <select
                  value={field.kind}
                  onChange={(e) => updateField(i, { kind: e.target.value })}
                >
                  {KIND_OPTIONS.map((opt) => (
                    <option value={opt.value} key={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {field.kind === "custom" && (
                  <select
                    value={field.custom ?? ""}
                    onChange={(e) =>
                      updateField(i, { custom: e.target.value })
                    }
                  >
                    <option value="">—</option>
                    {knownCustom.map((cn) => (
                      <option value={cn} key={cn}>
                        {cn}
                      </option>
                    ))}
                  </select>
                )}
                <button className="small" onClick={() => removeField(i)}>
                  ×
                </button>
              </div>
            ))}
          </div>
          )}
        </section>
      </div>
    </div>
  );
}
