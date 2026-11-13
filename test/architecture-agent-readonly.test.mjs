import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, chmod, readFile, rm, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ArchitectureStore } from "../dist/architecture/store.js";
test("real read_architecture MCP browses a read-only backup without changing any stored bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-readonly-")),
    dir = join(root, ".pymtheg/shared"),
    file = join(dir, "architecture.sqlite");
  let client, store;
  try {
    store = await ArchitectureStore.open(root);
    const index = store.save("Backup", "test", [
      {
        path: "requirements.md",
        text: "# R03 Durable plans\nKeep each accepted decision.\n",
      },
    ]);
    store.close();
    store = null;
    const { DatabaseSync } = await import("node:sqlite");
    const legacy = new DatabaseSync(file);
    legacy.exec("PRAGMA journal_mode=WAL");
    legacy.close();
    await chmod(file, 0o444);
    await chmod(dir, 0o555);
    const bytes = await readFile(file),
      files = await readdir(dir);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/cli/main.js"), "mcp", root],
      stderr: "pipe",
    });
    let errors = "";
    transport.stderr?.on("data", (b) => (errors += b));
    client = new Client({ name: "readonly-regression", version: "1" });
    await client.connect(transport);
    const result = await client.callTool({
      name: "read_architecture",
      arguments: { section: "records", kind: "heading" },
    });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const content =
      result.structuredContent ?? JSON.parse(result.content[0].text);
    assert.equal(content.items.length, 1);
    assert.equal(content.items[0].key, "R03");
    assert.equal(content.revision, index.id);
    await client.close();
    client = null;
    assert.equal(errors, "");
    assert.deepEqual(await readFile(file), bytes);
    assert.deepEqual(await readdir(dir), files);
  } finally {
    await client?.close();
    store?.close();
    await chmod(dir, 0o700).catch(() => {});
    await chmod(file, 0o600).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
