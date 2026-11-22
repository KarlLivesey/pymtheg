// SPDX-License-Identifier: MIT
// C-50: the production entry of the CLI's graph worker (graph-runner.ts).
import { workerData } from "node:worker_threads";
import type { GraphRequest } from "../graph/commands.js";
import { serveGraphRequest } from "./graph-worker.js";

const { request, control } = workerData as {
  request: GraphRequest;
  control: SharedArrayBuffer;
};
await serveGraphRequest(request, control);
