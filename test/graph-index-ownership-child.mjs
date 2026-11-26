// SPDX-License-Identifier: MIT
// Child process for test/graph-index-ownership.test.mjs (C-62): runs a graph
// run on <root> and stops itself (SIGSTOP) at <gate>, after telling the
// parent over IPC; the parent continues it with SIGCONT, or kills it.
//   after-walk      the first store call after the indexer's directory walk
//                   (before its baseline on a build that reads the baseline
//                   after the walk; after it here)
//   after-parse     the parse write's first store call, before the run's
//                   first commit (its claim)
//   before-finish   the run's finishIndexRun, its mark still held
//   before-publish  the command's completion record, after its rows
//   none            no stop
// <how> is "index" (indexProject, the indexer's walk only), "command"
// (executeGraph's `graph index`, which publishes the completion record) or
// "session" (C-55: two `graph index` runs in one IndexSession; the first,
// ungated, keeps the modules' inputs; the child says so and waits for the
// parent's "go" before the second, gated run).
// usage: node graph-index-ownership-child.mjs <root> <how> <gate>
import fs, { writeSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { executeGraph } from "../dist/graph/commands.js";
import {
  discoverLanguages,
  indexProject,
  IndexSession,
  SqliteGraphStore,
} from "../dist/graph/index.js";

const [root, how, gate] = process.argv.slice(2);
// Loaded before any gate: loading the modules reads directories too.
const languages = await discoverLanguages();
const proto = SqliteGraphStore.prototype;
let held = false;
// In a session, only the second run is gated.
let armed = how !== "session";
let walked = false;
const hold = () => {
  if (held || !armed) return;
  held = true;
  // Synchronously, from inside the store code: the message on the IPC
  // channel, then the stop; nothing after runs until SIGCONT.
  writeSync(process.channel.fd, JSON.stringify({ stopped: gate }) + "\n");
  process.kill(process.pid, "SIGSTOP");
};
const before = (name, when = () => true) => {
  const original = proto[name];
  if (!original) return;
  proto[name] = function (...args) {
    if (when()) hold();
    return original.apply(this, args);
  };
};
if (gate === "after-walk") {
  // The walk is the indexer's only directory read in an `index` run.
  const readdir = fs.promises.readdir;
  fs.promises.readdir = function (...args) {
    // The indexer's walk only: a command's inventory reads directories too.
    if (new Error().stack?.includes("/graph/indexer.js")) walked = true;
    return readdir.apply(this, args);
  };
  syncBuiltinESMExports();
  // The first of these after the walk: the baseline where a build reads it
  // after the walk, else the indexer's read right after the walk.
  for (const name of ["beginIndexRun", "completedAnalysis"])
    before(name, () => walked);
} else if (gate === "after-parse") before("replaceContexts");
else if (gate === "before-finish") before("finishIndexRun");
else if (gate === "before-publish") before("completeGraphCommandState");
else if (gate !== "none") throw Error("unknown gate " + gate);

let reply;
try {
  if (how === "session") {
    const session = new IndexSession({ registry: languages });
    const warm = await executeGraph({ command: "index", root }, { session });
    // What the session keeps after the first run, by module.
    const kept = [...(session["kept"]?.keys() ?? [])];
    process.send({ warm: warm.sync.complete, kept });
    await new Promise((go) => process.once("message", go));
    walked = false;
    armed = true;
    const answer = await executeGraph({ command: "index", root }, { session });
    reply = { complete: answer.sync.complete };
  } else if (how === "command") {
    const answer = await executeGraph({ command: "index", root });
    reply = { complete: answer.sync.complete };
  } else {
    const store = new SqliteGraphStore(
      `${root}/.pymtheg/rebuildable/graph.sqlite`,
    );
    try {
      await indexProject(root, languages, store);
      reply = { complete: !store.unfinishedIndexRun() };
    } finally {
      store.close();
    }
  }
} catch (error) {
  reply = { error: error.name };
}
process.send({ reply });
process.disconnect();
