// SPDX-License-Identifier: MIT
import { parentPort, workerData } from "node:worker_threads";
import { rustPhases } from "./index.js";
import type { PhaseMessage, PhaseRequest } from "./phase-runner.js";

const request = workerData as PhaseRequest;
const send = (message: PhaseMessage) => parentPort!.postMessage(message);
try {
  const result =
    request.phase === "analyze"
      ? rustPhases.analyze(request.context)
      : rustPhases.resolve(request.context);
  send({ kind: "done", result });
} catch (error) {
  send({
    kind: "error",
    message: error instanceof Error ? error.message : String(error),
  });
}
