// SPDX-License-Identifier: MIT
// List computed-key calls whose selected signature is a named checkout
// function or method, with the key expression and its declaration.
// Usage: node keys.mjs ROWS.jsonl RESULTS.json SWEEP_SCRATCH
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [rowsPath, results, scratch] = process.argv.slice(2);
const attempts = new Map(JSON.parse(readFileSync(results, "utf8")).repos.map((r) => [r.id, r.attempt]));
const texts = new Map();
for (const line of readFileSync(rowsPath, "utf8").split("\n")) {
  if (!line) continue;
  const r = JSON.parse(line);
  const d = r.diag;
  if (!d || d.calleeKind !== "ElementAccessExpression" || !/^(MethodDeclaration|FunctionDeclaration)@checkout$/.test(d.signature ?? "")) continue;
  const path = join(scratch, attempts.get(r.pin), "checkout", r.file);
  let text = texts.get(path);
  if (text === undefined) texts.set(path, (text = readFileSync(path, "utf8")));
  const callee = text.slice(r.start, r.end);
  const key = /\[([^\]]*)\]\s*$/.exec(callee)?.[1] ?? "?";
  const id = /^[A-Za-z_$][\w$]*$/.test(key) ? key : undefined;
  const decl = id && new RegExp(`(const|let|var)\\s+${id.replace(/\$/g, "\\$")}\\b[^\\n]*`).exec(text)?.[0];
  console.log(`${r.pin} ${r.file}:${text.slice(0, r.start).split("\n").length} ${callee.slice(-80)} | key=${key} | ${decl ? decl.slice(0, 90) : "(key not declared in file)"}`);
}
