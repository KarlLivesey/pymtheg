import {
  defaultScaffoldBodyMode,
  type ScaffoldBodyMode,
  type OutputMode,
  outputTargetIds,
  outputTargets,
  type BuiltinTarget,
} from "../shared/outputs.js";
export type { BuiltinTarget } from "../shared/outputs.js";
import { contractManifest, type ContractManifest } from "./manifest.js";
import type { ProjectIR } from "../semantic/core.js";
import {
  contractDocument,
  type ContractDocument,
  type ContractType,
} from "./document.js";
import { emitRust, emitGo } from "./targets.js";
import { portableContractDocument } from "./portable.js";

export interface Emission {
  source: string;
  symbols: { name: string; symbolId: string }[];
  notes: string[];
  dependencies: string[];
}
export interface Scaffold extends Omit<Emission, "symbols"> {
  symbols: (Emission["symbols"][number] & {
    span: import("../shared/identity.js").Span;
  })[];
  format: string;
  extension: string;
  snapshotId: string;
  implementation: ScaffoldBodyMode | "plugin_defined" | "declarations";
  mode?: OutputMode;
  contractManifest?: ContractManifest;
  assurance: "builtin_scaffold" | "plugin_declared";
  omitted: ContractDocument["omitted"];
}
export const builtinTargets = outputTargetIds;
export const cleanComment = (s: string) =>
  s.replaceAll("*/", "* /").replaceAll("\r", "").replaceAll("\n", " ");
