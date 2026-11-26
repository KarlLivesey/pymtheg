// C-50 review: preloaded into the real CLI (`node --import`). In the CLI's
// graph worker it stops the run at PYM_TEST_STOP_POINT until the
// coordinator has set the shared cancel flag (SIGINT), and says so on
// stderr first:
//   after-completion  right after the index's completion record is written
//   before-post       as the worker posts its result, after its last
//                     checkpoint (Sol review)
//   after-metadata    at the command's metadata read after the run's finish
//                     (contextInventory; the indexer's own report reads
//                     counts, before an earlier checkpoint), so only the
//                     checkpoint ahead of the completion write remains
// In the main thread, with PYM_TEST_INPLACE_GO, a link command's in-place
// store read stops until that file exists (the test sends SIGINT first).
import { existsSync } from "node:fs";
import { isMainThread, parentPort, workerData } from "node:worker_threads";
import { SqliteGraphStore } from "../../../dist/graph/index.js";

const proto = SqliteGraphStore.prototype;
const point = process.env.PYM_TEST_STOP_POINT;
if (!isMainThread && point && workerData?.request && workerData?.control) {
  const control = new Int32Array(workerData.control);
  const stop = () => {
    process.stderr.write(`stop point ${point}\n`);
    // [0] of the control memory is the cancel flag.
    while (Atomics.load(control, 0) === 0) Atomics.wait(control, 0, 0);
  };
  if (point === "before-post") {
    const postMessage = parentPort.postMessage.bind(parentPort);
    parentPort.postMessage = (message, ...rest) => {
      if (message?.kind === "result") stop();
      return postMessage(message, ...rest);
    };
  } else if (point === "after-completion") {
    const complete = proto.completeGraphCommandState;
    proto.completeGraphCommandState = function (...args) {
      const written = complete.apply(this, args);
      stop();
      return written;
    };
  } else if (point === "after-metadata") {
    let finished = false;
    const finish = proto.finishIndexRun;
    proto.finishIndexRun = function (...args) {
      finished = true;
      return finish.apply(this, args);
    };
    const inventory = proto.contextInventory;
    let stopped = false;
    proto.contextInventory = function (...args) {
      if (finished && !stopped) {
        stopped = true;
        stop();
      }
      return inventory.apply(this, args);
    };
  }
}
// In the main thread, with PYM_TEST_SAY_WRITTEN: once a large result has
// been handed to stdout, say so on stderr (the test then signals while the
// result is still draining to a reader that holds back).
if (isMainThread && process.env.PYM_TEST_SAY_WRITTEN) {
  const write = process.stdout.write.bind(process.stdout);
  let said = false;
  process.stdout.write = (chunk, ...rest) => {
    const result = write(chunk, ...rest);
    if (!said && String(chunk).length > 1 << 18) {
      said = true;
      process.stderr.write("stdout written\n");
    }
    return result;
  };
}
const go = process.env.PYM_TEST_INPLACE_GO;
if (isMainThread && go) {
  const hasFile = proto.hasFile;
  let stopped = false;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  proto.hasFile = function (...args) {
    if (!stopped) {
      stopped = true;
      process.stderr.write("stop point in-place\n");
      // Polled: the test creates the file after it has sent the signal.
      while (!existsSync(go)) Atomics.wait(pause, 0, 0, 5);
    }
    return hasFile.apply(this, args);
  };
}
