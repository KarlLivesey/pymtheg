// probe.mjs BUILD ROOT DB [SNAP_AT] : index ROOT with only the TypeScript
// module (run with --expose-gc). Logs live heap after a full GC at every
// compiler program creation and every 5,000 extracted files; with SNAP_AT,
// writes a heap snapshot to $SNAP_DIR when that many files are extracted.
import { writeHeapSnapshot } from "node:v8";
const [build, root, db, snapAt] = process.argv.slice(2);
const graph = await import(`${build}/dist/graph/index.js`);
const { default: tsModule, statistics } = await import(
  `${build}/dist/graph/languages/typescript/index.js`
);
const mb = (x) => Math.round(x / 1048576);
const started = Date.now();
const log = (what) => {
  global.gc();
  const m = process.memoryUsage();
  console.log(
    `${what} t=${Math.round((Date.now() - started) / 1000)}s liveHeap=${mb(m.heapUsed)} rss=${mb(m.rss)} programs=${statistics.programs} extracted=${statistics.extracted} neutral=${statistics.neutralPrograms}/${statistics.neutralExtracted}`,
  );
};
for (const field of ["programs", "extracted"]) {
  let value = statistics[field];
  Object.defineProperty(statistics, field, {
    get: () => value,
    set(next) {
      value = next;
      if (field === "programs") log("program");
      else if (value % 5000 === 0) log("extracted");
      if (field === "extracted" && snapAt && value === Number(snapAt))
        console.log("snapshot", writeHeapSnapshot(`${process.env.SNAP_DIR}/at-${value}.heapsnapshot`));
    },
  });
}
const store = new graph.SqliteGraphStore(db, "probe");
const report = await graph.indexProject(
  root,
  new graph.LanguageRegistry([tsModule]),
  store,
);
log("done");
console.log(
  "report",
  JSON.stringify({
    files: report.files,
    symbols: report.symbols,
    links: report.links,
    analysisErrors: report.analysisErrors,
  }),
);
