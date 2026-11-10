// Example fourth target. Invoked only by an explicit --plugin option.
export const apiVersion = "pymtheg.emitter/v1";
export const target = "javascript";
export const extension = ".js";
export function emit(document) {
  const bodyPolicy = document.bodyPolicy ?? "fail-fast";
  const outputMode = document.outputMode ?? "stubs";
  if (!["stubs", "contracts"].includes(outputMode))
    throw Error("Unsupported output mode");
  if (!["empty", "fail-fast"].includes(bodyPolicy))
    throw Error("Unsupported body policy");
  const reserved = new Set(
    "PymthegContracts Error Promise await yield break case catch continue debugger do else finally for if in instanceof switch throw try typeof while with default class function delete new return var let const export import extends super this void null true false eval arguments".split(
      " ",
    ),
  );
  const names = new Map(),
    used = new Set();
  const allocate = (raw) => {
    let name = reserved.has(raw) ? raw + "Contract" : raw;
    const base = name;
    let suffix = 2;
    while (used.has(name)) name = base + suffix++;
    used.add(name);
    return name;
  };
  for (const d of document.declarations)
    names.set(d.symbolId, allocate(d.name));
  const clean = (text) =>
    text.replaceAll("*/", "* /").replaceAll("\n", " ").replaceAll("\r", " ");
  function type(t) {
    switch (t.kind) {
      case "primitive":
        return {
          Bool: "boolean",
          Int: "bigint",
          Nat: "bigint",
          String: "string",
          Unit: "void",
        }[t.name];
      case "named":
        return names.get(t.symbolId);
      case "list":
        return `ReadonlyArray<${type(t.element)}>`;
      case "result":
        return `({tag: "Ok", value: ${type(t.ok)}} | ${type(t.error)})`;
      default:
        throw Error("Unsupported contract type");
    }
  }
  const lines = [
    bodyPolicy === "fail-fast"
      ? "// Generated JavaScript/JSDoc scaffold. Stubs fail until implemented."
      : "// Generated JavaScript/JSDoc scaffold. Bodies are intentionally empty.",
    "// JSDoc contracts, effects and ownership require implementation and checking.",
    "",
  ];
  const symbols = [];
  for (const d of document.declarations) {
    const name = names.get(d.symbolId);
    symbols.push({ name, symbolId: d.symbolId });
    lines.push(...d.notes.map((n) => "// " + clean(n)));
    if (d.kind === "record")
      lines.push(
        `/** @typedef {{${d.fields.map((f) => `${JSON.stringify(f.name)}: ${type(f.type)}`).join(", ")}}} ${name} */`,
      );
    else if (d.kind === "union")
      lines.push(
        `/** @typedef {${d.variants.map((v) => `{tag: ${JSON.stringify(v.name)}${v.payload ? `, value: ${type(v.payload)}` : ""}}`).join(" | ")}} ${name} */`,
      );
    else if (d.kind === "resource")
      lines.push(
        `/** @typedef {{resourceKind: ${JSON.stringify(d.name)}, state: ${d.states.map((s) => JSON.stringify(s)).join(" | ")}}} ${name} */`,
      );
    else if (d.kind === "callable") {
      const resultType = d.maySuspend
        ? `Promise<${type(d.result)}>`
        : type(d.result);
      const local = new Set();
      const params = d.parameters.map((p, i) => {
        let n = reserved.has(p.name) ? "arg" + i : p.name;
        while (local.has(n)) n += "_";
        local.add(n);
        return n;
      });
      if (outputMode === "contracts") {
        lines.push(
          `/** @typedef {function(${d.parameters.map((p) => type(p.type)).join(", ")}): ${resultType}} ${name} */`,
        );
        continue;
      }
      lines.push(
        "/**",
        ...d.parameters.map(
          (p, i) => ` * @param {${type(p.type)}} ${params[i]}`,
        ),
        ` * @returns {${resultType}}`,
        " */",
        `export ${d.maySuspend ? "async " : ""}function ${name}(${params.join(", ")}) {`,
        bodyPolicy === "fail-fast"
          ? '  throw new Error("Not implemented");'
          : "  // Implementation intentionally left empty.",
        "}",
      );
    } else throw Error("Unsupported contract declaration");
    lines.push("");
  }
  if (outputMode === "contracts")
    lines.push(
      `/** @typedef {{${document.declarations
        .filter((d) => d.kind === "callable")
        .map((d) => `${JSON.stringify(d.name)}: ${names.get(d.symbolId)}`)
        .join(", ")}}} PymthegContracts */`,
    );
  return {
    bodyPolicy,
    outputMode,
    source: lines.join("\n") + "\n",
    symbols,
    dependencies: [],
    notes: [
      "JavaScript/JSDoc is an example external emitter, not a built-in checked backend.",
      "Bigint preserves integer precision; Nat nonnegativity and return values still require implementation.",
    ],
  };
}
