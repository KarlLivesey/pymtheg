// SPDX-License-Identifier: MIT
// C-50 review: `pymtheg link list` and `link check` sync the graph through
// the CLI's graph worker, so SIGINT during a language module's analysis that
// cannot finish ends the run: exit 130 with the JSON error, and the process
// ends (with it, its worker; the module starts no process). Before C-50 the
// sync ran on the main thread and the signal was never handled.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { SAFETY_BOUND_MS, closing, endChild } from "./owned-processes.mjs";

const cli = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
const preload = new URL(
  "./fixtures/graph-cli/stuck-typescript.mjs",
  import.meta.url,
);
// C-50 review: every process a test starts has a bound (a regression that
// never exits fails; a passing run exits as soon as it has handled the
// signal) and is killed in the test's clean-up, whatever it found.

for (const command of ["list", "check"])
  test(`link ${command} exits 130 on SIGINT during a stuck graph sync`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pym-link-cancel-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src", "app.ts"),
      "export function start(n: number): number {\n  return n + 1;\n}\n",
    );
    await promisify(execFile)(
      process.execPath,
      [cli, "init", root, "--format", "json"],
      { timeout: SAFETY_BOUND_MS, killSignal: "SIGKILL" },
    );
    // A changed file, so the sync analyses again.
    await writeFile(join(root, "src", "more.ts"), "export const more = 1;\n");

    const child = spawn(
      process.execPath,
      ["--import", preload.href, cli, "link", command, "--json"],
      {
        cwd: root,
        env: { ...process.env, PYM_TEST_STUCK_TYPESCRIPT: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(() => endChild(child));
    const closed = closing(child, "the CLI to exit after SIGINT");
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (text) => (stdout += text));
    let ready = false;
    createInterface({ input: child.stderr }).on("line", (line) => {
      if (line !== "stuck typescript analysis ready" || ready) return;
      ready = true;
      child.kill("SIGINT");
    });
    const [code, signal] = await closed.wait();
    assert.ok(ready, "the analysis was entered");
    assert.deepEqual([code, signal], [130, null]);
    assert.equal(JSON.parse(stdout).exitCode, 130);
  });
