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
test("agents inspect and preview a resource lifecycle through relative identities without source writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-resource-agent-"));
  let client;
  const source =
    "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; } flow process(take f: File) -> Unit effects(state.File) { transition f -> Closed; return unit; }";
  try {
    await writeFile(join(root, "main.pym"), source);
    client = new Client({ name: "resource-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const run = await call(client, "check_design", { file: "main.pym" });
    const description = await call(client, "design_interface", {
      action: "resource",
      runId: run.runId,
      symbolId: "main.pym#File",
    });
    assert.equal(description.symbolId, "main.pym#File");
    assert.equal(description.definition.initial, "Open");
    const malformed = await client.callTool({
      name: "design_interface",
      arguments: {
        action: "preview_resource",
        runId: run.runId,
        symbolId: description.symbolId,
        sourceHash: description.sourceHash,
        edit: { kind: "resource", states: "not an array" },
      },
    });
    assert.equal(malformed.isError, true);
    assert.match(malformed.content[0].text, /Invalid resource lifecycle edit/);
    assert.match(malformed.content[0].text, /action resource/);
    assert.ok(!malformed.content[0].text.includes("invalid_type"));
    const preview = await call(client, "design_interface", {
      action: "preview_resource",
      runId: run.runId,
      symbolId: description.symbolId,
      sourceHash: description.sourceHash,
      edit: { ...description.definition, transitions: [] },
    });
    assert.ok(preview.affected.some((d) => d.name === "process"));
    assert.equal(preview.file, "main.pym");
    const changed = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": preview.text },
    });
    assert.ok(changed.findings.errors > 0);
    const findings = await call(client, "read_run", {
      runId: changed.runId,
      section: "findings",
    });
    assert.ok(findings.items.some((d) => d.code === "R002"));
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
