// probe.mjs BUILD ROOT DB : index ROOT with only the TypeScript module; at every
// compiler program creation log live heap after a full GC, roots and programs so far.
const [build, root, db] = process.argv.slice(2);
const { default: ts } = await import(`${build}/node_modules/typescript/lib/typescript.js`);
const graph = await import(`${build}/dist/graph/index.js`);
const { default: tsModule, statistics } = await import(`${build}/dist/graph/languages/typescript/index.js`);
let n = 0;
const mb = (x) => Math.round(x / 1048576);
let programs = statistics.programs;
Object.defineProperty(statistics, "programs", {
  get: () => programs,
  set(value) {
    programs = value;
    global.gc();
    const m = process.memoryUsage();
    console.log(`program ${++n} liveHeap=${mb(m.heapUsed)} rss=${mb(m.rss)} ext=${mb(m.external + m.arrayBuffers)} extracted=${statistics.extracted} neutral=${statistics.neutralPrograms}`);
  },
});
const store = new graph.SqliteGraphStore(db, "probe");
const t = Date.now();
const report = await graph.indexProject(root, new graph.LanguageRegistry([tsModule]), store);
global.gc();
console.log("done", JSON.stringify({ symbols: report.symbols, links: report.links, analysisErrors: report.analysisErrors, liveHeap: mb(process.memoryUsage().heapUsed), s: (Date.now() - t) / 1000 }));
