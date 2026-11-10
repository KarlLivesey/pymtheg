import { parentPort, workerData } from "node:worker_threads";
import { lower } from "./model.js";
import type { ProjectIR } from "../semantic/core.js";
const data = workerData as { ir: ProjectIR; entry: string; scope: unknown };
try {
  parentPort!.postMessage(lower(data.ir, data.entry, data.scope));
} catch (e) {
  parentPort!.postMessage({ kind: "incomplete", reasons: [String(e)] });
}
