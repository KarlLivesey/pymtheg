import { useDraftState } from "./useDraftUpdate";
import { searchInterfaces } from "../../src/studio/interface-search";
import { useState, useEffect, useMemo, useRef } from "react";
import { api } from "./api";
import { InterfaceTypeEditor } from "./InterfaceTypeEditor";
import type { InterfaceType } from "../../src/studio/interface-builder";
import { RecipeFields } from "./RecipeForm";
import {
  defaultRecipeOptions,
  type RecipeOptions,
} from "../../src/studio/recipes";
import {
  readSourceEditPreview,
  readTypeDefinition,
  type TypeDefinitionDescription,
  type SignatureDescription,
  type SignatureEdit,
  type InterfaceBaseline,
  type SourceEditPreview,
} from "../../src/studio/interface-data";
export function InterfaceEditor({
  description,
  projectRoot,
  runId,
  onClose,
  onApply,
  initialEdit,
  initialBaseline,
  onEdit,
}: {
  description: SignatureDescription;
  projectRoot: string;
  runId: string;
  initialEdit?: SignatureEdit | undefined;
  initialBaseline?: InterfaceBaseline | undefined;
  onEdit: (edit: SignatureEdit, types: InterfaceBaseline["types"]) => void;
  onClose: () => void;
  onApply: (preview: SourceEditPreview) => void | Promise<void>;
}) {
  const [options, setOptions, readOptions] = useDraftState<RecipeOptions>({
    ...defaultRecipeOptions,
    name: initialEdit?.name ?? description.name,
    inputs: initialEdit?.inputs ?? description.inputs,
    output: initialEdit?.output ?? description.output,
    effects: initialEdit?.effects ?? description.effects,
  });
  const [typeEdits, setTypeEdits, readTypeEdits] = useDraftState<
    Record<string, InterfaceType>
  >(
    Object.fromEntries(
      (initialEdit?.typeEdits ?? []).map((e) => [e.symbolId, e.definition]),
    ),
  );
  const [preview, setPreview] = useState<SourceEditPreview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const types = useMemo(
    () =>
      description.types.filter(
        (t): t is typeof t & { kind: "record" | "choice" } =>
          t.kind !== "resource",
      ),
    [description.types],
  );
  const [typeQuery, setTypeQuery] = useState("");
  const [typeLimit, setTypeLimit] = useState(20);
  const [openTypes, setOpenTypes] = useState<Set<string>>(new Set());
  const [definitions, setDefinitions] = useState<
    Record<string, TypeDefinitionDescription>
  >({});
  const [typeErrors, setTypeErrors] = useState<Record<string, string>>({});
  function reportEdit(edit: SignatureEdit) {
    const types = (edit.typeEdits ?? []).flatMap((t) => {
      const old = initialBaseline?.types.find((v) => v.symbolId === t.symbolId);
      if (old) return [old];
      const loaded = definitions[t.symbolId];
      return loaded?.definition
        ? [
            {
              symbolId: t.symbolId,
              definition: loaded.definition,
              ...(loaded.declarationHash
                ? { declarationHash: loaded.declarationHash }
                : {}),
            },
          ]
        : [];
    });
    onEdit(edit, types);
  }
  const typeRequests = useRef(new Map<string, AbortController>());
  useEffect(
    () => () => {
      for (const request of typeRequests.current.values()) request.abort();
    },
    [],
  );
  const filteredTypes = useMemo(
    () => searchInterfaces(types, typeQuery, projectRoot),
    [types, typeQuery, projectRoot],
  );
  async function openType(symbolId: string) {
    if (definitions[symbolId] || typeRequests.current.has(symbolId)) return;
    const controller = new AbortController();
    typeRequests.current.set(symbolId, controller);
    setTypeErrors((old) => ({ ...old, [symbolId]: "" }));
    try {
      const loaded = readTypeDefinition(
        await api(
          "interface",
          { action: "type", runId, symbolId },
          controller.signal,
        ),
      );
      if (
        loaded.snapshotId !== description.snapshotId ||
        loaded.symbolId !== symbolId
      )
        throw Error("This type belongs to a different checked snapshot.");
      if (!controller.signal.aborted)
        setDefinitions((old) => ({ ...old, [symbolId]: loaded }));
    } catch (e) {
      if (!controller.signal.aborted)
        setTypeErrors((old) => ({ ...old, [symbolId]: String(e) }));
    } finally {
      typeRequests.current.delete(symbolId);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal recipe-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="interface-title"
      >
        <span className="eyebrow">EDIT THE CHECKED INTERFACE</span>
        <h2 id="interface-title">Inputs and output for {description.name}</h2>
        <p>
          Change this component's contract. Its written body, cancellation path
          and other declarations stay in place. Applying creates an unsaved edit
          and checks its consequences.
        </p>
        <RecipeFields
          id="component"
          options={options}
          projectTypes={description.types}
          allowModes
          onChange={(edit) => {
            const value = edit(readOptions());
            setOptions(value);
            reportEdit({
              name: value.name,
              inputs: value.inputs,
              output: value.output,
              effects: value.effects ?? [],
              typeEdits: Object.entries(readTypeEdits()).map(
                ([symbolId, definition]) => ({ symbolId, definition }),
              ),
            });
            setPreview(null);
          }}
        />
        <details>
          <summary>Shared records and error cases ({types.length})</summary>
          <p>
            Editing a shared definition changes every consumer. Review the
            affected components and files before applying.
          </p>
          {!!Object.keys(typeEdits).length && (
            <p>
              {Object.keys(typeEdits).length} shared type edits will be included
              in the preview, including types outside this search.
            </p>
          )}
          <label className="interface-type-search">
            Find a shared type
            <input
              className="text-input"
              value={typeQuery}
              onChange={(e) => {
                setTypeQuery(e.target.value);
                setTypeLimit(20);
              }}
              placeholder="Type name or file"
            />
          </label>
          <p>
            Showing {Math.min(typeLimit, filteredTypes.length)} of{" "}
            {filteredTypes.length} matching types. Definitions load only when
            opened.
          </p>
          {filteredTypes.slice(0, typeLimit).map((type) => (
            <details
              key={type.symbolId}
              open={openTypes.has(type.symbolId)}
              onToggle={(event) => {
                const open = event.currentTarget.open;
                setOpenTypes((old) => {
                  if (old.has(type.symbolId) === open) return old;
                  const next = new Set(old);
                  if (open) next.add(type.symbolId);
                  else next.delete(type.symbolId);
                  return next;
                });
                if (open) void openType(type.symbolId);
              }}
            >
              <summary>
                {type.name} · {type.kind}
              </summary>
              {openTypes.has(type.symbolId) && (
                <>
                  <p>{type.file}</p>
                  {typeErrors[type.symbolId] ? (
                    <p role="alert">
                      {typeErrors[type.symbolId]}{" "}
                      <button onClick={() => void openType(type.symbolId)}>
                        Retry loading type
                      </button>
                    </p>
                  ) : definitions[type.symbolId]?.definition ? (
                    <InterfaceTypeEditor
                      label={type.name}
                      value={
                        typeEdits[type.symbolId] ??
                        definitions[type.symbolId]!.definition!
                      }
                      knownTypes={types}
                      lockDefinition
                      onChange={(edit) => {
                        const previous = readTypeEdits();
                        const value = edit(
                          previous[type.symbolId] ??
                            definitions[type.symbolId]!.definition!,
                        );
                        const next = { ...previous, [type.symbolId]: value };
                        setTypeEdits(next);
                        reportEdit({
                          name: readOptions().name,
                          inputs: readOptions().inputs,
                          output: readOptions().output,
                          effects: readOptions().effects ?? [],
                          typeEdits: Object.entries(next).map(
                            ([symbolId, definition]) => ({
                              symbolId,
                              definition,
                            }),
                          ),
                        });
                        setPreview(null);
                      }}
                    />
                  ) : (
                    <p>
                      {definitions[type.symbolId]?.unsupported ??
                        "Loading this type…"}
                    </p>
                  )}
                </>
              )}
            </details>
          ))}
          {typeLimit < filteredTypes.length && (
            <button onClick={() => setTypeLimit((n) => n + 20)}>
              Show 20 more types
            </button>
          )}
        </details>
        {error && <p role="alert">{error}</p>}
        {preview && (
          <section aria-label="Interface changes">
            <h3>Review the source changes</h3>
            {preview.notices?.map((notice, i) => (
              <p key={i} className="message notice-message">
                {notice}
              </p>
            ))}
            {!!preview.affected.length && (
              <p>
                Potentially affected:{" "}
                {preview.affected.map((t) => t.name).join(", ")}. These
                components are rechecked after applying.
              </p>
            )}
            {preview.edits.length ? (
              preview.edits.map((edit, i) => (
                <article key={i}>
                  <p>
                    {edit.span.file.startsWith(projectRoot + "/")
                      ? edit.span.file.slice(projectRoot.length + 1)
                      : edit.span.file}
                  </p>
                  <div>Before</div>
                  <pre>{edit.before || "(nothing)"}</pre>
                  <div>After</div>
                  <pre>{edit.text || "(removed)"}</pre>
                </article>
              ))
            ) : (
              <p>No source changes.</p>
            )}
          </section>
        )}
        <div className="modal-actions">
          <button className="button secondary" onClick={onClose}>
            Close and keep form
          </button>
          <button
            className="button secondary"
            aria-disabled={busy || undefined}
            onClick={() => {
              if (busy) return;
              setBusy(true);
              setError("");
              void api("interface", {
                action: "preview",
                runId,
                symbolId: description.symbolId,
                sourceHash: description.sourceHash,
                edit: {
                  name: options.name,
                  inputs: options.inputs,
                  output: options.output,
                  effects: options.effects ?? [],
                  typeEdits: Object.entries(readTypeEdits()).map(
                    ([symbolId, definition]) => ({ symbolId, definition }),
                  ),
                },
              })
                .then((raw) => {
                  const value = readSourceEditPreview(raw);
                  if (
                    value.snapshotId !== description.snapshotId ||
                    value.file !== description.file
                  )
                    throw Error(
                      "This preview belongs to another source snapshot.",
                    );
                  setPreview(value);
                })
                .catch((e) => setError(String(e)))
                .finally(() => setBusy(false));
            }}
          >
            Preview interface changes
          </button>
          <button
            className="button primary"
            disabled={busy || !preview?.edits.length}
            onClick={() => {
              if (!preview) return;
              setBusy(true);
              setError("");
              void Promise.resolve(onApply(preview))
                .catch((e) => setError(String(e)))
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
