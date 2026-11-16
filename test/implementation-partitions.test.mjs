// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { hash } from "../dist/shared/identity.js";
import { observeTypescript } from "../dist/implementation/typescript.js";
import {
  combinePartitions,
  partitionSources,
} from "../dist/implementation/partitions.js";
import {
  observationDocuments,
  decodeObservation,
} from "../dist/implementation/storage.js";
const version = { label: "Combined project", gitCommit: null, dirty: true };
import { decodePart } from "../dist/implementation/part-codec.js";
import { deflateRawSync } from "node:zlib";
const file = (path, text) => ({ path, text, hash: hash(text) });

test("large code parts compress portably with bounded, single-layer expansion", () => {
  const source = file(
    "large.ts",
    "//" + "x".repeat(300000) + "\nexport function f() { return 1; }",
  );
  const graph = observeTypescript([source], version);
  const documents = observationDocuments(graph);
  const packed = JSON.parse(documents[1].text);
  assert.equal(packed.schema, "pymtheg.observed-file/v3");
  assert.ok(documents[1].text.length < 10000);
  assert.deepEqual(decodeObservation(documents), graph);
  assert.throws(
    () => decodePart({ ...packed, bytes: packed.bytes + 1 }),
    /size/,
  );
  const nested = Buffer.from(JSON.stringify(packed));
  assert.throws(
    () =>
      decodePart({
        ...packed,
        bytes: nested.length,
        content: deflateRawSync(nested).toString("base64"),
      }),
    /nested compression/,
  );
  const bomb = deflateRawSync(Buffer.alloc(16 * 1024 * 1024 + 1));
  assert.throws(
    () => decodePart({ ...packed, bytes: 1, content: bomb.toString("base64") }),
    /larger|length|size|buffer/i,
  );
});

test("bounded source partitions resolve explicit static imports in one portable graph", () => {
  const files = [
    file("a.ts", "export function charge() { return 1; }"),
    file(
      "b.ts",
      'import { charge } from "./a.js"; export function checkout() { return charge(); }',
    ),
  ];
  const batches = partitionSources([...files].reverse(), 10);
  assert.deepEqual(
    batches.map((p) => p.map((f) => f.path)),
    [["a.ts"], ["b.ts"]],
  );
  const parts = batches.map((batch) =>
    observeTypescript(batch, version, {
      sourcePaths: files.map((f) => f.path),
    }),
  );
  const graph = combinePartitions(parts);
  assert.equal(graph.nodes.filter((n) => n.kind === "function").length, 2);
  assert.equal(graph.coverage.declarations, "complete");
  assert.equal(graph.coverage.relationships, "partial");
  assert.equal(graph.completeness, "partial");
  assert.ok(
    graph.edges.some(
      (e) =>
        e.kind === "calls" &&
        e.targetName === "charge" &&
        e.resolution === "resolved",
    ),
  );
  assert.ok(
    graph.limitations[0].includes("only explicit static module imports"),
  );
  assert.deepEqual(decodeObservation(observationDocuments(graph)), graph);
  assert.equal(combinePartitions(parts).snapshotId, graph.snapshotId);
  assert.throws(() => combinePartitions([parts[0], parts[0]]), /overlap/);
  assert.throws(
    () =>
      combinePartitions([
        parts[0],
        { ...parts[1], projectId: "another-project" },
      ]),
    /one captured project/,
  );
});

test("compressed code versions reject aggregate expansion before decompressing any part", () => {
  const graph = observeTypescript(
    Array.from({ length: 5 }, (_, i) =>
      file(`f${i}.ts`, `export function f${i}() { return ${i}; }`),
    ),
    version,
  );
  const documents = observationDocuments(graph);
  const manifest = JSON.parse(documents[0].text);
  for (const document of documents.slice(1)) {
    document.text = JSON.stringify({
      schema: "pymtheg.observed-file/v3",
      encoding: "deflate-raw-base64",
      bytes: 16 * 1024 * 1024,
      content: "eA==",
    });
    manifest.parts.find((ref) => ref.path === document.path).hash = hash(
      document.text,
    );
  }
  documents[0].text = JSON.stringify(manifest);
  assert.throws(
    () => decodeObservation(documents),
    /64 MiB.*no parts were decompressed/,
  );
});

