import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
test("architecture search exposes every match through revision-pinned MCP pages", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-search-pages-"));
  let store, client;
  try {
    store = await ArchitectureStore.open(root);
    const documents = Array.from({ length: 125 }, (_, i) => ({
      path: `doc${String(i).padStart(3, "0")}.md`,
      text: "# Design\nSearchneedle " + i,
    }));
    const initial = store.save("Initial", "test", documents);
    store.close();
    store = null;
    client = new Client({ name: "search-pages", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const call = async (args) => {
      const response = await client.callTool({
        name: "read_architecture",
        arguments: args,
      });
      assert.equal(response.isError, undefined, JSON.stringify(response));
      return response.structuredContent ?? JSON.parse(response.content[0].text);
    };
    const first = await call({
      section: "search",
      query: "Searchneedle",
      limit: 7,
    });
    assert.equal(first.total, 125);
    assert.equal(first.matches.length, 7);
    assert.equal(first.nextOffset, 7);
    store = await ArchitectureStore.open(root);
    store.save("New document", "test", [
      ...documents,
      { path: "aaa.md", text: "Searchneedle new" },
    ]);
    store.close();
    store = null;
    const paths = first.matches.map((m) => m.path);
    let offset = first.nextOffset;
    while (offset !== null) {
      const page = await call({
        section: "search",
        query: "Searchneedle",
        revision: first.revision,
        offset,
        limit: 7,
      });
      assert.equal(page.total, 125);
      paths.push(...page.matches.map((m) => m.path));
      offset = page.nextOffset;
    }
    assert.equal(new Set(paths).size, 125);
    assert.equal(paths.includes("aaa.md"), false);
    assert.equal(first.revision, initial.id);
    const missing = await client.callTool({
      name: "read_architecture",
      arguments: {
        section: "search",
        query: "Searchneedle",
        offset: 7,
        limit: 7,
      },
    });
    assert.equal(missing.isError, true);
  } finally {
    store?.close();
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
