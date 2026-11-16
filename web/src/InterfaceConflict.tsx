// SPDX-License-Identifier: MIT
import { mergeInterfaceEdits } from "../../src/studio/interface-merge";
import { useState } from "react";
import type {
  InterfaceDraft,
  SignatureDescription,
  SignatureEdit,
} from "../../src/studio/interface-data";
import { describeDraftType } from "../../src/studio/interface-description";
function signature(value: SignatureEdit | undefined) {
  if (!value) return "No saved contract baseline is available.";
  const type = describeDraftType;
  return `${value.name}(${value.inputs.map((p) => `${p.mode && p.mode !== "value" ? p.mode + " " : ""}${p.name}: ${type(p.type)}`).join(", ")}) -> ${type(value.output)}\n${value.effects.map((e) => `${e.kind}.${e.target}`).join(", ")}`;
}
function fieldText(key: string, value: unknown): string {
  if (value === undefined) return "Removed";
  if (
    key.startsWith("input:") &&
    value &&
    typeof value === "object" &&
    "name" in value &&
    "type" in value
  ) {
    const input = value as SignatureEdit["inputs"][number];
    return `${input.mode && input.mode !== "value" ? input.mode + " " : ""}${input.name}: ${describeDraftType(input.type)}`;
  }
  if (key === "input-order" && Array.isArray(value)) return value.join(" → ");
  if (key === "output")
    return describeDraftType(value as SignatureEdit["output"]);
  if (key === "effects" && Array.isArray(value))
    return value.map((e) => `${e.kind}.${e.target}`).join(", ") || "No effects";
  if (typeof value === "string") return value;
  return "Saved shared-type changes (review the definitions below)";
}
export function InterfaceConflict({
  value,
  onClose,
  onChoose,
  onContinue,
}: {
  value: {
    draft: InterfaceDraft;
    description: SignatureDescription | null;
    conflicts: string[];
    candidates: { symbolId: string; name: string }[];
  };
  onClose: () => void;
  onChoose: (symbolId: string) => Promise<void>;
  onContinue: (edit: SignatureEdit) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<string, "saved" | "current">>(
    {},
  );
  const merge = value.description
    ? mergeInterfaceEdits(
        value.draft.baseline?.signature,
        value.draft.edit,
        value.description,
        choices,
      )
    : null;
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Review changed interface"
      >
        <h2>The interface changed while this form was saved</h2>
        {value.conflicts.map((message) => (
          <p key={message}>{message}</p>
        ))}
        <section aria-label="Saved contract">
          <h3>When this form started</h3>
          <pre>{signature(value.draft.baseline?.signature)}</pre>
        </section>
        <section aria-label="Saved form changes">
          <h3>Your saved changes</h3>
          <pre>{signature(value.draft.edit)}</pre>
        </section>
        {!value.description && (
          <label>
            Choose the current component
            <select
              aria-label="Current component"
              disabled={busy}
              value=""
              onChange={(event) => {
                setChoices({});
                setBusy(true);
                void onChoose(event.target.value).finally(() => setBusy(false));
              }}
            >
              <option value="">Select a component to compare</option>
              {value.candidates.map((c) => (
                <option key={c.symbolId} value={c.symbolId}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <section aria-label="Current contract">
          <h3>Current checked contract</h3>
          <pre>
            {value.description
              ? signature(value.description)
              : "Choose a component above. Missing or unresolved interfaces cannot be applied."}
          </pre>
        </section>
        {!!value.draft.edit.typeEdits?.length && (
          <details>
            <summary>
              Saved shared-type edits ({value.draft.edit.typeEdits.length})
            </summary>
            <pre>{JSON.stringify(value.draft.edit.typeEdits, null, 2)}</pre>
            <p>
              Review these against current types in the editor before applying.
            </p>
          </details>
        )}
        {merge?.conflicts.map((field) => (
          <fieldset key={field.key}>
            <legend>{field.label} changed in both versions</legend>
            <label>
              <input
                type="radio"
                name={field.key}
                checked={choices[field.key] === "current"}
                onChange={() =>
                  setChoices((old) => ({ ...old, [field.key]: "current" }))
                }
              />{" "}
              Keep current: <code>{fieldText(field.key, field.current)}</code>
            </label>
            <label>
              <input
                type="radio"
                name={field.key}
                checked={choices[field.key] === "saved"}
                onChange={() =>
                  setChoices((old) => ({ ...old, [field.key]: "saved" }))
                }
              />{" "}
              Use saved: <code>{fieldText(field.key, field.saved)}</code>
            </label>
          </fieldset>
        ))}
        <p>
          Changes made only in the current version are preserved; your
          independent edits are kept. Choose each conflicting field before
          continuing. Nothing is saved or rewritten here.
        </p>
        {merge && (
          <section aria-label="Combined interface">
            <h3>Combined interface</h3>
            <pre>{signature(merge.edit)}</pre>
          </section>
        )}
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>
            Keep saved form and close
          </button>
          <button
            className="button primary"
            disabled={!merge || !!merge.unresolved.length || busy}
            onClick={() => {
              if (merge && !merge.unresolved.length) onContinue(merge.edit);
            }}
          >
            Continue reviewing saved changes
          </button>
        </div>
      </section>
    </div>
  );
}
