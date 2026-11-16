// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startStudio } from "../dist/studio/server.js";
const source =
  "flow quote(quantity: Nat) -> Bool {\n  // real handwritten decision\n  return quantity > 0;\n}\n";
test("interface API uses the checked IR, previews only, and rejects stale or malformed requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-interface-api-"));
  let app;
  try {
    const file = join(root, "main.pym");
    await writeFile(file, "type Customer = { id: Nat };\n" + source);
    app = await startStudio({ path: root });
    const ready = new Promise((resolve) => {
      const off = app.service.subscribe((e) => {
        if (e.kind === "run" && e.run.status !== "running") {
          off();
          resolve(e.run);
        }
      });
    });
    const started = await app.service.start({
      clientId: "interface-test",
      revision: 0,
      file: "main.pym",
      buffers: {},
      kind: "check",
      entry: "quote",
      seed: "42",
      maxSteps: 6,
      maxSamples: 10,
    });
    await ready;
    const request = (body) =>
      fetch(new URL("/api/interface", app.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + app.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const response = await request({
      action: "describe",
      runId: started.id,
      symbolId: file + "#quote",
    });
    assert.equal(response.status, 200);
    const description = await response.json();
    assert.equal(description.inputs[0].type, "Nat");
    assert.equal(description.output, "Bool");
    assert.equal(description.types.length, 1);
    assert.equal(description.types[0].definition, undefined);
    const typeResponse = await request({
      action: "type",
      runId: started.id,
      symbolId: file + "#Customer",
    });
    assert.equal(typeResponse.status, 200);
    const loadedType = await typeResponse.json();
    assert.equal(loadedType.snapshotId, description.snapshotId);
    assert.deepEqual(loadedType.definition, {
      kind: "record",
      name: "Customer",
      fields: [{ name: "id", type: "Nat" }],
    });
    const shapeEdit = {
      ...loadedType.definition,
      fields: [
        ...loadedType.definition.fields,
        { name: "name", type: "String" },
      ],
    };
    const shapePreview = await request({
      action: "preview-type",
      runId: started.id,
      symbolId: loadedType.symbolId,
      sourceHash: loadedType.sourceHash,
      edit: shapeEdit,
    });
    assert.equal(shapePreview.status, 200);
    assert.match((await shapePreview.json()).text, /name: String/);
    assert.equal(
      (
        await request({
          action: "preview-type",
          runId: started.id,
          symbolId: loadedType.symbolId,
          sourceHash: "stale",
          edit: shapeEdit,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request({
          action: "preview-type",
          runId: started.id,
          symbolId: loadedType.symbolId,
          sourceHash: loadedType.sourceHash,
          edit: { ...shapeEdit, name: "Another" },
        })
      ).status,
      400,
    );
    const edit = {
      ...description,
      inputs: [...description.inputs, { name: "customer", type: "String" }],
    };
    const preview = await request({
      action: "preview",
      runId: started.id,
      symbolId: description.symbolId,
      sourceHash: description.sourceHash,
      edit,
    });
    assert.equal(preview.status, 200);
    const result = await preview.json();
    assert.match(result.text, /quote\(quantity: Nat, customer: String\)/);
    assert.ok(result.text.endsWith(source.slice(source.indexOf("{"))));
    assert.equal(
      await readFile(file, "utf8"),
      "type Customer = { id: Nat };\n" + source,
    );
    const stale = await request({
      action: "preview",
      runId: started.id,
      symbolId: description.symbolId,
      sourceHash: "old",
      edit,
    });
    assert.equal(stale.status, 409);
    const bad = await request({
      action: "preview",
      runId: started.id,
      symbolId: description.symbolId,
      sourceHash: description.sourceHash,
      edit: { ...edit, output: { kind: "bad" } },
    });
    assert.equal(bad.status, 400);
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("new declarations use the shared snapshot preview API without writing source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-create-api-"));
  let app;
  try {
    const file = join(root, "main.pym");
    await writeFile(file, source);
    app = await startStudio({ path: root });
    const ready = new Promise((resolve) => {
      const off = app.service.subscribe((e) => {
        if (e.kind === "run" && e.run.status !== "running") {
          off();
          resolve(e.run);
        }
      });
    });
    const started = await app.service.start({
      clientId: "new-declaration",
      revision: 0,
      file: "main.pym",
      buffers: {},
      kind: "check",
      entry: "quote",
      seed: "42",
      maxSteps: 6,
      maxSamples: 10,
    });
    await ready;
    const request = (body) =>
      fetch(new URL("/api/declaration", app.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + app.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const context = await (
      await request({ action: "context", runId: started.id, file: "main.pym" })
    ).json();
    assert.equal(context.canCreate, true);
    const create = {
      action: "preview",
      runId: started.id,
      file: "main.pym",
      sourceHash: context.sourceHash,
      declaration: {
        kind: "component",
        signature: { name: "later", inputs: [], output: "Unit", effects: [] },
      },
    };
    const response = await request(create);
    assert.equal(response.status, 200);
    assert.match((await response.json()).text, /flow later\(\)/);
    assert.equal(await readFile(file, "utf8"), source);
    assert.equal(
      (await request({ ...create, sourceHash: "stale" })).status,
      409,
    );
    assert.equal(
      (
        await request({
          ...create,
          declaration: {
            ...create.declaration,
            signature: { ...create.declaration.signature, name: "quote" },
          },
        })
      ).status,
      400,
    );
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
