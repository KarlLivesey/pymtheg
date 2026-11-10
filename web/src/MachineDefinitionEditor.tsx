import { useLayoutEffect, useRef } from "react";
import type { MachineDefinition } from "../../src/studio/machine-data";

function nextName(names: string[], base: string) {
  if (!names.includes(base)) return base;
  let index = 2;
  while (names.includes(base + index)) index++;
  return base + index;
}

export function MachineDefinitionEditor({
  value,
  onChange,
}: {
  value: MachineDefinition;
  onChange: (value: MachineDefinition) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const focus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!focus.current) return;
    root.current
      ?.querySelector<HTMLElement>(`[data-machine-focus="${focus.current}"]`)
      ?.focus();
    focus.current = null;
  }, [value]);
  const change = (next: MachineDefinition, target: string) => {
    focus.current = target;
    onChange(next);
  };
  return (
    <div className="machine-definition" ref={root}>
      <label>
        Event model name
        <input
          maxLength={120}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </label>
      <p>
        Describe what can change, when it can change, and what must always be
        true. Events are indivisible model steps; this does not promise that
        real services act atomically.
      </p>
      <h3>1. What state do you keep?</h3>
      <p>
        Numbers need a smallest and largest possible value for finite checking.
        Leave an expression blank to keep it as an open question. Renaming a
        state also needs its uses in expressions updated.
      </p>
      <div className="machine-card-list">
        {value.states.map((state, index) => (
          <fieldset className="machine-card" key={index}>
            <legend>State {index + 1}</legend>
            <div className="machine-field-grid">
              <label>
                State {index + 1} name
                <input
                  data-machine-focus={`state-${index}`}
                  maxLength={120}
                  value={state.name}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      states: value.states.map((s, i) =>
                        i === index ? { ...s, name: e.target.value } : s,
                      ),
                    })
                  }
                />
              </label>
              <label>
                State {index + 1} kind
                <select
                  aria-label={`State ${index + 1} kind`}
                  value={state.type}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      states: value.states.map((s, i) =>
                        i === index
                          ? { ...s, type: e.target.value as typeof state.type }
                          : s,
                      ),
                    })
                  }
                >
                  <option value="Bool">Yes or no</option>
                  <option value="Nat">Whole number, zero or more</option>
                  <option value="Int">Whole number, including negatives</option>
                </select>
              </label>
              {state.type !== "Bool" && (
                <>
                  <label>
                    State {index + 1} minimum
                    <input
                      maxLength={30}
                      inputMode="numeric"
                      value={state.min}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          states: value.states.map((s, i) =>
                            i === index ? { ...s, min: e.target.value } : s,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    State {index + 1} maximum
                    <input
                      maxLength={30}
                      inputMode="numeric"
                      value={state.max}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          states: value.states.map((s, i) =>
                            i === index ? { ...s, max: e.target.value } : s,
                          ),
                        })
                      }
                    />
                  </label>
                </>
              )}
              <label>
                State {index + 1} starting value
                <input
                  maxLength={1000}
                  value={state.initial}
                  placeholder={
                    state.type === "Bool"
                      ? "For example, false"
                      : "For example, 0"
                  }
                  onChange={(e) =>
                    onChange({
                      ...value,
                      states: value.states.map((s, i) =>
                        i === index ? { ...s, initial: e.target.value } : s,
                      ),
                    })
                  }
                />
              </label>
            </div>
            <button
              type="button"
              disabled={value.states.length === 1}
              onClick={() =>
                change(
                  {
                    ...value,
                    states: value.states.filter((_, i) => i !== index),
                  },
                  `state-${Math.max(0, index - 1)}`,
                )
              }
            >
              Remove state {index + 1}
            </button>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        data-machine-focus="add-state"
        disabled={value.states.length >= 20}
        onClick={() =>
          change(
            {
              ...value,
              states: [
                ...value.states,
                {
                  name: nextName(
                    value.states.map((s) => s.name),
                    "value",
                  ),
                  type: "Bool",
                  min: "",
                  max: "",
                  initial: "",
                },
              ],
            },
            `state-${value.states.length}`,
          )
        }
      >
        Add state
      </button>
      <h3>2. What can happen?</h3>
      <p>
        Give each event a condition and the values it changes. For example,
        allow <code>count &lt; 3</code> and set count to <code>count + 1</code>.
        All expressions use the state before the event; values you do not set
        stay unchanged.
      </p>
      <div className="machine-card-list">
        {value.events.map((event, index) => (
          <fieldset className="machine-card" key={index}>
            <legend>Event {index + 1}</legend>
            <label>
              Event {index + 1} name
              <input
                data-machine-focus={`event-${index}`}
                maxLength={120}
                value={event.name}
                onChange={(e) =>
                  onChange({
                    ...value,
                    events: value.events.map((v, i) =>
                      i === index ? { ...v, name: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <label>
              When event {index + 1} can happen
              <input
                maxLength={1000}
                value={event.guard}
                placeholder="For example, count < 3; leave blank if undecided"
                onChange={(e) =>
                  onChange({
                    ...value,
                    events: value.events.map((v, i) =>
                      i === index ? { ...v, guard: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            {event.updates.map((update, updateIndex) => (
              <div className="machine-update" key={updateIndex}>
                <label>
                  Event {index + 1} change {updateIndex + 1} state
                  <select
                    aria-label={`Event ${index + 1} change ${updateIndex + 1} state`}
                    data-machine-focus={`update-${index}-${updateIndex}`}
                    value={update.state}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        events: value.events.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                updates: v.updates.map((u, j) =>
                                  j === updateIndex
                                    ? { ...u, state: e.target.value }
                                    : u,
                                ),
                              }
                            : v,
                        ),
                      })
                    }
                  >
                    <option value="">Choose state</option>
                    {update.state &&
                      !value.states.some((s) => s.name === update.state) && (
                        <option value={update.state}>
                          {update.state} (no longer declared)
                        </option>
                      )}
                    {value.states
                      .filter((s) => s.name)
                      .map((s, i) => (
                        <option key={i} value={s.name}>
                          {s.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Event {index + 1} change {updateIndex + 1} new value
                  <input
                    maxLength={1000}
                    value={update.value}
                    placeholder="For example, count + 1"
                    onChange={(e) =>
                      onChange({
                        ...value,
                        events: value.events.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                updates: v.updates.map((u, j) =>
                                  j === updateIndex
                                    ? { ...u, value: e.target.value }
                                    : u,
                                ),
                              }
                            : v,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  onClick={() =>
                    change(
                      {
                        ...value,
                        events: value.events.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                updates: v.updates.filter(
                                  (_, j) => j !== updateIndex,
                                ),
                              }
                            : v,
                        ),
                      },
                      `event-${index}`,
                    )
                  }
                >
                  Remove event {index + 1} change {updateIndex + 1}
                </button>
              </div>
            ))}
            <button
              type="button"
              disabled={event.updates.length >= 20}
              onClick={() =>
                change(
                  {
                    ...value,
                    events: value.events.map((v, i) =>
                      i === index
                        ? {
                            ...v,
                            updates: [...v.updates, { state: "", value: "" }],
                          }
                        : v,
                    ),
                  },
                  `update-${index}-${event.updates.length}`,
                )
              }
            >
              Add change to event {index + 1}
            </button>
            <button
              type="button"
              onClick={() =>
                change(
                  {
                    ...value,
                    events: value.events.filter((_, i) => i !== index),
                  },
                  index > 0 ? `event-${index - 1}` : "add-event",
                )
              }
            >
              Remove event {index + 1}
            </button>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        data-machine-focus="add-event"
        disabled={value.events.length >= 20}
        onClick={() =>
          change(
            {
              ...value,
              events: [
                ...value.events,
                {
                  name: nextName(
                    value.events.map((e) => e.name),
                    "advance",
                  ),
                  guard: "",
                  updates: [],
                },
              ],
            },
            `event-${value.events.length}`,
          )
        }
      >
        Add event
      </button>
      <h3>3. What must always hold?</h3>
      <p>
        A safety rule is checked in every reached state. For example,{" "}
        <code>count &lt;= 1</code> means a second attempt is a defect. This does
        not prove that work will eventually finish.
      </p>
      {!value.invariants.length && (
        <p className="message">
          No safety rules yet. Add one to describe the failure you want the
          checker to find.
        </p>
      )}
      <div className="machine-card-list">
        {value.invariants.map((rule, index) => (
          <fieldset className="machine-card" key={index}>
            <legend>Safety rule {index + 1}</legend>
            <label>
              Safety rule {index + 1} name
              <input
                data-machine-focus={`rule-${index}`}
                maxLength={120}
                value={rule.name}
                onChange={(e) =>
                  onChange({
                    ...value,
                    invariants: value.invariants.map((r, i) =>
                      i === index ? { ...r, name: e.target.value } : r,
                    ),
                  })
                }
              />
            </label>
            <label>
              Safety rule {index + 1} expression
              <input
                maxLength={1000}
                value={rule.expression}
                placeholder="For example, count <= 1"
                onChange={(e) =>
                  onChange({
                    ...value,
                    invariants: value.invariants.map((r, i) =>
                      i === index ? { ...r, expression: e.target.value } : r,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                change(
                  {
                    ...value,
                    invariants: value.invariants.filter((_, i) => i !== index),
                  },
                  index > 0 ? `rule-${index - 1}` : "add-rule",
                )
              }
            >
              Remove safety rule {index + 1}
            </button>
          </fieldset>
        ))}
      </div>
      <button
        type="button"
        data-machine-focus="add-rule"
        disabled={value.invariants.length >= 20}
        onClick={() =>
          change(
            {
              ...value,
              invariants: [
                ...value.invariants,
                {
                  name: nextName(
                    value.invariants.map((r) => r.name),
                    "withinLimit",
                  ),
                  expression: "",
                },
              ],
            },
            `rule-${value.invariants.length}`,
          )
        }
      >
        Add safety rule
      </button>
    </div>
  );
}
