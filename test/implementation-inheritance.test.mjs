import { runInNewContext } from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { combinePartitions } from "../dist/implementation/partitions.js";
import { hash } from "../dist/shared/identity.js";
const fixtures = JSON.parse(
  readFileSync(
    new URL(
      "./fixtures/implementation-inheritance-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
for (const [name, barrel, derived] of [
  ["named barrel", 'export {B} from "./a"', "export class D extends B {}"],
  ["star barrel", 'export * from "./a"', "export class D extends B {}"],
  [
    "local re-export and class expression",
    'import {B as Local} from "./a";export {Local as B}',
    "export const D=class extends B {}",
  ],
])
  fixtures.push({
    name,
    files: {
      "a.ts":
        'function refund(){return "REFUND"}export class B{run(){return refund()}}',
      "bar.ts": barrel,
      "d.ts": 'import {B} from "./bar";' + derived,
      "c.ts":
        'import {B} from "./a";import {D} from "./d";function other(){return "OTHER"}Object.getPrototypeOf(D.prototype).run=other;console.log(new B().run())',
    },
  });
fixtures.push({
  name: "transitive bases",
  files: {
    "a.js":
      'function refund(){return "REFUND"}function other(){return "OTHER"}class B{run(){return refund()}}class Middle extends B{}class D extends Middle{}Object.getPrototypeOf(Object.getPrototypeOf(D.prototype)).run=other;console.log(new B().run())',
  },
});
function* partitions(a) {
  if (!a.length) {
    yield [];
    return;
  }
  const [h, ...r] = a;
  for (const p of partitions(r)) {
    for (let i = 0; i < p.length; i++)
      yield [...p.slice(0, i), [h, ...p[i]], ...p.slice(i + 1)];
    yield [[h], ...p];
  }
}
function execute(files) {
  const cache = new Map(),
    lines = [],
    globals = {};
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const module = { exports: {} };
    cache.set(path, module);
    const output = ts.transpileModule(files[path], {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText;
    runInNewContext(output, {
      require: (name) =>
        load(
          Object.keys(files).find(
            (p) => p.replace(/\.[^.]+$/, "") === name.replace(/^\.\//, ""),
          ),
        ),
      module,
      exports: module.exports,
      console: { log: (...a) => lines.push(a.join(" ")) },
    });
    return module.exports;
  }
  load(files["c.ts"] ? "c.ts" : Object.keys(files)[0]);
  return lines.join("\n");
}
for (const fixture of fixtures)
  test(`runtime inheritance/assignment uncertainty ${fixture.name}`, () => {
    assert.match(execute(fixture.files), /OTHER/);
    const files = Object.entries(fixture.files).map(([path, text]) => ({
        path,
        text,
        hash: hash(text),
      })),
      v = { label: "Inheritance provenance", gitCommit: null, dirty: true },
      options = { sourcePaths: files.map((f) => f.path) };
    const check = (g) => {
      const calls = g.edges.filter(
        (e) =>
          e.kind === "calls" &&
          fixture.files[e.span.file].slice(e.span.start, e.span.end) ===
            "new B().run()",
      );
      assert.ok(calls.length);
      for (const call of calls)
        assert.equal(
          call.to,
          null,
          `${fixture.name} falsely targets ${call.to}`,
        );
    };
    check(observeTypescript(files, v, options));
    for (const part of partitions(files)) {
      const graphs = part.map((fs) => observeTypescript(fs, v, options));
      check(combinePartitions(graphs));
      check(combinePartitions([...graphs].reverse()));
    }
  });

test("stable inherited fields and unrelated helpers retain recall", () => {
  const text =
    "function helper(){return 7}class B{n=0;constructor(n){this.n=n}run(){return this.n}}class D extends B{}function use(){return new B(7).run()+helper()}";
  const g = observeTypescript([{ path: "a.ts", text, hash: hash(text) }], {
    label: "Stable inheritance",
    gitCommit: null,
    dirty: true,
  });
  assert.equal(
    g.edges.find((e) => e.kind === "calls" && e.targetName === "new B(7).run")
      ?.to,
    "a.ts#method:B.run",
  );
  assert.equal(
    g.edges.find((e) => e.kind === "calls" && e.targetName === "helper")?.to,
    "a.ts#function:helper",
  );
});
test("inheritance provenance survives storage and rejects invalid owners and bases", async () => {
  const { observationDocuments, decodeObservation } = await import(
    "../dist/implementation/storage.js"
  );
  const { readObservedGraph } = await import(
    "../dist/implementation/schema.js"
  );
  const text =
    "class B{run(){return 1}}class D extends B{}Object.getPrototypeOf(D.prototype).run=()=>7;export function use(){return new B().run()}";
  const g = observeTypescript([{ path: "a.ts", text, hash: hash(text) }], {
    label: "Stored inheritance",
    gitCommit: null,
    dirty: true,
  });
  assert.ok(g.inheritanceOrigins.length);
  assert.deepEqual(decodeObservation(observationDocuments(g)), g);
  const owner = structuredClone(g);
  owner.inheritanceOrigins[0].owner = "missing";
  assert.throws(() => readObservedGraph(owner), /inheritance provenance/);
  const base = structuredClone(g);
  base.inheritanceOrigins[0].base = "a.ts#function:use";
  assert.throws(() => readObservedGraph(base), /inheritance provenance/);
  // A default import outside this partition carries mutation flags for other
  // uses. Inheritance provenance retains only its declared file/name identity.
  const derived = 'import Base from "./base"; export class D extends Base {}';
  const partial = observeTypescript(
    [{ path: "derived.ts", text: derived, hash: hash(derived) }],
    { label: "Partitioned default base", gitCommit: null, dirty: true },
    { sourcePaths: ["base.ts", "derived.ts"] },
  );
  assert.deepEqual(partial.inheritanceOrigins[0].importTarget, {
    file: "base.ts",
    name: "default",
  });
  assert.deepEqual(decodeObservation(observationDocuments(partial)), partial);
});
