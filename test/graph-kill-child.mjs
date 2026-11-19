// SPDX-License-Identifier: MIT
// Child process for test/graph-write-ahead-log.test.mjs: runs `graph index`
// on <root> with the fixture module and kills itself with SIGKILL at <point>.
// usage: node graph-kill-child.mjs <root> <point>
//   open      writable store opened, before any write
//   file      inside the second file's write transaction
//   resolved  resolution written, completion record not yet written
//   complete  completion record committed, store not yet closed
//   none      not killed: prints "not killed" when the index returns
import { executeGraph } from "../dist/graph/commands.js";
import { LanguageRegistry } from "../dist/graph/registry.js";
import { SqliteGraphStore } from "../dist/graph/store.js";
import { fixtureModule } from "./graph-kill-fixture.mjs";
const [root, point] = process.argv.slice(2);
const kill = () => process.kill(process.pid, "SIGKILL");
const proto = SqliteGraphStore.prototype;
const wrap = (name, after, when = () => true) => {
  const original = proto[name];
  proto[name] = function (...args) {
    if (!after && when()) kill();
    const result = original.apply(this, args);
    if (after && when()) kill();
    return result;
  };
};
let files = 0;
if (point === "open") wrap("invalidateGraphCommandState", false);
else if (point === "file") {
  wrap("replaceFile", false, () => {
    files++;
    return false;
  });
  // A link row of the second file is written; its transaction is open.
  wrap("insertLink", true, () => files === 2);
} else if (point === "resolved") wrap("replaceAnalysis", true);
else if (point === "complete") wrap("completeGraphCommandState", true);
else if (point !== "none") throw Error("unknown kill point " + point);
await executeGraph(
  { command: "index", root },
  { registry: new LanguageRegistry([fixtureModule()]) },
);
process.stdout.write("not killed\n");
