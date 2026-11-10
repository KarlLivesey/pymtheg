import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { initializeWorkspace } from "../dist/project/workspace.js";
test("MCP launched without a path recognizes an initialized empty project from its subfolder", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-init-"));
  let client;
  try {
    const initialized = await initializeWorkspace(root, "Shared project");
    const marker = await readFile(join(root, ".pymtheg/project.json"), "utf8");
    const child = join(root, "src");
    await mkdir(child);
    client = new Client({ name: "init-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp"],
        cwd: child,
        stderr: "pipe",
      }),
    );
    const info = await client.callTool({ name: "project_info", arguments: {} });
    assert.equal(info.isError, undefined);
    const project = info.structuredContent ?? JSON.parse(info.content[0].text);
    assert.equal(project.root, root);
    assert.equal(project.workspace.id, initialized.workspace.id);
    assert.equal(project.totalFiles, 0);
    const checked = await client.callTool({
      name: "check_design",
      arguments: {
        file: "design.pym",
        buffers: { "design.pym": "flow design() -> Unit {}" },
      },
    });
    assert.equal(checked.isError, undefined, JSON.stringify(checked));
    const result =
      checked.structuredContent ?? JSON.parse(checked.content[0].text);
    assert.equal(result.exitStatus, 0);
    assert.deepEqual((await readdir(root)).sort(), [
      ".pymtheg",
      ".pymtheg-architecture",
      ".pymtheg.json",
      "src",
    ]);
    assert.equal(
      await readFile(join(root, ".pymtheg/project.json"), "utf8"),
      marker,
    );
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
