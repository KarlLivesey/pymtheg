// SPDX-License-Identifier: MIT
// C-50 review (third reviewer): once the CLI's coordinator has set the
// shared cancel flag, no later checkpoint of the command passes, even while
// the worker is too busy to read the `cancel` message. Before, a query
// paused at its first store read, or an edited index paused before its
// completion write, went on to answer, and the CLI exited 0 after SIGINT.
// The worker (test/graph-cli-pause-worker.mjs) pauses inside one store
// method until the flag is set; the test aborts once it has paused.
//
// C-50 review: every wait has a bound that ends the test, and the worker
// each test starts is terminated in its clean-up whatever it found.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runGraphInWorker } from "../dist/cli/graph-runner.js";
import { executeGraph } from "../dist/graph/commands.js";
import { LanguageRegistry } from "../dist/graph/index.js";
import { fixtureFiles, fixtureModule } from "./graph-kill-fixture.mjs";
import { bounded } from "./owned-processes.mjs";

const registry = () => new LanguageRegistry([fixtureModule()]);

/** An indexed fixture project; `edit` changes one file afterwards. */
async function project(t, edit) {
  const root = await mkdtemp(join(tmpdir(), "pym-cli-checkpoints-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(fixtureFiles(3)))
    await writeFile(join(root, path), text);
  const cold = await executeGraph(
    { command: "index", root },
    { registry: registry() },
  );
  assert.equal(cold.sync.complete, true);
  if (edit) await writeFile(join(root, "f0.x"), "def f0\ncall g0\ndef g0\n");
  return root;
}

/** Runs `request` in the pausing worker and aborts once it has paused. */
async function aborted(request, pause) {
  const flag = new Int32Array(new SharedArrayBuffer(8));
  const controller = new AbortController();
  let worker;
  const run = runGraphInWorker(request, {
    signal: controller.signal,
    workerURL: new URL("./graph-cli-pause-worker.mjs", import.meta.url),
    workerData: { flag: flag.buffer, pause },
    onWorker: (started) => (worker = started),
  });
  const end = () => worker.terminate();
  const outcome = run.then(
    () => "resolved",
    (error) => `${error.name}: ${error.message}`,
  );
  try {
    // A run that ends without pausing fails the test instead of hanging it.
    const waited = Atomics.waitAsync(flag, 0, 0);
    const first = await bounded(
      Promise.race([
        waited.async ? waited.value.then(() => "paused") : "paused",
        outcome.then((value) => `ended before pausing (${value})`),
      ]),
      "the worker to pause",
      end,
    );
    assert.equal(first, "paused");
    controller.abort();
    return (await bounded(outcome, "the run to end", end)).split(":")[0];
  } finally {
    // Whatever was found, the worker is released and ended.
    controller.abort();
    Atomics.store(flag, 1, 1);
    await end();
  }
}

const status = async (root) =>
  (await executeGraph({ command: "status", root }, { registry: registry() }))
    .sync.complete;

test("a query paused at its first store read stops at the next read once the coordinator has set the cancel flag", async (t) => {
  const root = await project(t, false);
  assert.equal(
    await aborted(
      { command: "file", args: ["f0.x"], root, noSync: true },
      "hasFile",
    ),
    "AbortError",
  );
});

test("an edited index paused after its last store write of the run stops before the completion write", async (t) => {
  const root = await project(t, true);
  assert.equal(
    await aborted({ command: "index", root }, "finishIndexRun"),
    "AbortError",
  );
  // The completion was not written: the index is incomplete.
  assert.equal(await status(root), false);
});

test("an index paused inside its completion write is complete: the stop came after it", async (t) => {
  const root = await project(t, true);
  // The flag is set after the checkpoint ahead of the write, so the
  // completion is written; the answer is the index's, complete (C-50
  // review: one outcome per stop).
  assert.equal(
    await aborted({ command: "index", root }, "completeGraphCommandState"),
    "resolved",
  );
  assert.equal(await status(root), true);
});

// C-50 review: a cancel taken cooperatively in an awaited call's unmarked
// code, after which the module enters a marked stretch. The stretch's entry
// re-reads the flag and refuses: the coordinator did not terminate the
// worker (the section was not the module's), so a stretch begun now would
// run to its end.
test("a marked stretch entered after a cooperative cancel is refused", async (t) => {
  const root = await project(t, false);
  await writeFile(join(root, "z.x"), "def stretch\n");
  const flag = new Int32Array(new SharedArrayBuffer(16));
  const controller = new AbortController();
  let worker;
  const run = runGraphInWorker(
    { command: "index", root },
    {
      signal: controller.signal,
      workerURL: new URL("./graph-cli-stretch-worker.mjs", import.meta.url),
      workerData: { flag: flag.buffer },
      onWorker: (started) => (worker = started),
    },
  );
  const end = () => worker.terminate();
  const outcome = run.then(
    () => "resolved",
    (error) => error.name,
  );
  const release = (at) => {
    Atomics.store(flag, at, 1);
    Atomics.notify(flag, at);
  };
  try {
    const blocked = Atomics.waitAsync(flag, 0, 0);
    if (blocked.async)
      await bounded(blocked.value, "the unmarked code to be reached", end);
    controller.abort();
    release(1);
    // Either the run ends (the stretch refused), or the stretch is entered.
    const entered = Atomics.waitAsync(flag, 2, 0);
    const first = await bounded(
      Promise.race([
        outcome,
        entered.async ? entered.value.then(() => "entered") : "entered",
      ]),
      "the run to end or the stretch to be entered",
      end,
    );
    assert.equal(first, "AbortError");
    assert.equal(Atomics.load(flag, 2), 0, "the stretch was never entered");
  } finally {
    release(1);
    release(3);
    await end();
  }
});
