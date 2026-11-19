// C-6 concurrency measurement (from evidence/w3-p1/concurrency.mjs). Cold-indexes
// <root> into its project graph path with the built code in <dist>, and at fixed
// write counts (every 100 writes) spawns `graph status`, `graph search
// --no-sync`, a writable open and a writable open with one write as separate
// processes (probe-child.mjs). Prints the index wall time and every
// probe's result. Write counts, not clocks, decide when probes start.
// usage: node concurrency.mjs <dist> <root> <rust|go> <label>
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { loadavg } from "node:os";
const [dist, root, lang, label] = process.argv.slice(2);
const g = await import(`${dist}/graph/index.js`);
const { storagePath } = await import(`${dist}/storage/local.js`);
const mod = (await import(`${dist}/graph/languages/${lang}/index.js`)).default;
const db = storagePath(root, "graph", true);
for (const suffix of ["", "-journal", "-wal", "-shm"])
  rmSync(db + suffix, { force: true });
const store = new g.SqliteGraphStore(db);
// Probe every 100 writes, starting at write 20.
const probeAt = (write) => write % 100 === 20;
const children = [];
const original = store.replaceFile;
let writes = 0;
store.replaceFile = function (...args) {
  const result = original.apply(this, args);
  if (probeAt(++writes))
    for (const mode of ["status", "search", "open", "write"]) {
      const child = spawn(
        process.execPath,
        [
          new URL("probe-child.mjs", import.meta.url).pathname,
          dist,
          root,
          db,
          mode,
          String(writes),
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      children.push(
        new Promise((ok) => child.on("close", () => ok(out.trim()))),
      );
    }
  return result;
};
const load = loadavg()[0];
const started = performance.now();
await g.indexProject(root, new g.LanguageRegistry([mod]), store);
const wallMs = Math.round(performance.now() - started);
store.close();
const probes = (await Promise.all(children)).map((line) => JSON.parse(line));
console.log(
  JSON.stringify({
    label,

    wallMs,
    loadStart: load,
    writes,
    probes,
  }),
);
