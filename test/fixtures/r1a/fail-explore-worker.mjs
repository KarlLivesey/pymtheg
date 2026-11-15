// Test-only preload (`node --import`): constructing the built-in search worker
// throws, so the production adapter sees a real worker/engine error. Every
// other worker (analysis, lowering) starts normally.
import { createRequire, syncBuiltinESMExports } from "node:module";
const threads = createRequire(import.meta.url)("node:worker_threads");
const Original = threads.Worker;
threads.Worker = class extends Original {
  constructor(url, options) {
    if (String(url).endsWith("/explore-worker.js"))
      throw Error("controlled explore worker failure");
    super(url, options);
  }
};
syncBuiltinESMExports();
