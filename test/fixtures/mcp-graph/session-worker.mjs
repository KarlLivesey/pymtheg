// The production graph worker (C-48) with test controls, set by the test
// through `workerData`:
//   gate: Int32Array over a SharedArrayBuffer: [paused, released, writes]
//   mode: "production"   production modules, no pause
//         "pause-store"  production modules; the worker stops inside its
//                        first file write (the core section) until the
//                        server's cancel flag is set (gate[2]: checkpoints
//                        passed by then)
//         "pause-module" the synthetic module; stops inside its first parse
//                        (a module call) until released
//         "crash-module" the synthetic module; a file named crash.syn exits
//                        the worker from inside its parse
//         "keeping"      the synthetic module, keeping a name map (C-45)
//         "write-limit"  production modules; stops for good at its
//                        `writes`th committed write (gate[2])
//         "pause-query"  the keeping module; a query stops inside its first
//                        call-link read until released
//         "await-module" the synthetic module; its analysis returns a promise
//                        that settles only when the signal aborts
//         "await-deaf"   the same, never settling
//         "stretch-module" the synthetic module; its analysis awaits, then
//                        stops inside a marked synchronous stretch
//                        (`synchronousStretch`) until released
//         "table-race"   the table module (C-45 review); while gate[2] is 1,
//                        the next run's baseline is preceded by another
//                        process's complete `graph index` (once)
// A stopped worker sets gate[0] to 1 and waits for gate[1].
import { workerData } from "node:worker_threads";
import { serveGraphRequests } from "../../../dist/mcp/graph-worker.js";
import { synchronousStretch } from "../../../dist/graph/sections.js";
import {
  LanguageRegistry,
  SqliteGraphStore,
} from "../../../dist/graph/index.js";
import { module as synthetic } from "../graph-core/synthetic.mjs";
import { keepingModule } from "./keeping-module.mjs";
import { tableModule } from "../graph-session/table-module.mjs";
import { spawnSync } from "node:child_process";

const gate = new Int32Array(workerData.gate);
const stop = () => {
  Atomics.store(gate, 0, 1);
  Atomics.notify(gate, 0);
  while (Atomics.load(gate, 1) === 0) Atomics.wait(gate, 1, 0);
};
const proto = SqliteGraphStore.prototype;
let registry;
if (workerData.mode === "pause-store") {
  // Stops inside its first file write and cannot go on until the server's
  // cancel flag is set, so the run cannot finish before the cancel; then
  // records the checkpoint count at that moment in gate[2].
  const control = new Int32Array(workerData.control);
  const replaceFile = proto.replaceFile;
  let stopped = false;
  proto.replaceFile = function (...args) {
    if (!stopped) {
      stopped = true;
      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
      while (Atomics.load(control, 0) === 0) Atomics.wait(control, 0, 0);
      Atomics.store(gate, 2, Atomics.load(control, 2));
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
if (workerData.mode === "pause-query") {
  // The keeping module; a query stops inside its first call-link read.
  registry = new LanguageRegistry([keepingModule]);
  const callLinks = proto.callLinks;
  let stopped = false;
  proto.callLinks = function (...args) {
    if (!stopped) {
      stopped = true;
      stop();
    }
    return callLinks.apply(this, args);
  };
}
if (workerData.mode === "await-module" || workerData.mode === "await-deaf") {
  // The synthetic module with an analysis that returns at once a promise
  // that settles only when the signal aborts ("await-module", as Rust's
  // phase worker does) or never ("await-deaf"). It reports its start.
  registry = new LanguageRegistry([
    {
      ...synthetic,
      analyze(context) {
        // Reported after the call has returned its promise, so the worker
        // is in its "awaiting" section by then.
        queueMicrotask(() => {
          Atomics.store(gate, 0, 1);
          Atomics.notify(gate, 0);
        });
        return new Promise((resolve, reject) => {
          if (workerData.mode === "await-module")
            context.signal?.addEventListener("abort", () =>
              reject(context.signal.reason),
            );
        });
      },
    },
  ]);
}
if (workerData.mode === "stretch-module") {
  // An async analysis (as Go's is): after an await it runs synchronous code
  // that cannot finish, marked as the module's own stretch. The marking is
  // what makes it read as inside the call (C-50).
  registry = new LanguageRegistry([
    {
      ...synthetic,
      async analyze() {
        await Promise.resolve();
        return synchronousStretch(stop);
      },
    },
  ]);
}
if (workerData.mode === "table-race") {
  registry = new LanguageRegistry([tableModule]);
  const beginIndexRun = proto.beginIndexRun;
  const child = new URL("../graph-session/index-child.mjs", import.meta.url)
    .pathname;
  proto.beginIndexRun = function (...args) {
    if (Atomics.load(gate, 2) === 1) {
      Atomics.store(gate, 2, 0);
      const other = spawnSync(process.execPath, [child, workerData.root], {
        encoding: "utf8",
      });
      if (other.status !== 0) throw Error(other.stderr);
    }
    return beginIndexRun.apply(this, args);
  };
}
if (workerData.mode === "keeping")
  registry = new LanguageRegistry([keepingModule]);
serveGraphRequests(registry ? { registry } : {});
