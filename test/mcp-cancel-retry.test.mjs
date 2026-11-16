// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentWorkspace } from "../dist/mcp/workspace.js";
import { analyseFile } from "../dist/analysis/index.js";
test("a new MCP check waits for cancelled work cleanup instead of reporting a spurious busy error", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-cancel-retry-"));
  let release, started;
  const cleaning = new Promise((r) => (release = r)),
    ready = new Promise((r) => (started = r));
  let calls = 0;
  const workspace = new AgentWorkspace(root, async (options) => {
    calls++;
    if (calls === 1) {
      started();
      await cleaning;
    }
    return analyseFile(options.file);
  });
  try {
    await writeFile(
      join(root, "main.pym"),
      "flow main() -> Unit { return unit; }",
    );
    const firstController = new AbortController();
    const first = workspace.run({ file: "main.pym" }, firstController.signal);
    await ready;
    await assert.rejects(
      workspace.run({ file: "main.pym" }, new AbortController().signal),
      /Another analysis/,
    );
    firstController.abort();
    const retry = workspace
      .run({ file: "main.pym" }, new AbortController().signal)
      .then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
    release();
    assert.equal((await first).report.session.state, "Cancelled");
    const result = await retry;
    assert.equal(result.error, undefined, String(result.error));
    assert.equal(calls, 2);
    assert.equal(result.value.report.session.state, "Completed");
  } finally {
    release();
    await workspace.close();
    await rm(root, { recursive: true, force: true });
  }
});
