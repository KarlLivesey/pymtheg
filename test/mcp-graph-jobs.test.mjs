import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GraphJobs } from "../dist/mcp/graph-jobs.js";
test("graph lifecycle uses controlled readiness: busy rejection, cancellation, retention and close join", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-r1c-jobs-"));
  const jobs = new GraphJobs(
    root,
    () =>
      new Worker(
        new URL("./fixtures/mcp-graph/controlled-worker.mjs", import.meta.url),
      ),
  );
  const start = async () => {
    const job = jobs.start({ command: "index" });
    await new Promise((resolve) => job.listeners.add(resolve));
    assert.equal(job.progress.phase, "controlled-ready");
    return job;
  };
  try {
    const cancelled = await start();
    assert.throws(() => jobs.start({ command: "status" }), /running/);
    await jobs.cancel(cancelled.id);
    assert.equal(cancelled.state, "cancelled");
    await cancelled.done;
    for (let i = 0; i < 3; i++) {
      const job = await start();
      job.worker.postMessage("finish");
      await job.done;
      assert.equal(job.state, "error");
    }
    assert.throws(() => jobs.get(cancelled.id), /expired/);
    const draining = await start();
    const announced = new Promise((resolve) =>
      draining.worker.once("message", resolve),
    );
    draining.worker.postMessage("announce-error");
    await announced;
    assert.equal(draining.state, "error");
    assert.equal(draining.exited, false);
    assert.throws(() => jobs.start({ command: "status" }), /running/);
    await jobs.cancel(draining.id);
    assert.equal(draining.exited, true);
    const crashed = await start();
    crashed.worker.postMessage("unexpected-exit");
    await crashed.done;
    assert.equal(crashed.state, "error");
    assert.match(crashed.error, /exited/);
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
