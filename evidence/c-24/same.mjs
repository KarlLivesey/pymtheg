// SPDX-License-Identifier: MIT
// C-24: compare normalised store dumps. Prints, for every dump after the
// first, whether it is byte-identical to the first, and otherwise the lines
// only one side has (at most LIMIT of each, default 20).
// Usage: node same.mjs A.dump.gz B.dump.gz [C.dump.gz ...]
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const limit = Number(process.env.LIMIT ?? 20);
const [first, ...rest] = process.argv.slice(2);
const read = (path) => gunzipSync(readFileSync(path)).toString("utf8");
const base = read(first);
const digest = (text) =>
  createHash("sha256").update(text).digest("hex").slice(0, 16);
console.log(first, digest(base), base.split("\n").length - 1, "lines");
const baseLines = new Set(base.split("\n"));
for (const path of rest) {
  const text = read(path);
  if (text === base) {
    console.log(path, digest(text), "identical");
    continue;
  }
  const lines = new Set(text.split("\n"));
  const gone = [...baseLines].filter((l) => !lines.has(l));
  const added = [...lines].filter((l) => !baseLines.has(l));
  console.log(path, digest(text), `differs: -${gone.length} +${added.length}`);
  for (const l of gone.slice(0, limit)) console.log("  -", l.slice(0, 600));
  for (const l of added.slice(0, limit)) console.log("  +", l.slice(0, 600));
}
