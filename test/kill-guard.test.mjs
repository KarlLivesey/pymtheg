// SPDX-License-Identifier: MIT
// C-50 review: a full-suite run died with exit 137. A test read a child's pid
// from a ready file that existed but was still empty, so `Number("")` gave
// 0, and its clean-up called `killGroup(0)`: `process.kill(-0, "SIGKILL")`
// is `kill(0, SIGKILL)`, every process in the caller's own process group,
// which was the whole test run. A kill now refuses any pid that is not an
// integer above 1.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { isProcessId, killGroup } from "../dist/backends/child-groups.js";

test("killGroup refuses 0, -1, 1, NaN and fractions without calling process.kill", (t) => {
  const calls = [];
  t.mock.method(process, "kill", (...args) => {
    calls.push(args);
    return true;
  });
  for (const pid of [0, -0, -1, 1, Number.NaN, 1.5, Number("")])
    assert.equal(killGroup(pid), false, String(pid));
  assert.deepEqual(calls, []);
  assert.equal(isProcessId(2), true);
  // A real group id reaches process.kill (here a spy), as a group.
  assert.equal(killGroup(4_194_000), true);
  assert.deepEqual(calls, [
    [process.platform === "win32" ? 4_194_000 : -4_194_000, "SIGKILL"],
  ]);
});

// The proof: the clean-up the test had, with its ready file existing but
// empty (made empty on purpose, not by load), runs in a process group of its
// own. On the previous head that process killed its own group and died by
// SIGKILL; now it survives and says so.
test("a clean-up that reads an empty ready file does not kill its own process group", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pym-kill-guard-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const groups = pathToFileURL(
    join(import.meta.dirname, "..", "dist", "backends", "child-groups.js"),
  ).href;
  const script = `
    import { existsSync, readFileSync, writeFileSync } from "node:fs";
    import { killGroup } from ${JSON.stringify(groups)};
    const ready = ${JSON.stringify(join(dir, "ready"))};
    writeFileSync(ready, "");
    if (existsSync(ready)) killGroup(Number(readFileSync(ready, "utf8")));
    process.stdout.write("survived");
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    detached: true,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  const [code, signal] = await new Promise((resolve) =>
    child.on("close", (...result) => resolve(result)),
  );
  assert.deepEqual([code, signal, out], [0, null, "survived"]);
});

// C-50 review: a test's clean-up signals only a process it started. A pid
// file of {"pid":1}, or a live process without the test's marker, is never
// signalled.
test("a test's clean-up kills only a process it started", async (t) => {
  const { killOwned } = await import("./owned-processes.mjs");
  const dir = await mkdtemp(join(tmpdir(), "pym-owned-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  t.mock.method(process, "kill", (...args) => {
    calls.push(args);
    return true;
  });
  assert.equal(killOwned(1, dir), false, "init");
  assert.equal(killOwned(0, dir), false, "own group");
  assert.equal(
    killOwned(JSON.parse('{"pid":1}').pid, dir),
    false,
    "a pid file",
  );
  assert.equal(
    killOwned(process.pid, dir),
    false,
    "no marker on its command line",
  );
  assert.deepEqual(calls, []);
  t.mock.restoreAll();
  // A process this test started, with the marker on its command line.
  const child = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1 << 30)", join(dir, "marker")],
    { stdio: "ignore" },
  );
  const closed = new Promise((resolve) =>
    child.on("close", (...result) => resolve(result)),
  );
  // Once its command line can be read, it is killed.
  for (let turn = 0; !killOwned(child.pid, dir); turn++) {
    assert.ok(turn < 100_000, "the child's command line was never readable");
    await new Promise(setImmediate);
  }
  assert.deepEqual(await closed, [null, "SIGKILL"]);
});
