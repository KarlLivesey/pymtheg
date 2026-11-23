// A graph worker that speaks the C-48 protocol but cannot complete on its
// own: only an explicit message from the test, or termination, ends a job.
// It reports itself inside a module call, so cancelling it terminates it.
import { parentPort, workerData } from "node:worker_threads";
const control = new Int32Array(workerData.control);
let id;
parentPort.on("message", (message) => {
  if (message?.kind === "request") {
    id = message.id;
    Atomics.store(control, 1, 1);
    parentPort.postMessage({ kind: "progress", id, progress: { phase: "controlled-ready", done: 0, total: 1 } });
    return;
  }
  if (message === "complete") {
    const symbol = { id: "symbol:" + "a".repeat(64), name: "Ready", identity: "Ready", kind: "function", module: "go", file: "a.go", range: { start: 0, end: 1 }, status: "clean", line: 1, column: 1, endLine: 1, endColumn: 2 };
    Atomics.store(control, 1, 0);
    parentPort.postMessage({ kind: "result", id, view: { tables: { answer: [{ ...symbol, ref: symbol.id, type: "match", at: "a.go:1:1" }], symbols: [], links: [], possible_callers: [], failed_files: [] }, summary: { status: "ok", truncated: false }, details: new Map() } });
    return;
  }
  if (message === "unexpected-exit") process.exit(7);
  if (message === "finish") {
    Atomics.store(control, 1, 0);
    parentPort.postMessage({ kind: "error", id, message: "Controlled terminal result" });
  }
});
