// C-6 journal-switch stress: one process writes in short sessions (open,
// write, close: each switches to the write-ahead log and back), others open,
// read and close as queries do, all on one small graph file. Counts every
// error. usage: node stress.mjs <dist> <db> <role> <iterations>
//   role writer | reader (read-only open) | query (writable open, reads only)
//   | main: spawn 2 writers, 3 readers and 2 query processes; print totals
import { spawn } from "node:child_process";
const [dist, db, role, n = "300"] = process.argv.slice(2);
const { SqliteGraphStore } = await import(`${dist}/graph/store.js`);
if (role === "main") {
  new SqliteGraphStore(db, "stress").close();
  const roles = ["writer", "writer", "reader", "reader", "reader", "query", "query"];
  const results = await Promise.all(
    roles.map(
      (r) =>
        new Promise((done) => {
          const child = spawn(process.execPath, [
            new URL(import.meta.url).pathname,
            dist,
            db,
            r,
            n,
          ]);
          let out = "";
          child.stdout.on("data", (d) => (out += d));
          child.stderr.on("data", (d) => (out += d));
          child.on("exit", () => done(out.trim()));
        }),
    ),
  );
  console.log(results.join("\n"));
} else {
  const errors = {};
  for (let i = 0; i < Number(n); i++) {
    try {
      const store = new SqliteGraphStore(db, undefined, {
        readOnly: role === "reader",
      });
      try {
        if (role === "writer") {
          store.invalidateGraphCommandState();
          store.removeFile(`missing-${i}`);
          store.completeGraphCommandState({ i });
        } else store.readCommandSnapshot(() => [store.counts(), store.graphCommandState()]);
      } finally {
        store.close();
      }
    } catch (error) {
      errors[error.message] = (errors[error.message] ?? 0) + 1;
    }
  }
  console.log(JSON.stringify({ role, iterations: Number(n), errors }));
}
