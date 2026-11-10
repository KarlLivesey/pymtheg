import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { startStudio } from "../dist/studio/server.js";
const source =
  "op reserve(n: Nat) -> Nat requires n >= 0 cost calls exact n + 1;\nflow caller() -> Unit budget calls <= 2 { call reserve(0) as value; return unit; }\n";
const changed = (d) => ({
  ...d,
  requires: ["n > 0"],
  costs: [{ metric: "calls", quality: "exact", expression: "n + 3" }],
});
test("real MCP describes and previews operation rules with portable IDs and honest caller findings", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-operation-mcp-"));
  let client;
  try {
    await writeFile(join(root, "main.pym"), source);
    client = new Client({ name: "operation-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const call = async (name, args) => {
      const result = await client.callTool({ name, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      return result.structuredContent ?? JSON.parse(result.content[0].text);
    };
    const run = await call("check_design", { file: "main.pym" });
    const description = await call("design_interface", {
      action: "operation",
      runId: run.runId,
      symbolId: "main.pym#reserve",
    });
    assert.equal(description.symbolId, "main.pym#reserve");
    assert.equal(description.file, "main.pym");
    assert.equal(description.definition.costs[0].expression, "n + 1");
    const malformed = await client.callTool({
      name: "design_interface",
      arguments: {
        action: "preview_operation",
        runId: run.runId,
        symbolId: description.symbolId,
        sourceHash: description.sourceHash,
        edit: { requires: "not an array" },
      },
    });
    assert.equal(malformed.isError, true);
    assert.match(malformed.content[0].text, /Invalid operation contract edit/);
    assert.match(malformed.content[0].text, /action operation/);
    assert.ok(!malformed.content[0].text.includes("invalid_type"));
    const preview = await call("design_interface", {
      action: "preview_operation",
      runId: run.runId,
      symbolId: description.symbolId,
      sourceHash: description.sourceHash,
      edit: changed(description.definition),
    });
    assert.ok(preview.affected.some((d) => d.name === "caller"));
    assert.equal(preview.file, "main.pym");
    const checked = await call("check_design", {
      file: "main.pym",
      buffers: { "main.pym": preview.text },
    });
    const findings = await call("read_run", {
      runId: checked.runId,
      section: "findings",
    });
    assert.ok(findings.items.some((d) => d.code === "C004"));
    assert.ok(findings.items.some((d) => d.code === "K002"));
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("Studio HTTP operation previews are hash guarded and remain unsaved", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-operation-http-"));
  let app;
  try {
    await writeFile(join(root, "main.pym"), source);
    app = await startStudio({ path: root });
    const ready = new Promise((resolve) => {
      const off = app.service.subscribe((event) => {
        if (event.kind === "run" && event.run.status !== "running") {
          off();
          resolve(event.run);
        }
      });
    });
    await app.service.start({
      clientId: "operation-http",
      revision: 0,
      file: "main.pym",
      buffers: {},
      kind: "check",
      entry: "caller",
      seed: "1",
      maxSteps: 5,
      maxSamples: 5,
    });
    const run = await ready;
    const symbol = run.symbols.find((s) => s.name === "reserve");
    assert.ok(symbol);
    const request = (data) =>
      fetch(new URL("/api/interface", app.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + app.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ runId: run.id, symbolId: symbol.id, ...data }),
      });
    const descResponse = await request({ action: "operation" });
    assert.equal(descResponse.status, 200);
    const description = await descResponse.json();
    const stale = await request({
      action: "preview-operation",
      sourceHash: "stale",
      edit: changed(description.definition),
    });
    assert.equal(stale.status, 409);
    const response = await request({
      action: "preview-operation",
      sourceHash: description.sourceHash,
      edit: changed(description.definition),
    });
    assert.equal(response.status, 200);
    const preview = await response.json();
    assert.ok(preview.text.includes("requires (n > 0)"));
    assert.ok(preview.affected.some((d) => d.name === "caller"));
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
    for (const action of ["operation", "preview-operation"]) {
      const missing = await request({
        action,
        symbolId: symbol.id.replace(/#reserve$/, "#oldName"),
        sourceHash: description.sourceHash,
        edit: description.definition,
      });
      assert.equal(missing.status, 409);
      assert.match(
        await missing.text(),
        /oldName.*main\.pym.*renamed or removed.*saved form is kept.*Download/,
      );
    }
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
