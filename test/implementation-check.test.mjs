// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
test("CLI and MCP produce explicit implementation checks without writing source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-check-output-"));
  let client;
  try {
    const file = join(root, "design.pym"),
      source = "op pay(id: String) -> Bool;";
    await writeFile(file, source);
    const args = [
      resolve("dist/cli/main.js"),
      "scaffold",
      file,
      "--mode",
      "contracts",
      "--target",
      "typescript",
      "--implementation",
      "Service",
      "--contracts-module",
      "./contracts",
      "--implementation-module",
      "./service",
      "--format",
      "json",
    ];
    const command = spawnSync(process.execPath, args, { encoding: "utf8" });
    assert.equal(command.status, 0, command.stderr);
    const out = JSON.parse(command.stdout);
    assert.match(out.source, /PymthegImplementation<Implementation>/);
    assert.match(out.source, /from "\.\/service"/);
    assert.equal(out.guarantee, "compiler-input-only");
    const unsupported = spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "scaffold",
        file,
        "--mode",
        "contracts",
        "--target",
        "go",
        "--implementation",
        "*Service",
        "--contracts-module",
        "example.com/contracts",
      ],
      { encoding: "utf8" },
    );
    assert.equal(unsupported.status, 3);
    assert.match(unsupported.stdout + unsupported.stderr, /same package/);
    client = new Client({ name: "implementation-check-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const call = async (name, arguments_) => {
      const result = await client.callTool({ name, arguments: arguments_ });
      assert.ok(!result.isError, JSON.stringify(result));
      return result.structuredContent ?? JSON.parse(result.content[0].text);
    };
    const checked = await call("check_design", { file: "design.pym" });
    const generated = await call("emit_implementation_check", {
      runId: checked.runId,
      target: "typescript",
      implementationType: "Service",
      contractsModule: "./contracts",
      implementationModule: "./service",
    });
    assert.equal(generated.source, out.source);
    assert.equal(generated.snapshotId, out.snapshotId);
    const invalid = await client.callTool({
      name: "emit_implementation_check",
      arguments: {
        runId: checked.runId,
        target: "typescript",
        implementationType: "Service; hacked()",
        contractsModule: "./contracts",
        implementationModule: "./service",
      },
    });
    assert.ok(invalid.isError);
    const go = await call("emit_implementation_check", {
      runId: checked.runId,
      target: "go",
      implementationType: "*Service",
    });
    assert.match(go.source, /\(\*Service\)\(nil\)/);
    const ignoredModule = await client.callTool({
      name: "emit_implementation_check",
      arguments: {
        runId: checked.runId,
        target: "go",
        implementationType: "*Service",
        contractsModule: "example.com/contracts",
      },
    });
    assert.ok(ignoredModule.isError);
    assert.match(JSON.stringify(ignoredModule), /same package/);
    assert.equal(await readFile(file, "utf8"), source);
    assert.deepEqual(await readdir(root), ["design.pym"]);
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