const tsReserved = new Set(
  "string boolean bigint number symbol object any unknown never undefined Error Promise eval arguments await yield break case catch continue debugger do else finally for if in instanceof switch throw try typeof while with private protected public package implements default class function delete new return var let const export import extends interface type enum static super this void null true false Result ReadonlyArray Parameters PymthegContracts PymthegSameInputs PymthegExactInputs PymthegImplementation".split(
    " ",
  ),
);
export function nameMap(
  doc: ContractDocument,
  reserved: ReadonlySet<string>,
  transform: (
    name: string,
    declaration: ContractDocument["declarations"][number],
  ) => string = (s) => s,
) {
  const transformed = doc.declarations.map((d) => transform(d.name, d));
  const allocated = outputNames(
    doc.declarations.map((d) => d.name),
    reserved,
    (_, i) => transformed[i]!,
    "Contract",
  );
  return new Map(doc.declarations.map((d, i) => [d.symbolId, allocated[i]!]));
}
/** Allocate transformed names without stealing another declaration's exact spelling. */
export function outputNames(
  originals: string[],
  reserved: ReadonlySet<string>,
  transform: (name: string, index: number) => string = (s) => s,
  reservedSuffix = "Value",
) {
  const transformed = originals.map(transform);
  const exact = new Set(
    originals.filter(
      (name, i) => name === transformed[i] && !reserved.has(name),
    ),
  );
  const used = new Set(reserved);
  return transformed.map((baseName, i) => {
    const base = reserved.has(baseName) ? baseName + reservedSuffix : baseName;
    let name = base;
    let n = 2;
    while (used.has(name) || (exact.has(name) && originals[i] !== name))
      name = base + n++;
    used.add(name);
    return name;
  });
}
function emitTypeScript(
  doc: ContractDocument,
  body: ScaffoldBodyMode,
): Emission {
  const names = nameMap(doc, tsReserved),
    symbols: Emission["symbols"] = [];
  const type = (t: ContractType): string => {
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
        return names.get(t.symbolId)!;
      case "list":
        return `ReadonlyArray<${type(t.element)}>`;
      case "result":
        return `Result<${type(t.ok)}, ${type(t.error)}>`;
    }
  };
  const methods: string[] = [];
  const contractsOnly = doc.outputMode === "contracts";
  const lines = [
    contractsOnly
      ? "// Generated contracts. Implement PymthegContracts in a separate file; safe to regenerate this file."
      : body === "fail-fast"
        ? "// Generated from a frozen Pymtheg specification. Stubs throw until implemented."
        : "// Generated from a frozen Pymtheg specification. Empty bodies may fail return checking.",
    "// Nat is bigint; nonnegativity, effects and ownership remain obligations.",
    "",
    'export type Result<Success, Failure> = { readonly tag: "Ok"; readonly value: Success } | Failure;',
    "",
  ];
  for (const d of doc.declarations) {
    const name = names.get(d.symbolId)!;
    symbols.push({ name, symbolId: d.symbolId });
    if (!(contractsOnly && d.kind === "callable"))
      lines.push(...d.notes.map((n) => "// " + cleanComment(n)));
    switch (d.kind) {
      case "record":
        lines.push(
          `export interface ${name} {`,
          ...d.fields.map(
            (f) => `  readonly ${JSON.stringify(f.name)}: ${type(f.type)};`,
          ),
          "}",
        );
        break;
      case "union":
        lines.push(
          `export type ${name} = ${d.variants.map((v) => `{ readonly tag: ${JSON.stringify(v.name)}${v.payload ? `; readonly value: ${type(v.payload)}` : ""} }`).join(" | ")};`,
        );
        break;
      case "resource":
        lines.push(
          `export interface ${name} {`,
          `  readonly resourceKind: ${JSON.stringify(d.name)};`,
          `  readonly state: ${d.states.map((s) => JSON.stringify(s)).join(" | ")};`,
          "}",
        );
        break;
      case "callable": {
        const names = outputNames(
          d.parameters.map((p) => p.name),
          tsReserved,
        );
        const ps = d.parameters.map((p, i) => `${names[i]}: ${type(p.type)}`);
        const resultType = d.maySuspend
          ? `Promise<${type(d.result)}>`
          : type(d.result);
        if (contractsOnly) {
          methods.push(
            ...d.notes.map((n) => "  // " + cleanComment(n)),
            `  ${name}(${ps.join(", ")}): ${resultType};`,
          );
          break;
        }
        lines.push(
          `export ${d.maySuspend ? "async " : ""}function ${name}(${ps.join(", ")}): ${resultType} {`,
          body === "fail-fast"
            ? '  throw new Error("Not implemented");'
            : "  // Implementation intentionally left empty.",
          "}",
        );
        break;
      }
    }
    lines.push("");
  }
  if (contractsOnly)
    lines.push(
      "export interface PymthegContracts {",
      ...methods,
      "}",
      "",
      "// Required in the implementation file to catch added or removed inputs:",
      "// export type ContractCheck = PymthegImplementation<YourImplementation>;",
      "// A bare implements clause permits fewer parameters in TypeScript.",
      "type PymthegSameInputs<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;",
      "type PymthegExactInputs<T extends PymthegContracts> = {",
      "  [K in keyof PymthegContracts]: PymthegSameInputs<Parameters<T[K]>, Parameters<PymthegContracts[K]>> extends true ? T[K] : never;",
      "};",
      "export type PymthegImplementation<T extends PymthegContracts & PymthegExactInputs<T>> = T;",
      "",
    );
  return {
    source: lines.join("\n").replace(/\n{3,}/g, "\n\n"),
    symbols,
    dependencies: [],
    notes: [
      contractsOnly
        ? "Implement PymthegContracts in a separate file and add export type ContractCheck = PymthegImplementation<YourImplementation> to enforce exact input lists. Regenerate this contract file after design changes."
        : body === "fail-fast"
          ? "Every callable fails with Not implemented; no business logic is generated."
          : "Function bodies are empty; return checking may fail until implemented.",
      "A checked model does not establish that handwritten code follows its contracts.",
    ],
  };
}
export function emitDocument(
  doc: ContractDocument,
  target: BuiltinTarget = "typescript",
  body: ScaffoldBodyMode = defaultScaffoldBodyMode,
): Scaffold {
  doc = portableContractDocument(doc);
  const origins = new Map(doc.declarations.map((d) => [d.symbolId, d.span]));
  const emitters = {
    typescript: emitTypeScript,
    rust: emitRust,
    go: emitGo,
  } satisfies Record<
    BuiltinTarget,
    (document: ContractDocument, body: ScaffoldBodyMode) => Emission
  >;
  const emitted = emitters[target](doc, body);
  return {
    ...emitted,
    symbols: emitted.symbols.map((s) => ({
      ...s,
      span: origins.get(s.symbolId)!,
    })),
    format: target,
    extension: outputTargets[target].extension,
    snapshotId: doc.snapshotId,
    implementation: doc.outputMode === "contracts" ? "declarations" : body,
    mode: doc.outputMode ?? "stubs",
    contractManifest: contractManifest(doc),
    assurance: "builtin_scaffold",
    omitted: doc.omitted,
  };
}
export function scaffold(
  ir: ProjectIR,
  target: BuiltinTarget = "typescript",
  body: ScaffoldBodyMode = defaultScaffoldBodyMode,
  mode: OutputMode = "stubs",
): Scaffold {
  return emitDocument(
    { ...contractDocument(ir), outputMode: mode },
    target,
    body,
  );
}
