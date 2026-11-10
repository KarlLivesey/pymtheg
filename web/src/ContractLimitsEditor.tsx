import { useLayoutEffect, useRef } from "react";
import type { OperationContract } from "../../src/studio/operation-data";
export function ContractLimitsEditor({
  value,
  inputs,
  onChange,
}: {
  value: OperationContract;
  inputs: string[];
  onChange: (v: OperationContract) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    focus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (focus.current) {
      root.current?.querySelector<HTMLElement>(focus.current)?.focus();
      focus.current = null;
    }
  });
  return (
    <div ref={root}>
      {(["budgets", "bounds"] as const).map((kind) => {
        const rows = value[kind] ?? [];
        const bounds = kind === "bounds";
        return (
          <fieldset key={kind}>
            <legend>{bounds ? "Input bounds" : "Work budgets"}</legend>
            <p>
              {bounds
                ? "Set the largest supported input count. Bounds are assumptions about callers."
                : "Set a maximum declared work count, for example calls <= 100. A budget is checked against the component’s calculated work."}
            </p>
            {rows.map((row, i) => (
              <div className="interface-field" key={i}>
                <label>
                  {bounds ? "Input" : "Metric"}
                  {bounds ? (
                    <select
                      aria-label={`Bound input ${i + 1}`}
                      data-limit={`${kind}-${i}`}
                      value={"parameter" in row ? row.parameter : ""}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          bounds: (value.bounds ?? []).map((r, j) =>
                            j === i ? { ...r, parameter: e.target.value } : r,
                          ),
                        })
                      }
                    >
                      <option value="">Choose an input</option>
                      {inputs.map((input) => (
                        <option key={input}>{input}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={`Budget metric ${i + 1}`}
                      data-limit={`${kind}-${i}`}
                      value={"metric" in row ? row.metric : ""}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          budgets: (value.budgets ?? []).map((r, j) =>
                            j === i ? { ...r, metric: e.target.value } : r,
                          ),
                        })
                      }
                    />
                  )}
                </label>
                <label>
                  Maximum
                  <input
                    aria-label={`${bounds ? "Bound" : "Budget"} maximum ${i + 1}`}
                    value={"maximum" in row ? row.maximum : row.expression}
                    inputMode={bounds ? "numeric" : "text"}
                    onChange={(e) => {
                      if (bounds)
                        onChange({
                          ...value,
                          bounds: (value.bounds ?? []).map((r, j) =>
                            j === i ? { ...r, maximum: e.target.value } : r,
                          ),
                        });
                      else
                        onChange({
                          ...value,
                          budgets: (value.budgets ?? []).map((r, j) =>
                            j === i ? { ...r, expression: e.target.value } : r,
                          ),
                        });
                    }}
                  />
                </label>
                <button
                  type="button"
                  aria-label={`Remove ${bounds ? "bound" : "budget"} ${i + 1}`}
                  onClick={() => {
                    focus.current =
                      rows.length > 1
                        ? `[data-limit="${kind}-${Math.min(i, rows.length - 2)}"]`
                        : `[data-add-limit="${kind}"]`;
                    if (bounds)
                      onChange({
                        ...value,
                        bounds: (value.bounds ?? []).filter((_, j) => j !== i),
                      });
                    else
                      onChange({
                        ...value,
                        budgets: (value.budgets ?? []).filter(
                          (_, j) => j !== i,
                        ),
                      });
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              data-add-limit={kind}
              disabled={rows.length >= 20}
              onClick={() => {
                focus.current = `[data-limit="${kind}-${rows.length}"]`;
                if (bounds)
                  onChange({
                    ...value,
                    bounds: [
                      ...(value.bounds ?? []),
                      { parameter: "", maximum: "" },
                    ],
                  });
                else
                  onChange({
                    ...value,
                    budgets: [
                      ...(value.budgets ?? []),
                      { metric: "", expression: "" },
                    ],
                  });
              }}
            >
              Add {bounds ? "input bound" : "work budget"}
            </button>
          </fieldset>
        );
      })}
    </div>
  );
}
