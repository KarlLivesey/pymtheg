// SPDX-License-Identifier: MIT
// Child process for test/graph-index-race.test.mjs: runs `graph index` on
// <root> and stops itself (SIGSTOP) at <point>, after telling the parent
// over IPC; the parent continues it with SIGCONT. Ported from the C-22
// review's reproducers.
//   journal-window  right after the run's first data-version read around
//                   its journal set-up: inside the first write's set-up (a
//                   build that takes its baseline before choosing the
//                   journal), or the baseline read after the journal was
//                   chosen at the start of the run
//   finish-commit   right after the commit that clears the run's mark
// usage: node graph-index-race-child.mjs <root> <point>
import { writeSync } from "node:fs";
import { executeGraph } from "../dist/graph/commands.js";
import { SqliteGraphStore } from "../dist/graph/store.js";

const [root, point] = process.argv.slice(2);
const proto = SqliteGraphStore.prototype;
let held = false;
const hold = () => {
  if (held) return;
  held = true;
  // Synchronously, from inside the store code: the message on the IPC
  // channel, then the stop; nothing after runs until SIGCONT.
  writeSync(process.channel.fd, JSON.stringify({ stopped: point }) + "\n");
  process.kill(process.pid, "SIGSTOP");
};
const wrap = (name, around) => {
  const original = proto[name];
  proto[name] = function (...args) {
    return around.call(this, () => original.apply(this, args));
  };
};
let inRun = false;
let journalChosen = false;
let inJournal = false;
if (point === "journal-window") {
  wrap("beginIndexRun", function (call) {
    inRun = true;
    return call();
  });
  wrap("beforeWrite", function (call) {
    inJournal = inRun;
    try {
      return call();
    } finally {
      inJournal = false;
      if (inRun) journalChosen = true;
    }
  });
  wrap("commandDataVersion", function (call) {
    // Inside the journal set-up of the first write (a build that takes the
    // baseline before choosing the journal), or the first read after the
    // journal was chosen at the start of the run.
    const version = call();
    if (inJournal || (journalChosen && inRun)) hold();
    return version;
  });
} else if (point === "finish-commit")
  wrap("finishIndexRun", function (call) {
    const db = this.db;
    const exec = db.exec;
    db.exec = function (sql) {
      const result = exec.call(this, sql);
      if (sql === "COMMIT") hold();
      return result;
    };
    try {
      return call();
    } finally {
      db.exec = exec;
    }
  });
else throw Error("unknown point " + point);
try {
  const answer = await executeGraph({ command: "index", root });
  process.send({ reply: { complete: answer.sync.complete } });
} catch (error) {
  process.send({ reply: { error: error.message } });
}
process.disconnect();
