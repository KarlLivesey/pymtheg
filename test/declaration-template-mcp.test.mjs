import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { parse } from "../dist/language/parser.js";

test("agents can discover, edit and preview every Studio declaration template without guessing its JSON shape", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-templates-"));
  let client;
  const original =
    "// Existing source must stay intact.\nflow keep() -> Unit { return unit; }\n";
  try {
    await writeFile(join(root, "main.pym"), original);
    client = new Client({ name: "template-test", version: "1" });
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
    const available = await call("design_interface", {
      action: "creation",
      runId: run.runId,
      file: "main.pym",
      limit: 1,
    });
    assert.deepEqual(
      available.declarationKinds.map((k) => k.kind),
      ["component", "operation", "type", "resource", "machine"],
    );
    for (const { kind } of available.declarationKinds) {
      const context = await call("design_interface", {
        action: "creation",
        runId: run.runId,
        file: "main.pym",
        declarationKind: kind,
        limit: 1,
      });
      assert.equal(context.template.schema, "pymtheg.declaration-template/v1");
      assert.equal(context.template.edit.kind, kind);
      assert.match(context.template.nextStep, /does not save/);
      if (kind === "component") {
        const malformed = await client.callTool({
          name: "design_interface",
          arguments: {
            action: "create",
            runId: run.runId,
            file: "main.pym",
            sourceHash: context.sourceHash,
            edit: { kind: "invalid" },
          },
        });
        assert.equal(malformed.isError, true);
        assert.match(
          malformed.content[0].text,
          /Invalid declaration edit.*kind/,
        );
        assert.match(malformed.content[0].text, /action.*creation/);
        assert.ok(!malformed.content[0].text.includes("invalid_union"));
      }
      const edit = context.template.edit;
      if (kind === "component" || kind === "operation")
        edit.signature.name = "customName";
      else if (kind === "type") edit.definition.name = "CustomShape";
      else edit.name = "CustomName";
      if (kind === "operation") {
        edit.signature.inputs = [{ name: "amount", type: "Nat" }];
        edit.signature.output = "Nat";
        edit.requires = ["amount > 0"];
        edit.ensures = ["result >= amount"];
      }
      if (kind === "type") {
        const unfinished = structuredClone(edit);
        unfinished.definition.fields.push({
          name: "amount",
          type: { kind: "unselected" },
        });
        const refused = await client.callTool({
          name: "design_interface",
          arguments: {
            action: "create",
            runId: run.runId,
            file: "main.pym",
            sourceHash: context.sourceHash,
            edit: unfinished,
          },
        });
        assert.equal(refused.isError, true);
        assert.match(JSON.stringify(refused.content), /amount.*choose what/);
        assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
      }
      const preview = await call("design_interface", {
        action: "create",
        runId: run.runId,
        file: "main.pym",
        sourceHash: context.sourceHash,
        edit,
      });
      assert.ok(preview.text.startsWith(original));
      assert.deepEqual(parse("main.pym", preview.text).diagnostics, []);
      assert.ok(
        preview.text.includes(kind === "type" ? "CustomShape" : "customName") ||
          preview.text.includes("CustomName"),
      );
      if (kind === "machine")
        assert.ok(preview.notices.some((n) => /No safety rules/.test(n)));
      if (kind === "operation") {
        assert.equal(edit.atomic, false);
        assert.match(preview.text, /requires.*amount > 0/);
        assert.match(preview.text, /ensures.*result >= amount/);
        assert.ok(
          preview.notices.some((n) => /guarantees are assumptions/.test(n)),
        );
      }
    }
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
