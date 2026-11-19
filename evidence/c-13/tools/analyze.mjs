// analyze.mjs BUILD ROOT [PREFIX...] : runs the TypeScript module's analyze()
// directly over ROOT's tracked TS/JS files (only those under a PREFIX, if
// given) and context files. Prints the exception's stack if it throws,
// otherwise a summary of failed files by first diagnostic.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeHeapSnapshot } from "node:v8";
const [build, root, ...prefixes] = process.argv.slice(2);
const { contentHash } = await import(`${build}/dist/graph/index.js`);
const { statistics } = await import(
  `${build}/dist/graph/languages/typescript/index.js`
);
const tracked = execFileSync("git", ["-C", root, "ls-files", "-z"], {
  maxBuffer: 1 << 30,
})
  .toString()
  .split("\0")
  .filter(Boolean);
const source = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const context =
  /(^|\/)([^/]*tsconfig[^/]*\.json|[^/]*jsconfig[^/]*\.json|package\.json|pnpm-workspace\.yaml)$/;
const read = (path) => readFileSync(`${root}/${path}`);
const wanted = (path) =>
  !prefixes.length || prefixes.some((prefix) => path.startsWith(prefix));
const files = tracked
  .filter((p) => source.test(p) && wanted(p))
  .map((path) => {
    const bytes = read(path);
    return {
      path,
      text: bytes.toString("utf8"),
      hash: contentHash(bytes),
      module: "typescript",
      version: "",
      result: { status: "clean", diagnostics: [], symbols: [], links: [] },
    };
  });
const contextFiles = tracked
  .filter((p) => context.test(p))
  .map((path) => {
    const bytes = read(path);
    return {
      path,
      text: bytes.toString("utf8"),
      hash: contentHash(bytes),
      status: "clean",
      diagnostics: [],
    };
  });
// With BUDGET or TAINT_STEPS, a module instance with that program budget
// (characters) or taint walk budget (steps).
const loaded = await import(`${build}/dist/graph/languages/typescript/index.js`);
const tsModule =
  (process.env.BUDGET || process.env.TAINT_STEPS) && loaded.typescriptModule
    ? loaded.typescriptModule({
        ...(process.env.BUDGET ? { programCharacters: Number(process.env.BUDGET) } : {}),
        ...(process.env.TAINT_STEPS ? { taintSteps: Number(process.env.TAINT_STEPS) } : {}),
      })
    : loaded.default;
const started = Date.now();
// With HEAPLOG, log live heap after a full GC at every program creation (--expose-gc).
if (process.env.HEAPLOG) {
  let value = statistics.programs;
  Object.defineProperty(statistics, "programs", {
    get: () => value,
    set(next) {
      value = next;
      global.gc();
      if (process.env.SNAP_AT && value === Number(process.env.SNAP_AT))
        console.log("snapshot", writeHeapSnapshot(`${process.env.SNAP_DIR}/program-${value}.heapsnapshot`));
      console.log(`program ${value} t=${Math.round((Date.now() - started) / 1000)}s liveHeap=${Math.round(process.memoryUsage().heapUsed / 1048576)} extracted=${statistics.extracted}`);
    },
  });
}
try {
  const results = tsModule.analyze({
    files,
    contextFiles,
    changedFiles: files.map((f) => f.path),
    changedContextFiles: contextFiles.map((f) => f.path),
  });
  if (global.gc) {
    // Live heap with the inputs and every returned result still held.
    global.gc();
    console.log(`returned liveHeap=${Math.round(process.memoryUsage().heapUsed / 1048576)} t=${Math.round((Date.now() - started) / 1000)}s`);
  }
  const reasons = new Map();
  let failed = 0;
  for (const { result } of results)
    if (result.status === "failed") {
      failed++;
      const key = (result.diagnostics[0]?.message ?? "").slice(0, 200);
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
  console.log(
    JSON.stringify({
      files: files.length,
      results: results.length,
      failed,
      programs: statistics.programs,
      s: (Date.now() - started) / 1000,
    }),
  );
  for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 15))
    console.log(count, reason);
  const taint = await import(`${build}/dist/graph/languages/typescript/taint.js`);
  if (taint.taintStatistics) console.log("taint", JSON.stringify({ ...taint.taintStatistics, budget: taint.TAINT_BUDGET }));
  let exhausted = 0;
  for (const { result } of results)
    for (const link of result.links ?? []) if (link.data?.reason === "taint-budget-exhausted") exhausted++;
  console.log("links taint-budget-exhausted", exhausted);
  const answered = new Set(results.map((item) => item.path));
  const missing = files.filter((file) => !answered.has(file.path)).map((file) => file.path);
  console.log("without a result", missing.length, JSON.stringify(missing.slice(0, 10)));
  const compiler = results.filter(({ result }) => result.status === "failed" && /^The TypeScript compiler failed while analysing this file: (?!the compiler threw on)/.test(result.diagnostics[0]?.message ?? ""));
  console.log("compiler failures", compiler.length);
  for (const { path, result } of compiler.slice(0, 40)) console.log("  ", path, result.diagnostics[0].message.slice(57, 160));
} catch (error) {
  console.log("THREW", JSON.stringify({ files: files.length, programs: statistics.programs, s: (Date.now() - started) / 1000 }));
  console.log(error?.stack ?? String(error));
}
