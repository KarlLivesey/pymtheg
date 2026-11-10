import type { SymbolView } from "./protocol.js";
/** Suggest only unambiguous in-scope value inputs; all other placeholders remain explicit holes. */
export function callableSnippet(
  symbol: SymbolView,
  caller?: SymbolView,
): string {
  const shape = symbol.callable;
  if (!shape) return symbol.name;
  const statement = symbol.kind === "flow" || symbol.kind === "op";
  const args = shape.parameters
    .map((p) => {
      const compatible = (caller?.callable?.parameters ?? []).filter(
        (candidate) => {
          if (p.typeKey && candidate.typeKey)
            return p.typeKey === candidate.typeKey;
          // Older saved runs have no resolved identity. Primitive shapes remain
          // unambiguous, but nominal/unsupported lookalikes must stay as holes.
          return (
            ["bool", "nat", "int", "string", "unit"].includes(p.shape.kind) &&
            p.shape.kind === candidate.shape.kind
          );
        },
      );
      const sameName = compatible.find(
        (candidate) => candidate.name === p.name,
      );
      const suggested =
        p.mode === "take"
          ? undefined
          : (sameName ?? (compatible.length === 1 ? compatible[0] : undefined));
      return (
        (p.mode && p.mode !== "value" ? p.mode + " " : "") +
        "${" +
        (suggested?.name ?? 'unknown "Value for ' + p.name + '"') +
        "}"
      );
    })
    .join(", ");
  const invocation =
    (statement ? "call " : "") + symbol.name + "(" + args + ")";
  if (!statement) return invocation;
  if (shape.result.kind === "unit") return invocation + ";";
  const binding = invocation + " as ${result};";
  if (shape.result.kind !== "tagged") return binding;
  return (
    binding +
    "\nmatch ${result} {\n" +
    shape.result.variants
      .map(
        (v) =>
          "  " +
          v.tag +
          (v.payload ? "(${" + v.tag.toLowerCase() + "Value})" : "") +
          " => {\n    " +
          (!caller?.callable || caller.callable.result.kind !== "unit"
            ? "return "
            : "") +
          'unknown "Handle ' +
          v.tag +
          '";\n  }',
      )
      .join("\n") +
    "\n}"
  );
}
