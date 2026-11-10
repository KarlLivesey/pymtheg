import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
const call = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  assert.equal(r.isError, undefined, JSON.stringify(r));
  return r.structuredContent ?? JSON.parse(r.content[0].text);
};
test("MCP lists pinned candidate files before a workspace exists, then captures selected code", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-code-inventory-"));
  let client;
  try {
    await mkdir(join(root, "src"));
    const text = "export function ready(): boolean { return true; }";
    await writeFile(join(root, "main.ts"), text);
    await writeFile(join(root, "src", "helper.js"), "export const value = 1;");
    client = new Client({ name: "code-files-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    const missing = await client.callTool({
      name: "observe_implementation",
      arguments: {
        files: ["missing.ts"],
        label: "Missing",
        expectedRevision: null,
      },
    });
    assert.equal(missing.isError, true);
    assert.match(
      missing.content[0].text,
      /Observed source file was not found: missing.ts/,
    );
    assert.ok(!missing.content[0].text.includes(root));
    assert.ok(!missing.content[0].text.includes("ENOENT"));
    const first = await call(client, "read_implementation", {
      section: "files",
      limit: 1,
    });
    assert.deepEqual(first.files, ["main.ts"]);
    await assert.rejects(
      readFile(join(root, ".pymtheg-architecture", "architecture.sqlite")),
      { code: "ENOENT" },
    );
    await writeFile(join(root, "later.ts"), "export const later = 1;");
    const next = await call(client, "read_implementation", {
      section: "files",
      inventoryId: first.inventoryId,
      offset: first.nextOffset,
      limit: 1,
    });
    assert.equal(next.total, 2);
    assert.deepEqual(next.files, ["src/helper.js"]);
    await call(client, "observe_implementation", {
      files: first.files,
      label: "Selected code",
      expectedRevision: null,
    });
    const graph = await call(client, "read_implementation", {
      section: "graph",
      mode: "existing",
    });
    assert.ok(graph.items.some((node) => node.name === "ready"));
    assert.equal(await readFile(join(root, "main.ts"), "utf8"), text);
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("real MCP retains code versions, pages both graphs and records explicit stub links", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-gap-mcp-"));
  let client;
  try {
    const store = await ArchitectureStore.open(root);
    store.save("Plan", "fixture", [
      {
        path: "plan.json",
        text: JSON.stringify({
          schema: "pymtheg.plan/v1",
          items: [
            {
              ...newPlanItem("Send once"),
              id: "R1",
              title: "Send once",
              acceptance: "one request",
            },
          ],
        }),
      },
    ]);
    store.close();
    const source =
      'export function send(): boolean { throw new Error("Not implemented"); }';
    await writeFile(join(root, "main.ts"), source);
    client = new Client({ name: "gap-test", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/cli/main.js"), "mcp", root],
      stderr: "pipe",
    });
    await client.connect(transport);
    const versions = await call(client, "read_implementation", {});
    const captured = await call(client, "observe_implementation", {
      files: ["main.ts"],
      label: "Code one",
      expectedRevision: versions.activeRevision,
    });
    const plan = await call(client, "read_implementation", {
      section: "graph",
      mode: "gaps",
      limit: 1,
    });
    assert.ok(captured.revision.storage.newBytes > 0);
    assert.equal(captured.revision.storage.newParts, 2);
    assert.equal(captured.revision.entities, undefined);
    assert.equal(captured.revision.documents, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(captured)) < 4096);
    assert.equal(plan.items.length, 1);
    assert.equal(plan.items[0].status, "unlinked");
    const code = await call(client, "read_implementation", {
      section: "graph",
      mode: "existing",
      limit: 1,
    });
    assert.equal(code.items[0].name, "send");
    const sourceDetail = await call(client, "read_implementation", {
      section: "graph",
      mode: "existing",
      detailId: code.items[0].id,
      limit: 1,
    });
    assert.match(sourceDetail.detail.text, /throw new Error/);
    const planDetail = await call(client, "read_implementation", {
      section: "graph",
      mode: "planned",
      detailId: plan.items[0].id,
      limit: 1,
    });
    assert.match(planDetail.detail.text, /one request/);
    const linkArgs = {
      revision: captured.revision.id,
      planId: plan.items[0].id,
      planHash: plan.items[0].planHash,
      nodeId: code.items[0].id,
      observationId: code.observationId,
      note: "Signature only",
    };
    const unreviewed = await client.callTool({
      name: "link_implementation",
      arguments: linkArgs,
    });
    assert.equal(unreviewed.isError, true);
    const stalePlan = await client.callTool({
      name: "link_implementation",
      arguments: { ...linkArgs, reviewed: true, planHash: "0".repeat(64) },
    });
    const unknownPlan = await client.callTool({
      name: "link_implementation",
      arguments: { ...linkArgs, reviewed: true, planId: "R1" },
    });
    assert.equal(stalePlan.isError, true);
    assert.equal(unknownPlan.isError, true);
    assert.match(stalePlan.content[0].text, /current planHash/);
    assert.match(
      unknownPlan.content[0].text,
      /No current planned record has ID R1/,
    );
    const unknownNode = await client.callTool({
      name: "link_implementation",
      arguments: {
        ...linkArgs,
        reviewed: true,
        nodeId: "main.ts#function:missing",
      },
    });
    assert.equal(unknownNode.isError, true);
    assert.match(
      unknownNode.content[0].text,
      /No observed declaration has ID main.ts#function:missing/,
    );
    const staleObservation = await client.callTool({
      name: "link_implementation",
      arguments: { ...linkArgs, reviewed: true, observationId: "0".repeat(64) },
    });
    assert.equal(staleObservation.isError, true);
    assert.match(staleObservation.content[0].text, /Code observation changed/);
    const receipt = await call(client, "link_implementation", {
      ...linkArgs,
      reviewed: true,
    });
    assert.equal(receipt.reviewed, true);
    assert.equal(receipt.revision.entities, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(receipt)) < 4096);
    const linked = await call(client, "read_implementation", {
      section: "graph",
    });
    assert.equal(linked.items[0].status, "fail-fast");
    assert.equal(linked.items[0].linkCount, 1);
    assert.equal(
      linked.items[0].codeLinks[0].reviewedRevision,
      captured.revision.id,
    );
    const comparison = await call(client, "compare_implementation", {
      planId: linked.items[0].id,
      nodeId: code.items[0].id,
      planRevision: linked.activeRevision,
      codeRevision: linked.activeRevision,
    });
    assert.equal(comparison.source.equal, true);
    assert.equal(comparison.before.revision, captured.revision.id);
    assert.equal(comparison.reviewAllowed, true);
    assert.equal(comparison.note, "Signature only");
    const catalogue = await call(client, "read_implementation", {
      section: "versions",
      query: "Code one",
      category: "code",
      limit: 1,
    });
    assert.equal(catalogue.total, 1);
    assert.equal(catalogue.items[0].id, captured.revision.id);
    assert.equal(catalogue.items[0].category, "code");
    await call(client, "unlink_implementation", {
      revision: linked.activeRevision,
      planId: linked.items[0].id,
      nodeId: code.items[0].id,
    });
    const unlinked = await call(client, "read_implementation", {
      section: "graph",
    });
    assert.equal(unlinked.items[0].status, "unlinked");
    assert.equal(await readFile(join(root, "main.ts"), "utf8"), source);
    const before = await readFile(
      join(root, ".pymtheg-architecture/architecture.sqlite"),
    );
    await call(client, "read_implementation", {
      section: "versions",
      limit: 1,
    });
    await call(client, "read_implementation", { section: "graph", limit: 1 });
    assert.deepEqual(
      await readFile(join(root, ".pymtheg-architecture/architecture.sqlite")),
      before,
    );
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
