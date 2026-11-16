// SPDX-License-Identifier: MIT
import type { ContractDocument, ContractType } from "./document.js";

/** Only output coordinates are rebased; model text and canonical IR stay intact. */
export function portableContractDocument(
  doc: ContractDocument,
  sourceFiles: readonly string[] = [],
): ContractDocument {
  if (doc.sourceRoot === ".") return doc;
  const files = sourceFiles.length
    ? sourceFiles
    : doc.declarations.map((d) => d.span.file);
  let parts = (files[0] ?? "").replaceAll("\\", "/").split("/").slice(0, -1);
  for (const file of files.slice(1)) {
    const next = file.replaceAll("\\", "/").split("/").slice(0, -1);
    let i = 0;
    while (i < parts.length && parts[i] === next[i]) i++;
    parts = parts.slice(0, i);
  }
  const root = (doc.sourceRoot ?? parts.join("/")).replaceAll("\\", "/");
  const coordinate = (value: string) => {
    const path = value.replaceAll("\\", "/");
    if (!root || root === "." || !path.startsWith("/")) return value;
    const base = root.split("/").filter(Boolean),
      target = path.split("/").filter(Boolean);
    let i = 0;
    while (i < base.length && base[i] === target[i]) i++;
    return [...base.slice(i).map(() => ".."), ...target.slice(i)].join("/");
  };
  const type = (value: ContractType): ContractType => {
    switch (value.kind) {
      case "named":
        return { ...value, symbolId: coordinate(value.symbolId) };
      case "list":
        return { ...value, element: type(value.element) };
      case "result":
        return { ...value, ok: type(value.ok), error: type(value.error) };
      case "primitive":
        return value;
    }
  };
  return {
    ...doc,
    sourceRoot: ".",
    declarations: doc.declarations.map((d) => {
      const origin = {
        ...d,
        symbolId: coordinate(d.symbolId),
        span: { ...d.span, file: coordinate(d.span.file) },
      };
      switch (d.kind) {
        case "record":
          return {
            ...origin,
            kind: d.kind,
            fields: d.fields.map((f) => ({ ...f, type: type(f.type) })),
          };
        case "union":
          return {
            ...origin,
            kind: d.kind,
            variants: d.variants.map((v) => ({
              ...v,
              payload: v.payload ? type(v.payload) : null,
            })),
          };
        case "callable":
          return {
            ...origin,
            kind: d.kind,
            parameters: d.parameters.map((p) => ({ ...p, type: type(p.type) })),
            result: type(d.result),
          };
        case "resource":
          return {
            ...origin,
            kind: d.kind,
            states: d.states,
            initial: d.initial,
            terminal: d.terminal,
          };
      }
    }),
    omitted: doc.omitted.map((o) => ({ ...o, name: coordinate(o.name) })),
  };
}
