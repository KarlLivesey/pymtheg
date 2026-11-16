// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
const call = async (client, name, args) => {
  const r = await client.callTool({ name, arguments: args });
  assert.equal(r.isError, undefined, JSON.stringify(r));
  return r.structuredContent ?? JSON.parse(r.content[0].text);
};
test("agent type search and creation retain unsaved unimported type buffers", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-types-agent-"));
  let client;
  const main = "flow keep() -> Unit { return unit; }",
    types = "type Customer = { id: Nat };";
  try {
    await writeFile(join(root, "main.pym"), main);
    client = new Client({ name: "type-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const run = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "types.pym": types },
    });
    const context = await call(client, "design_interface", {
      action: "creation",
      runId: run.runId,
      file: "main.pym",
    });
    const inventory = await call(client, "design_interface", {
      action: "creation_types",
      runId: run.runId,
      query: "Customer",
    });
    assert.equal(inventory.total, 1);
    const selected = inventory.items[0];
    assert.equal(selected.file, "types.pym");
    const preview = await call(client, "design_interface", {
      action: "create",
      runId: run.runId,
      file: "main.pym",
      sourceHash: context.sourceHash,
      edit: {
        kind: "component",
        signature: {
          name: "useCustomer",
          inputs: [
            {
              name: "customer",
              type: {
                kind: "named",
                name: "Customer",
                symbolId: selected.symbolId,
              },
            },
          ],
          output: "Unit",
          effects: [],
        },
      },
      typeSelections: [
        {
          file: selected.file,
          symbolId: selected.symbolId,
          sourceHash: selected.sourceHash,
        },
      ],
    });
    assert.match(preview.text, /import "\.\/types.pym"/);
    const checked = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": preview.text, "types.pym": types },
    });
    assert.equal(checked.findings.errors, 0);
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), main);
    await assert.rejects(readFile(join(root, "types.pym")), { code: "ENOENT" });
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
