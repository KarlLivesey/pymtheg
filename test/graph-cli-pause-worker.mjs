// SPDX-License-Identifier: MIT
// C-50 review: a CLI graph worker that pauses inside one store method
// (`workerData.pause`) on its first call, until the coordinator has set the
// shared cancel flag. The worker is then busy, so it cannot have read the
// coordinator's `cancel` message: only the flag can stop the command. It
// raises flag [0] of `workerData.flag` when it pauses (readiness).
import { workerData } from "node:worker_threads";
import { serveGraphRequest } from "../dist/cli/graph-worker.js";
import { LanguageRegistry, SqliteGraphStore } from "../dist/graph/index.js";
import { fixtureModule } from "./graph-kill-fixture.mjs";

const flag = new Int32Array(workerData.flag);
const control = new Int32Array(workerData.control);
const original = SqliteGraphStore.prototype[workerData.pause];
let paused = false;
SqliteGraphStore.prototype[workerData.pause] = function (...args) {
  if (!paused) {
    paused = true;
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
    // [0] of the control memory is the cancel flag.
    while (Atomics.load(control, 0) === 0) Atomics.wait(control, 0, 0);
  }
  return original.apply(this, args);
};
await serveGraphRequest(
  workerData.request,
  workerData.control,
  { registry: new LanguageRegistry([fixtureModule()]) },
  workerData.childGroups,
);
