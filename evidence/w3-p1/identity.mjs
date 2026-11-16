// W3-P1 result-identity and timing step. Indexes <corpus> into <db> with the
// built graph code in <dist>, then prints one JSON line: timings, the index
// report, and sha256 hashes of (a) every graph_* table's rows read with plain
// SQLite, and (b) query output through that build's own store API.
// usage: node identity.mjs <dist> <corpus> <db> <rust|go> <label>
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { loadavg } from "node:os";
const [dist, corpus, db, lang, label] = process.argv.slice(2);
const g = await import(`${dist}/graph/index.js`);
const mod = (await import(`${dist}/graph/languages/${lang}/index.js`)).default;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const load = loadavg()[0];
const ru0 = process.resourceUsage();
const started = performance.now();
const store = new g.SqliteGraphStore(db, "w3p1");
const report = await g.indexProject(
  corpus,
  new g.LanguageRegistry([mod]),
  store,
);
const wallMs = Math.round(performance.now() - started);
const ru = process.resourceUsage();
const symbols = store.findSymbols();
// Deterministic sample of symbols for the per-symbol queries.
const sample = symbols.filter(
  (_, i) => i % Math.max(1, Math.floor(symbols.length / 300)) === 0,
);
const api = {
  files: hash(store.files()),
  symbols: hash(symbols),
  links: hash(store.links()),
  unresolved: hash(store.unresolved()),
  ambiguous: hash(store.ambiguous()),
  contexts: hash(store.contexts()),
  failedFiles: hash(store.failedFiles()),
  counts: hash(store.counts()),
  perSymbol: hash(
    sample.map((s) => [
      store.outgoing(s.id),
      store.incoming(s.id),
      store.neighbourhood(s.id, 1),
      store.linksForFile(s.file, 50),
      store.callLinks(s.id, "incoming", 50),
    ]),
  ),
};
store.close();
const raw = new DatabaseSync(db, { readOnly: true });
const tables = {};
for (const [table, order] of [
  ["graph_meta", "key"],
  ["graph_files", "path"],
  ["graph_parse_failures", "path"],
  ["graph_contexts", "path"],
  ["graph_symbols", "id"],
  ["graph_links", "id"],
  ["graph_candidates", "link,symbol"],
])
  tables[table] = hash(
    raw.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all(),
  );
raw.close();
console.log(
  JSON.stringify({
    label,
    wallMs,
    userCpuMs: Math.round((ru.userCPUTime - ru0.userCPUTime) / 1000),
    sysCpuMs: Math.round((ru.systemCPUTime - ru0.systemCPUTime) / 1000),
    maxRssMB: Math.round(ru.maxRSS / 1024),
    loadStart: load,
    sampledSymbols: sample.length,
    report: hash(report),
    reportCounts: Object.fromEntries(
      Object.entries(report).filter(([, v]) => typeof v === "number"),
    ),
    tables,
    api,
  }),
);
