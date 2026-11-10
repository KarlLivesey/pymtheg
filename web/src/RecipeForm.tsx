import { sourceFileName } from "../../src/shared/identity-values";
import type { TypeChoice } from "../../src/studio/type-choices";
import { InterfaceTypeEditor } from "./InterfaceTypeEditor";
import { identifierProblem, unusedSourceName } from "../../src/shared/names";
import { useState, useEffect } from "react";
import {
  useDraftUpdate,
  useDraftState,
  type DraftUpdate,
} from "./useDraftUpdate";
import {
  recipes,
  recipeSource,
  defaultRecipeOptions,
  type RecipeId,
  type RecipeOptions,
  type RecipeFormDraft,
} from "../../src/studio/recipes";
import { appendInterfaceInput } from "../../src/studio/interface-builder";
import type {
  InterfaceType,
  InterfaceContext,
} from "../../src/studio/interface-builder";
function definedTypes(values: InterfaceType[]) {
  const names = new Map<string, { name: string; kind: "record" | "choice" }>();
  const pending = [...values];
  while (pending.length) {
    const value = pending.pop()!;
    if (typeof value === "string") continue;
    switch (value.kind) {
      case "record":
        names.set(value.name, { name: value.name, kind: value.kind });
        pending.push(...value.fields.map((f) => f.type));
        break;
      case "choice":
        names.set(value.name, { name: value.name, kind: value.kind });
        pending.push(
          ...value.variants.flatMap((v) => (v.payload ? [v.payload] : [])),
        );
        break;
      case "result":
        pending.push(value.ok, value.error);
        break;
      case "list":
        pending.push(value.element);
        break;
      case "named":
        break;
    }
  }
  return [...names.values()];
}
export interface RecipeDraft {
  id: RecipeId;
  options: RecipeOptions;
  path: string;
  source: string;
  context?: InterfaceContext;
}
export function RecipeFields({
  id,
  options,
  onChange,
  projectTypes = [],
  allowModes = false,
}: {
  id: RecipeId;
  options: RecipeOptions;
  onChange: DraftUpdate<RecipeOptions>;
  allowModes?: boolean;
  projectTypes?: {
    name: string;
    kind: "record" | "choice" | "resource";
    symbolId?: string;
    file?: string;
  }[];
}) {
  const update = useDraftUpdate(options, onChange);
  const [part, setPart] = useState("inputs");
  const allTypes: TypeChoice[] = [
    ...definedTypes([...options.inputs.map((i) => i.type), options.output]),
    ...projectTypes,
  ];
  const knownTypes = [
    ...new Map(
      allTypes.map((type) => [type.symbolId ?? "local:" + type.name, type]),
    ).values(),
  ];
  if (id === "retry")
    return (
      <label>
        <input
          type="checkbox"
          checked={options.deduplicate}
          onChange={(e) =>
            update((current) => ({ ...current, deduplicate: e.target.checked }))
          }
        />{" "}
        Repeating this request has no additional effect (idempotent provider
        contract)
      </label>
    );
  if (id === "work")
    return (
      <div className="recipe-fields">
        {(
          [
            ["items", "Maximum items"],
            ["calls", "Calls for each item"],
            ["budget", "Maximum calls allowed"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              className="text-input"
              aria-label={label}
              inputMode="numeric"
              pattern="[0-9]+"
              required
              value={options[key]}
              onChange={(e) =>
                update((current) => ({ ...current, [key]: e.target.value }))
              }
            />
          </label>
        ))}
      </div>
    );
  if (id === "decision")
    return (
      <label>
        Minimum age
        <input
          className="text-input"
          aria-label="Minimum age"
          inputMode="numeric"
          required
          pattern="[0-9]+"
          value={options.age}
          onChange={(e) =>
            update((current) => ({ ...current, age: e.target.value }))
          }
        />
      </label>
    );
  if (id !== "component") return null;
  return (
    <section className="component-inputs">
      <label>
        Component name
        <input
          className="text-input"
          value={options.name}
          onChange={(e) =>
            update((current) => ({ ...current, name: e.target.value }))
          }
        />
      </label>
      {identifierProblem(options.name) && (
        <p role="alert">{identifierProblem(options.name)}</p>
      )}
      <nav className="component-steps" aria-label="Component details">
        {[
          ["inputs", "1. Inputs"],
          ["output", "2. Return value"],
          ["effects", "3. Effects (optional)"],
        ].map(([step, label]) => (
          <button
            key={step}
            type="button"
            aria-pressed={part === step}
            onClick={() => setPart(step!)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div hidden={part !== "inputs"}>
        <h3>What does the caller supply?</h3>
        <p>Give each input a name and choose the kind of value it accepts.</p>
        {options.inputs.map((input, index) => (
          <div className="input-builder-row" key={index}>
            <label>
              Input {index + 1} name
              <input
                className="text-input"
                value={input.name}
                onChange={(e) =>
                  update((current) => ({
                    ...current,
                    inputs: current.inputs.map((p, i) =>
                      i === index ? { ...p, name: e.target.value } : p,
                    ),
                  }))
                }
              />
            </label>
            {allowModes && (
              <label>
                Input {index + 1} passing
                <select
                  aria-label={`Input ${index + 1} passing`}
                  value={input.mode ?? "value"}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      inputs: current.inputs.map((p, i) =>
                        i === index
                          ? {
                              ...p,
                              mode: event.target.value as
                                | "value"
                                | "take"
                                | "borrow",
                            }
                          : p,
                      ),
                    }))
                  }
                >
                  <option value="value">Value</option>
                  <option value="borrow">
                    Borrow resource (caller keeps ownership)
                  </option>
                  <option value="take">
                    Take resource (callee must settle it)
                  </option>
                </select>
              </label>
            )}
            <InterfaceTypeEditor
              label={`Input ${index + 1}`}
              value={input.type}
              knownTypes={knownTypes}
              allowUnit={false}
              onChange={(type) =>
                update((current) => ({
                  ...current,
                  inputs: current.inputs.map((p, i) =>
                    i === index ? { ...p, type: type(p.type) } : p,
                  ),
                }))
              }
            />
            <button
              type="button"
              className="text-link"
              aria-label={`Remove input ${index + 1}`}
              onClick={() =>
                update((current) => ({
                  ...current,
                  inputs: current.inputs.filter((_, i) => i !== index),
                }))
              }
            >
              Remove
            </button>
            {identifierProblem(input.name) && (
              <p role="alert">{identifierProblem(input.name)}</p>
            )}
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={options.inputs.length >= 20}
          onClick={() =>
            update((current) => ({
              ...current,
              inputs: appendInterfaceInput(current.inputs),
            }))
          }
        >
          Add an input
        </button>
        <button
          type="button"
          className="button secondary"
          onClick={() => setPart("output")}
        >
          Next: return value
        </button>
      </div>
      <div hidden={part !== "output"}>
        <h3>What comes back?</h3>
        <p>
          Choose one result, or success and error cases. Reuse a record you
          already defined by choosing Existing named type.
        </p>
        <InterfaceTypeEditor
          knownTypes={knownTypes}
          label="Output"
          value={options.output}
          onChange={(output) =>
            update((current) => ({
              ...current,
              output: output(current.output),
            }))
          }
        />
        <button
          type="button"
          className="button secondary"
          onClick={() => setPart("effects")}
        >
          Next: effects (optional)
        </button>
      </div>
      <div hidden={part !== "effects"}>
        <h3>External work and state changes</h3>
        <p>
          Name any services or resources this component may use. This only
          declares its allowed effects; it does not run them.
        </p>
        {(options.effects ?? []).map((effect, index) => (
          <div className="interface-field" key={index}>
            <label>
              Effect {index + 1} kind
              <select
                value={effect.kind}
                onChange={(e) =>
                  update((current) => ({
                    ...current,
                    effects: current.effects!.map((v, i) =>
                      i === index ? { ...v, kind: e.target.value } : v,
                    ),
                  }))
                }
              >
                <option value="remote">Remote service call</option>
                <option value="read">Read a resource</option>
                <option value="write">Write a resource</option>
                <option value="state">Change resource state</option>
                <option value="io">Other input or output</option>
              </select>
            </label>
            <label>
              Effect {index + 1} target
              <input
                value={effect.target}
                onChange={(e) =>
                  update((current) => ({
                    ...current,
                    effects: current.effects!.map((v, i) =>
                      i === index ? { ...v, target: e.target.value } : v,
                    ),
                  }))
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                update((current) => ({
                  ...current,
                  effects: current.effects!.filter((_, i) => i !== index),
                }))
              }
            >
              Remove effect {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={(options.effects?.length ?? 0) >= 20}
          className="button secondary"
          onClick={() =>
            update((current) => ({
              ...current,
              effects: [
                ...(current.effects ?? []),
                { kind: "remote", target: "" },
              ],
            }))
          }
        >
          Add an effect
        </button>
      </div>
    </section>
  );
}
export function RecipeForm({
  onClose,
  onCreate,
  existingPaths,
  projectTypes = [],
  initialDraft,
  onDraft,
  typeCatalogue = { status: "ready", message: "" },
  onReloadTypes,
}: {
  initialDraft?: RecipeFormDraft | null;
  typeCatalogue?: {
    status: "idle" | "loading" | "ready" | "error";
    message: string;
  };
  onReloadTypes?: () => void;
  onDraft: (draft: RecipeFormDraft) => void;
  onClose: () => void;
  existingPaths: string[];
  projectTypes?: InterfaceContext["types"];
  onCreate: (draft: RecipeDraft) => Promise<void>;
}) {
  const [id, setId] = useState<RecipeId>(initialDraft?.id ?? "work"),
    [options, setOptions, readOptions] = useDraftState<RecipeOptions>(
      initialDraft?.options ?? defaultRecipeOptions,
    ),
    [path, setPath] = useState(
      () =>
        initialDraft?.path ??
        unusedSourceName(sourceFileName("work-budget"), existingPaths),
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [choosing, setChoosing] = useState(initialDraft?.choosing ?? true);
  useEffect(
    () => onDraft({ id, options, path, choosing }),
    [id, options, path, choosing],
  );
  const recipe = recipes.find((r) => r.id === id)!;
  const context = { file: path, types: projectTypes };
  let preview = "";
  try {
    preview = recipeSource(id, options, context);
  } catch {
    /* Show validation on submit; keep partially typed fields. */
  }
  return (
    <div className="modal-backdrop">
      <form
        className="modal recipe-modal"
        role="dialog"
        aria-modal="true"
        data-type-catalogue={typeCatalogue.status}
        aria-labelledby="new-title"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setBusy(true);
          void Promise.resolve()
            .then(() =>
              onCreate({
                id,
                options: readOptions(),
                path,
                source: recipeSource(id, readOptions(), context),
                context,
              }),
            )
            .catch((e) => setError(String(e)))
            .finally(() => setBusy(false));
        }}
      >
        <span className="eyebrow">START WITH A SMALL DESIGN</span>
        <h2 id="new-title">What would you like to work out?</h2>
        <p>
          Choose a starting point. Change the decisions below; Pymtheg writes
          the design text and checks it for you.
        </p>
        {choosing ? (
          <div className="recipe-choices">
            {recipes.map((r) => (
              <button
                type="button"
                key={r.id}
                aria-pressed={id === r.id}
                className={id === r.id ? "selected" : ""}
                onClick={() => {
                  setId(r.id);
                  setChoosing(false);
                  setPath(unusedSourceName(r.filename, existingPaths));
                  setError("");
                }}
              >
                <strong>{r.title}</strong>
                <span>{r.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <section className="chosen-recipe" aria-label="Chosen starting point">
            <div>
              <strong>{recipe.title}</strong>
              <p>{recipe.description}</p>
            </div>
            <button
              type="button"
              className="button secondary"
              onClick={() => setChoosing(true)}
            >
              Change starting point
            </button>
          </section>
        )}
        {id === "component" && typeCatalogue.status === "loading" && (
          <p role="status">
            {typeCatalogue.message} You can continue naming inputs while this
            runs.
          </p>
        )}
        {id === "component" && typeCatalogue.status === "error" && (
          <div role="alert">
            <p>
              Existing project types could not be loaded.{" "}
              {typeCatalogue.message}
            </p>
            <button type="button" onClick={onReloadTypes}>
              Recheck project types
            </button>
          </div>
        )}
        <RecipeFields
          id={id}
          options={options}
          projectTypes={projectTypes}
          onChange={setOptions}
        />
        <label>
          Save this design as
          <input
            className="text-input"
            aria-label="Design file name"
            placeholder={sourceFileName("my-design")}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
          />
          <small>
            A local design file inside this project. New folders are created
            when you create the file. Your program is not executed.
          </small>
        </label>
        <details>
          <summary>See the generated design text</summary>
          <pre className="disk-preview">
            {preview || "Finish the input values to see a preview."}
          </pre>
        </details>
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy || !preview}>
            {busy ? "Creating…" : "Create and check"}
          </button>
        </div>
      </form>
    </div>
  );
}
