// C-6 cold-index measurement. Runs the real `graph index` command
// (executeGraph) of the build in <dist> on <root>, from an empty graph with a
// fixed project id, and prints one JSON line: wall time, CPU, peak RSS, the
// time spent inside graph-store write transactions (statement work + commit)
// and inside COMMIT alone, the number of commits, and a digest of every stored
// row (identity). Timings are observations.
//
// <variant> applies connection settings to every writable graph connection the
// command opens, to evaluate options against the unmodified build:
//   asis        the build as it is
//   wal-normal  journal_mode=WAL, synchronous=NORMAL
//   wal-full    journal_mode=WAL, synchronous=FULL
//   sync-off    synchronous=OFF (diagnostic lower bound only; not a candidate)
//   batch-<N>   wal-normal plus up to N store write transactions per commit
//
// usage: node measure.mjs <dist> <root> <label> <variant>
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { digest } from "./digest.mjs";
const [dist, root, label, variant = "asis"] = process.argv.slice(2);
const { SqliteGraphStore } = await import(`${dist}/graph/store.js`);
const { executeGraph } = await import(`${dist}/graph/commands.js`);
const db = join(root, ".pymtheg/rebuildable/graph.sqlite");
for (const suffix of ["", "-journal", "-wal", "-shm"])
  rmSync(db + suffix, { force: true });
mkdirSync(join(root, ".pymtheg/rebuildable"), { recursive: true, mode: 0o700 });
{
  // Fixed project id: the completion record names it, so rows compare across builds.
  const raw = new DatabaseSync(db);
  raw.exec(
    "CREATE TABLE IF NOT EXISTS graph_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  raw
    .prepare("INSERT INTO graph_meta VALUES ('project',?)")
    .run("00000000-0000-4000-8000-00000000c006");
  raw.close();
}
const stats = { txMs: 0, transactions: 0, commitMs: 0, commits: 0 };
const proto = SqliteGraphStore.prototype;
// Per store write method: calls, whole-call, transaction and commit seconds.
const methods = {};
let current = "other";
const bucket = () =>
  (methods[current] ??= { calls: 0, callMs: 0, txMs: 0, commitMs: 0 });
for (const name of [
  "replaceContexts",
  "replaceFile",
  "removeFile",
  "replaceAnalysis",
  "resolveLinks",
  "invalidateGraphCommandState",
  "completeGraphCommandState",
  "close",
]) {
  const original = proto[name];
  proto[name] = function (...args) {
    const outer = current;
    current = name;
    const t = performance.now();
    try {
      return original.apply(this, args);
    } finally {
      const b = bucket();
      b.calls++;
      b.callMs += performance.now() - t;
      current = outer;
    }
  };
}
const batch = Number(/^batch-(\d+)/.exec(variant)?.[1] ?? 0);
// wal-normal-ck<N>, batch-<B>-ck<N>: with an automatic checkpoint every N pages
// (SQLite's default is 1000).
// ...-cache<MB> (any variant, including asis): page cache of MB mebibytes
// (SQLite's default is about 2).
const cache = /-cache(\d+)$/.exec(variant)?.[1];
const base = cache ? variant.replace(/-cache\d+$/, "") : variant;
const checkpoint = /^(?:wal-normal|batch-\d+)-ck(\d+)$/.exec(base)?.[1];
const pragmas = {
  asis: "",
  "wal-normal": "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;",
  "wal-full": "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
  "wal-off": "PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF;",
  "sync-off": "PRAGMA synchronous=OFF;",
}[batch || checkpoint ? "wal-normal" : base]?.concat(
  checkpoint ? `PRAGMA wal_autocheckpoint=${checkpoint};` : "",
  cache ? `PRAGMA cache_size=-${Number(cache) * 1024};` : "",
);
if (pragmas === undefined) throw Error("unknown variant " + variant);
// findFileStatusIndex runs once per open, after the connection exists.
const find = proto.findFileStatusIndex;
proto.findFileStatusIndex = function () {
  const db = this.db;
  if (!db.__measured) {
    db.__measured = true;
    const exec = db.exec.bind(db);
    db.exec = (sql) => {
      if (sql !== "COMMIT") return exec(sql);
      const t = performance.now();
      try {
        return exec(sql);
      } finally {
        stats.commitMs += performance.now() - t;
        bucket().commitMs += performance.now() - t;
        stats.commits++;
      }
    };
    if (pragmas && !this.db.isTransaction) exec(pragmas);
  }
  return find.call(this);
};
const transaction = proto.transaction;
proto.transaction = function (action) {
  const t = performance.now();
  try {
    if (!batch) return transaction.call(this, action);
    // Evaluation only: several store transactions share one commit.
    if (!this.db.isTransaction) {
      this.db.exec("BEGIN IMMEDIATE");
      this.pending = 0;
    }
    this.db.exec("SAVEPOINT w");
    try {
      action();
      this.db.exec("RELEASE w");
    } catch (error) {
      this.db.exec("ROLLBACK TO w");
      this.db.exec("RELEASE w");
      throw error;
    }
    if (++this.pending >= batch) this.db.exec("COMMIT");
  } finally {
    stats.txMs += performance.now() - t;
    bucket().txMs += performance.now() - t;
    stats.transactions++;
  }
};
if (batch) {
  // Close an open batch before anything reads or publishes completion.
  for (const name of [
    "completeGraphCommandState",
    "close",
    "readCommandSnapshot",
  ]) {
    const original = proto[name];
    proto[name] = function (...args) {
      if (this.db.isOpen && this.db.isTransaction) this.db.exec("COMMIT");
      return original.apply(this, args);
    };
  }
}
const ru0 = process.resourceUsage();
const started = performance.now();
const response = await executeGraph({ command: "index", root });
const wallMs = performance.now() - started;
const ru = process.resourceUsage();
const rows = digest(db);
console.log(
  JSON.stringify({
    label,
    variant,
    exitCode: response.exitCode,
    complete: response.sync.complete,
    wallS: +(wallMs / 1000).toFixed(1),
    txS: +(stats.txMs / 1000).toFixed(1),
    commitS: +(stats.commitMs / 1000).toFixed(1),
    commits: stats.commits,
    transactions: stats.transactions,
    userS: +((ru.userCPUTime - ru0.userCPUTime) / 1e6).toFixed(1),
    sysS: +((ru.systemCPUTime - ru0.systemCPUTime) / 1e6).toFixed(1),
    maxRssMB: Math.round(ru.maxRSS / 1024),
    methods: Object.fromEntries(
      Object.entries(methods).map(([name, b]) => [
        name,
        [b.calls, ...[b.callMs, b.txMs, b.commitMs].map((ms) => +(ms / 1000).toFixed(1))],
      ]),
    ),
    counts: response.counts,
    rows,
  }),
);
