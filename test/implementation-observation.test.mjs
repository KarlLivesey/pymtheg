import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../dist/shared/identity.js";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { readObservedGraph } from "../dist/implementation/schema.js";
const version = { label: "working tree", gitCommit: null, dirty: true };
const sources = (input) =>
  Object.entries(input).map(([path, text]) => ({
    path,
    text,
    hash: hash(text),
  }));
test("observed graph resolves real imports, calls and methods while distinguishing unfinished code", () => {
  const graph = observeTypescript(
    sources({
      "service.ts":
        'export function charge(id: string): boolean { return true; } export function empty(): void {} export function pending(): boolean { throw new Error("Not implemented"); } export interface Port { send(): void; }',
      "main.ts":
        'import { charge as pay } from "./service.js"; class Checkout { run() { return pay("order"); } } const checkout = new Checkout(); checkout.run();',
    }),
    version,
  );
  assert.equal(graph.coverage.declarations, "complete");
  assert.equal(graph.coverage.relationships, "partial");
  assert.equal(graph.completeness, "partial");
  assert.equal(graph.nodes.find((node) => node.name === "empty").body, "empty");
  assert.equal(
    graph.nodes.find((node) => node.name === "pending").body,
    "fail-fast",
  );
  assert.equal(
    graph.nodes.find((node) => node.name === "Port").body,
    "declaration-only",
  );
  assert.equal(
    graph.nodes.find((node) => node.qualifiedName === "Port.send").body,
    "declaration-only",
  );
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.kind === "calls" &&
        edge.from === "main.ts#method:Checkout.run" &&
        edge.to === "service.ts#function:charge",
    ),
  );
  assert.ok(
    graph.edges.some(
      (edge) => edge.kind === "imports" && edge.to === "file:service.ts",
    ),
  );
  assert.ok(
    graph.edges.some(
      (edge) =>
        edge.kind === "calls" && edge.to === "main.ts#method:Checkout.run",
    ),
  );
  assert.ok(
    graph.edges.some(
      (edge) => edge.resolution === "unresolved" && edge.targetName === "Error",
    ),
  );
  assert.ok(graph.nodes.every((node) => !node.span.file.startsWith("/")));
});
test("observation identity comes from source bytes rather than labels or clocks; syntax holes remain partial", () => {
  const input = sources({ "a.ts": "export const ready = () => true;" });
  const first = observeTypescript(input, version);
  const second = observeTypescript(input, { ...version, label: "release 2" });
  assert.equal(first.snapshotId, second.snapshotId);
  const changed = observeTypescript(
    sources({ "a.ts": "export const ready = () => false;" }),
    version,
  );
  assert.notEqual(changed.snapshotId, first.snapshotId);
  const partial = observeTypescript(
    sources({ "a.ts": input[0].text, "broken.ts": "function missing( {" }),
    version,
  );
  assert.equal(partial.completeness, "partial");
  assert.ok(partial.diagnostics.some((item) => item.span.file === "broken.ts"));
  assert.ok(
    partial.nodes.some(
      (node) => node.name === "ready" && node.body === "present",
    ),
  );
  assert.throws(
    () =>
      observeTypescript([{ ...input[0], hash: hash("different") }], version),
    /hash/,
  );
  const malformed = structuredClone(first);
  malformed.nodes[0].span.end = 100000;
  assert.throws(() => readObservedGraph(malformed), /source provenance/);
});
