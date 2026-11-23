// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GraphJobs } from "../dist/mcp/graph-jobs.js";
test("graph lifecycle uses controlled readiness: busy rejection, cancellation, reuse, crash, retention and close join", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-r1c-jobs-"));
  const jobs = new GraphJobs(root, {
    launch: (control) =>
      new Worker(
        new URL("./fixtures/mcp-graph/controlled-worker.mjs", import.meta.url),
        { workerData: { control } },
      ),
  });
  const start = async () => {
    const job = jobs.start({ command: "index" });
    await new Promise((resolve) => job.listeners.add(resolve));
    assert.equal(job.progress.phase, "controlled-ready");
    return job;
  };
  try {
    const cancelled = await start();
    assert.throws(() => jobs.start({ command: "status" }), /running/);
    // The controlled worker is inside a module call: it is terminated.
    await jobs.cancel(cancelled.id);
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.exited, true);
    const started = jobs.generation;
    // An answered job leaves its worker for the next one: three jobs, one
    // new worker (the cancelled one was terminated).
    for (let i = 0; i < 3; i++) {
      const job = await start();
      job.worker.postMessage("finish");
      await job.done;
      assert.equal(job.state, "error");
    }
    assert.equal(jobs.generation, started + 1);
    assert.throws(() => jobs.get(cancelled.id), /expired/);
    const crashed = await start();
    crashed.worker.postMessage("unexpected-exit");
    await crashed.done;
    assert.equal(crashed.state, "error");
    assert.match(crashed.error, /exited/);
    // The next job starts a new worker.
    const after = await start();
    assert.equal(jobs.generation, started + 2);
    after.worker.postMessage("finish");
    await after.done;
    const closing = await start();
    await jobs.close();
    await closing.done;
    assert.equal(closing.state, "cancelled");
    assert.throws(() => jobs.start({ command: "index" }), /closed/);
  } finally {
    await jobs.close();
    await rm(root, { recursive: true, force: true });
  }
});
