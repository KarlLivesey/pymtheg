import { useDraftState, type DraftEdit } from "./useDraftUpdate";
import { ProjectTypeContext } from "./ProjectTypeSearch";
import { declarationTypeReferences } from "../../src/studio/declaration-references";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { api } from "./api";
import { RecipeFields } from "./RecipeForm";
import { InterfaceTypeEditor } from "./InterfaceTypeEditor";
import { MachineDefinitionEditor } from "./MachineDefinitionEditor";
import { OperationRulesEditor } from "./OperationRulesEditor";
import {
  mergeResourceDefinitions,
  resourceChanges,
} from "../../src/studio/resource-merge";
import { defaultRecipeOptions } from "../../src/studio/recipes";
import {
  initialDeclaration,
  declarationKinds,
  declarationInfo,
  declarationDraftSchema,
  resourceDescriptionSchema,
  type ResourceDescription,
  type NewDeclaration,
  type DeclarationDraft,
} from "../../src/studio/declaration-data";
import {
  readSourceEditPreview,
  type SourceEditPreview,
} from "../../src/studio/interface-data";

const contextSchema = z.object({
  file: z.string(),
  sourceHash: z.string(),
  snapshotId: z.string(),
  canCreate: z.boolean(),
  notice: z.string().nullable(),
  types: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["record", "choice", "resource"]),
      symbolId: z.string(),
      file: z.string(),
    }),
  ),
});
export function DeclarationEditor({
  file,
  resourceName,
  runId,
  initialDraft,
  onDraft,
  onClose,
  onRefresh,
  onApply,
  recoverySaved,
  loadError,
}: {
  file: string;
  resourceName?: string | undefined;
  runId: string | undefined;
  initialDraft: DeclarationDraft | null;
  onDraft: (draft: DeclarationDraft) => void;
  onClose: () => void;
  onRefresh: () => void;
  onApply: (preview: SourceEditPreview) => Promise<void>;
  recoverySaved: boolean;
  loadError?: string | undefined;
}) {
  const resumed = useRef(!!initialDraft);
  const [declaration, setDeclaration, readDeclaration] =
    useDraftState<NewDeclaration | null>(initialDraft?.declaration ?? null);
  const [importedTypes, setImportedTypes] = useState(
    initialDraft?.typeSelections ?? [],
  );
  const importedTypesRef = useRef(importedTypes);
  const [resourceEdit, setResourceEdit] = useState(initialDraft?.resourceEdit);
  const [resourceConflict, setResourceConflict] =
    useState<ResourceDescription | null>(null);
  const editingResource = !!(resourceName || initialDraft?.resourceEdit);
  const [context, setContext] = useState<z.infer<typeof contextSchema> | null>(
    null,
  );
  const [preview, setPreview] = useState<SourceEditPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generation = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setContext(null);
    setPreview(null);
    setError("");
    setBusy(false);
    if (!runId) return;
    const abort = new AbortController();
    void api(
      "declaration",
      editingResource
        ? {
            action: "resource-context",
            runId,
            file,
            name: resourceName ?? resourceEdit?.name,
          }
        : { action: "context", runId, file },
      abort.signal,
    )
      .then((raw) => {
        if (abort.signal.aborted) return;
        if (!editingResource) {
          setContext(contextSchema.parse(raw));
          return;
        }
        const current = resourceDescriptionSchema.parse(raw);
        if (!current.definition)
          throw Error(
            current.unsupported ?? "This lifecycle needs Text editing.",
          );
        setContext({
          file: current.file,
          sourceHash: current.sourceHash,
          snapshotId: current.snapshotId,
          types: [],
          canCreate: true,
          notice: null,
        });
        if (!resourceEdit) {
          setDeclaration(current.definition);
          setResourceEdit({
            name: current.name,
            baseline: current.definition,
            declarationHash: current.declarationHash,
          });
        } else {
          setResourceConflict(
            JSON.stringify(resourceEdit.baseline) ===
              JSON.stringify(current.definition)
              ? null
              : current,
          );
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(String(error));
      });
    return () => abort.abort();
  }, [runId, file, resourceName]);
  function change(
    value: NewDeclaration | DraftEdit<NewDeclaration>,
    edit = resourceEdit,
  ) {
    const current = readDeclaration();
    if (typeof value === "function" && !current) return;
    const next = typeof value === "function" ? value(current!) : value;
    try {
      const refs = declarationTypeReferences(next);
      const draft = declarationDraftSchema.parse({
        file,
        declaration: next,
        typeSelections: importedTypesRef.current.filter((item) =>
          refs.has(item.symbolId),
        ),
        ...(edit ? { resourceEdit: edit } : {}),
      });
      onDraft(draft);
      generation.current++;
      setDeclaration(draft.declaration);
      setPreview(null);
      setError("");
    } catch {
      setError(
        "This change exceeds the declaration form's limits. Keep names within 120 characters; event models allow 20 states, events, safety rules or changes per event. Operations allow 20 caller rules and 20 return rules. Expressions can have up to 1,000 characters. Other forms allow 20 inputs or fields and five nested type levels. The previous form is kept.",
      );
    }
  }
  async function previewChanges() {
    if (!context || !declaration || !runId || resourceConflict) return;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const next = readSourceEditPreview(
        await api(
          editingResource ? "interface" : "declaration",
          editingResource
            ? {
                action: "preview-resource",
                runId,
                symbolId: context.file + "#" + resourceEdit!.name,
                sourceHash: context.sourceHash,
                edit: declaration,
              }
            : {
                action: "preview",
                runId,
                file,
                sourceHash: context.sourceHash,
                declaration,
                typeSelections: importedTypesRef.current.filter((item) =>
                  declarationTypeReferences(declaration).has(item.symbolId),
                ),
              },
        ),
      );
      if (mounted.current && generation.current === request) {
        if (
          (next.baseSnapshotId ?? next.snapshotId) !== context.snapshotId ||
          next.file !== context.file
        )
          throw Error("The preview belongs to another source snapshot.");
        setPreview(next);
      }
    } catch (error) {
      if (mounted.current && generation.current === request)
        setError(String(error));
    } finally {
      if (mounted.current && generation.current === request) setBusy(false);
    }
  }
  const resource = declaration?.kind === "resource" ? declaration : null;
  const combinedResource =
    resource && resourceEdit && resourceConflict?.definition
      ? mergeResourceDefinitions(
          resourceEdit.baseline,
          resource,
          resourceConflict.definition,
        )
      : null;
  function stateName(index: number, value: string) {
    if (!resource) return;
    const old = resource.states[index]!;
    const states = resource.states.map((s, i) => (i === index ? value : s));
    const unambiguous =
      resource.states.filter((s) => s === old).length === 1 &&
      !resource.states.some((s, i) => i !== index && s === value);
    change({
      ...resource,
      states,
      ...(unambiguous
        ? {
            initial: resource.initial === old ? value : resource.initial,
            terminal: resource.terminal.map((s) => (s === old ? value : s)),
            transitions: resource.transitions.map((e) => ({
              from: e.from === old ? value : e.from,
              to: e.to === old ? value : e.to,
            })),
          }
        : {}),
    });
  }
  const stateOptions = (value: string) => (
    <>
      {!resource?.states.includes(value) && (
        <option value={value}>
          {value || "Choose a state"} (not declared)
        </option>
      )}
      {resource?.states.map((s, i) => (
        <option key={i} value={s}>
          {s || "Unnamed state"}
        </option>
      ))}
    </>
  );
  const knownTypes = [
    ...new Map(
      [
        ...(context?.types ?? []),
        ...importedTypes.map((item) => ({
          name:
            item.name ??
            item.symbolId.slice(item.symbolId.lastIndexOf("#") + 1),
          kind: item.kind ?? "record",
          symbolId: item.symbolId,
          file: item.file,
        })),
      ].map((item) => [item.symbolId, item]),
    ).values(),
  ];
  return (
    <ProjectTypeContext.Provider
      value={
        editingResource
          ? null
          : {
              file,
              runId,
              register: (item) => {
                const referenced = declarationTypeReferences(declaration);
                const next = [
                  ...importedTypesRef.current.filter(
                    (old) =>
                      old.symbolId !== item.symbolId &&
                      referenced.has(old.symbolId),
                  ),
                  {
                    symbolId: item.symbolId,
                    file: item.file,
                    sourceHash: item.sourceHash,
                    name: item.name,
                    kind: item.kind,
                  },
                ];
                if (next.length > 129)
                  throw Error(
                    "This form already refers to 128 imported types. Split the declaration before adding more.",
                  );
                importedTypesRef.current = next;
                setImportedTypes(next);
              },
            }
      }
    >
      <div className="modal-backdrop" onClick={onClose}>
        <section
          className={`modal interface-modal declaration-editor${resource ? " resource-editor" : ""}${declaration?.kind === "machine" ? " machine-editor" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={
            editingResource ? "Edit resource lifecycle" : "Add to this design"
          }
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-heading">
            <div>
              <h2>
                {editingResource
                  ? "Edit resource lifecycle"
                  : "Add to this design"}
              </h2>
              <p>{file}</p>
            </div>
            <button className="text-link" onClick={onClose}>
              Close
            </button>
          </div>
          {resumed.current && (
            <p className="message">
              Resumed your unfinished declaration for {file}. Review it against
              the current source before applying it.
            </p>
          )}
          <p>
            {editingResource
              ? "Change the lifecycle rules, preview affected components, then apply to the unsaved design. Existing uses are not automatically renamed."
              : "Describe one part of your system. Preview it, then add it to the unsaved design. Your existing source stays intact."}
          </p>
          {resourceConflict && (
            <section aria-label="Lifecycle changed on disk">
              <h3>This lifecycle changed since your form was saved</h3>
              <div className="plan-form-grid">
                {[
                  {
                    title: "Your edited lifecycle",
                    value:
                      declaration?.kind === "resource"
                        ? declaration
                        : resourceEdit!.baseline,
                  },
                  {
                    title: "Current lifecycle",
                    value: resourceConflict.definition!,
                  },
                ].map((item) => (
                  <section key={item.title}>
                    <h4>{item.title}</h4>
                    <h5>Changes from the original</h5>
                    <ul>
                      {resourceChanges(resourceEdit!.baseline, item.value).map(
                        (change) => (
                          <li key={change}>{change}</li>
                        ),
                      )}
                    </ul>
                    <p>States: {item.value.states.join(", ")}</p>
                    <p>
                      Starts in: {item.value.initial}. Cleanup complete:{" "}
                      {item.value.terminal.join(", ") || "none"}.
                    </p>
                    <ul>
                      {item.value.transitions.map((edge, i) => (
                        <li key={i}>
                          {edge.from} → {edge.to}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <button
                disabled={!combinedResource?.definition}
                onClick={() => {
                  if (!combinedResource?.definition) return;
                  const edit = {
                    name: resourceConflict.name,
                    baseline: resourceConflict.definition!,
                    declarationHash: resourceConflict.declarationHash,
                  };
                  setResourceEdit(edit);
                  change(combinedResource.definition, edit);
                  setResourceConflict(null);
                }}
              >
                Combine independent changes
              </button>
              {combinedResource?.conflicts.map((conflict) => (
                <p key={conflict}>{conflict}</p>
              ))}
              <button
                onClick={() => {
                  const edit = {
                    name: resourceConflict.name,
                    baseline: resourceConflict.definition!,
                    declarationHash: resourceConflict.declarationHash,
                  };
                  setResourceEdit(edit);
                  change(resourceConflict.definition!, edit);
                  setResourceConflict(null);
                }}
              >
                Use current lifecycle
              </button>
              <button
                onClick={() => {
                  const edit = {
                    name: resourceConflict.name,
                    baseline: resourceConflict.definition!,
                    declarationHash: resourceConflict.declarationHash,
                  };
                  setResourceEdit(edit);
                  change(declaration!, edit);
                  setResourceConflict(null);
                }}
              >
                Replace current rules with my edited lifecycle
              </button>
            </section>
          )}
          {editingResource && !declaration && (
            <div>
              <p role={error || loadError ? "alert" : "status"}>
                {error || loadError || "Loading the current lifecycle…"}
              </p>
              <button onClick={onRefresh}>Check current source</button>
            </div>
          )}
          {!declaration ? (
            !editingResource && (
              <div className="declaration-choices">
                {declarationKinds.map((kind) => (
                  <button
                    className="button secondary"
                    key={kind}
                    onClick={() => change(initialDeclaration(kind))}
                  >
                    <strong>{declarationInfo[kind].label}</strong>
                    <span>{declarationInfo[kind].description}</span>
                  </button>
                ))}
              </div>
            )
          ) : (
            <>
              <p role="status">
                {recoverySaved
                  ? "Form saved locally."
                  : "Saving unfinished form locally…"}
              </p>
              <fieldset disabled={busy} className="declaration-fields">
                <legend>{declarationInfo[declaration.kind].label}</legend>
                <p>{declarationInfo[declaration.kind].guidance}</p>
                {!editingResource && (
                  <p className="muted">
                    Starting names and values are examples. Make each field
                    match your design before previewing.
                  </p>
                )}
                {(declaration.kind === "component" ||
                  declaration.kind === "operation") && (
                  <RecipeFields
                    id="component"
                    allowModes
                    projectTypes={knownTypes}
                    options={{
                      ...defaultRecipeOptions,
                      ...declaration.signature,
                    }}
                    onChange={(edit) =>
                      change((current) => {
                        if (
                          current.kind !== "component" &&
                          current.kind !== "operation"
                        )
                          return current;
                        const next = edit({
                          ...defaultRecipeOptions,
                          ...current.signature,
                        });
                        return {
                          ...current,
                          signature: {
                            ...current.signature,
                            name: next.name,
                            inputs: next.inputs,
                            output: next.output,
                            effects: next.effects ?? [],
                          },
                        };
                      })
                    }
                  />
                )}
                {declaration.kind === "type" && (
                  <InterfaceTypeEditor
                    label="Data shape"
                    definitionsOnly
                    value={declaration.definition}
                    knownTypes={knownTypes}
                    onChange={(edit) =>
                      change((current) =>
                        current.kind === "type"
                          ? { ...current, definition: edit(current.definition) }
                          : current,
                      )
                    }
                  />
                )}
                {declaration.kind === "machine" && (
                  <MachineDefinitionEditor
                    value={declaration}
                    onChange={change}
                  />
                )}
                {resource && (
                  <div className="resource-definition">
                    <label>
                      Resource name
                      <input
                        maxLength={120}
                        value={resource.name}
                        readOnly={editingResource}
                        onChange={(e) =>
                          change({ ...resource, name: e.target.value })
                        }
                      />
                    </label>
                    <h3>Which states can it be in?</h3>
                    <p>
                      Give each state a distinct name. Choose which states mean
                      cleanup is complete.
                    </p>
                    <div className="resource-state-list">
                      {resource.states.map((state, i) => (
                        <div className="interface-field" key={i}>
                          <label>
                            State {i + 1} name
                            <input
                              maxLength={120}
                              value={state}
                              onChange={(e) => stateName(i, e.target.value)}
                            />
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              checked={resource.terminal.includes(state)}
                              onChange={(e) =>
                                change({
                                  ...resource,
                                  terminal: e.target.checked
                                    ? [...resource.terminal, state]
                                    : resource.terminal.filter(
                                        (s) => s !== state,
                                      ),
                                })
                              }
                            />
                            Cleanup complete in state {i + 1}
                          </label>
                          <button
                            type="button"
                            disabled={resource.states.length === 1}
                            onClick={() =>
                              change({
                                ...resource,
                                states: resource.states.filter(
                                  (_, j) => i !== j,
                                ),
                                terminal: resource.terminal.filter(
                                  (s) => s !== state,
                                ),
                              })
                            }
                          >
                            Remove state {i + 1}
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={resource.states.length >= 40}
                      onClick={() => {
                        let n = resource.states.length + 1;
                        while (resource.states.includes("State" + n)) n++;
                        change({
                          ...resource,
                          states: [...resource.states, "State" + n],
                        });
                      }}
                    >
                      Add state
                    </button>
                    <label>
                      Starting state
                      <select
                        aria-label="Starting state"
                        value={resource.initial}
                        onChange={(e) =>
                          change({ ...resource, initial: e.target.value })
                        }
                      >
                        {stateOptions(resource.initial)}
                      </select>
                    </label>
                    <h3>Which state changes are allowed?</h3>
                    {resource.transitions.map((edge, i) => (
                      <div className="interface-field" key={i}>
                        <label>
                          Transition {i + 1} from
                          <select
                            aria-label={`Transition ${i + 1} from`}
                            value={edge.from}
                            onChange={(e) =>
                              change({
                                ...resource,
                                transitions: resource.transitions.map((v, j) =>
                                  i === j ? { ...v, from: e.target.value } : v,
                                ),
                              })
                            }
                          >
                            {stateOptions(edge.from)}
                          </select>
                        </label>
                        <label>
                          Transition {i + 1} to
                          <select
                            aria-label={`Transition ${i + 1} to`}
                            value={edge.to}
                            onChange={(e) =>
                              change({
                                ...resource,
                                transitions: resource.transitions.map((v, j) =>
                                  i === j ? { ...v, to: e.target.value } : v,
                                ),
                              })
                            }
                          >
                            {stateOptions(edge.to)}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            change({
                              ...resource,
                              transitions: resource.transitions.filter(
                                (_, j) => i !== j,
                              ),
                            })
                          }
                        >
                          Remove transition {i + 1}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={resource.transitions.length >= 80}
                      onClick={() =>
                        change({
                          ...resource,
                          transitions: [
                            ...resource.transitions,
                            {
                              from: resource.states[0]!,
                              to: resource.states.at(-1)!,
                            },
                          ],
                        })
                      }
                    >
                      Add allowed transition
                    </button>
                    <p>
                      These are lifecycle rules. The checker will still require
                      cleanup on each exit; no cleanup steps are added for you.
                    </p>
                  </div>
                )}
                {declaration.kind === "operation" && (
                  <OperationRulesEditor value={declaration} onChange={change} />
                )}
                {declaration.kind === "operation" && (
                  <details className="declaration-assumptions">
                    <summary>
                      Work summaries and atomicity (optional assumptions)
                    </summary>
                    <p>
                      Leave work unspecified if you do not know it yet. A
                      summary is a declared assumption, not a measurement.
                    </p>
                    {declaration.costs.map((cost, i) => (
                      <div className="interface-field" key={i}>
                        <label>
                          Work {i + 1} metric
                          <input
                            maxLength={120}
                            value={cost.metric}
                            onChange={(e) =>
                              change({
                                ...declaration,
                                costs: declaration.costs.map((c, j) =>
                                  i === j
                                    ? { ...c, metric: e.target.value }
                                    : c,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Work {i + 1} count
                          <input
                            inputMode="numeric"
                            maxLength={30}
                            value={cost.count}
                            onChange={(e) =>
                              change({
                                ...declaration,
                                costs: declaration.costs.map((c, j) =>
                                  i === j ? { ...c, count: e.target.value } : c,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Work {i + 1} meaning
                          <select
                            aria-label={`Work ${i + 1} meaning`}
                            value={cost.quality}
                            onChange={(e) =>
                              change({
                                ...declaration,
                                costs: declaration.costs.map((c, j) =>
                                  i === j
                                    ? {
                                        ...c,
                                        quality: e.target.value as
                                          | "exact"
                                          | "upper",
                                      }
                                    : c,
                                ),
                              })
                            }
                          >
                            <option value="exact">Exactly this much</option>
                            <option value="upper">At most this much</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            change({
                              ...declaration,
                              costs: declaration.costs.filter(
                                (_, j) => i !== j,
                              ),
                            })
                          }
                        >
                          Remove work summary {i + 1}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      disabled={declaration.costs.length >= 20}
                      onClick={() =>
                        change({
                          ...declaration,
                          costs: [
                            ...declaration.costs,
                            { metric: "calls", count: "1", quality: "exact" },
                          ],
                        })
                      }
                    >
                      Add work summary
                    </button>
                    <label>
                      <input
                        type="checkbox"
                        checked={declaration.atomic}
                        onChange={(e) =>
                          change({ ...declaration, atomic: e.target.checked })
                        }
                      />
                      Assume the operation finishes atomically
                    </label>
                    <p>
                      Only choose atomicity if intermediate effects cannot be
                      observed. Otherwise leave it unchecked and model
                      uncertainty explicitly.
                    </p>
                  </details>
                )}
              </fieldset>
              {loadError && (
                <p role="alert" className="message error-message">
                  {loadError}
                </p>
              )}
              {!context && !loadError && (
                <p role="status">
                  Checking the current source and its available types…
                </p>
              )}
              {context?.notice && <p className="message">{context.notice}</p>}
              {error && (
                <p role="alert" className="message error-message">
                  {error}
                </p>
              )}
              {preview && (
                <section
                  aria-label={
                    editingResource
                      ? "Lifecycle edit preview"
                      : "New declaration preview"
                  }
                >
                  <h3>
                    {editingResource
                      ? "Review the lifecycle changes"
                      : "Review what will be added"}
                  </h3>
                  {editingResource && (
                    <>
                      <h4>Affected components</h4>
                      <ul>
                        {preview.affected.map((item) => (
                          <li key={item.symbolId}>{item.name}</li>
                        ))}
                      </ul>
                      <p>
                        {preview.affectedComplete
                          ? "All consumers in the checked project were considered."
                          : "Impact is incomplete; recheck the current project before relying on it."}
                      </p>
                    </>
                  )}
                  {preview.notices?.map((notice, i) => (
                    <p key={i}>{notice}</p>
                  ))}
                  <pre>{preview.edits.map((edit) => edit.text).join("\n")}</pre>
                </section>
              )}
              <div className="modal-actions">
                <button className="button secondary" onClick={onClose}>
                  Close and keep form
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={onRefresh}
                >
                  Check current source
                </button>
                <button
                  className="button secondary"
                  disabled={!context?.canCreate || !!resourceConflict}
                  aria-disabled={busy || undefined}
                  onClick={() => {
                    if (!busy) void previewChanges();
                  }}
                >
                  {editingResource
                    ? "Preview lifecycle changes"
                    : "Preview declaration"}
                </button>
                <button
                  className="button primary"
                  disabled={busy || !preview}
                  onClick={() => {
                    if (!preview) return;
                    setBusy(true);
                    void onApply(preview)
                      .catch((e) => {
                        if (mounted.current) {
                          setError(String(e));
                          setPreview(null);
                        }
                      })
                      .finally(() => {
                        if (mounted.current) setBusy(false);
                      });
                  }}
                >
                  {editingResource
                    ? "Apply lifecycle changes and check"
                    : "Add to editor and check"}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </ProjectTypeContext.Provider>
  );
}
