// SPDX-License-Identifier: MIT
// C-19: summary of one SCIP index: documents, occurrences, roles, symbol
// kinds, crates named by references, and a few sample symbols.
// Usage: node inspect.mjs INDEX.scip
import { readScip, parseSymbol } from "./scip.mjs";

const { documents, external } = readScip(process.argv[2]);
let occurrences = 0;
let definitions = 0;
const crates = new Map();
const kinds = new Map();
const samples = [];
for (const d of documents) {
  for (const o of d.occurrences) {
    occurrences++;
    if (o.roles & 1) definitions++;
    const p = parseSymbol(o.symbol);
    const c = p.local ? "(local)" : p.crate + " " + p.version;
    crates.set(c, (crates.get(c) ?? 0) + 1);
    if (samples.length < 25 && !p.local && Math.random() < 0.002) samples.push(o.symbol);
  }
  for (const s of d.symbols) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
}
for (const s of external) kinds.set("ext:" + s.kind, (kinds.get("ext:" + s.kind) ?? 0) + 1);
console.log({ documents: documents.length, occurrences, definitions, external: external.length });
console.log("paths sample", documents.slice(0, 5).map((d) => d.path));
console.log("top crates", [...crates].sort((a, b) => b[1] - a[1]).slice(0, 25));
console.log("kinds", [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 30));
console.log(samples.join("\n"));
