import { ProjectTypeContext, ProjectTypeSearch } from "./ProjectTypeSearch";
import { typeChoices } from "../../src/studio/type-choices";
import { useDraftUpdate, type DraftUpdate } from "./useDraftUpdate";
import { useContext, useState } from "react";
import {
  appendDefinitionMember,
  type InterfaceType,
} from "../../src/studio/interface-builder";
const labels = {
  unselected: "Choose a type…",
  Nat: "Nonnegative whole number",
  Int: "Whole number",
  String: "Text",
  Bool: "Yes or no",
  Unit: "No returned value",
  record: "Record with fields",
  list: "List of values",
  choice: "Named outcomes",
  result: "Success or error",
  named: "Existing named type",
};
function suggested(value: string) {
  return (value.replace(/[^A-Za-z0-9_]/g, "") || "Value").replace(/^./, (c) =>
    c.toUpperCase(),
  );
}
export function InterfaceTypeEditor({
  label,
  value,
  onChange: onValueChange,
  depth = 0,
  allowUnit = true,
  onlyOutcomes = false,
  knownTypes = [],
  lockDefinition = false,
  definitionsOnly = false,
}: {
  label: string;
  value: InterfaceType;
  onChange: DraftUpdate<InterfaceType>;
  depth?: number;
  allowUnit?: boolean;
  onlyOutcomes?: boolean;
  knownTypes?: {
    name: string;
    kind: "record" | "choice" | "resource";
    symbolId?: string;
    file?: string;
  }[];
  lockDefinition?: boolean;
  definitionsOnly?: boolean;
}) {
  const update = useDraftUpdate(value, onValueChange);
  const onChange = (next: InterfaceType) => update(() => next);
  type Compound = Exclude<InterfaceType, string>;
  const edit = <K extends Compound["kind"]>(
    kind: K,
    change: (current: Extract<Compound, { kind: K }>) => InterfaceType,
  ) =>
    update((current) =>
      typeof current !== "string" && current.kind === kind
        ? change(current as Extract<Compound, { kind: K }>)
        : current,
    );
  const projectTypeContext = useContext(ProjectTypeContext);
  const [typeQuery, setTypeQuery] = useState("");
  const available = knownTypes.filter(
    (t) => !onlyOutcomes || t.kind === "choice",
  );
  const selected = typeof value === "string" ? value : value.kind;
  const choices = typeChoices(
    available,
    typeQuery,
    typeof value !== "string" && value.kind === "named" ? value : { name: "" },
  );
  const visible = choices.items;
  const choose = (kind: string) => {
    const name = suggested(label);
    switch (kind) {
      case "unselected":
        onChange({ kind });
        break;
      case "list":
        onChange({ kind, element: { kind: "unselected" } });
        break;
      case "record":
        onChange({
          kind,
          name,
          fields: [{ name: "id", type: { kind: "unselected" } }],
        });
        break;
      case "choice":
        onChange({
          kind,
          name: name + "Outcomes",
          variants: [{ name: "Approved" }, { name: "Declined" }],
        });
        break;
      case "result":
        onChange({
          kind,
          ok: { kind: "unselected" },
          error: {
            kind: "choice",
            name: name + "Errors",
            variants: [{ name: "Declined" }, { name: "Unavailable" }],
          },
        });
        break;
      case "named":
        onChange({
          kind,
          name: available.length === 1 ? available[0]!.name : "",
          ...(available.length === 1 && available[0]?.symbolId
            ? { symbolId: available[0].symbolId }
            : {}),
        });
        break;
      default:
        onChange(kind as InterfaceType);
    }
  };
  const types = definitionsOnly
    ? ["record", "choice"]
    : onlyOutcomes
      ? [
          "choice",
          ...(available.length || selected === "named" || projectTypeContext
            ? ["named"]
            : []),
        ]
      : [
          "Nat",
          "Int",
          "String",
          "Bool",
          ...(allowUnit ? ["Unit"] : []),
          ...(depth < 4
            ? [
                "record",
                "list",
                "choice",
                "result",
                ...(available.length ||
                selected === "named" ||
                projectTypeContext
                  ? ["named"]
                  : []),
              ]
            : []),
        ];
  return (
    <div className="interface-type-editor">
      <label>
        {label} type
        <select
          aria-label={label + " type"}
          disabled={lockDefinition}
          value={selected}
          onChange={(e) => choose(e.target.value)}
        >
          {!definitionsOnly && (
            <option value="unselected">{labels.unselected}</option>
          )}
          {types.map((type) => (
            <option key={type} value={type}>
              {labels[type as keyof typeof labels]}
            </option>
          ))}
        </select>
      </label>
      {selected === "unselected" && (
        <p className="muted">
          Choose the kind of value before previewing. This choice is still
          unfinished.
        </p>
      )}
      {typeof value !== "string" && value.kind === "named" && (
        <>
          <ProjectTypeSearch
            onlyOutcomes={onlyOutcomes}
            onChoose={(item) =>
              onChange({
                kind: "named",
                name: item.name,
                symbolId: item.symbolId,
              })
            }
          />
          {available.length > 25 && (
            <label>
              Find {label.toLowerCase()} type
              <input
                value={typeQuery}
                onChange={(e) => setTypeQuery(e.target.value)}
                placeholder="Search available types"
              />
            </label>
          )}
          <label>
            {label} type name
            <select
              aria-label={label + " type name"}
              value={choices.selectedValue}
              onChange={(event) => {
                const chosen = visible.find(
                  (t) => t.value === event.target.value,
                );
                if (chosen)
                  onChange({
                    kind: "named",
                    name: chosen.name,
                    ...(chosen.symbolId ? { symbolId: chosen.symbolId } : {}),
                  });
              }}
            >
              {!choices.selectedValue && (
                <option value="">
                  {value.name || "Choose a defined type"}
                </option>
              )}
              {visible.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          {available.length > 25 && (
            <p className="muted">
              Showing up to 25 matches and the selected type. Search to find
              another type.
            </p>
          )}
        </>
      )}
      {typeof value !== "string" && value.kind === "list" && (
        <fieldset>
          <legend>{label} items</legend>
          <InterfaceTypeEditor
            label={label + " item"}
            value={value.element}
            onChange={(element) =>
              edit("list", (current) => ({
                ...current,
                element: element(current.element),
              }))
            }
            knownTypes={knownTypes}
            depth={depth + 1}
          />
        </fieldset>
      )}
      {typeof value !== "string" && value.kind === "record" && (
        <fieldset>
          <legend>{label} fields</legend>
          <label>
            {label} record name
            <input
              value={value.name}
              disabled={lockDefinition}
              onChange={(e) =>
                edit("record", (current) => ({
                  ...current,
                  name: e.target.value,
                }))
              }
            />
          </label>
          {value.fields.map((field, index) => (
            <div className="interface-field" key={index}>
              <label>
                {label} field {index + 1} name
                <input
                  value={field.name}
                  onChange={(e) =>
                    edit("record", (current) => ({
                      ...current,
                      fields: current.fields.map((f, i) =>
                        i === index ? { ...f, name: e.target.value } : f,
                      ),
                    }))
                  }
                />
              </label>
              <InterfaceTypeEditor
                label={`${label} field ${index + 1}`}
                value={field.type}
                knownTypes={knownTypes}
                depth={depth + 1}
                onChange={(type) =>
                  edit("record", (current) => ({
                    ...current,
                    fields: current.fields.map((f, i) =>
                      i === index ? { ...f, type: type(f.type) } : f,
                    ),
                  }))
                }
              />
              <button
                type="button"
                disabled={value.fields.length === 1}
                onClick={() =>
                  edit("record", (current) => ({
                    ...current,
                    fields: current.fields.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove field {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={value.fields.length >= 20}
            onClick={() =>
              edit("record", (current) => appendDefinitionMember(current))
            }
          >
            Add {label} field
          </button>
        </fieldset>
      )}
      {typeof value !== "string" && value.kind === "choice" && (
        <fieldset>
          <legend>{label} outcomes</legend>
          <label>
            {label} outcomes name
            <input
              value={value.name}
              disabled={lockDefinition}
              onChange={(e) =>
                edit("choice", (current) => ({
                  ...current,
                  name: e.target.value,
                }))
              }
            />
          </label>
          {value.variants.map((variant, index) => (
            <div className="interface-field" key={index}>
              <label>
                {label} outcome {index + 1} name
                <input
                  value={variant.name}
                  onChange={(e) =>
                    edit("choice", (current) => ({
                      ...current,
                      variants: current.variants.map((v, i) =>
                        i === index ? { ...v, name: e.target.value } : v,
                      ),
                    }))
                  }
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={variant.payload !== undefined}
                  onChange={(e) =>
                    edit("choice", (current) => ({
                      ...current,
                      variants: current.variants.map((v, i) =>
                        i === index
                          ? e.target.checked
                            ? { ...v, payload: { kind: "unselected" } }
                            : { name: v.name }
                          : v,
                      ),
                    }))
                  }
                />
                {label} outcome {index + 1} carries a value
              </label>
              {variant.payload !== undefined && (
                <InterfaceTypeEditor
                  label={`${label} outcome ${index + 1} value`}
                  value={variant.payload}
                  knownTypes={knownTypes}
                  depth={depth + 1}
                  onChange={(payload) =>
                    edit("choice", (current) => ({
                      ...current,
                      variants: current.variants.map((v, i) =>
                        i === index && v.payload !== undefined
                          ? { ...v, payload: payload(v.payload) }
                          : v,
                      ),
                    }))
                  }
                />
              )}
              <button
                type="button"
                disabled={value.variants.length === 1}
                onClick={() =>
                  edit("choice", (current) => ({
                    ...current,
                    variants: current.variants.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove outcome {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={value.variants.length >= 20}
            onClick={() =>
              edit("choice", (current) => appendDefinitionMember(current))
            }
          >
            Add {label} outcome
          </button>
        </fieldset>
      )}
      {typeof value !== "string" && value.kind === "result" && (
        <fieldset>
          <legend>{label}: success or declared error</legend>
          <InterfaceTypeEditor
            label={label + " success"}
            value={value.ok}
            knownTypes={knownTypes}
            depth={depth + 1}
            onChange={(ok) =>
              edit("result", (current) => ({ ...current, ok: ok(current.ok) }))
            }
          />
          <InterfaceTypeEditor
            label={label + " error"}
            value={value.error}
            knownTypes={knownTypes}
            depth={depth + 1}
            onlyOutcomes
            onChange={(error) =>
              edit("result", (current) => ({
                ...current,
                error: error(current.error),
              }))
            }
          />
        </fieldset>
      )}
    </div>
  );
}
