// SPDX-License-Identifier: MIT
// C-50 review: a stop has one outcome. An index fully written before the
// stop took effect is complete: exit 0, the stop reported on stderr, and
// status complete. Otherwise no completion line, exit 130, and status
// incomplete. A link query run in place and interrupted exits 130 too. The
// real CLI runs with a preload (test/fixtures/graph-cli/stop-points.mjs)
// that stops it where each case needs, until the signal's handshake.
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SAFETY_BOUND_MS, closing, endChild } from "./owned-processes.mjs";

const cli = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
const preload = new URL("./fixtures/graph-cli/stop-points.mjs", import.meta.url)
  .href;
// C-50 review: every process a test starts has a bound (a run that never
// exits fails) and is killed in the test's clean-up, whatever it found.
const limit = { timeout: SAFETY_BOUND_MS, killSignal: "SIGKILL" };
const execBounded = (args) =>
  promisify(execFile)(process.execPath, args, limit);

async function project(t) {
  const root = await mkdtemp(join(tmpdir(), "pym-cli-stop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  await writeFile(
    join(root, "src", "a.ts"),
    "export function start(n: number): number {\n  return n + 1;\n}\n",
  );
  return root;
}
const status = (root) =>
  JSON.parse(
    spawnSync(
      process.execPath,
      [cli, "graph", "status", "--root", root, "--json"],
      { encoding: "utf8", ...limit },
    ).stdout,
  ).sync.complete;

/** Runs the CLI, sends SIGINT on `ready`, then calls `after` (if any). */
async function interrupted(args, env, ready, after) {
  const child = spawn(process.execPath, ["--import", preload, cli, ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = closing(child, "the CLI to exit");
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (text) => (stdout += text));
  let seen = false;
  createInterface({ input: child.stderr }).on("line", async (line) => {
    stderr += line + "\n";
    if (line !== ready || seen) return;
    seen = true;
    child.kill("SIGINT");
    await after?.();
  });
  try {
    const [code] = await closed.wait();
    assert.ok(seen, `the stop point was reached: ${stderr}`);
    return { code, stdout, stderr };
  } finally {
    endChild(child);
  }
}

test("a stop after the index's completion is written leaves it complete: exit 0, and the stop is reported", async (t) => {
  const root = await project(t);
  const run = await interrupted(
    ["graph", "index", "--root", root],
    { PYM_TEST_STOP_POINT: "after-completion" },
    "stop point after-completion",
  );
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stderr, /the stop arrived after the index was complete/);
  assert.equal(status(root), true);
});

test("a stop before the completion write leaves no completion: exit 130, no completion line, status incomplete", async (t) => {
  // Stopped after every earlier checkpoint has passed: only the checkpoint
  // ahead of the completion write can stop it.
  const root = await project(t);
  const run = await interrupted(
    ["graph", "index", "--root", root],
    { PYM_TEST_STOP_POINT: "after-metadata" },
    "stop point after-metadata",
  );
  assert.equal(run.code, 130, run.stderr);
  assert.doesNotMatch(run.stderr, /^graph complete/m);
  assert.equal(status(root), false);
});

test("link list --no-sync interrupted during its in-place query exits 130", async (t) => {
  const root = await project(t);
  await execBounded([cli, "init", root, "--format", "json"]);
  // Indexed, so the in-place query reads a store.
  await execBounded([cli, "graph", "index", "--root", root]);
  const go = join(root, "..", `${root.split("/").pop()}.go`);
  t.after(() => rm(go, { force: true }));
  const run = await interrupted(
    [
      // One in-place query (the sync probe), then only direct store reads:
      // only the check after the query can stop it.
      "link",
      "list",
      "--no-sync",
      "--root",
      root,
      "--json",
    ],
    { PYM_TEST_INPLACE_GO: go },
    "stop point in-place",
    () => writeFile(go, ""),
  );
  assert.equal(run.code, 130, run.stderr);
  assert.equal(JSON.parse(run.stdout).exitCode, 130);
});

// C-50 review: a command that syncs and then answers, stopped after its
// sync's completion write but before it answers, exits 130 with no answer
// (the JSON error, no result) and no stderr line about the stop; the index
// its sync wrote stays complete. Only `graph index` reports its result
// after a late stop.
for (const [what, args, init] of [
  [
    "graph file",
    (root) => ["graph", "file", "src/a.ts", "--root", root, "--json"],
    false,
  ],
  ["link list", (root) => ["link", "list", "--root", root, "--json"], true],
  ["link check", (root) => ["link", "check", "--root", root, "--json"], true],
])
  test(`${what} stopped after its sync's completion write exits 130 with no answer; the index stays complete`, async (t) => {
    const root = await project(t);
    if (init) await execBounded([cli, "init", root, "--format", "json"]);
    // An edit, so the command's sync indexes and writes a completion.
    await writeFile(join(root, "src", "b.ts"), "export const b = 2;\n");
    const run = await interrupted(
      args(root),
      { PYM_TEST_STOP_POINT: "after-completion" },
      "stop point after-completion",
    );
    assert.equal(run.code, 130, run.stderr);
    const answer = JSON.parse(run.stdout);
    assert.equal(answer.status, "error", run.stdout);
    assert.equal(answer.exitCode, 130);
    assert.doesNotMatch(run.stderr, /the stop arrived/);
    assert.equal(status(root), true);
  });

// Sol review: a stop that arrives as the worker posts its result, after its
// last checkpoint. The result stands with the run's own exit code, and the
// late-stop line says the index was complete only when its sync is.
test("a stop after the last checkpoint of an index that ends complete: exit 0, the index said complete", async (t) => {
  const root = await project(t);
  const run = await interrupted(
    ["graph", "index", "--root", root, "--json"],
    { PYM_TEST_STOP_POINT: "before-post" },
    "stop point before-post",
  );
  assert.equal(run.code, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).sync.complete, true);
  assert.match(run.stderr, /the stop arrived after the index was complete/);
});

