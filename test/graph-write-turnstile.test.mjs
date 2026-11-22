// SPDX-License-Identifier: MIT
// C-37: a writer that waits beside a batching index run gets the write lock
// at the next batch boundary. Every writer passes a turnstile (a lock-only
// database beside the store) before it asks for the write lock, and the run
// passes it before each batch, so a waiter holding it stops the next batch
// from beginning. Counted, not timed: the run stops itself inside a batch,
// the waiter says when it holds the turnstile, and after the run resumes it
// records, at each of its commits, whether the waiter's write is in.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeAheadLogSafe } from "../dist/storage/local.js";

const child = new URL("graph-write-turnstile-child.mjs", import.meta.url)
  .pathname;
const proc = existsSync("/proc/self/status");
const skip =
  (!proc && "needs /proc to see the child stopped") ||
  (!writeAheadLogSafe(tmpdir()) && "batches need the write-ahead log here");

/** Children still running when a test ends are killed (a failed assertion
 * could otherwise leave one stopped). */
const children = new Set();
function stopChildren() {
  for (const process_ of children)
    if (process_.exitCode === null && process_.signalCode === null)
      process_.kill("SIGKILL");
  children.clear();
}
/** A child in `mode`; `next(key)` resolves with its next message holding `key`. */
function start(args) {
  const process_ = fork(child, args, {
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  children.add(process_);
  const messages = [];
  const waiting = [];
  const deliver = () => {
    for (const [index, [key, done]] of waiting.entries()) {
      const found = messages.findIndex((message) => key in message);
      if (found < 0) continue;
      done(messages.splice(found, 1)[0]);
      waiting.splice(index, 1);
      return deliver();
    }
  };
  process_.on("message", (message) => {
    messages.push(message);
    deliver();
  });
  const exited = new Promise((done) =>
    process_.once("exit", (code, signal) => done({ code, signal })),
  );
  return {
    process: process_,
    exited,
    next: (key) =>
      new Promise((done) => {
        waiting.push([key, done]);
        deliver();
      }),
  };
}
async function stoppedFor(child_) {
  while (
    !/^State:\s+T/m.test(
      readFileSync(`/proc/${child_.process.pid}/status`, "utf8"),
    )
  )
    await new Promise(setImmediate);
}
function tree() {
  const base = mkdtempSync(join(tmpdir(), "c37-turnstile-"));
  const root = join(base, "tree");
  mkdirSync(root);
  for (let i = 0; i < 20; i++)
    writeFileSync(join(root, `${i}.syn`), `source ${i}`);
  return { base, root, graph: join(base, "graph.sqlite") };
}

test(
  "a waiting writer is in before the run's second commit after it waits",
  { skip },
  async () => {
    const { base, root, graph } = tree();
    try {
      // 21 rows per file: a batch of 50 rows commits after three files. The
      // run stops after its fifth write, inside its second batch.
      const run = start(["index", root, graph, "50", "5"]);
      const stop = await run.next("stopped");
      assert.equal(stop.inBatch, true);
      await stoppedFor(run);
      const writer = start(["write", graph]);
      assert.equal((await writer.next("holding")).holding, true);
      // The waiter holds the turnstile and waits for the write lock, which the
      // stopped run holds. The run goes on.
      run.process.kill("SIGCONT");
      assert.deepEqual((await writer.next("reply")).reply, { written: true });
      assert.equal((await writer.exited).code, 0);
      const { reply } = await run.next("reply");
      assert.equal((await run.exited).code, 0);
      assert.equal(reply.error, undefined);
      assert.equal(reply.indexed, 20);
      // The batch in progress commits without the waiter's write; every later
      // commit comes after it.
      assert.deepEqual(
        reply.after.map((commit) => commit.waiterVisible),
        [false, ...reply.after.slice(1).map(() => true)],
      );
      assert.ok(reply.after.length >= 2, JSON.stringify(reply.after));
    } finally {
      stopChildren();
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test(
  "a waiter that dies holding the turnstile does not stop the run",
  { skip },
  async () => {
    const { base, root, graph } = tree();
    try {
      const run = start(["index", root, graph, "50", "5"]);
      await run.next("stopped");
      await stoppedFor(run);
      const writer = start(["write", graph]);
      await writer.next("holding");
      writer.process.kill("SIGKILL");
      assert.equal((await writer.exited).signal, "SIGKILL");
      run.process.kill("SIGCONT");
      const { reply } = await run.next("reply");
      assert.equal((await run.exited).code, 0);
      assert.equal(reply.error, undefined);
      assert.equal(reply.indexed, 20);
      assert.ok(reply.after.every((commit) => !commit.waiterVisible));
    } finally {
      stopChildren();
      rmSync(base, { recursive: true, force: true });
    }
  },
);
