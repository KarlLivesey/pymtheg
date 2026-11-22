// SPDX-License-Identifier: MIT
// Child process for test/graph-reindex-kill.test.mjs: runs `graph index` on
// <root> with the production language modules and kills itself with SIGKILL
// right after the <n>th store write commits (a transaction, a file removal,
// or the completion record's invalidation). Prints "not killed <writes>" when
// the index returns first. With [batch rows] the store's write batches
// (C-37) end after that many rows, so a small fixture has several batch
// boundaries; the end of each batch scope, where its last batch commits, is
// a kill point of its own.
// usage: node graph-reindex-kill-child.mjs <root> <n> [batch rows]
import { DatabaseSync } from "node:sqlite";
import { executeGraph } from "../dist/graph/commands.js";
import { SqliteGraphStore } from "../dist/graph/store.js";

const [root, limit, batchRows] = process.argv.slice(2);
if (batchRows) SqliteGraphStore.writeBatchRows = Number(batchRows);
const proto = SqliteGraphStore.prototype;
let writes = 0;
// Write commits, to show that batches of several writes formed.
let commits = 0;
let writing = false;
const exec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (sql) {
  if (sql === "BEGIN IMMEDIATE") writing = true;
  else if (sql === "COMMIT" && writing) {
    commits++;
    writing = false;
  } else if (sql === "ROLLBACK") writing = false;
  return exec.call(this, sql);
};
const writeBatch = proto.writeBatch;
proto.writeBatch = async function (...args) {
  try {
    return await writeBatch.apply(this, args);
  } finally {
    if (++writes === Number(limit)) process.kill(process.pid, "SIGKILL");
  }
};
for (const name of [
  "transaction",
  "removeFile",
  "invalidateGraphCommandState",
]) {
  const original = proto[name];
  proto[name] = function (...args) {
    // A transaction inside another write counts once, at the outer one.
    const outer = !this.c22Writing;
    this.c22Writing = true;
    try {
      return original.apply(this, args);
    } finally {
      if (outer) {
        this.c22Writing = false;
        if (++writes === Number(limit)) process.kill(process.pid, "SIGKILL");
      }
    }
  };
}
await executeGraph({ command: "index", root });
process.stdout.write(`not killed ${writes} commits ${commits}\n`);
