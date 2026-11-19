// rebuild.mjs BUILD ROOT [N] [fresh] : builds the inferred group's program N
// times over one compiler host (a fresh host each time with "fresh"),
// keeping only the latest program, and logs live heap after a full GC
// (run with --expose-gc). Shows whether a rebuild retains the previous one.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const [build, root, count = "4", mode = ""] = process.argv.slice(2);
const ts = createRequire(`${build}/package.json`)("typescript");
const { projectModel } = await import(`${build}/dist/graph/languages/typescript/project.js`);
const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], { maxBuffer: 1 << 30 }).toString().split("\0").filter(Boolean);
const source = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const context = /(^|\/)([^/]*tsconfig[^/]*\.json|[^/]*jsconfig[^/]*\.json|package\.json|pnpm-workspace\.yaml)$/;
const read = (path) => readFileSync(`${root}/${path}`, "utf8");
const files = tracked.filter((p) => source.test(p)).map((path) => ({ path, text: read(path), hash: "", module: "typescript", version: "", result: { status: "clean", diagnostics: [], symbols: [], links: [] } }));
const contexts = tracked.filter((p) => context.test(p)).map((path) => ({ path, text: read(path), hash: "", status: "clean", diagnostics: [] }));
const model = projectModel(files, contexts);
const group = model.groups.find((g) => g.config === null);
const mb = (x) => Math.round(x / 1048576);
const live = (what) => { global.gc(); console.log(what, "liveHeap", mb(process.memoryUsage().heapUsed)); };
live("model");
// A file that overflows the stack while the host reads it is left out here.
const guarded = (inner) => ({ ...inner, getSourceFile(...args) { try { return inner.getSourceFile(...args); } catch (error) { if (error instanceof RangeError) return undefined; throw error; } } });
let host = guarded(model.host(group));
let current;
for (let i = 1; i <= Number(count); i++) {
  if (mode === "fresh") host = guarded(model.host(group));
  current = undefined;
  live(`before build ${i}`);
  const program = ts.createProgram({ rootNames: group.roots.filter((r) => !model.parseFailures.has(r.slice(1))), options: group.options, host });
  const checker = program.getTypeChecker();
  for (const s of program.getSourceFiles()) program.getSyntacticDiagnostics(s);
  current = { program, checker };
  live(`after build ${i} (files ${program.getSourceFiles().length})`);
}
