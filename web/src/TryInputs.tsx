import { useEffect, useRef, useState } from "react";
import type { SymbolView } from "../../src/studio/protocol";
import {
  trialSchema,
  type TrialResult,
} from "../../src/behaviour/trial-schema";
import { api } from "./api";
import { ValueInput, initialValue, canEnterValue } from "./ScopeEditor";
export function TryInputs({
  entry,
  runId,
  current,
}: {
  entry: SymbolView;
  runId: string;
  current: boolean;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({}),
    [result, setResult] = useState<TrialResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [assumptionLimit, setAssumptionLimit] = useState(20);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    setValues(
      Object.fromEntries(
        entry.callable?.parameters.map((p) => [
          p.name,
          initialValue(p.shape),
        ]) ?? [],
      ),
    );
    setResult(null);
    return () => request.current?.abort();
  }, [entry.id]);
  useEffect(() => {
    request.current?.abort();
    setResult(null);
    setBusy(false);
    setError("");
    return () => request.current?.abort();
  }, [runId, current]);
  const inputsAvailable = (entry.callable?.parameters ?? []).every((p) =>
    canEnterValue(p.shape, values[p.name]),
  );
  return (
    <section className="try-inputs" aria-label="Try inputs">
      <h3>Try one set of inputs</h3>
      <p>
        See the actual returned value for this example. This uses the source
        interpreter; it does not contact real services or prove every case.
      </p>
      {entry.callable?.parameters.map((p) => (
        <label key={p.name}>
          <strong>{p.name}</strong>
          <ValueInput
            shape={p.shape}
            value={values[p.name]}
            label={"Try input " + p.name}
            onChange={(value) => {
              request.current?.abort();
              request.current = null;
              setValues((old) => ({ ...old, [p.name]: value }));
              setResult(null);
              setBusy(false);
              setError("");
            }}
          />
        </label>
      ))}
      {!current && <p>Check the latest edit before running an example.</p>}
      <button
        className="button primary"
        disabled={busy || !current || !inputsAvailable}
        onClick={() => {
          const controller = new AbortController();
          request.current = controller;
          setBusy(true);
          setError("");
          setAssumptionLimit(20);
          void api(
            "try-inputs",
            { id: runId, entry: entry.name, inputs: values },
            controller.signal,
          )
            .then((raw) => {
              if (!controller.signal.aborted && request.current === controller)
                setResult(trialSchema.parse(raw));
            })
            .catch((e) => {
              if (request.current === controller && !controller.signal.aborted)
                setError(String(e));
            })
            .finally(() => {
              if (request.current === controller) setBusy(false);
            });
        }}
      >
        Run these inputs
      </button>
      {busy && (
        <button
          className="button secondary"
          onClick={() => request.current?.abort()}
        >
          Cancel example
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {result && current && (
        <div className="trial-result" role="status">
          <strong>
            {result.completion === "complete"
              ? "Returned value"
              : result.completion === "violated"
                ? "Condition violated"
                : "No result established"}
          </strong>
          <pre>
            {result.completion === "complete"
              ? JSON.stringify(result.output, null, 2)
              : result.message}
          </pre>
          <small>
            {result.steps} source steps · one example, not a universal claim
          </small>
          {result.assumptions.length > 0 && (
            <details>
              <summary>
                Assumptions for this example ({result.assumptions.length})
              </summary>
              <ul>
                {result.assumptions
                  .slice(0, assumptionLimit)
                  .map((assumption, i) => (
                    <li key={i}>{assumption}</li>
                  ))}
              </ul>
              {result.assumptions.length > assumptionLimit && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setAssumptionLimit((n) => n + 20)}
                >
                  Show more assumptions (
                  {result.assumptions.length - assumptionLimit} remaining)
                </button>
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