test(
  "a stop after the last checkpoint of an index that writes no completion: its own exit code, not said complete",
  { skip: process.getuid?.() === 0 && "root reads a mode-000 file" },
  async (t) => {
    const root = await project(t);
    // A file that cannot be read: a retryable failure, so no completion.
    const locked = join(root, "src", "locked.ts");
    await writeFile(locked, "export const locked = 1;\n");
    await chmod(locked, 0);
    // Readable again for the clean-up, if it is still there.
    t.after(() => chmod(locked, 0o644).catch(() => {}));
    const run = await interrupted(
      ["graph", "index", "--root", root, "--json"],
      { PYM_TEST_STOP_POINT: "before-post" },
      "stop point before-post",
    );
    const answer = JSON.parse(run.stdout);
    assert.equal(answer.sync.complete, false);
    assert.equal(run.code, answer.exitCode, run.stderr);
    assert.notEqual(run.code, 0);
    assert.doesNotMatch(run.stderr, /after the index was complete/);
    assert.match(run.stderr, /the stop arrived after the command had finished/);
  },
);

// Sol and Opus reviews: the drain. A large answer, a reader that holds
// back, and the preload's "drain started" line, said when the CLI begins
// to drain its output after the command has finished: the test acts on
// that line, so what it does lands in the drain.
async function largeAnswer(t) {
  const root = await project(t);
  const functions = Array.from(
    { length: 4000 },
    (_, i) =>
      `export function function_with_a_long_descriptive_name_${i}(n: number): number { return n + ${i}; }\n`,
  ).join("");
  await writeFile(join(root, "src", "big.ts"), functions);
  await execBounded([cli, "graph", "index", "--root", root]);
  const child = spawn(
    process.execPath,
    [
      "--import",
      preload,
      cli,
      "graph",
      "file",
      "src/big.ts",
      "--no-sync",
      "--json",
      "--root",
      root,
    ],
    {
      env: { ...process.env, PYM_TEST_SAY_DRAIN: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => endChild(child));
  const closed = closing(child, "the CLI to exit");
  // The reader holds back: nothing reads stdout until the test says.
  child.stdout.pause();
  let stderr = "";
  const drain = new Promise((resolve) =>
    createInterface({ input: child.stderr }).on("line", (line) => {
      stderr += line + "\n";
      if (line === "drain started") resolve();
    }),
  );
  return { child, closed, drain, stderr: () => stderr };
}

test("one signal while a large answer drains to a reader that holds back: the answer is whole, and the exit code the command's", async (t) => {
  const { child, closed, drain, stderr } = await largeAnswer(t);
  await drain;
  child.kill("SIGTERM");
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (text) => (stdout += text));
  child.stdout.resume();
  const [code, signal] = await closed.wait();
  assert.equal(signal, null, `the CLI died by ${signal}: ${stderr()}`);
  const answer = JSON.parse(stdout);
  assert.equal(code, answer.exitCode);
  assert.equal(code, 0);
  assert.doesNotMatch(stderr(), /the stop arrived/);
});

// decisions.md, C-50: no CLI graph run that only SIGKILL can stop, also
// while its output drains to a reader that never reads.
test("the CLI can always be stopped: a second signal while its output drains to a reader that never reads ends it with 130", async (t) => {
  const { child, closed, drain } = await largeAnswer(t);
  await drain;
  child.kill("SIGTERM");
  child.kill("SIGTERM");
  const [code, signal] = await closed.wait();
  assert.deepEqual([code, signal], [130, null]);
});

// Opus review: a reader that closes early (`… | head -c 100`): the drain of
// stdout ends quietly, with no stack trace, and the command's own code.
test("a reader that closes during the drain: the command's own exit code, no error on stderr", async (t) => {
  const { child, closed, drain, stderr } = await largeAnswer(t);
  await drain;
  child.stdout.destroy();
  const [code, signal] = await closed.wait();
  assert.deepEqual([code, signal], [0, null], stderr());
  assert.doesNotMatch(stderr(), /EPIPE|Error/);
});

// Sol review: a closed stderr ends nothing but stderr. The index's first
// progress line is written, the test closes its end of stderr, and every
// later stderr write meets a closed pipe: the exit code is the one stdout
// reports.
test("stderr closed during an index: the exit code is the one stdout reports", async (t) => {
  const root = await project(t);
  const gate = join(root, "..", `${root.split("/").pop()}.stderr-gate`);
  t.after(() => rm(gate, { force: true }));
  const child = spawn(
    process.execPath,
    ["--import", preload, cli, "graph", "index", "--root", root, "--json"],
    {
      env: { ...process.env, PYM_TEST_STDERR_GATE: gate },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => endChild(child));
  const closed = closing(child, "the CLI to exit");
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (text) => (stdout += text));
  let gated = false;
  child.stderr.setEncoding("utf8").on("data", (text) => {
    if (gated || !text.includes("stderr gate")) return;
    gated = true;
    child.stderr.destroy();
    void writeFile(gate, "");
  });
  const [code, signal] = await closed.wait();
  assert.ok(gated, "the stderr gate was reached");
  assert.equal(signal, null);
  assert.equal(code, JSON.parse(stdout).exitCode);
});
