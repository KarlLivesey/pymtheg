// One concurrent probe, run as a separate process while an index is writing
// (C-6; modes status, search and open as in evidence/w3-p1/probe-child.mjs).
//   status  the real `pymtheg graph status` from the project root
//   search  the real `pymtheg graph search Event --no-sync`
//   open    a writable SqliteGraphStore open + close (30 s writer wait)
//   write   a writable open, one graph write (it needs the write lock), close
// Prints one JSON line {mode, at, ok, ms, error}.
// usage: node probe-child.mjs <dist> <root> <db> <mode> <at-write>
import { spawnSync } from "node:child_process";
const [dist, root, db, mode, at] = process.argv.slice(2);
const started = performance.now();
let ok = true,
  error = null;
if (mode === "status" || mode === "search") {
  const args =
    mode === "status"
      ? ["graph", "status"]
      : ["graph", "search", "Event", "--no-sync"];
  const run = spawnSync(process.execPath, [`${dist}/cli/main.js`, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  const text = `${run.stdout}\n${run.stderr}`;
  ok =
    !/database is locked/i.test(text) &&
    /Graph (status|search):/.test(run.stdout);
  if (!ok) error = text.trim().split("\n").at(-1);
} else {
  try {
    const g = await import(`${dist}/graph/index.js`);
    const store = new g.SqliteGraphStore(db);
    try {
      if (mode === "write") store.removeFile(`c6-probe-absent-${at}`);
    } finally {
      store.close();
    }
  } catch (e) {
    ok = false;
    error = e.message;
  }
}
console.log(
  JSON.stringify({
    mode,
    at: Number(at),
    ok,
    ms: Math.round(performance.now() - started),
    error,
  }),
);
