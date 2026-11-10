import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { newPlanItem } from "../dist/architecture/planning.js";
import { sourceCatalogue } from "../dist/architecture/source-contracts.js";
import { analyseFile } from "../dist/analysis/index.js";

test("legacy catalogue records remain searchable past 64 KiB without rewriting history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-long-record-search-"));
  let store, client;
  try {
    const padding = "description ".repeat(9000);
    const sourceFile = join(root, "design.pym");
    const source = `flow unfinished() -> Unit { // ${padding}\n return unknown "source-body-needle"; }`;
    const catalogue = sourceCatalogue(
      analyseFile(sourceFile, () => {}, {
        buffers: { [sourceFile]: source },
        root,
      }).ir,
      root,
    );
    store = await ArchitectureStore.open(root);
    const index = store.save("Large catalogue", "test", [
      {
        path: "long.md",
        text: "# Long section\n" + padding + "heading-tail-needle",
      },
      {
        path: ".pymtheg-source-contracts.json",
        text: JSON.stringify(catalogue),
      },
      {
        path: "native-plan.json",
        text: JSON.stringify({
          schema: "pymtheg.plan/v1",
          items: [
            {
              ...newPlanItem("P"),
              title: "Large native plan",
              detail: 'Use "quoted phrase" and C:\\design\\plan.',
              evidence: "x".repeat(70000) + "native-tail-needle",
            },
          ],
        }),
      },
      {
        path: "catalogue.json",
        text: JSON.stringify({
          functions: [
            {
              id: "node.composeServices",
              name: "composeServices",
              owner: "node",
              description: padding,
              args: { config: "NodeConfig", lifetime: "NodeLifetime" },
            },
          ],
          types: {
            NodeConfig: { description: padding, lateField: "type-tail-needle" },
          },
          profiles: {
            release: { description: padding, lateField: "profile-tail-needle" },
          },
        }),
      },
    ]);
    store.close();
    store = null;
    const file = join(root, ".pymtheg-architecture", "architecture.sqlite");
    // Reproduce the retained v16 projection, not only a fresh v17 import.
    const db = new DatabaseSync(file);
    const legacy = structuredClone(index);
    legacy.indexVersion = 16;
    for (const entity of legacy.entities)
      if (entity.searchText) {
        entity.searchTruncated = entity.searchText.length > 65536;
        entity.searchText = entity.searchText.slice(0, 65536);
      }
    db.prepare("UPDATE revisions SET index_json=? WHERE id=?").run(
      JSON.stringify(legacy),
      index.snapshotHash,
    );
    db.close();
    const before = await readFile(file);
    store = await ArchitectureStore.open(root, { readOnly: true });
    const rebuilt = store.read(index.id);
    const functionRecord = rebuilt.entities.find(
      (e) => e.key === "node.composeServices",
    );
    assert.ok(functionRecord.searchText.includes("nodelifetime"));
    assert.ok(!rebuilt.entities.some((e) => e.searchTruncated));
    assert.equal(
      store.document(index.id, "catalogue.json").text,
      store.export(index.id).documents.find((d) => d.path === "catalogue.json")
        .text,
    );
    store.close();
    store = null;
    client = new Client({ name: "long-record-search", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [resolve("dist/cli/main.js"), "mcp", root],
        stderr: "pipe",
      }),
    );
    for (const [query, expected] of [
      ["NodeLifetime", "function:node.composeServices"],
      ['"quoted phrase"', "plan:P"],
      ["C:\\design\\plan", "plan:P"],
      ["type-tail-needle", "type:NodeConfig"],
      ["profile-tail-needle", "profile:release"],
      [
        "heading-tail-needle",
        rebuilt.entities.find((e) => e.kind === "heading").id,
      ],
      ["native-tail-needle", "plan:P"],
      ["source-body-needle", "source:design.pym#unfinished"],
    ]) {
      const response = await client.callTool({
        name: "read_architecture",
        arguments: {
          section: "records",
          revision: index.id,
          query,
        },
      });
      assert.equal(response.isError, undefined, JSON.stringify(response));
      const result =
        response.structuredContent ?? JSON.parse(response.content[0].text);
      assert.ok(
        result.items.some((e) => e.id === expected),
        JSON.stringify(result),
      );
      assert.ok(result.items.every((e) => !Object.hasOwn(e, "searchText")));
    }
    const boilerplate = await client.callTool({
      name: "read_architecture",
      arguments: {
        section: "records",
        revision: index.id,
        query: "evidenceRevision",
      },
    });
    const empty =
      boilerplate.structuredContent ?? JSON.parse(boilerplate.content[0].text);
    assert.equal(empty.items.length, 0);
    await client.close();
    client = null;
    assert.deepEqual(await readFile(file), before);
  } finally {
    store?.close();
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
});
