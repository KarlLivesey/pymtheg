// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { queryImplementation } from "../dist/implementation/query-runner.js";
const empty = { index: {}, documents: [] };
const options = { mode: "gaps", query: "", offset: 0, limit: 20 };
test("a CPU-bound graph query is cancelled through its actual owned worker coordinator", async () => {
  const controller = new AbortController();
  const workerURL = new URL(
    "data:text/javascript," +
      encodeURIComponent(
        'import {parentPort} from "node:worker_threads";parentPort.postMessage({kind:"ready"});while(true){}',
      ),
  );
  await assert.rejects(
    queryImplementation(empty, null, options, null, controller.signal, {
      workerURL,
      onReady: () => controller.abort(),
    }),
    /cancelled/,
  );
});
test("a graph worker cannot publish malformed output as a completed result", async () => {
  const workerURL = new URL(
    "data:text/javascript," +
      encodeURIComponent(
        'import {parentPort} from "node:worker_threads";parentPort.postMessage({result:{items:[]}});',
      ),
  );
  await assert.rejects(
    queryImplementation(
      empty,
      null,
      options,
      null,
      new AbortController().signal,
      { workerURL },
    ),
    /invalid|expected/i,
  );
});
