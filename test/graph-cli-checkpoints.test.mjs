// SPDX-License-Identifier: MIT
// C-50 review (third reviewer): once the CLI's coordinator has set the
// shared cancel flag, no later checkpoint of the command passes, even while
// the worker is too busy to read the `cancel` message. Before, a query
// paused at its first store read, or an edited index paused before its
// completion write, went on to answer, and the CLI exited 0 after SIGINT.
// The worker (test/graph-cli-pause-worker.mjs) pauses inside one store
// method until the flag is set; the test aborts once it has paused.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runGraphInWorker } from "../dist/cli/graph-runner.js";
import { executeGraph } from "../dist/graph/commands.js";
import { LanguageRegistry } from "../dist/graph/index.js";
import { fixtureFiles, fixtureModule } from "./graph-kill-fixture.mjs";

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
  const flag = new Int32Array(new SharedArrayBuffer(4));
  const controller = new AbortController();
  const run = runGraphInWorker(request, {
    signal: controller.signal,
    workerURL: new URL("./graph-cli-pause-worker.mjs", import.meta.url),
    workerData: { flag: flag.buffer, pause },
  });
  const outcome = run.then(
    () => "resolved",
    (error) => `${error.name}: ${error.message}`,
  );
  // A run that ends without pausing fails the test instead of hanging it.
  const waited = Atomics.waitAsync(flag, 0, 0);
  const first = await Promise.race([
    waited.async ? waited.value.then(() => "paused") : "paused",
    outcome.then((value) => `ended before pausing (${value})`),
  ]);
  assert.equal(first, "paused");
  controller.abort();
  return (await outcome).split(":")[0];
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

test("an index paused inside its completion write answers cancelled: the result is the last checkpoint", async (t) => {
  const root = await project(t, true);
  assert.equal(
    await aborted({ command: "index", root }, "completeGraphCommandState"),
    "AbortError",
  );
  // The flag was set after the checkpoint before the write, so the
  // completion is written; the answer is still the cancel's.
  assert.equal(await status(root), true);
});
