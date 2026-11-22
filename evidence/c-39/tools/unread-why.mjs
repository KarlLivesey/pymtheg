// SPDX-License-Identifier: MIT
// C-39 review: for each failed TypeScript file of a pin, say which part of
// the item 4 rule (index.ts `unreadFacts`) it fails: not provably a module,
// a declare/global/namespace/module token, a triple-slash reference, a \u
// escape, a JSX runtime pragma, or an import without a literal specifier.
// The module check uses the default compiler options (no program here).
// Usage: node unread-why.mjs BUILD SCRATCH RUN.json
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const [build, scratch, runPath] = process.argv.slice(2);
const { provablyModule, unreadFacts } = await import(
  pathToFileURL(resolve(build, "dist/graph/languages/typescript/index.js"))
);
const ts = (await import(pathToFileURL(resolve(build, "node_modules/typescript/lib/typescript.js")))).default;
const run = JSON.parse(readFileSync(runPath, "utf8"));
const out = {};
for (const repo of run.repos) {
  if (repo.outcome !== "finished") continue;
  const checkout = join(scratch, repo.attempt, "checkout");
  const db = new DatabaseSync(join(checkout, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  for (const { path, body } of db.prepare("SELECT path, body FROM graph_files WHERE json_extract(body,'$.module')='typescript'").iterate()) {
    if (JSON.parse(body).result?.status !== "failed") continue;
    let text;
    try { text = readFileSync(join(checkout, path), "utf8"); } catch { continue; }
    const tokens = new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []);
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
    const why = !provablyModule(source, text, {}) ? "not provably a module"
      : text.includes("\\u") ? "\\u escape"
      : /\/\/\/\s*</.test(text) ? "triple-slash directive"
      : /@jsx(?:ImportSource|Runtime)\b/.test(text) ? "JSX runtime pragma"
      : ["declare", "global", "namespace", "module"].find((t) => tokens.has(t)) ? `token ${["declare", "global", "namespace", "module"].find((t) => tokens.has(t))}`
      : unreadFacts(text, path).specifiers ? "passes (names and imports decide per link)" : "import without a literal specifier";
    const key = `${repo.id} | ${why}`;
    out[key] ??= { files: 0, examples: [] };
    out[key].files++;
    if (out[key].examples.length < 3) out[key].examples.push(path);
  }
  db.close();
}
console.log(JSON.stringify(out, null, 1));
