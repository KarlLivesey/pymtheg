import { useEffect, useState } from "react";
import {
  recipes,
  recipeSource,
  type RecipeOptions,
} from "../../src/studio/recipes";
import type { Report } from "../../src/reporting/report";
import { RecipeFields, type RecipeDraft } from "./RecipeForm";
export function RecipeCoach({
  draft,
  report,
  current,
  editable,
  onUpdate,
  onView,
  onSimulate,
}: {
  draft: RecipeDraft;
  report: Report | null;
  current: boolean;
  editable: boolean;
  onUpdate: (options: RecipeOptions, source: string) => void | Promise<void>;
  onView: (view: string) => void;
  onSimulate: () => void;
}) {
  const [options, setOptions] = useState(draft.options),
    [error, setError] = useState("");
  useEffect(() => setOptions(draft.options), [draft]);
  const recipe = recipes.find((r) => r.id === draft.id)!;
  const costResult = report?.results.find(
    (r) =>
      r.analysisKind === "cost" &&
      r.propertyId.endsWith("#main/cost/remote_calls"),
  );
  const count = costResult?.witnessOrDerivation;
  const rawMaximum =
    count && typeof count === "object" && "maximum" in count
      ? count.maximum
      : null;
  const maximum =
    rawMaximum === null || rawMaximum === undefined ? null : String(rawMaximum);
  const budgetKnown =
    current &&
    ((costResult?.completion === "complete" &&
      (costResult.outcome === "established" ||
        costResult.outcome === "counterexample")) ||
      (costResult?.completion === "unsupported" &&
        costResult.witnessValidation === "unvalidated" &&
        costResult.diagnostics.length > 0 &&
        costResult.diagnostics.every((d) => d.code === "K002"))) &&
    maximum !== null &&
    !report?.diagnostics.some(
      (d) => d.severity === "error" && d.code !== "K002",
    );
  const over = report?.diagnostics.some((d) => d.code === "K002");
  return (
    <section className="recipe-coach" aria-label="Guided design">
      <div className="coach-heading">
        <span className="eyebrow">YOUR NEXT STEP</span>
        <strong>{recipe.title}</strong>
      </div>
      {!current ? (
        <p>
          Check the current edit to update these results. Guidance uses the
          checked design.
        </p>
      ) : draft.id === "work" ? (
        <>
          <p>
            {!budgetKnown ? (
              "The budget cannot be checked yet. Resolve the highlighted problem or unknown work before relying on a total."
            ) : (
              <>
                The calculated work bound is {maximum} external calls under the
                declared limits.{" "}
                {over
                  ? "That bound exceeds your budget. Review source-path feasibility before treating it as a real violation. Try fewer calls per item, then check again."
                  : "It fits the declared budget. Review any suggestions before treating the design as finished."}
              </>
            )}
          </p>
          <button className="text-link" onClick={() => onView("costs")}>
            See how the work adds up →
          </button>
        </>
      ) : draft.id === "component" ? (
        <p>
          The inputs and output are now defined. The body is deliberately
          undecided: describe the next step, or add a reusable rule. An unknown
          is a visible design question, not a completed implementation.
        </p>
      ) : (
        <p>
          {draft.id === "retry"
            ? "A local syntax check cannot find event-ordering failures. Explore the behaviour to see what a lost acknowledgement allows."
            : draft.id === "resource"
              ? "This example checks cleanup on success, failure and cancellation. Select a finding or open Structure to see the file lifecycle."
              : draft.id === "decision"
                ? "The same eligibility rule is reused by its caller. Try an age and see the returned decision below."
                : "The remaining finding names a decision you still need to make. Select it to see the exact place in the design."}
        </p>
      )}
      {draft.id === "retry" && (
        <>
          <p>
            Run the simulator and look for enqueue → perform work → lost
            acknowledgement → retry → perform work again. Then enable the
            idempotent provider contract in “Adjust this recipe”, update and
            simulate again. That correction is a declared provider assumption;
            production code must enforce it.
          </p>
          <button
            className="button primary"
            disabled={!current}
            onClick={onSimulate}
          >
            Explore retry behaviour
          </button>
          <p className="muted">
            A found sequence is a real counterexample in this model. No
            violation in sampled runs is limited to those samples.
          </p>
        </>
      )}
      {draft.id === "component" && (
        <button
          className="button secondary"
          disabled={!current}
          onClick={() => onView("scaffold")}
        >
          Preview types and signatures
        </button>
      )}
      {draft.id === "decision" && (
        <button className="button secondary" onClick={() => onView("try")}>
          Try inputs and see the result
        </button>
      )}
      <details>
        <summary>
          {draft.id === "component"
            ? "Change inputs and output"
            : "Adjust this recipe"}
        </summary>
        <RecipeFields
          id={draft.id}
          options={options}
          projectTypes={draft.context?.types ?? []}
          onChange={setOptions}
        />
        {!editable && (
          <p className="muted">
            You have edited the source directly. These controls will not replace
            those changes; keep editing the source or create another recipe.
          </p>
        )}
        <button
          className="button secondary"
          disabled={!editable}
          onClick={() => {
            try {
              const source = recipeSource(draft.id, options, draft.context);
              setError("");
              void Promise.resolve(onUpdate(options, source)).catch((e) =>
                setError(String(e)),
              );
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Update design and check
        </button>
        {error && <p role="alert">{error}</p>}
      </details>
      <details>
        <summary>Words used in this design</summary>
        <dl>
          {recipe.concepts.map(([word, meaning]) => (
            <div key={word}>
              <dt>{word}</dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
