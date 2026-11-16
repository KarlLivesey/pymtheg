// SPDX-License-Identifier: MIT
import { recursiveLayout } from "./layout.js";
import type { ScaffoldBodyMode } from "../shared/outputs.js";
import type { ContractDocument, ContractType } from "./document.js";
import {
  nameMap,
  outputNames,
  cleanComment,
  type Emission,
} from "./scaffold.js";
const rustReserved = new Set(
  "PymthegContracts bool std num_bigint _ as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield try".split(
    " ",
  ),
);
const goReserved = new Set(
  "PymthegContracts panic big _ break default func interface select case defer go map struct chan else goto package switch const fallthrough if range type continue for import return var Result ResultOk ResultErr".split(
    " ",
  ),
);
const upper = (name: string) => {
  const publicName = name.replace(/^_+/, "");
  if (!publicName) return "Value";
  if (/^[0-9]/.test(publicName)) return "Value" + publicName;
  return publicName.charAt(0).toUpperCase() + publicName.slice(1);
};
function allocator(initial: Iterable<string>) {
  const used = new Set(initial);
  return (raw: string) => {
    let name = raw,
      n = 2;
    while (used.has(name)) name = raw + n++;
    used.add(name);
    return name;
  };
}
function localNames(
  names: string[],
  reserved: ReadonlySet<string>,
  transform = (s: string) => s,
  reservedSuffix = "Value",
) {
  return outputNames(names, reserved, transform, reservedSuffix);
}
const snake = (name: string) =>
  name
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
function hasIntegers(t: ContractType): boolean {
  switch (t.kind) {
    case "primitive":
      return t.name === "Int" || t.name === "Nat";
    case "named":
      return false;
    case "list":
      return hasIntegers(t.element);
    case "result":
      return hasIntegers(t.ok) || hasIntegers(t.error);
  }
}
function types(doc: ContractDocument): ContractType[] {
  return doc.declarations.flatMap((d) =>
    d.kind === "record"
      ? d.fields.map((f) => f.type)
      : d.kind === "union"
        ? d.variants.flatMap((v) => (v.payload ? [v.payload] : []))
        : d.kind === "callable"
          ? [...d.parameters.map((p) => p.type), d.result]
          : [],
  );
}
export function emitRust(
  doc: ContractDocument,
  body: ScaffoldBodyMode,
): Emission {
  const layout = recursiveLayout(doc, "rust");
  const names = nameMap(doc, rustReserved, (name, d) => {
      if (d.kind !== "callable") return name;
      const callable = snake(name);
      return rustReserved.has(callable) ? callable + "_contract" : callable;
    }),
    alloc = allocator(names.values()),
    symbols: Emission["symbols"] = [],
    integers = types(doc).some(hasIntegers);
  const type = (t: ContractType, owner?: string): string => {
    switch (t.kind) {
      case "primitive":
        return {
          Bool: "bool",
          Int: "num_bigint::BigInt",
          Nat: "num_bigint::BigUint",
          String: "std::string::String",
          Unit: "()",
        }[t.name];
      case "named":
        return layout.needsIndirection(owner, t.symbolId)
          ? `std::boxed::Box<${names.get(t.symbolId)!}>`
          : names.get(t.symbolId)!;
      case "list":
        return `std::vec::Vec<${type(t.element)}>`;
      case "result":
        return `std::result::Result<${type(t.ok, owner)}, ${type(t.error, owner)}>`;
    }
  };
  const contractsOnly = doc.outputMode === "contracts",
    methods: string[] = [];
  const lines = [
    contractsOnly
      ? "// Generated contracts. Implement PymthegContracts separately; regenerate this file safely."
      : body === "fail-fast"
        ? "// Generated from a frozen Pymtheg specification; stubs fail until implemented."
        : "// Generated from a frozen Pymtheg specification; bodies are intentionally empty.",
    "// Contracts are not implementation proofs.",
    ...(layout.recursive
      ? [
          "// Recursive inline fields use Box for finite Rust layout; source contracts remain obligations.",
        ]
      : []),
    ...(integers
      ? [
          '// Add num-bigint = "0.4" to Cargo.toml for arbitrary-precision integers.',
        ]
      : []),
    "",
  ];
  for (const d of doc.declarations) {
    const name = names.get(d.symbolId)!;
    symbols.push({ name, symbolId: d.symbolId });
    if (!(contractsOnly && d.kind === "callable"))
      lines.push(...d.notes.map((n) => "// " + cleanComment(n)));
    switch (d.kind) {
      case "record": {
        const fields = localNames(
          d.fields.map((f) => f.name),
          rustReserved,
          snake,
          "_value",
        );
        lines.push(
          "#[derive(Debug, Clone, PartialEq)]",
          `pub struct ${name} {`,
          ...d.fields.map(
            (f, i) => `    pub ${fields[i]}: ${type(f.type, d.symbolId)},`,
          ),
          "}",
        );
        break;
      }
      case "union": {
        const variants = localNames(
          d.variants.map((v) => v.name),
          rustReserved,
        );
        lines.push(
          "#[derive(Debug, Clone, PartialEq)]",
          `pub enum ${name} {`,
          ...d.variants.map(
            (v, i) =>
              `    ${variants[i]}${v.payload ? `(${type(v.payload, d.symbolId)})` : ""},`,
          ),
          "}",
        );
        break;
      }
      case "resource": {
        const state = alloc(name + "State");
        lines.push(
          "#[derive(Debug, Clone, PartialEq)]",
          `pub enum ${state} {`,
          ...localNames(d.states, rustReserved).map((s) => `    ${s},`),
          "}",
          "#[derive(Debug, Clone, PartialEq)]",
          `pub struct ${name} {`,
          `    pub state: ${state},`,
          "}",
        );
        break;
      }
      case "callable": {
        const ps = localNames(
          d.parameters.map((p) => p.name),
          rustReserved,
          snake,
          "_value",
        );
        if (contractsOnly) {
          methods.push(
            ...d.notes.map((n) => "    // " + cleanComment(n)),
            `    fn ${name}(&self${d.parameters.length ? ", " : ""}${d.parameters.map((p, i) => `${ps[i]}: ${p.mode === "borrow" ? "&" : ""}${type(p.type)}`).join(", ")}) -> ${type(d.result)};`,
          );
          break;
        }
        lines.push(
          "#[allow(unused_variables)]",
          `pub fn ${name}(${d.parameters.map((p, i) => `${ps[i]}: ${p.mode === "borrow" ? "&" : ""}${type(p.type)}`).join(", ")}) -> ${type(d.result)} {`,
          body === "fail-fast"
            ? '    todo!("Not implemented");'
            : "    // Implementation intentionally left empty.",
          "}",
        );
        break;
      }
    }
    lines.push("");
  }
  if (contractsOnly)
    lines.push("pub trait PymthegContracts {", ...methods, "}", "");
  return {
    source: lines.join("\n"),
    symbols,
    dependencies: integers ? ["num-bigint 0.4"] : [],
    notes: [
      "Rust owns value/take parameters and borrows borrow parameters; domain lifecycle rules still need implementation.",
      "Arbitrary-precision integers are never silently narrowed to i64 or u64.",
      ...(layout.recursive
        ? [
            "Recursive value storage uses Box; no allocation or construction logic is generated.",
          ]
        : []),
      contractsOnly
        ? "Implement PymthegContracts separately; regenerating this file does not rewrite implementation bodies."
        : body === "fail-fast"
          ? "Every callable fails with Not implemented; no business logic is generated."
          : "Empty non-unit functions fail return checking until implemented.",
    ],
  };
}
export function emitGo(
  doc: ContractDocument,
  body: ScaffoldBodyMode,
): Emission {
  const layout = recursiveLayout(doc, "go");
  const names = nameMap(doc, goReserved, upper),
    alloc = allocator([...names.values(), "Result", "ResultOk", "ResultErr"]),
    symbols: Emission["symbols"] = [],
    integers = types(doc).some(hasIntegers);
  const type = (t: ContractType, owner?: string): string => {
    switch (t.kind) {
      case "primitive":
        return {
          Bool: "bool",
          Int: "*big.Int",
          Nat: "*big.Int",
          String: "string",
          Unit: "struct{}",
        }[t.name];
      case "named":
        return (
          (layout.needsIndirection(owner, t.symbolId) ? "*" : "") +
          names.get(t.symbolId)!
        );
      case "list":
        return `[]${type(t.element)}`;
      case "result":
        return `Result[${type(t.ok)}, ${type(t.error)}]`;
    }
  };
  const contractsOnly = doc.outputMode === "contracts",
    methods: string[] = [];
  const lines = [
    contractsOnly
      ? "// Generated contracts. Implement PymthegContracts separately; regenerate this file safely."
      : body === "fail-fast"
        ? "// Generated from a frozen Pymtheg specification; stubs fail until implemented."
        : "// Generated from a frozen Pymtheg specification; bodies are intentionally empty.",
    "// Nat nonnegativity, ownership, effects and lifecycle obligations require implementation.",
    ...(layout.recursive
      ? [
          "// Recursive record fields use pointers; nil validity must follow the source contract.",
        ]
      : []),
    "package contracts",
    "",
    ...(integers ? ['import "math/big"', ""] : []),
    "type Result[S any, E any] interface { isResult(S, E) }",
    "type ResultOk[S any, E any] struct { Value S }",
    "type ResultErr[S any, E any] struct { Value E }",
    "func (ResultOk[S, E]) isResult(S, E) {}",
    "func (ResultErr[S, E]) isResult(S, E) {}",
    "",
  ];
  for (const d of doc.declarations) {
    const name = names.get(d.symbolId)!;
    symbols.push({ name, symbolId: d.symbolId });
    if (!(contractsOnly && d.kind === "callable"))
      lines.push(...d.notes.map((n) => "// " + cleanComment(n)));
    switch (d.kind) {
      case "record": {
        const fields = localNames(
          d.fields.map((f) => f.name),
          goReserved,
          upper,
        );
        lines.push(
          `type ${name} struct {`,
          ...d.fields.map(
            (f, i) =>
              `    ${fields[i]} ${type(f.type, d.symbolId)} // source field: ${cleanComment(f.name)}`,
          ),
          "}",
        );
        break;
      }
      case "union": {
        const marker = "is" + name;
        lines.push(`type ${name} interface { ${marker}() }`);
        for (const v of d.variants) {
          const variant = alloc(name + "_" + upper(v.name));
          lines.push(
            `type ${variant} struct { ${v.payload ? "Value " + type(v.payload) : ""} }`,
            `func (${variant}) ${marker}() {}`,
          );
        }
        break;
      }
      case "resource": {
        const state = alloc(name + "State");
        lines.push(
          `type ${state} string`,
          "const (",
          ...d.states.map(
            (s) =>
              `    ${alloc(state + "_" + upper(s))} ${state} = ${JSON.stringify(s)}`,
          ),
          ")",
          `type ${name} struct { State ${state} }`,
        );
        break;
      }
      case "callable": {
        const ps = localNames(
          d.parameters.map((p) => p.name),
          goReserved,
        );
        if (contractsOnly) {
          methods.push(
            ...d.notes.map((n) => "    // " + cleanComment(n)),
            `    ${name}(${d.parameters.map((p, i) => `${ps[i]} ${p.mode === "borrow" ? "*" : ""}${type(p.type)}`).join(", ")})${d.result.kind === "primitive" && d.result.name === "Unit" ? "" : " " + type(d.result)}`,
          );
          break;
        }
        lines.push(
          `func ${name}(${d.parameters.map((p, i) => `${ps[i]} ${p.mode === "borrow" ? "*" : ""}${type(p.type)}`).join(", ")})${d.result.kind === "primitive" && d.result.name === "Unit" ? "" : " " + type(d.result)} {`,
          body === "fail-fast"
            ? '    panic("Not implemented")'
            : "    // Implementation intentionally left empty.",
          "}",
        );
        break;
      }
    }
    lines.push("");
  }
  if (contractsOnly)
    lines.push(
      "type PymthegContracts interface {",
      ...methods,
      "}",
      "",
      "// Required in your implementation file to check this interface:",
      "// var _ PymthegContracts = (*YourImplementation)(nil)",
      "",
    );
  return {
    source: lines.join("\n"),
    symbols,
    dependencies: integers ? ["Go standard library math/big"] : [],
    notes: [
      "Go has no affine ownership or immutable slices; take/borrow and nonnegativity remain documented obligations.",
      "Tagged unions use sealed interfaces and empty marker methods; no business implementation is generated.",
      ...(layout.recursive
        ? [
            "Recursive records use pointers for finite layout; nil is not automatically a valid source value.",
          ]
        : []),
      contractsOnly
        ? "Implement PymthegContracts separately; regenerating this file does not rewrite implementation bodies."
        : body === "fail-fast"
          ? "Every callable fails with Not implemented; no business logic is generated."
          : "Empty functions with result values fail return checking until implemented.",
    ],
  };
}
