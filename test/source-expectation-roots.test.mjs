// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../dist/language/project.js";
import { typecheck } from "../dist/semantic/core.js";
import {
  sourceCatalogue,
  sourceExpectations,
  sourceExpectationSets,
} from "../dist/architecture/source-contracts.js";
test("per-root expectations share one graph while retaining ownership of shared and independent dependencies", () => {
  const file = "/tmp/root-expectations/main.pym";
  const source =
    "type Shared = { ok: Bool }; type Extra = { n: Nat }; flow a(x: Shared) -> Unit { return unit; } flow b(x: Shared,y: Extra) -> Unit { return unit; }";
  const catalogue = sourceCatalogue(
    typecheck(loadProject(file, { buffers: { [file]: source } })),
    "/tmp/root-expectations",
  );
  const roots = sourceExpectationSets(catalogue, [
    "source:main.pym#a",
    "source:main.pym#b",
  ]);
  assert.ok(roots["source:main.pym#a"]["source:main.pym#Shared"]);
  assert.equal(roots["source:main.pym#a"]["source:main.pym#Extra"], undefined);
  assert.ok(roots["source:main.pym#b"]["source:main.pym#Extra"]);
  assert.deepEqual(
    { ...roots["source:main.pym#a"], ...roots["source:main.pym#b"] },
    sourceExpectations(catalogue, ["source:main.pym#a", "source:main.pym#b"]),
  );
});
