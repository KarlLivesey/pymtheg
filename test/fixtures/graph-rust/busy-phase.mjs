import { isMainThread, workerData } from "node:worker_threads";

// The CLI launches its real Rust worker. Preloading keeps that worker busy
// indefinitely; receiving the marker establishes readiness before signalling.
// An edited index runs its analysis worker as `analyzeScoped` (C-36).
if (
  !isMainThread &&
  process.env.PYM_TEST_BUSY_RUST_PHASE &&
  workerData?.phase?.startsWith(process.env.PYM_TEST_BUSY_RUST_PHASE)
) {
  process.stderr.write("rust cancellation fixture ready\n");
  const counter = new Int32Array(new SharedArrayBuffer(4));
  for (;;) Atomics.add(counter, 0, 1);
}
