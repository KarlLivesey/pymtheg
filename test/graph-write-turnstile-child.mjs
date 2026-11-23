// SPDX-License-Identifier: MIT
// Child process for test/graph-write-turnstile.test.mjs (C-37).
//   index <root> <graph> <rows> <stop>   index <root> with the synthetic
//     module in batches of <rows> rows; stop itself (SIGSTOP, after telling
//     the parent) right after its <stop>th file write, inside a batch; and
//     after every commit record whether the waiter's file is visible. The
//     reply lists the commits made after the stop.
//   write <graph>   write one file through the store; tell the parent once
//     it holds the turnstile (it then waits for the write lock).
import { writeSync } from "node:fs";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { module as synthetic } from "./fixtures/graph-core/synthetic.mjs";

const [mode, ...args] = process.argv.slice(2);
const proto = SqliteGraphStore.prototype;
const tell = (message) =>
  writeSync(process.channel.fd, JSON.stringify(message) + "\n");
const waiterPath = "waiter.syn";

if (mode === "index") {
  const [root, graph, rows, stopAt] = args;
  SqliteGraphStore.writeBatchRows = Number(rows);
  let writes = 0;
  let resumed = false;
  const after = [];
  const replaceFile = proto.replaceFile;
  proto.replaceFile = function (...rest) {
    const result = replaceFile.apply(this, rest);
    if (++writes === Number(stopAt)) {
      tell({ stopped: writes, inBatch: this.batchOpen !== undefined });
      process.kill(process.pid, "SIGSTOP");
      resumed = true;
    }
    return result;
  };
  const commit = proto.commitTransaction;
  proto.commitTransaction = function (...rest) {
    const result = commit.apply(this, rest);
    if (resumed)
      after.push({
        waiterVisible: !!this.db
          .prepare("SELECT 1 FROM graph_files WHERE path=?")
          .get(waiterPath),
      });
    return result;
  };
  const store = new SqliteGraphStore(graph, "c37-turnstile");
  try {
    const report = await indexProject(
      root,
      new LanguageRegistry([synthetic]),
      store,
    );
    process.send({ reply: { after, indexed: report.indexed } });
  } catch (error) {
    process.send({ reply: { error: error.message } });
  } finally {
    store.close();
  }
} else if (mode === "write") {
  const [graph] = args;
  const enter = proto.enterTurnstile;
  // A build without the turnstile says so at once instead of waiting.
  if (typeof enter !== "function") tell({ holding: false });
  proto.enterTurnstile = function (...rest) {
    const entered = enter.apply(this, rest);
    tell({ holding: entered });
    return entered;
  };
  const store = new SqliteGraphStore(graph, "c37-turnstile");
  try {
    const text = "source of the waiter";
    store.replaceFile({
      path: waiterPath,
      text,
      hash: "hash:waiter",
      module: "synthetic",
      version: "1",
      result: synthetic.parse({ path: waiterPath, text }),
    });
    process.send({ reply: { written: true } });
  } finally {
    store.close();
  }
} else throw Error(`unknown mode ${mode}`);
