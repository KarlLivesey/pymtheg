// SPDX-License-Identifier: MIT
// C-50 review: a stop has one outcome. An index fully written before the
// stop took effect is complete: exit 0, the stop reported on stderr, and
// status complete. Otherwise no completion line, exit 130, and status
// incomplete. A link query run in place and interrupted exits 130 too. The
// real CLI runs with a preload (test/fixtures/graph-cli/stop-points.mjs)
// that stops it where each case needs, until the signal's handshake.
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
