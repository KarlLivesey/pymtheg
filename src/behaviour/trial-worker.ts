import { workerData, parentPort } from "node:worker_threads";
import { tryFlow } from "./trial.js";
parentPort!.postMessage(
  tryFlow(workerData.ir, workerData.entry, workerData.inputs),
);
