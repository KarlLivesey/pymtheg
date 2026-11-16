// SPDX-License-Identifier: MIT
import { useLayoutEffect, useRef } from "react";
type Rules = {
  requires?: string[] | undefined;
  ensures?: string[] | undefined;
  origins?:
    | {
        requires: (number | null)[];
        ensures: (number | null)[];
        costs: (number | null)[];
      }
    | undefined;
};
export function OperationRulesEditor<T extends Rules>({
  value,
  onChange,
  concrete = false,
}: {
  value: T;
  concrete?: boolean;
  onChange: (next: T) => void;
}) {
  const root = useRef<HTMLDetailsElement>(null);
  const focus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (focus.current) {
      root.current?.querySelector<HTMLElement>(focus.current)?.focus();
      focus.current = null;
    }
  });
  return (
    <details className="declaration-assumptions" ref={root}>
      <summary>Rules for callers and returned values (optional)</summary>
      <p>
        Use input names in these rules. In a rule about the returned value, call
        that value <code>result</code>. The checker will point out unknown names
        or incompatible types. An empty added rule stays an open question.
      </p>
      {(["requires", "ensures"] as const).map((kind) => {
        const rules = value[kind] ?? [];
        const label = kind === "requires" ? "Caller rule" : "Return rule";
        return (
          <fieldset key={kind}>
            <legend>
              {kind === "requires"
                ? "What must be true before the call?"
                : concrete
                  ? "What must this component return?"
                  : "What does the external operation guarantee?"}
            </legend>
            <p>
              {kind === "requires"
                ? "Every caller must meet these conditions."
                : concrete
                  ? "These are obligations checked against the component’s return paths within the supported analysis fragment."
                  : "These are assumptions about the service or adapter. Checking your design does not prove that its implementation keeps them."}
            </p>
            {rules.map((rule, index) => (
              <div className="interface-field" key={index}>
                <label>
                  {label} {index + 1}
                  <textarea
                    aria-label={`${label} ${index + 1}`}
                    data-rule={`${kind}-${index}`}
                    rows={2}
                    maxLength={1000}
                    value={rule}
                    placeholder={
                      kind === "requires"
                        ? "For example: amount > 0"
                        : "For example: result >= amount"
                    }
                    onChange={(event) =>
                      onChange({
                        ...value,
                        [kind]: rules.map((old, i) =>
                          i === index ? event.target.value : old,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    focus.current =
                      rules.length > 1
                        ? `[data-rule="${kind}-${Math.min(index, rules.length - 2)}"]`
                        : `[data-add-rule="${kind}"]`;
                    onChange({
                      ...value,
                      [kind]: rules.filter((_, i) => i !== index),
                      ...(value.origins
                        ? {
                            origins: {
                              ...value.origins,
                              [kind]: value.origins[kind].filter(
                                (_, i) => i !== index,
                              ),
                            },
                          }
                        : {}),
                    });
                  }}
                >
                  Remove {label.toLowerCase()} {index + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={rules.length >= 20}
              data-add-rule={kind}
              onClick={() => {
                focus.current = `[data-rule="${kind}-${rules.length}"]`;
                onChange({
                  ...value,
                  [kind]: [...rules, ""],
                  ...(value.origins
                    ? {
                        origins: {
                          ...value.origins,
                          [kind]: [...value.origins[kind], null],
                        },
                      }
                    : {}),
                });
              }}
            >
              Add {label.toLowerCase()}
            </button>
          </fieldset>
        );
      })}
    </details>
  );
}