test("partitioned ambient declarations never invent locally unique global targets", () => {
  const files = [
    file(
      "a.ts",
      "interface Blob { a: string } function first(x: Blob) { return x; }",
    ),
    file(
      "b.ts",
      "interface Blob { b: string } function second(x: Blob) { return x; }",
    ),
  ];
  const full = observeTypescript(files, version);
  const combined = combinePartitions(
    files.map((f) => observeTypescript([f], version)),
  );
  const uses = (graph) =>
    graph.edges.filter(
      (e) => e.kind === "uses-type" && e.targetName === "Blob",
    );
  assert.ok(uses(full).length > 0);
  assert.ok(uses(full).every((e) => e.resolution === "unresolved"));
  assert.ok(
    uses(combined).every((e) => e.resolution === "unresolved" && e.to === null),
  );
  assert.equal(combined.nodes.filter((n) => n.name === "Blob").length, 2);
});

test("merged interface methods remain ambiguous across parse partitions", () => {
  const files = [
    file(
      "dom.ts",
      'interface Console { error(x: string): void; } declare var console: Console; function a() { console.error("a"); }',
    ),
    file("node.ts", "interface Console { error(x: string): void; }"),
  ];
  const full = observeTypescript(files, version);
  const combined = combinePartitions(
    files.map((f) => observeTypescript([f], version)),
  );
  const call = (graph) =>
    graph.edges.find(
      (e) => e.kind === "calls" && e.targetName === "console.error",
    );
  assert.equal(call(full).resolution, "unresolved");
  assert.equal(call(combined).resolution, "unresolved");
  assert.equal(call(combined).to, null);
});

test("untyped Symbol keys never resolve to a different computed member", () => {
  const text =
    'const A = Symbol("a"), B = Symbol("b"), C = Symbol("c"); class T { [A]() {} [B]() {} [C]() {} run() { this[C](); this[B](); } }';
  const graph = observeTypescript([file("symbols.ts", text)], version);
  const calls = graph.edges.filter(
    (e) => e.kind === "calls" && e.targetName.startsWith("this["),
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((e) => e.to === null && e.resolution === "unresolved"));
  const literal = observeTypescript(
    [file("literal.ts", 'class T { ["go"]() {} run() { this["go"](); } }')],
    version,
  );
  assert.ok(
    literal.edges.some(
      (e) => e.kind === "calls" && e.resolution === "resolved",
    ),
  );
});

test("dynamic function choices and mutations never borrow a compatible function signature", () => {
  const text =
    "function a(){ return 1; } function b(){ return 2; } function run(flag: boolean, cb: typeof a) { const selected = flag ? a : b; selected(); cb(); let mutable = a; mutable = b; mutable(); const alias = a; alias(); }";
  const graph = observeTypescript([file("choices.ts", text)], version);
  for (const name of ["selected", "cb", "mutable"]) {
    const edge = graph.edges.find(
      (e) => e.kind === "calls" && e.targetName === name,
    );
    assert.equal(edge.resolution, "unresolved", name);
    assert.equal(edge.to, null, name);
  }
  assert.equal(
    graph.edges.find((e) => e.kind === "calls" && e.targetName === "alias").to,
    "choices.ts#function:a",
  );
});

test("partition import recovery agrees with full parsing and never assigns dynamic exported values a callable target", () => {
  const files = [
    file(
      "a.ts",
      "export function go(){return 1} export const LIMIT=3; export default function start(){return 2} export type Shape={n:number}; function one(){return 1} function two(){return 2} export const dynamic=flag?one:two;",
    ),
    file("other.ts", "export function go(){return 5}"),
    file(
      "b.ts",
      'import start,{go as execute,LIMIT,dynamic,type Shape} from "./a.js"; import * as other from "./other.js"; export function run(value:Shape){execute();start();other.go();dynamic();return LIMIT+value.n}',
    ),
  ];
  const full = observeTypescript(files, version);
  const split = combinePartitions(
    files.map((source) =>
      observeTypescript([source], version, {
        sourcePaths: files.map((f) => f.path),
      }),
    ),
  );
  const key = (e) =>
    [e.span.file, e.span.start, e.span.end, e.kind, e.targetName].join("|");
  const expected = new Map(full.edges.map((e) => [key(e), e.to]));
  for (const edge of split.edges.filter((e) => e.importTarget && e.to))
    assert.equal(edge.to, expected.get(key(edge)), key(edge));
  for (const name of ["execute", "start", "other.go"])
    assert.ok(
      split.edges.some(
        (e) => e.kind === "calls" && e.targetName === name && e.to,
      ),
    );
  assert.equal(
    split.edges.find((e) => e.kind === "calls" && e.targetName === "dynamic")
      .to,
    null,
  );
  assert.ok(
    split.edges.some(
      (e) =>
        e.kind === "references" &&
        e.targetName === "LIMIT" &&
        e.to === "a.ts#binding:LIMIT",
    ),
  );
  assert.deepEqual(decodeObservation(observationDocuments(split)), split);
});

