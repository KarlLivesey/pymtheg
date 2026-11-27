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
import { bounded, killMarked, killOwned } from "./owned-processes.mjs";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGraphInWorker } from "../dist/cli/graph-runner.js";
import { executeGraph } from "../dist/graph/commands.js";
import { LanguageRegistry } from "../dist/graph/index.js";
import { synchronousStretch } from "../dist/graph/sections.js";
import { fixtureFiles, fixtureModule } from "./graph-kill-fixture.mjs";

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
  let ended = false;
  try {
    ended = await Promise.race([
      new Promise((resolve) => child.on("exit", () => resolve(true))),
      new Promise(
        (resolve) => (guard = setTimeout(resolve, HANG_GUARD_MS, false)),
      ),
    ]);
  } finally {
    clearTimeout(guard);
    // Sol review: whatever the scenario printed, nothing it started is left
    // running, before any output is parsed (a partial line once threw
    // first). Only processes this test started are killed: each carries the
    // scenario's scratch path on its command line (test/owned-processes.mjs);
    // the pids are read from the raw output.
    if (!ended) killOwned(child.pid, scratch, { group: true });
    for (const [, pid] of out.matchAll(/"pid":(\d+)/g)) {
      killOwned(Number(pid), scratch, { group: true });
      killOwned(Number(pid), scratch);
    }
    // Sol review: and every process that carries the scratch path (each
    // fixture's socket is in it), reported or not.
    killMarked(scratch);
    await rm(scratch, { recursive: true, force: true });
  }
  assert.ok(ended, `the ${name} scenario did not finish: ${out}`);
  const facts = out
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

// C-50 review, as C-48's server does: an abort that finds the worker
// awaiting a module's promise kills the run's processes at once and asks
// the worker to abort. The module here awaits a child it does not pass the
// signal to, so only that kill ends the wait; the run then stops at its
// next checkpoint.
test("an abort while a module awaits a child process kills it, and the run ends", async () => {
  const facts = await scenario("await-child");
  assert.equal(facts.rejected, "AbortError");
  assert.equal(facts.closed, 2);
});

// C-50 review: the cooperative path itself. A module's async analysis
// creates a run folder (as the Go toolchain route does) and removes it only
// when its abort signal fires; it cannot finish otherwise. The abort finds
// the worker awaiting, so the coordinator asks it to cancel, and the
// command aborts the module's signal: the folder is gone when the run
// answers. Terminating the worker instead (on every cancel, or by reading
// the awaited section as the module's) leaves the folder; a worker that
// ignores the cancel never answers, and the scenario fails at its bound.
test("an abort while a module's promise is awaited reaches the module, which cleans up before the run answers", async () => {
  const facts = await scenario("cleanup");
  assert.equal(facts.rejected, "AbortError");
  assert.equal(facts.folderLeft, false);
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

// C-50 review: what a worker reads for a module's marked stretch. The CLI
// worker and the MCP worker (src/mcp/graph-worker.ts) both map `true` to
// the module section and "awaiting" to the awaited one, so a stretch marked
// with `synchronousStretch` after an await reads as the module section in
// both.
test("a module's marked synchronous stretch is reported as inside the module call", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-cli-stretch-"));
  try {
    await writeFile(join(scratch, "a.x"), "def a\n");
    const base = fixtureModule();
    const states = [];
    let inStretch;
    const module = {
      ...base,
      async parse(input) {
        await null;
        return synchronousStretch(() => {
          inStretch = states.at(-1);
          return base.parse(input);
        });
      },
    };
    const response = await executeGraph(
      { command: "index", root: scratch },
      {
        registry: new LanguageRegistry([module]),
        onModuleCall: (inside) => states.push(inside),
      },
    );
    assert.equal(response.status, "ok");
    assert.equal(inStretch, true);
    // The call, its awaited promise, the stretch, awaited again, settled.
    const parse = states.indexOf(true);
    assert.deepEqual(states.slice(parse, parse + 5), [
      true,
      "awaiting",
      true,
      "awaiting",
      false,
    ]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("a run that is not aborted answers through the worker", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-cli-run-"));
  // C-50 review: ended whatever the test found.
  let worker;
  try {
    for (const [path, text] of Object.entries(fixtureFiles(3)))
      await writeFile(join(scratch, path), text);
    const flag = new SharedArrayBuffer(4);
    const progress = [];
    const response = await bounded(
      runGraphInWorker(
        { command: "index", root: scratch },
        {
          signal: new AbortController().signal,
          progress: (p) => progress.push(p.phase),
          workerURL: new URL("./graph-cli-stuck-worker.mjs", import.meta.url),
          workerData: { flag },
          onWorker: (started) => (worker = started),
        },
      ),
      "the run to answer",
    );
    assert.equal(response.status, "ok");
    assert.equal(response.counts.files, 3);
    assert.ok(progress.includes("complete"));
  } finally {
    await worker?.terminate();
    await rm(scratch, { recursive: true, force: true });
  }
});
