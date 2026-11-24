// C-50 review: preloaded into the real CLI (`node --import`). Worker threads
// inherit the preload, so in the CLI's graph worker (its `workerData` holds
// the request and the control memory) the TypeScript module's analysis, one
// synchronous module call, is replaced by one that cannot finish. It says
// so on stderr first, so the test signals only once the worker is inside it.
import { isMainThread, workerData } from "node:worker_threads";

if (
  !isMainThread &&
  process.env.PYM_TEST_STUCK_TYPESCRIPT &&
  workerData?.request &&
  workerData?.control
) {
  const { default: typescript } = await import(
    "../../../dist/graph/languages/typescript/index.js"
  );
  typescript.analyze = () => {
    process.stderr.write("stuck typescript analysis ready\n");
    const counter = new Int32Array(new SharedArrayBuffer(4));
    for (;;) Atomics.add(counter, 0, 1);
  };
}
