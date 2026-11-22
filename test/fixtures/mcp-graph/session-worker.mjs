// The production graph worker (C-48) with test controls, set by the test
// through `workerData`:
//   gate: Int32Array over a SharedArrayBuffer: [paused, released, writes]
//   mode: "production"   production modules, no pause
//         "pause-store"  production modules; the worker stops inside its
//                        first file write (the core section) until released
//         "pause-module" the synthetic module; stops inside its first parse
//                        (a module call) until released
//         "crash-module" the synthetic module; a file named crash.syn exits
//                        the worker from inside its parse
//         "keeping"      the synthetic module, keeping a name map (C-45)
//         "write-limit"  production modules; stops for good at its
//                        `writes`th committed write (gate[2])
// A stopped worker sets gate[0] to 1 and waits for gate[1].
import { workerData } from "node:worker_threads";
import { serveGraphRequests } from "../../../dist/mcp/graph-worker.js";
import {
  LanguageRegistry,
  SqliteGraphStore,
} from "../../../dist/graph/index.js";
import { module as synthetic } from "../graph-core/synthetic.mjs";
import { keepingModule } from "./keeping-module.mjs";

const gate = new Int32Array(workerData.gate);
const stop = () => {
  Atomics.store(gate, 0, 1);
  Atomics.notify(gate, 0);
  while (Atomics.load(gate, 1) === 0) Atomics.wait(gate, 1, 0);
};
const proto = SqliteGraphStore.prototype;
let registry;
if (workerData.mode === "pause-store") {
  const replaceFile = proto.replaceFile;
  let stopped = false;
  proto.replaceFile = function (...args) {
    if (!stopped) {
      stopped = true;
      stop();
    }
    return replaceFile.apply(this, args);
  };
}
if (workerData.mode === "write-limit") {
  // Counts committed writes as the C-22 kill child does (outer calls only).
  let writes = 0;
  for (const name of [
    "transaction",
    "removeFile",
    "invalidateGraphCommandState",
  ]) {
    const original = proto[name];
    proto[name] = function (...args) {
      const outer = !this.c48Writing;
      this.c48Writing = true;
      try {
        return original.apply(this, args);
      } finally {
        if (outer) {
          this.c48Writing = false;
          if (++writes === Atomics.load(gate, 2)) stop();
        }
      }
    };
  }
}
if (workerData.mode === "pause-module" || workerData.mode === "crash-module") {
  let stopped = false;
  registry = new LanguageRegistry([
    {
      ...synthetic,
      parse(input) {
        if (workerData.mode === "crash-module" && input.path === "crash.syn")
          process.exit(9);
        if (workerData.mode === "pause-module" && !stopped) {
          stopped = true;
          stop();
        }
        return synthetic.parse(input);
      },
    },
  ]);
}
if (workerData.mode === "keeping")
  registry = new LanguageRegistry([keepingModule]);
serveGraphRequests(registry ? { registry } : {});
