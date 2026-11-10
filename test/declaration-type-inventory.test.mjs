import test from "node:test";
import assert from "node:assert/strict";
import {
  declarationTypeInventory,
  declarationTypePage,
} from "../dist/studio/declaration-type-inventory.js";
import { queryDeclarationTypes } from "../dist/implementation/query-runner.js";
const root = "/tmp/catalog-orders-proj";
test("an exact type limit cannot hide later sources behind a complete inventory", () => {
  const text = Array.from(
    { length: 25000 },
    (_, i) => `type T${i} = Ready;`,
  ).join("\n");
  const inputs = Array.from({ length: 4 }, (_, i) => ({
    file: `f${i}.pym`,
    text,
  }));
  const exact = declarationTypeInventory(root, inputs);
  assert.equal(exact.items.length, 100000);
  assert.equal(exact.complete, true);
  const exceeded = declarationTypeInventory(root, [
    ...inputs,
    { file: "last.pym", text: "type Later = Ready;" },
  ]);
  assert.equal(exceeded.items.length, 100000);
  assert.equal(exceeded.complete, false);
  assert.match(exceeded.warnings.join("\n"), /metadata budget/);
});
test("type discovery preserves same-name identities, filters before paging and does not match project-root names", () => {
  const inputs = Array.from({ length: 1000 }, (_, i) => ({
    file: `types/t${i}.pym`,
    text: `type T${i} = { id: Nat };`,
  }));
  inputs.push(
    { file: "a.pym", text: "type Order = { id: Nat };" },
    { file: "b.pym", text: "type Order = { key: String };" },
  );
  const catalog = declarationTypeInventory(root, inputs);
  assert.equal(catalog.parsedFiles, 1002);
  assert.equal(catalog.complete, true);
  const result = declarationTypePage(catalog, { query: "Order", limit: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.items[0].symbolId, "a.pym#Order");
  assert.equal(result.nextOffset, 1);
  assert.equal(
    declarationTypePage(catalog, { query: "Order", offset: 1, limit: 1 })
      .items[0].symbolId,
    "b.pym#Order",
  );
  assert.equal(
    declarationTypePage(catalog, { query: "T999" }).items[0].symbolId,
    "types/t999.pym#T999",
  );
  assert.equal(
    declarationTypePage(catalog, { query: "catalog-orders-proj" }).total,
    0,
  );
});
test("damaged and duplicate sources stay distinguishable from valid candidate metadata", () => {
  const result = declarationTypeInventory(root, [
    {
      file: "duplicate.pym",
      text: "type A = { id: Nat }; type A = { id: Int };",
    },
    { file: "broken.pym", text: "type Broken = { id: Nat }; flow damaged(" },
    { file: "good.pym", text: "type Good = { id: NotYetDefined };" },
  ]);
  assert.equal(result.complete, false);
  assert.equal(
    result.items.find((t) => t.name === "Broken").status,
    "syntax-incomplete",
  );
  assert.ok(
    result.items
      .filter((t) => t.name === "A")
      .every((t) => t.status === "duplicate"),
  );
  assert.equal(result.items.find((t) => t.name === "Good").status, "candidate");
  assert.match(result.meaning, /not verification evidence/);
  assert.equal(
    declarationTypeInventory(root, [
      { file: "../elsewhere.pym", text: "type X = A;" },
    ]).items.length,
    0,
  );
});
test("type discovery uses the cancellable owned worker and validates its output", async () => {
  const result = await queryDeclarationTypes(
    root,
    [{ file: "a.pym", text: "type A = { id: Nat };" }],
    [],
    new AbortController().signal,
  );
  assert.equal(result.items[0].name, "A");
  const controller = new AbortController();
  const workerURL = new URL(
    "data:text/javascript," +
      encodeURIComponent(
        'import {parentPort} from "node:worker_threads";parentPort.postMessage({kind:"ready"});while(true){}',
      ),
  );
  await assert.rejects(
    queryDeclarationTypes(root, [], [], controller.signal, {
      workerURL,
      onReady: () => controller.abort(),
    }),
    /cancelled/,
  );
  const bad = new URL(
    "data:text/javascript," +
      encodeURIComponent(
        'import {parentPort} from "node:worker_threads";parentPort.postMessage({result:{complete:true}});',
      ),
  );
  await assert.rejects(
    queryDeclarationTypes(root, [], [], new AbortController().signal, {
      workerURL: bad,
    }),
    /invalid|expected/i,
  );
});
