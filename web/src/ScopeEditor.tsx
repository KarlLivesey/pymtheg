// SPDX-License-Identifier: MIT
import { useState } from "react";
import type { ValueShape } from "../../src/studio/shapes";
import type { SymbolView } from "../../src/studio/protocol";
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function initialValue(shape: ValueShape): unknown {
  switch (shape.kind) {
    case "bool":
      return false;
    case "int":
    case "nat":
      return "0";
    case "string":
      return "";
    case "unit":
    case "resource":
    case "unsupported":
      return null;
    case "list":
      return [];
    case "record":
      return Object.fromEntries(
        shape.fields.map((f) => [f.name, initialValue(f.shape)]),
      );
    case "tagged": {
      const v = shape.variants[0];
      return v
        ? {
            tag: v.tag,
            ...(v.payload ? { value: initialValue(v.payload) } : {}),
          }
        : null;
    }
  }
}
/** Availability of value controls, never a semantic correctness judgement. */
export function canEnterValue(shape: ValueShape, value: unknown): boolean {
  switch (shape.kind) {
    case "unsupported":
    case "resource":
      return false;
    case "record":
      return (
        record(value) &&
        shape.fields.every((f) => canEnterValue(f.shape, value[f.name]))
      );
    case "list":
      return (
        Array.isArray(value) &&
        value.every((item) => canEnterValue(shape.item, item))
      );
    case "tagged": {
      const variant = record(value)
        ? shape.variants.find((v) => v.tag === value.tag)
        : undefined;
      return (
        !!variant &&
        (!variant.payload ||
          canEnterValue(
            variant.payload,
            record(value) ? value.value : undefined,
          ))
      );
    }
    default:
      return true;
  }
}
function automatic(shape: ValueShape, bound?: string): boolean {
  switch (shape.kind) {
    case "bool":
    case "unit":
    case "resource":
      return true;
    case "nat":
      return bound !== undefined && BigInt(bound) <= 1000n;
    case "tagged":
      return shape.variants.every((v) => !v.payload || automatic(v.payload));
    case "record":
      return shape.fields.every((f) => automatic(f.shape));
    default:
      return false;
  }
}
export function ValueInput({
  shape,
  value,
  label,
  onChange,
}: {
  shape: ValueShape;
  value: unknown;
  label: string;
  onChange: (v: unknown) => void;
}) {
  if (shape.kind === "unsupported")
    return (
      <p role="alert">
        {shape.label}. You can still check this source or try another entry.
      </p>
    );
  if (shape.kind === "resource")
    return (
      <p className="muted">
        A {shape.label} handle is created by its declared contract.
      </p>
    );
  if (shape.kind === "unit")
    return <span className="muted">unit — no payload</span>;
  if (shape.kind === "bool")
    return (
      <select
        aria-label={label}
        value={String(value === true)}
        onChange={(e) => onChange(e.target.value === "true")}
      >
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    );
  if (shape.kind === "int" || shape.kind === "nat" || shape.kind === "string")
    return (
      <input
        className="text-input"
        aria-label={label}
        value={
          typeof value === "string" || typeof value === "number"
            ? String(value)
            : ""
        }
        onChange={(e) => onChange(e.target.value)}
        required={shape.kind !== "string"}
        {...(shape.kind === "string"
          ? {}
          : {
              inputMode: "numeric" as const,
              pattern: shape.kind === "nat" ? "[0-9]+" : "-?[0-9]+",
            })}
      />
    );
  if (shape.kind === "record")
    return (
      <div className="record-value">
        {shape.fields.map((field) => (
          <label key={field.name}>
            {field.name} <small>{field.shape.label}</small>
            <ValueInput
              shape={field.shape}
              value={
                record(value) ? value[field.name] : initialValue(field.shape)
              }
              label={`${label} / ${field.name}`}
              onChange={(v) =>
                onChange({ ...(record(value) ? value : {}), [field.name]: v })
              }
            />
          </label>
        ))}
      </div>
    );
  if (shape.kind === "list") {
    const values = Array.isArray(value) ? value : [];
    return (
      <div className="list-value">
        <p className="muted">
          {values.length === 0
            ? "Empty list"
            : `${values.length} item${values.length === 1 ? "" : "s"}`}
        </p>
        {values.map((v, i) => (
          <div className="value-row" key={i}>
            <ValueInput
              shape={shape.item}
              value={v}
              label={`${label} / item ${i + 1}`}
              onChange={(next) =>
                onChange(values.map((old, j) => (j === i ? next : old)))
              }
            />
            <button
              type="button"
              className="text-link"
              aria-label={`Remove ${label} item ${i + 1}`}
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          disabled={values.length >= 50}
          onClick={() => onChange([...values, initialValue(shape.item)])}
        >
          Add list item
        </button>
      </div>
    );
  }
  if (shape.kind !== "tagged") return <p>Unsupported value shape.</p>;
  const tag =
    typeof value === "string"
      ? value
      : record(value) && typeof value.tag === "string"
        ? value.tag
        : (shape.variants[0]?.tag ?? "");
  const variant = shape.variants.find((v) => v.tag === tag);
  return (
    <div className="tagged-value">
      <select
        aria-label={`${label} / outcome`}
        value={tag}
        onChange={(e) => {
          const next = shape.variants.find((v) => v.tag === e.target.value)!;
          onChange({
            tag: next.tag,
            ...(next.payload ? { value: initialValue(next.payload) } : {}),
          });
        }}
      >
        {shape.variants.map((v) => (
          <option key={v.tag}>{v.tag}</option>
        ))}
      </select>
      {variant?.payload && (
        <ValueInput
          shape={variant.payload}
          value={record(value) ? value.value : initialValue(variant.payload)}
          label={`${label} / ${tag}`}
          onChange={(next) => onChange({ tag, value: next })}
        />
      )}
    </div>
  );
}
function Domain({
  name,
  shape,
  bound,
  values,
  onChange,
  kind,
}: {
  name: string;
  shape: ValueShape;
  bound?: string;
  values: unknown[] | undefined;
  onChange: (values: unknown[] | undefined) => void;
  kind: string;
}) {
  const required = !automatic(shape, bound),
    active = values !== undefined;
  return (
    <fieldset className="domain-card">
      <legend>
        {name}{" "}
        <span>
          {shape.label}
          {bound !== undefined ? ` · at most ${bound}` : ""}
        </span>
      </legend>
      <p>
        {active
          ? "Explore these values."
          : required
            ? "Choose values to explore; this type needs an explicit finite set."
            : "Use every value allowed by the declared finite type."}
      </p>
      <label className="domain-toggle">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) =>
            onChange(e.target.checked ? [initialValue(shape)] : undefined)
          }
        />
        Choose specific {kind}
      </label>
      {active && (
        <>
          <div className="domain-values">
            {values.map((value, index) => (
              <div className="domain-example" key={index}>
                <div className="example-heading">
                  <strong>Example {index + 1}</strong>
                  <button
                    type="button"
                    className="text-link"
                    aria-label={`Remove ${name} example ${index + 1}`}
                    onClick={() =>
                      onChange(values.filter((_, i) => i !== index))
                    }
                  >
                    Remove
                  </button>
                </div>
                <ValueInput
                  shape={shape}
                  value={value}
                  label={`${name} example ${index + 1}`}
                  onChange={(v) =>
                    onChange(values.map((old, i) => (i === index ? v : old)))
                  }
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={values.length >= 100}
            onClick={() => onChange([...values, initialValue(shape)])}
          >
            Add example for {name}
          </button>
          {values.length === 0 && (
            <p role="alert">
              Choose at least one value, or turn off the explicit set.
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
export function scopeProblems(
  entry: SymbolView | undefined,
  operations: SymbolView[],
  raw: string,
): string[] {
  let scope: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value)) return ["Scope must be an object."];
    scope = value;
  } catch {
    return ["Scope is not valid JSON."];
  }
  if (!entry?.callable) return [];
  const problems: string[] = [];
  const check = (
    group: "inputs" | "results",
    name: string,
    shape: ValueShape,
    bound?: string,
  ) => {
    const values = record(scope[group]) ? scope[group][name] : undefined;
    if (Array.isArray(values) && values.length === 0)
      problems.push(`Choose at least one example for ${name}.`);
    else if (values === undefined && !automatic(shape, bound))
      problems.push(
        `Choose examples for ${name}; ${shape.label} needs an explicit finite set.`,
      );
  };
  entry.callable.parameters.forEach((p) =>
    check("inputs", p.name, p.shape, p.bound),
  );
  operations.forEach((op) => {
    if (op.callable && !op.callable.protocol)
      check("results", op.name, op.callable.result);
  });
  return problems;
}
export function ScopeEditor({
  entry,
  operations,
  value,
  onChange,
}: {
  entry: SymbolView | undefined;
  operations: SymbolView[];
  value: string;
  onChange: (text: string) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  let scope: Record<string, unknown> = {};
  let invalid = false;
  try {
    const decoded: unknown = JSON.parse(value);
    if (!record(decoded)) invalid = true;
    else scope = decoded;
  } catch {
    invalid = true;
  }
  const update = (
    group: "inputs" | "results",
    name: string,
    values: unknown[] | undefined,
  ) => {
    const old = record(scope[group]) ? scope[group] : {},
      next = { ...old };
    if (values === undefined) delete next[name];
    else next[name] = values;
    const result = { ...scope };
    if (Object.keys(next).length) result[group] = next;
    else delete result[group];
    onChange(JSON.stringify(result, null, 2));
  };
  const domain = (
    group: "inputs" | "results",
    name: string,
    shape: ValueShape,
    bound?: string,
  ) => {
    const values = record(scope[group]) ? scope[group][name] : undefined;
    return (
      <Domain
        key={group + name}
        name={name}
        shape={shape}
        {...(bound !== undefined ? { bound } : {})}
        kind={group === "inputs" ? "inputs" : "outcomes"}
        values={Array.isArray(values) ? values : undefined}
        onChange={(v) => update(group, name, v)}
      />
    );
  };
  return (
    <section className="scope-builder" aria-label="Scenario values">
      <h3>What should this scenario explore?</h3>
      {!entry && (
        <p>
          Check the source and select an entry to see its inputs and outcomes.
        </p>
      )}
      {entry?.kind === "machine" && (
        <>
          <p>
            This machine already declares its finite state ranges. Change those
            in the source to model a different system size.
          </p>
          <dl>
            {Object.entries(entry.machineDomains ?? {}).map(([name, bound]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{bound}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      {!invalid && entry?.callable && (
        <>
          <h4>Inputs to {entry.name}</h4>
          {entry.callable.parameters.length === 0 ? (
            <p className="muted">This flow has no input parameters.</p>
          ) : (
            entry.callable.parameters.map((p) =>
              domain("inputs", p.name, p.shape, p.bound),
            )
          )}
          <h4>External outcomes</h4>
          {operations.length === 0 ? (
            <p className="muted">
              No abstract operation results need to be chosen.
            </p>
          ) : (
            operations.map((op) =>
              op.callable?.protocol ? (
                <p key={op.id}>
                  <strong>{op.name}</strong>: outcomes come from its provider
                  protocol.
                </p>
              ) : (
                op.callable && domain("results", op.name, op.callable.result)
              ),
            )
          )}
          <label>
            Maximum model states
            <input
              className="text-input"
              aria-label="Maximum model states"
              type="number"
              min="1"
              max="100000"
              value={
                typeof scope.maxStates === "number" ? scope.maxStates : 5000
              }
              onChange={(e) =>
                onChange(
                  JSON.stringify(
                    { ...scope, maxStates: Number(e.target.value) },
                    null,
                    2,
                  ),
                )
              }
            />
          </label>
          <p className="muted">
            Exhausting this construction budget is reported as incomplete. It
            never means the smaller model passed.
          </p>
        </>
      )}
      {invalid && (
        <p role="alert">
          The scope is not valid JSON. Correct it in the advanced editor before
          running.
        </p>
      )}
      <button
        type="button"
        className="text-link"
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? "Hide advanced scope" : "Advanced scope JSON"}
      </button>
      {(advanced || invalid) && (
        <label>
          Finite scope JSON
          <textarea
            aria-label="Finite scope JSON"
            className="scope-editor"
            value={value}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      )}
    </section>
  );
}
