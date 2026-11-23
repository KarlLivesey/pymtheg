// SPDX-License-Identifier: MIT
// C-50: a CLI graph run stuck inside a language module's synchronous
// analysis is ended by an abort (SIGINT/SIGTERM/SIGHUP/SIGQUIT in the CLI),
// because the command runs in a worker that the coordinator terminates. The
// worker that cannot finish signals, through shared memory, that it is where
// the scenario needs it before the abort; no wait decides an outcome.
//
// Each cancellation scenario runs in a child process
// (graph-cli-cancel-scenario.mjs), so a regression that leaves a worker or a
// process running fails the test instead of hanging the run: the child's
// process group is killed after a few minutes, and any child process it
// reported is killed too. That bound only turns a hang into a failure.
import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGraphInWorker } from "../dist/cli/graph-runner.js";
import { fixtureFiles } from "./graph-kill-fixture.mjs";

const HANG_GUARD_MS = 3 * 60_000;
/** Runs a scenario in its own process group; its JSON facts, or a failure. */
async function scenario(name) {
  const scratch = await mkdtemp(join(tmpdir(), `pymtheg-cli-${name}-`));
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL("./graph-cli-cancel-scenario.mjs", import.meta.url),
      ),
      name,
      scratch,
    ],
    { detached: true, stdio: ["ignore", "pipe", "inherit"] },
  );
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  let guard;
  const ended = await Promise.race([
    new Promise((resolve) => child.on("exit", () => resolve(true))),
    new Promise(
      (resolve) => (guard = setTimeout(resolve, HANG_GUARD_MS, false)),
    ),
  ]);
  clearTimeout(guard);
  const facts = out
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (!ended)
    for (const pid of [-child.pid, ...facts.map((f) => f.pid).filter(Boolean)])
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
  await rm(scratch, { recursive: true, force: true });
  assert.ok(ended, `the ${name} scenario did not finish: ${out}`);
  return Object.assign({}, ...facts.filter((f) => !f.pid));
}

test("an abort ends a graph run stuck inside a module call, and the next index repairs the store to a cold index's rows", async () => {
  const facts = await scenario("stuck");
  assert.equal(facts.rejected, "AbortError");
  assert.equal(facts.status, "ok");
  assert.equal(facts.same, true);
});

// C-50 review: a child process the worker started (as a toolchain is) is
// killed with its whole process group when the coordinator terminates the
// worker; a terminated worker could not kill it itself. The child and a
// grandchild each hold a connection to the scenario's socket, which closes
// only when that process has died.
test("an abort inside a module call kills the child processes the worker started", async () => {
  const facts = await scenario("child");
  assert.equal(facts.rejected, "AbortError");
  assert.equal(facts.closed, 2);
});

// C-50 review: synchronous work a module runs after an await, marked with
// `synchronousStretch` (as Go marks its link notes and parse), is inside
// the module call, so the abort terminates the worker there.
test("an abort ends a module's synchronous stretch after an await", async () => {
  const facts = await scenario("stretch");
  assert.equal(facts.rejected, "AbortError");
});

// C-50 review: an abort that finds the worker outside a module call asks
// for a cooperative cancel. If the worker reaches the next module call
// before the cancel message is read, it refuses to enter it (the flag the
// coordinator set): the call that cannot finish is never entered.
test("after an abort the worker refuses to enter the next module call", async () => {
  const facts = await scenario("block");
  assert.equal(facts.rejected, "AbortError");
  assert.equal(facts.entered, 0);
});

test("a run that is not aborted answers through the worker", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-cli-run-"));
  try {
    for (const [path, text] of Object.entries(fixtureFiles(3)))
      await writeFile(join(scratch, path), text);
    const flag = new SharedArrayBuffer(4);
    const progress = [];
    const response = await runGraphInWorker(
      { command: "index", root: scratch },
      {
        signal: new AbortController().signal,
        progress: (p) => progress.push(p.phase),
        workerURL: new URL("./graph-cli-stuck-worker.mjs", import.meta.url),
        workerData: { flag },
      },
    );
    assert.equal(response.status, "ok");
    assert.equal(response.counts.files, 3);
    assert.ok(progress.includes("complete"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
