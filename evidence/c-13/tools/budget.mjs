// budget.mjs BUILD ROOT BUDGET... : for each budget, how many files of each
// over-budget project the module would leave out, and their characters.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const [build, root, ...budgets] = process.argv.slice(2);
const project = await import(`${build}/dist/graph/languages/typescript/project.js`);
const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { maxBuffer: 1 << 30 }).toString().split("\0").filter(Boolean);
const source = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const context = /(^|\/)([^/]*tsconfig[^/]*\.json|[^/]*jsconfig[^/]*\.json|package\.json|pnpm-workspace\.yaml)$/;
const read = (path) => readFileSync(`${root}/${path}`, "utf8");
const files = tracked.filter((p) => source.test(p)).map((path) => ({ path, text: read(path), hash: "", module: "typescript", version: "", result: { status: "clean", diagnostics: [], symbols: [], links: [] } }));
const contexts = tracked.filter((p) => context.test(p)).map((path) => ({ path, text: read(path), hash: "", status: "clean", diagnostics: [] }));
const size = new Map(files.map((f) => [f.path, f.text.length]));
for (const budget of budgets) {
  project.programBudget.characters = Number(budget);
  const model = project.projectModel(files, contexts);
  let chars = 0;
  for (const path of model.omitted.keys()) chars += size.get(path);
  const kept = model.groups.reduce((n, g) => n + g.roots.length, 0) - model.omitted.size;
  console.log(JSON.stringify({ budget: Number(budget), omitted: model.omitted.size, omittedCharacters: chars, keptRoots: kept }));
}
