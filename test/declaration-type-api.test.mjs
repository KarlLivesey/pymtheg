// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startStudio } from "../dist/studio/server.js";
const main = "flow keep() -> Unit { return unit; }";
test("Studio discovers unimported types, pins pages and guards import previews against source changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-type-api-"));
  let app;
  try {
    await mkdir(join(root, "types"));
    await writeFile(join(root, "main.pym"), main);
    await writeFile(
      join(root, "types", "first.pym"),
      "type Order = { id: Nat };",
    );
    await writeFile(
      join(root, "types", "second.pym"),
      "type Order = { code: String };",
    );
    app = await startStudio({ path: root });
    const ready = new Promise((resolve) => {
      const off = app.service.subscribe((e) => {
        if (e.kind === "run" && e.run.status !== "running") {
          off();
          resolve(e.run);
        }
      });
    });
    const run = await app.service.start({
      clientId: "type-search",
      revision: 0,
      file: "main.pym",
      buffers: {},
      kind: "check",
      entry: "keep",
      seed: "42",
      maxSteps: 5,
      maxSamples: 5,
    });
    await ready;
    const request = (data) =>
      fetch(new URL("/api/declaration", app.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + app.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ runId: run.id, file: "main.pym", ...data }),
      });
    const context = await (await request({ action: "context" })).json();
    assert.equal(context.types.length, 0);
    const first = await (
      await request({ action: "types", query: { query: "Order", limit: 1 } })
    ).json();
    assert.equal(first.total, 2);
    assert.equal(first.items[0].symbolId, "types/first.pym#Order");
    const last = await (
      await request({
        action: "types",
        query: {
          inventoryId: first.inventoryId,
          query: "Order",
          offset: 1,
          limit: 1,
        },
      })
    ).json();
    const selected = last.items[0];
    assert.equal(selected.symbolId, "types/second.pym#Order");
    const declaration = {
      kind: "component",
      signature: {
        name: "consume",
        inputs: [
          {
            name: "order",
            type: { kind: "named", name: "Order", symbolId: selected.symbolId },
          },
        ],
        output: "Unit",
        effects: [],
      },
    };
    const args = {
      action: "preview",
      sourceHash: context.sourceHash,
      declaration,
      typeSelections: [
        {
          symbolId: selected.symbolId,
          file: selected.file,
          sourceHash: selected.sourceHash,
        },
      ],
    };
    const response = await request(args);
    assert.equal(response.status, 200, await response.clone().text());
    const preview = await response.json();
    assert.match(preview.text, /import "\.\/types\/second.pym"/);
    assert.equal(preview.baseSnapshotId, context.snapshotId);
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), main);
    const validate = (sources) =>
      fetch(new URL("/api/declaration/imports", app.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + app.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sources, buffers: {} }),
      });
    assert.equal((await validate(preview.importedSources)).status, 200);

    await writeFile(
      join(root, "types", "second.pym"),
      "type Order = { changed: Bool };",
    );
    assert.equal((await validate(preview.importedSources)).status, 409);
    const stale = await request(args);
    assert.equal(stale.status, 409, await stale.clone().text());
    assert.match(await stale.text(), /selected type source changed/);
    const pinned = await (
      await request({
        action: "types",
        query: {
          inventoryId: first.inventoryId,
          query: "Order",
          offset: 1,
          limit: 1,
        },
      })
    ).json();
    assert.equal(pinned.items[0].sourceHash, selected.sourceHash);
    const fresh = await (
      await request({
        action: "types",
        query: { query: "Order", refresh: true },
      })
    ).json();
    assert.notEqual(
      fresh.items.find((item) => item.symbolId === selected.symbolId)
        .sourceHash,
      selected.sourceHash,
    );
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("type discovery remains complete beyond the editor preload budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-large-type-catalog-"));
  let app;
  try {
    await writeFile(join(root, "main.pym"), main);
    for (let i = 0; i < 6; i++)
      await writeFile(
        join(root, `types${i}.pym`),
        "//" + "note".repeat(375000) + `\ntype T${i} = { id: Nat };`,
      );
    app = await startStudio({ path: root });
    const done = new Promise((resolve) => {
      const off = app.service.subscribe((event) => {
        if (event.kind === "run" && event.run.status !== "running") {
          off();
          resolve();
        }
      });
    });
    const run = await app.service.start({
      clientId: "large-types",
      revision: 0,
      file: "main.pym",
      buffers: {},
      kind: "check",
      entry: "keep",
      seed: "42",
      maxSteps: 1,
      maxSamples: 1,
    });
    await done;
    const page = await app.service.declarationTypes(
      run.id,
      { query: "T" },
      new AbortController().signal,
    );
    assert.equal(page.total, 6);
    assert.equal(page.parsedFiles, 7);
    assert.equal(page.complete, true);
    assert.ok(page.bytes > 8 * 1024 * 1024);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