test("an inherited dynamic this receiver never gains a definite method target in a smaller parse partition", () => {
  const files = [
    file("a.ts", "export class A{go(){return 1}run(){return this.go()}}"),
    file(
      "b.ts",
      'import {A} from "./a.js";class B extends A{go(){return 2}}new B().run();',
    ),
  ];
  const full = observeTypescript(files, version),
    split = combinePartitions(
      files.map((f) =>
        observeTypescript([f], version, {
          sourcePaths: files.map((f) => f.path),
        }),
      ),
    );
  for (const graph of [full, split])
    assert.equal(
      graph.edges.find((e) => e.kind === "calls" && e.targetName === "this.go")
        .to,
      null,
    );
});

test("private module names survive partition merging while global augmentations remain ambiguous", () => {
  const files = [
    file(
      "a.ts",
      "export {}; function internal(){return 1} export function run(){return internal()} declare global {interface GlobalShape {a:number}} function typed(x:GlobalShape){return x}",
    ),
    file(
      "b.ts",
      "export {}; function internal(){return 2} export function run(){return internal()} declare global {interface GlobalShape {b:number}}",
    ),
  ];
  const full = observeTypescript(files, version);
  const split = combinePartitions(
    files.map((f) =>
      observeTypescript([f], version, {
        sourcePaths: files.map((f) => f.path),
      }),
    ),
  );
  for (const graph of [full, split]) {
    for (const name of ["a.ts", "b.ts"])
      assert.equal(
        graph.edges.find(
          (e) =>
            e.span.file === name &&
            e.kind === "calls" &&
            e.targetName === "internal",
        )?.to,
        name + "#function:internal",
      );
    assert.equal(
      graph.edges.find(
        (e) => e.kind === "uses-type" && e.targetName === "GlobalShape",
      )?.to,
      null,
    );
  }
  assert.deepEqual(decodeObservation(observationDocuments(split)), split);
});

test("writes through imports cross partition boundaries without inventing stable dispatch", () => {
  const files = [
    file(
      "a.ts",
      "export const api={go(){return 1}};export function clean(){return 3}",
    ),
    file(
      "b.ts",
      'import {api} from "./a.js"; export function configure(){Reflect.set(api,"go",()=>2)}',
    ),
    file(
      "c.ts",
      'import {api,clean} from "./a.js"; export function run(){clean();return api.go()}',
    ),
  ];
  const full = observeTypescript(files, version);
  const split = combinePartitions([
    observeTypescript([files[0], files[2]], version, {
      sourcePaths: files.map((f) => f.path),
    }),
    observeTypescript([files[1]], version, {
      sourcePaths: files.map((f) => f.path),
    }),
  ]);
  for (const graph of [full, split]) {
    assert.equal(
      graph.edges.find((e) => e.kind === "calls" && e.targetName === "api.go")
        ?.to,
      null,
    );
    assert.equal(
      graph.edges.find((e) => e.kind === "calls" && e.targetName === "clean")
        ?.to,
      "a.ts#function:clean",
    );
    assert.ok(
      graph.edges.some(
        (e) =>
          e.kind === "written-by" &&
          e.from === "a.ts#binding:api" &&
          e.to === "b.ts#function:configure",
      ),
    );
  }
  assert.deepEqual(decodeObservation(observationDocuments(split)), split);
});

test("top-level imported writer identity is independent of parser partitioning", () => {
  const files = [
    file("a.ts", "export const api={go(){return 1}}"),
    file("b.ts", 'import {api} from "./a.js"; Reflect.set(api,"go",()=>2);'),
  ];
  const full = observeTypescript(files, version),
    split = combinePartitions(
      files.map((f) =>
        observeTypescript([f], version, {
          sourcePaths: files.map((f) => f.path),
        }),
      ),
    );
  const writers = (g) =>
    g.nodes.filter((n) => n.id.includes("#binding-write:"));
  assert.equal(writers(full).length, 1);
  assert.deepEqual(writers(split), writers(full));
});
