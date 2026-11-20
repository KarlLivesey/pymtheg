// groups.mjs BUILD ROOT : the TypeScript module's project groups for ROOT's
// tracked files (config, roots, owned file count), largest first.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [build, root] = process.argv.slice(2);
const { projectModel } = await import(
  `${build}/dist/graph/languages/typescript/project.js`
);
const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], {
  maxBuffer: 1 << 30,
})
  .toString()
  .split("\0")
  .filter(Boolean);
const source = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const context = /(^|\/)([^/]*tsconfig[^/]*\.json|[^/]*jsconfig[^/]*\.json|package\.json|pnpm-workspace\.yaml)$/;
const read = (path) => readFileSync(`${root}/${path}`, "utf8");
const files = tracked
  .filter((p) => source.test(p))
  .map((path) => ({ path, text: read(path), hash: "", module: "typescript", version: "", result: { status: "clean", diagnostics: [], symbols: [], links: [] } }));
const contexts = tracked
  .filter((p) => context.test(p))
  .map((path) => ({ path, text: read(path), hash: "", status: "clean", diagnostics: [] }));
const model = projectModel(files, contexts);
const byPath = new Map(files.map((f) => [f.path, f.text]));
const rows = model.groups
  .map((g) => ({ config: g.config, roots: g.roots.length, chars: g.roots.reduce((n, r) => n + (byPath.get(r.slice(1))?.length ?? 0), 0), failure: g.failure ?? null }))
  .sort((a, b) => b.chars - a.chars);
console.log(JSON.stringify({ files: files.length, contexts: contexts.length, groups: rows.length, failures: model.failures.size, ties: model.ties.size }));
for (const row of rows.slice(0, Number(process.env.TOP ?? 25))) console.log(JSON.stringify(row));
const reasons = new Map();
for (const message of model.failures.values()) reasons.set(message.slice(0, 160), (reasons.get(message.slice(0, 160)) ?? 0) + 1);
for (const [message, count] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(count, message);
