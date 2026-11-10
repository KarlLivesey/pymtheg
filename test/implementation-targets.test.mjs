import test from "node:test";
import assert from "node:assert/strict";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { implementationPage } from "../dist/implementation/workspace.js";
import { hash } from "../dist/shared/identity.js";
test("observed calls distinguish external imports, builtins, local bindings and unknown targets without claiming resolution", () => {
  const text = `import { z } from 'zod';
import { missing } from './missing';
export function f(callback: () => void) {
  new Error('example'); JSON.stringify({});
  z
    .string();
  callback(); missing(); unknownGlobal();
}
export function shadow(Error: new () => unknown) { new Error(); }
`;
  const graph = observeTypescript(
    [{ path: "main.ts", text, hash: hash(text) }],
    { label: "Target origins", gitCommit: null, dirty: true },
  );
  const calls = graph.edges.filter((e) => e.kind === "calls");
  const kind = (name, owner = "f") =>
    calls.find((e) => e.targetName === name && e.from.endsWith(":" + owner));
  assert.equal(kind("Error").targetKind, "builtin");
  assert.equal(kind("JSON.stringify").targetKind, "builtin");
  assert.equal(kind("z.string").targetKind, "external-package");
  assert.equal(kind("callback").targetKind, "local-binding");
  assert.equal(kind("missing").targetKind, "unknown");
  assert.equal(kind("unknownGlobal").targetKind, "unknown");
  assert.equal(
    kind("Error", "shadow").targetKind,
    "local-binding",
    "a shadowed global is not a builtin",
  );
  assert.equal(kind("z.string").to, null);
  assert.equal(graph.coverage.relationships, "partial");
  const state = { index: { id: "code" }, documents: [], bindings: [], graph };
  const page = implementationPage(state, state, {
    mode: "existing",
    query: "",
    offset: 0,
    limit: 100,
  });
  assert.ok(
    page.edges.some(
      (e) =>
        e.targetName === "z.string" &&
        e.targetKind === "external-package" &&
        e.unresolved,
    ),
  );
});
