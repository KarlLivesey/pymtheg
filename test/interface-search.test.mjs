// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { searchInterfaces } from "../dist/studio/interface-search.js";
const root = "/tmp/orders-project";
const rows = [
  { name: "Record", file: root + "/types.pym" },
  { name: "OrderLine", file: root + "/types.pym" },
  { name: "Order", file: root + "/nested/types.pym" },
  { name: "Audit", file: root + "/orders/audit.pym" },
];
test("type and callable search ignore the workspace prefix and rank names ahead of relative paths", () => {
  assert.deepEqual(
    searchInterfaces(rows, "Order", root).map((r) => r.name),
    ["Order", "OrderLine", "Audit"],
  );
  assert.deepEqual(searchInterfaces(rows, "tmp", root), []);
  assert.deepEqual(searchInterfaces(rows, "orders-project", root), []);
  assert.equal(searchInterfaces(rows, "nested", root)[0].name, "Order");
});
