// SPDX-License-Identifier: MIT
// C-50: a graph worker whose language module cannot finish. It serves the
// request with the production protocol (serveGraphRequest) and a registry
// of the storage fixture language; parsing a file that contains "stuck"
// raises a flag in shared memory and then loops forever, synchronously.
import { workerData } from "node:worker_threads";
import { serveGraphRequest } from "../dist/cli/graph-worker.js";
import { LanguageRegistry } from "../dist/graph/index.js";
import { fixtureModule } from "./graph-kill-fixture.mjs";

const flag = new Int32Array(workerData.flag);
const base = fixtureModule();
const stuck = {
  ...base,
  parse(input) {
    if (input.text.includes("stuck")) {
      Atomics.store(flag, 0, 1);
      Atomics.notify(flag, 0);
      for (;;);
    }
    return base.parse(input);
  },
};
await serveGraphRequest(workerData.request, workerData.control, {
  registry: new LanguageRegistry([stuck]),
});
