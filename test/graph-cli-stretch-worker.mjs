// SPDX-License-Identifier: MIT
// C-50 review: a CLI graph worker whose module, inside a call already
// awaited, runs unmarked code and then a marked stretch. Flags (Int32,
// `workerData.flag`): [0] raised when the unmarked code is reached; it
// blocks there until [1] is set; [2] raised if the marked stretch is ever
// entered; the stretch blocks until [3] is set.
import { workerData } from "node:worker_threads";
import { serveGraphRequest } from "../dist/cli/graph-worker.js";
import { LanguageRegistry } from "../dist/graph/index.js";
import { synchronousStretch } from "../dist/graph/sections.js";
import { fixtureModule } from "./graph-kill-fixture.mjs";

const flag = new Int32Array(workerData.flag);
const base = fixtureModule();
const module = {
  ...base,
  parse(input) {
    if (!input.text.includes("stretch")) return base.parse(input);
    return (async () => {
      await null;
      // Unmarked code of the awaited call: the section is not the module's.
      Atomics.store(flag, 0, 1);
      Atomics.notify(flag, 0);
      while (Atomics.load(flag, 1) === 0) Atomics.wait(flag, 1, 0);
      return synchronousStretch(() => {
        Atomics.store(flag, 2, 1);
        Atomics.notify(flag, 2);
        while (Atomics.load(flag, 3) === 0) Atomics.wait(flag, 3, 0);
        return base.parse(input);
      });
    })();
  },
};
await serveGraphRequest(
  workerData.request,
  workerData.control,
  { registry: new LanguageRegistry([module]) },
  workerData.childGroups,
);
