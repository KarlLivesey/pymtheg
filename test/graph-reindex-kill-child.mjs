// SPDX-License-Identifier: MIT
// Child process for test/graph-reindex-kill.test.mjs: runs `graph index` on
// <root> with the production language modules and kills itself with SIGKILL
// right after the <n>th store write commits (a transaction, a file removal,
// or the completion record's invalidation). Prints "not killed <writes>
// scoped <files>" when the index returns first, with the number of Rust files
// it re-decided alone.
// usage: node graph-reindex-kill-child.mjs <root> <n>
import { executeGraph } from "../dist/graph/commands.js";
import { SqliteGraphStore } from "../dist/graph/store.js";
import { graphWork } from "../dist/graph/work.js";

const [root, limit] = process.argv.slice(2);
const proto = SqliteGraphStore.prototype;
let writes = 0;
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
// C-36: how many Rust files the unkilled run re-decided alone.
process.stdout.write(
  `not killed ${writes} scoped ${graphWork.counts["analyze.rust.scopedFiles"] ?? 0}\n`,
);
