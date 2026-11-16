// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
const digest = (text) => createHash("sha256").update(text).digest("hex");
async function withClient(source, callback, plugin = false) {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-emission-"));
  let client;
  try {
    await writeFile(join(root, "main.pym"), source);
    const args = [resolve("dist/cli/main.js"), "mcp", root];
    if (plugin) {
      const entry = join(root, "emitter.mjs");
      await writeFile(
        entry,
        `import * as base from ${JSON.stringify(pathToFileURL(resolve("examples/plugins/javascript.mjs")).href)}; import {appendFileSync} from 'node:fs'; export const apiVersion=base.apiVersion,target=base.target,extension=base.extension;export function emit(d){appendFileSync(${JSON.stringify(join(root, "calls"))},'called\\n');return base.emit(d);}`,
      );
      args.push("--plugin", "javascript=" + entry);
    }
    client = new Client({ name: "emission-acceptance", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args,
        stderr: "pipe",
      }),
    );
    const call = async (name, args) => {
      const response = await client.callTool({ name, arguments: args });
      assert.equal(response.isError, undefined, JSON.stringify(response));
      assert.ok(
        Buffer.byteLength(response.content[0].text) <= 262144,
        "Every reply must fit the published transport budget",
      );
      return response.structuredContent ?? JSON.parse(response.content[0].text);
    };
    await callback(call, root);
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
}
async function readAll(call, emissionId, section) {
  let offset = 0,
    text = "",
    expectedHash;
  for (;;) {
    const page = await call("read_scaffold", { emissionId, section, offset });
    assert.equal(page.offset, offset);
    expectedHash ??= page.contentHash;
    assert.equal(page.contentHash, expectedHash);
    text += page.text;
    if (page.nextOffset === null) {
      assert.equal(text.length, page.totalCharacters);
      break;
    }
    assert.ok(page.nextOffset > offset);
    offset = page.nextOffset;
  }
  assert.equal(digest(text), expectedHash);
  return text;
}
test("large MCP code output is delivered exactly through bounded artifact pages", async () =>
  withClient(
    Array.from(
      { length: 1000 },
      (_, i) => `type Record${i} = { identifier: Nat, description: String };`,
    ).join("\n") + "\nop inspect(value: Record0) -> Bool;",
    async (call) => {
      const checked = await call("check_design", { file: "main.pym" });
      const output = await call("emit_scaffold", {
        runId: checked.runId,
        mode: "contracts",
      });
      assert.equal(output.requiresPaging, true);
      assert.equal(output.readTool, "read_scaffold");
      assert.equal(output.omittedCount, 0);
      const source = await readAll(call, output.emissionId, "source");
      assert.match(source, /interface Record999/);
      assert.match(source, /interface PymthegContracts/);
      assert.doesNotMatch(source, /throw new/);
      const manifest = JSON.parse(
        await readAll(call, output.emissionId, "manifest"),
      );
      assert.equal(manifest.entries.length, 1001);
      const details = JSON.parse(
        await readAll(call, output.emissionId, "details"),
      );
      assert.equal(details.symbols.length, 1001);
      assert.deepEqual(details.omitted, []);
      assert.equal(output.snapshotId, checked.snapshotId);
    },
  ));
test("reading retained output never reruns a registered emitter", async () =>
  withClient(
    "op inspect() -> Bool;",
    async (call, root) => {
      const checked = await call("check_design", { file: "main.pym" });
      const output = await call("emit_scaffold", {
        runId: checked.runId,
        target: "javascript",
      });
      assert.equal(output.requiresPaging, false);
      assert.match(output.source, /Not implemented/);
      assert.equal(await readFile(join(root, "calls"), "utf8"), "called\n");
      await writeFile(join(root, "main.pym"), "op changed() -> Unit;");
      const newer = await call("check_design", { file: "main.pym" });
      assert.notEqual(newer.snapshotId, checked.snapshotId);
      for (const section of ["source", "manifest", "details"])
        await readAll(call, output.emissionId, section);
      const retained = await call("read_scaffold", {
        emissionId: output.emissionId,
      });
      assert.equal(retained.snapshotId, checked.snapshotId);
      assert.equal(retained.text, output.source);
      assert.equal(await readFile(join(root, "calls"), "utf8"), "called\n");
    },
    true,
  ));
