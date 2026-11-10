import test from "node:test";
import assert from "node:assert/strict";
import { sourceDependencyPaths } from "../dist/architecture/source-contracts.js";
test("dependency explanation follows shortest cycle-safe routes and bounds deep output", async () => {
  const catalogue = {
    dependencies: [
      { from: "charge", to: "Order" },
      { from: "Order", to: "Money" },
      { from: "Money", to: "Order" },
    ],
  };
  assert.deepEqual(
    await sourceDependencyPaths(catalogue, "charge", ["Money"]),
    [{ target: "Money", via: ["charge", "Order", "Money"], truncated: false }],
  );
  const deep = {
    dependencies: Array.from({ length: 10000 }, (_, i) => ({
      from: String(i),
      to: String(i + 1),
    })),
  };
  const paths = await sourceDependencyPaths(deep, "0", ["10000"]);
  assert.equal(paths.length, 1);
  assert.equal(paths[0].truncated, true);
  assert.equal(paths[0].via.length, 16);
  assert.equal(paths[0].via.at(-1), "10000");
  const cancel = new AbortController();
  queueMicrotask(() => cancel.abort());
  await assert.rejects(
    sourceDependencyPaths(deep, "0", ["10000"], cancel.signal),
    { name: "AbortError" },
  );
});
