// SPDX-License-Identifier: MIT
// C-50: a CLI graph run stuck inside a language module's synchronous
// analysis is ended by an abort (SIGINT/SIGTERM in the CLI), because the
// command runs in a worker that the coordinator terminates. The worker that
// cannot finish signals, through shared memory, that it is inside the
// module call before the test aborts; nothing depends on time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGraphInWorker } from "../dist/cli/graph-runner.js";
import { executeGraph } from "../dist/graph/commands.js";
import { LanguageRegistry } from "../dist/graph/index.js";
import { fixtureFiles, fixtureModule } from "./graph-kill-fixture.mjs";

test("an abort ends a graph run stuck inside a module call, and the next index repairs the store", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-cli-cancel-"));
  const root = join(scratch, "project");
  try {
    await mkdir(root);
    for (const [path, text] of Object.entries(fixtureFiles(6)))
      await writeFile(join(root, path), text);
    await writeFile(join(root, "z.x"), "def stuck\n");
    const flag = new SharedArrayBuffer(4);
    const controller = new AbortController();
    const run = runGraphInWorker(
      { command: "index", root },
      {
        signal: controller.signal,
        workerURL: new URL("./graph-cli-stuck-worker.mjs", import.meta.url),
        workerData: { flag },
      },
    );
    // Readiness: the module is inside its synchronous call.
    const waited = Atomics.waitAsync(new Int32Array(flag), 0, 0);
    if (waited.async) await waited.value;
    controller.abort();
    await assert.rejects(run, (error) => error.name === "AbortError");

    // The store is left as a killed run leaves it; the next index (without
    // the file that cannot be analysed) repairs it and equals a cold index.
    await rm(join(root, "z.x"));
    const registry = () => new LanguageRegistry([fixtureModule()]);
    const after = await executeGraph(
      { command: "index", root },
      { registry: registry() },
    );
    assert.equal(after.status, "ok");
    const cold = join(scratch, "cold");
    await mkdir(cold);
    for (const [path, text] of Object.entries(fixtureFiles(6)))
      await writeFile(join(cold, path), text);
    const fresh = await executeGraph(
      { command: "index", root: cold },
      { registry: registry() },
    );
    assert.deepEqual(after.counts, fresh.counts);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

// C-50 review: a child process the worker started (as a toolchain is) is
// killed with its whole process group when the coordinator terminates the
// worker; a terminated worker could not kill it itself. The child and a
// grandchild each hold a connection to the test's socket, which closes only
// when that process has died.
test("an abort inside a module call kills the child processes the worker started", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-cli-child-"));
  const root = join(scratch, "project");
  const socket = join(scratch, "child.sock");
  const connections = [];
  const sockets = [];
  const pids = [];
  let connected;
  const both = new Promise((resolve) => (connected = resolve));
  const server = createServer((connection) => {
    sockets.push(connection);
    connections.push(new Promise((resolve) => connection.on("close", resolve)));
    connection.setEncoding("utf8");
    connection.on("data", (text) => {
      const pid = Number.parseInt(text, 10);
      if (pid > 0) pids.push(pid);
    });
    if (connections.length === 2) connected();
  });
  await new Promise((resolve) => server.listen(socket, resolve));
  try {
    await mkdir(root);
    for (const [path, text] of Object.entries(fixtureFiles(2)))
      await writeFile(join(root, path), text);
    await writeFile(join(root, "z.x"), "def stuck\n");
    const flag = new SharedArrayBuffer(4);
    const controller = new AbortController();
    const run = runGraphInWorker(
      { command: "index", root },
      {
        signal: controller.signal,
        workerURL: new URL("./graph-cli-stuck-worker.mjs", import.meta.url),
        workerData: { flag, socket },
      },
    );
    // Readiness: the module is inside its synchronous call, and the child
    // and the grandchild are both running.
    const waited = Atomics.waitAsync(new Int32Array(flag), 0, 0);
    if (waited.async) await waited.value;
    await both;
    controller.abort();
    await assert.rejects(run, (error) => error.name === "AbortError");
    // Both processes die: each connection closes. The coordinator has
    // already sent SIGKILL when the run rejects; the guard only turns a
    // regression (processes left running) into a failure instead of a hang.
    // It decides nothing when the test passes.
    let guard;
    const closed = await Promise.race([
      Promise.all(connections).then(() => true),
      new Promise((resolve) => (guard = setTimeout(resolve, 60_000, false))),
    ]);
    clearTimeout(guard);
    assert.equal(closed, true, "a child process survived the cancelled run");
    assert.equal(connections.length, 2);
  } finally {
    // Whatever survived a failure is ended, so the test process can exit.
    for (const pid of pids)
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    for (const socket of sockets) socket.destroy();
    server.close();
    await rm(scratch, { recursive: true, force: true });
  }
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
