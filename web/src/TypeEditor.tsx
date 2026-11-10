import { useDraftState, type DraftEdit } from "./useDraftUpdate";
import { useState } from "react";
import { api } from "./api";
import { InterfaceTypeEditor } from "./InterfaceTypeEditor";
import { describeDraftType } from "../../src/studio/interface-description";
import type { InterfaceType } from "../../src/studio/interface-builder";
import {
  mergeTypeDefinitions,
  type TypeDefinition,
  type TypeDraft,
} from "../../src/studio/type-edit-data";
import {
  readSourceEditPreview,
  type SourceEditPreview,
  type TypeDefinitionDescription,
} from "../../src/studio/interface-data";

function conflictText(value: unknown): string {
  if (value === undefined) return "Removed";
  if (Array.isArray(value)) return value.join(" → ");
  if (value && typeof value === "object" && "name" in value) {
    const member = value as {
      name: string;
      type?: InterfaceType;
      payload?: InterfaceType;
      fields?: { name: string; type: InterfaceType }[];
      variants?: { name: string; payload?: InterfaceType }[];
    };
    const type = (value: InterfaceType): string =>
      describeDraftType(value, { expandDefinitions: true });
    if (member.type) return `${member.name}: ${type(member.type)}`;
    if (member.fields)
      return `${member.name}\n${member.fields.map((field) => `  ${field.name}: ${type(field.type)}`).join("\n")}`;
    if (member.variants)
      return `${member.name}\n${member.variants.map((variant) => `  ${variant.name}${variant.payload ? ` (${type(variant.payload)})` : " (no carried value)"}`).join("\n")}`;
    return `${member.name}${member.payload ? ` (${type(member.payload)})` : " (no carried value)"}`;
  }
  return String(value);
}

export function TypeEditor({
  description,
  file,
  initialDraft,
  knownTypes,
  onDraft,
  onClose,
  onApply,
  runId,
}: {
  description: TypeDefinitionDescription;
  file: string;
  initialDraft: TypeDraft | null;
  knownTypes: { name: string; kind: "record" | "choice"; symbolId: string }[];
  onDraft: (draft: TypeDraft) => void;
  onClose: () => void;
  onApply: (preview: SourceEditPreview) => Promise<void>;
  runId: string;
}) {
  const current = description.definition as TypeDefinition;
  const [choices, setChoices] = useState<Record<string, "saved" | "current">>(
    {},
  );
  const merged = initialDraft
    ? mergeTypeDefinitions(
        initialDraft.baseline,
        initialDraft.definition,
        current,
        choices,
      )
    : { definition: current, conflicts: [], unresolved: [] };
  const [reviewing, setReviewing] = useState(merged.conflicts.length > 0);
  const [definition, setDefinition, readDefinition] = useDraftState(
    merged.definition,
  );
  const [preview, setPreview] = useState<SourceEditPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function change(edit: TypeDefinition | DraftEdit<TypeDefinition>) {
    const next = typeof edit === "function" ? edit(readDefinition()) : edit;
    setDefinition(next);
    setPreview(null);
    setError("");
    onDraft({
      schema: "pymtheg.type-draft/v1",
      file,
      name: description.name,
      baseline: current,
      definition: next,
    });
  }
  async function previewChanges() {
    setBusy(true);
    setError("");
    try {
      const result = readSourceEditPreview(
        await api("interface", {
          action: "preview-type",
          runId,
          symbolId: description.symbolId,
          sourceHash: description.sourceHash,
          edit: definition,
        }),
      );
      if (
        result.snapshotId !== description.snapshotId ||
        result.file !== description.file
      )
        throw Error("This preview belongs to another source snapshot.");
      setPreview(result);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal interface-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${description.name} data shape`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <h2>Edit {description.name}</h2>
          <button className="text-link" onClick={onClose}>
            Close
          </button>
        </div>
        <p>
          Add or remove fields and outcomes, then review the source and affected
          definitions. Applying changes updates your editor; Save writes the
          file.
        </p>
        {initialDraft &&
          JSON.stringify(initialDraft.baseline) !== JSON.stringify(current) &&
          !reviewing && (
            <p className="message notice-message">
              Your saved form has been combined with the current data shape.
              Independent changes are retained; review the preview before
              applying.
            </p>
          )}
        {reviewing ? (
          <section aria-label="Review concurrent data-shape changes">
            <h3>The source and saved form both changed</h3>
            <p>
              Independent changes are kept. Choose which value to keep for each
              conflict.
            </p>
            {merged.conflicts.map((conflict) => (
              <fieldset key={conflict.key}>
                <legend>{conflict.label}</legend>
                <label>
                  <input
                    type="radio"
                    name={conflict.key}
                    checked={choices[conflict.key] === "saved"}
                    onChange={() =>
                      setChoices((old) => ({ ...old, [conflict.key]: "saved" }))
                    }
                  />
                  Keep my saved edit
                  <pre>{conflictText(conflict.saved)}</pre>
                </label>
                <label>
                  <input
                    type="radio"
                    name={conflict.key}
                    checked={choices[conflict.key] === "current"}
                    onChange={() =>
                      setChoices((old) => ({
                        ...old,
                        [conflict.key]: "current",
                      }))
                    }
                  />
                  Keep the current source
                  <pre>{conflictText(conflict.current)}</pre>
                </label>
              </fieldset>
            ))}
            <button
              className="button primary"
              disabled={merged.unresolved.length > 0}
              onClick={() => {
                change(merged.definition);
                setReviewing(false);
              }}
            >
              Continue with these choices
            </button>
          </section>
        ) : (
          <InterfaceTypeEditor
            label="Shape"
            value={definition}
            lockDefinition
            knownTypes={knownTypes}
            onChange={(edit) =>
              change((current) => edit(current) as TypeDefinition)
            }
          />
        )}
        {error && (
          <p role="alert" className="message error-message">
            {error}
          </p>
        )}
        {preview && (
          <section aria-label="Data-shape changes">
            <h3>Review the changes</h3>
            {preview.notices?.map((notice, index) => (
              <p className="message notice-message" key={index}>
                {notice}
              </p>
            ))}
            <p>
              Affected definitions:{" "}
              {preview.affected.length
                ? preview.affected.map((item) => item.name).join(", ")
                : "None found in this checked scope"}
              .
            </p>
            {!preview.affectedComplete && (
              <p className="message notice-message">
                The affected list is incomplete. Recheck the remaining source
                before relying on it.
              </p>
            )}
            {preview.edits.map((edit, index) => (
              <article key={index}>
                <h4>Before</h4>
                <pre>{edit.before}</pre>
                <h4>After</h4>
                <pre>{edit.text}</pre>
              </article>
            ))}
            {!preview.edits.length && <p>No source changes.</p>}
          </section>
        )}
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>
            Close and keep form
          </button>
          <button
            className="button secondary"
            disabled={reviewing}
            aria-disabled={busy || undefined}
            onClick={() => {
              if (!busy) void previewChanges();
            }}
          >
            Preview data-shape changes
          </button>
          <button
            className="button primary"
            disabled={busy || !preview?.edits.length || reviewing}
            onClick={() => {
              if (!preview) return;
              setBusy(true);
              setError("");
              void onApply(preview)
                .catch((error) => setError(String(error)))
                .finally(() => setBusy(false));
            }}
          >
            Apply to editor and check
          </button>
        </div>
      </section>
    </div>
  );
}
