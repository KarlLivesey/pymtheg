// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
const call = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent ?? JSON.parse(result.content[0].text);
};
test("MCP creates a finite event model in an unsaved buffer using the shared writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-machine-agent-"));
  let client;
  try {
    const original = "flow keep() -> Unit { return unit; }";
    await writeFile(join(root, "main.pym"), original);
    client = new Client({ name: "machine-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const run = await call(client, "check_design", { file: "main.pym" });
    const context = await call(client, "design_interface", {
      action: "creation",
      runId: run.runId,
      file: "main.pym",
    });
    const preview = await call(client, "design_interface", {
      action: "create",
      runId: run.runId,
      file: "main.pym",
      sourceHash: context.sourceHash,
      edit: {
        kind: "machine",
        name: "Attempts",
        states: [
          { name: "count", type: "Nat", min: "0", max: "3", initial: "0" },
        ],
        events: [
          {
            name: "advance",
            guard: "",
            updates: [{ state: "count", value: "count + 1" }],
          },
        ],
        invariants: [{ name: "once", expression: "count <= 1" }],
      },
    });
    assert.match(preview.text, /machine Attempts/);
    assert.match(
      preview.text,
      /unknown "When advance may happen is not decided"/,
    );
    const checked = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": preview.text },
    });
    assert.equal(checked.exitStatus, 2);
    assert.ok(checked.results.unresolved > 0);
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
