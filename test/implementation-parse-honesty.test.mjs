// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash } from "../dist/shared/identity.js";
test("a parser-recovered declaration is unparsed, never an empty implementation", () => {
  const text =
    "// Header\r\n// Second line\r\nexport function half(n: number {";
  const good = "export function empty() {}";
  const graph = observeTypescript(
    [
      { path: "broken.ts", text, hash: hash(text) },
      { path: "good.ts", text: good, hash: hash(good) },
    ],
    { label: "Imperfect parse", gitCommit: null, dirty: true },
  );
  const broken = graph.nodes.find((n) => n.name === "half");
  assert.equal(broken.body, "unparsed");
  assert.equal(broken.bodyHash, null);
  assert.match(broken.signature, /Unparsed/);
  assert.equal(graph.nodes.find((n) => n.name === "empty").body, "empty");
  assert.equal(graph.coverage.declarations, "partial");
});
