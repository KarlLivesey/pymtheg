// SPDX-License-Identifier: MIT
// C-19: print the SCIP occurrences on one source line (for hand checks).
// Usage: node occurrences.mjs INDEX.scip FILE LINE(1-based)
import { readScip } from "./scip.mjs";
const [index, file, line] = process.argv.slice(2);
const { documents } = readScip(index);
const doc = documents.find((d) => d.path === file);
if (!doc) throw Error("no document " + file);
for (const o of doc.occurrences) if (o.range[0] === Number(line) - 1) console.log(JSON.stringify(o.range), o.roles, o.symbol);
