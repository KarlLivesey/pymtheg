import test from "node:test";
import assert from "node:assert/strict";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash } from "../dist/shared/identity.js";
import {
  observationDocuments,
  decodeObservation,
} from "../dist/implementation/storage.js";
const version = { label: "Budget", gitCommit: null, dirty: true };
const file = (path, text) => ({ path, text, hash: hash(text) });
test("one expensive file degrades explicitly while other declarations and relationships survive", () => {
  const graph = observeTypescript(
    [
      file(
        "a-large.ts",
        Array.from(
          { length: 200 },
          (_, i) => `export function f${i}(){return ${i};}`,
        ).join("\n"),
      ),
      file(
        "z-small.ts",
        "export function ready(){return true;} export function run(){return ready();}",
      ),
    ],
    version,
    { fileVisitBudget: 100 },
  );
  assert.equal(graph.coverage.declarations, "partial");
  assert.ok(
    graph.limitations.some((l) =>
      /1 of 2 files.*narrower source scope.*a-large.ts/.test(l),
    ),
  );
  assert.equal(
    graph.files.find((f) => f.path === "a-large.ts").coverage.declarations,
    "partial",
  );
  assert.equal(
    graph.files.find((f) => f.path === "z-small.ts").coverage.declarations,
    "complete",
  );
  assert.ok(graph.nodes.some((n) => n.name === "ready"));
  assert.ok(
    graph.edges.some(
      (e) => e.kind === "calls" && e.targetName === "ready" && e.to,
    ),
  );
  assert.ok(!graph.nodes.some((n) => n.name === "f0"));
  assert.match(
    graph.diagnostics.find((d) => d.span.file === "a-large.ts").message,
    /2 files.*source bytes.*narrower/,
  );
  assert.deepEqual(decodeObservation(observationDocuments(graph)), graph);
});
test("dictionary storage validates references and reads legacy file parts", () => {
  const graph = observeTypescript(
    [
      file(
        "a.ts",
        "export function ready(){return true;} export function run(){return ready();}",
      ),
    ],
    version,
  );
  const docs = observationDocuments(graph),
    part = JSON.parse(docs[1].text);
  assert.equal(part.schema, "pymtheg.observed-file/v4");
  const corrupted = structuredClone(docs);
  part.nodes[0][0] = part.strings.length;
  corrupted[1].text = JSON.stringify(part);
  const manifest = JSON.parse(corrupted[0].text);
  manifest.parts[0].hash = hash(corrupted[1].text);
  corrupted[0].text = JSON.stringify(manifest);
  assert.throws(() => decodeObservation(corrupted), /dictionary reference/);
  const legacy = structuredClone(docs);
  legacy[1].text = JSON.stringify({
    schema: "pymtheg.observed-file/v1",
    file: graph.files[0],
    nodes: graph.nodes,
    edges: graph.edges,
    diagnostics: graph.diagnostics,
  });
  const old = JSON.parse(legacy[0].text);
  old.parts[0].hash = hash(legacy[1].text);
  legacy[0].text = JSON.stringify(old);
  assert.deepEqual(decodeObservation(legacy), graph);
});

test("v4 derived declaration hashes preserve legacy v2 parts and non-derived provider hashes", () => {
  const graph = observeTypescript(
    [file("a.ts", "export function f(){return 1}")],
    version,
  );
  const docs = observationDocuments(graph),
    part = JSON.parse(docs[1].text);
  const legacy = structuredClone(part);
  legacy.schema = "pymtheg.observed-file/v2";
  for (let i = 0; i < legacy.nodes.length; i++)
    if (legacy.nodes[i][7] === null) {
      legacy.nodes[i][7] = legacy.strings.length;
      legacy.strings.push(graph.nodes[i].declarationHash);
    }
  for (const edge of legacy.edges) edge.length = 7;
  const replace = (value) => {
    const changed = structuredClone(docs);
    changed[1].text = JSON.stringify(value);
    const manifest = JSON.parse(changed[0].text);
    manifest.parts[0].hash = hash(changed[1].text);
    changed[0].text = JSON.stringify(manifest);
    return changed;
  };
  assert.deepEqual(decodeObservation(replace(legacy)), graph);
  const custom = structuredClone(graph);
  custom.nodes[0].declarationHash = hash(
    "Provider-specific declaration identity",
  );
  assert.deepEqual(decodeObservation(observationDocuments(custom)), custom);
});
