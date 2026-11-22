// SPDX-License-Identifier: MIT
// Child process for test/graph-reindex-kill.test.mjs: runs `graph index` on
// <root> with the production language modules and kills itself with SIGKILL
// right after the <n>th store write commits (a transaction, a file removal,
// or the completion record's invalidation). Prints "not killed <writes>" when
// the index returns first, with the number of scoped TypeScript analyses
// (C-38) after it.
// usage: node graph-reindex-kill-child.mjs <root> <n>
import { executeGraph } from "../dist/graph/commands.js";
import { statistics } from "../dist/graph/languages/typescript/index.js";
import { SqliteGraphStore } from "../dist/graph/store.js";

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
process.stdout.write(`not killed ${writes} scoped ${statistics.scoped}\n`);
