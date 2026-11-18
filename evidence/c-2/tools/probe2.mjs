// probe2.mjs BUILD ROOT DB : full index with every production module; logs process.memoryUsage()
// around each module's analyze/resolve and the store's analysis writes (observation only).
const [build, root, db] = process.argv.slice(2);
const graph = await import(`${build}/dist/graph/index.js`);
const { discoverLanguages } = await import(`${build}/dist/graph/registry.js`).catch(() => ({}));
const mb = (x) => Math.round(x / 1048576);
const log = (what) => { const m = process.memoryUsage(); console.log(`${what} rss=${mb(m.rss)} heapTotal=${mb(m.heapTotal)} heapUsed=${mb(m.heapUsed)} external=${mb(m.external)} arrayBuffers=${mb(m.arrayBuffers)}`); };
const registry = discoverLanguages ? await discoverLanguages() : null;
const wrapped = new graph.LanguageRegistry(registry.modules.map((m) => ({
  ...m,
  ...(m.analyze ? { analyze: async (c) => { log(`analyze ${m.id} start`); const r = await m.analyze(c); log(`analyze ${m.id} end`); return r; } } : {}),
  ...(m.resolve ? { resolve: async (c) => { log(`resolve ${m.id} start`); const r = await m.resolve(c); log(`resolve ${m.id} end`); return r; } } : {}),
})));
const store = new graph.SqliteGraphStore(db, "probe");
const replace = store.replaceAnalysis.bind(store);
store.replaceAnalysis = (module, result) => { log(`write ${module} start`); replace(module, result); log(`write ${module} end`); };
await graph.indexProject(root, wrapped, store);
log("done");
