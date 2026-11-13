import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
test("large project inventories page consistently while source and configuration change", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-large-inventory-"));
  let client;
  try {
    const names = Array.from(
      { length: 1000 },
      (_, i) => "component_".repeat(14) + String(i).padStart(4, "0") + ".pym",
    );
    for (let i = 0; i < names.length; i++)
      await writeFile(join(root, names[i]), `flow file${i}() -> Unit {}`);
    const assumption = "scope assumption ".repeat(3000);
    await mkdir(join(root, ".pymtheg"), { recursive: true });
    await writeFile(
      join(root, ".pymtheg/settings.json"),
      JSON.stringify({
        version: 1,
        scenarios: {
          large: {
            file: names[0],
            entry: "file0",
            scope: { domains: {}, assumptions: [assumption] },
          },
        },
      }),
    );
    client = new Client({ name: "inventory-acceptance", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const call = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      assert.ok(Buffer.byteLength(result.content[0].text) <= 262144);
      return result.structuredContent ?? JSON.parse(result.content[0].text);
    };
    const first = await call("project_info");
    assert.equal(first.totalFiles, 1000);
    assert.ok(first.files.length < 1000);
    assert.equal(first.configurationRequiresPaging, true);
    const paths = first.files.map((f) => f.path);
    let offset = first.nextOffset;
    await writeFile(join(root, names[0]), "flow changed() -> Unit {}");
    await writeFile(join(root, "new.pym"), "flow newFile() -> Unit {}");
    while (offset !== null) {
      const page = await call("project_info", {
        inventoryId: first.inventoryId,
        section: "files",
        offset,
      });
      assert.equal(page.totalFiles, 1000);
      paths.push(...page.files.map((f) => f.path));
      assert.ok(page.nextOffset === null || page.nextOffset > offset);
      offset = page.nextOffset;
    }
    assert.equal(paths.length, 1000);
    assert.equal(new Set(paths).size, 1000);
    assert.deepEqual(paths, names);
    const freshSource = await call("read_source", { file: names[0] });
    assert.equal(freshSource.lines[0], "flow changed() -> Unit {}");
    let config = "",
      characterOffset = 0,
      hash;
    for (;;) {
      const page = await call("project_info", {
        inventoryId: first.inventoryId,
        section: "configuration",
        offset: characterOffset,
      });
      config += page.text;
      hash = page.contentHash;
      if (page.nextOffset === null) break;
      characterOffset = page.nextOffset;
    }
    assert.equal(createHash("sha256").update(config).digest("hex"), hash);
    assert.equal(
      JSON.parse(config).scenarios.large.scope.assumptions[0],
      assumption,
    );
    const fresh = await call("project_info");
    assert.equal(fresh.totalFiles, 1001);
    assert.notEqual(fresh.inventoryId, first.inventoryId);
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
