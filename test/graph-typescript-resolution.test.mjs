import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import typescript, {
  statistics,
} from "../dist/graph/languages/typescript/index.js";

// Resolution rules of the TypeScript/JavaScript module: each rule has a positive
// case, a look-alike negative case and, where relevant, an ambiguous case.

const registry = () => new LanguageRegistry([typescript]);
async function project(files, run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-typescript-"));
  const root = join(scratch, "project");
  const database = join(scratch, "graph.sqlite");
  let store = new SqliteGraphStore(database, "typescript-rules");
  const write = async (path, text) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  try {
    await mkdir(root);
    for (const [path, text] of Object.entries(files)) await write(path, text);
    const report = await indexProject(root, registry(), store);
    const graph = {
      root,
      database,
      write,
      remove: (path) => rm(join(root, path)),
      get store() {
        return store;
      },
      reopen() {
        store.close();
        store = new SqliteGraphStore(database);
      },
      reindex: () => indexProject(root, registry(), store),
      /** Links in `file` whose range text is `at` (optionally of `kind`). */
      links(file, at, kind) {
        const text = store.getFile(file).text;
        return store
          .links()
          .filter(
            (link) =>
              link.file === file &&
              text.slice(link.range.start, link.range.end) === at &&
              (kind === undefined || link.kind === kind),
          );
      },
      link(file, at, kind) {
        const found = graph.links(file, at, kind);
        assert.equal(
          found.length,
          1,
          `one ${kind ?? "link"} at ${at} in ${file}`,
        );
        return found[0];
      },
      symbol(file, identity, kind) {
        const found = store
          .findSymbols({ file })
          .filter(
            (symbol) =>
              symbol.identity === identity &&
              (kind === undefined || symbol.kind === kind),
          );
        assert.equal(found.length, 1, `one symbol ${identity} in ${file}`);
        return found[0];
      },
      /** "file#identity" of a link's definite target or null. */
      target(link) {
        const symbol = store
          .findSymbols()
          .find((symbol) => symbol.id === link.targetId);
        return symbol ? `${symbol.file}#${symbol.identity}` : null;
      },
      candidates(link) {
        const all = store.findSymbols();
        return link.candidates
          .map(({ id }) => all.find((symbol) => symbol.id === id))
          .map((symbol) => `${symbol.file}#${symbol.identity}`)
          .sort();
      },
    };
    await run(graph, report);
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
const clean = (report) => {
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.analysisErrors, []);
  assert.deepEqual(report.resolutionErrors, []);
};

test("relative imports resolve to the module; a missing relative file stays unresolved", async () => {
  await project(
    {
      "a.ts": "export function f() {}\n",
      "b.ts":
        'import { f } from "./a";\nimport { g } from "./missing";\nf();\ng();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(graph.target(graph.link("b.ts", '"./a"')), "a.ts#a.ts");
      assert.equal(graph.target(graph.link("b.ts", "f", "imports")), "a.ts#f");
      const missing = graph.link("b.ts", '"./missing"');
      assert.equal(missing.resolution, "unresolved");
      assert.equal(missing.targetName, "./missing");
      assert.equal(missing.data.reason, "missing-module");
      assert.equal(graph.link("b.ts", "g", "calls").resolution, "unresolved");
    },
  );
});

test("barrel chains resolve to the original declaration, never to a same-named look-alike", async () => {
  await project(
    {
      "impl.ts": "export function tool() {}\n",
      "decoy.ts": "export function tool() {}\n",
      "level1.ts": 'export * from "./impl";\n',
      "level2.ts": 'export { tool as renamed } from "./level1";\n',
      "use.ts": 'import { renamed } from "./level2";\nrenamed();\n',
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link("use.ts", "renamed", "calls");
      assert.equal(graph.target(call), "impl.ts#tool");
      assert.notEqual(graph.target(call), "decoy.ts#tool");
      assert.equal(
        graph.target(graph.link("level2.ts", "tool as renamed")),
        "impl.ts#tool",
      );
    },
  );
});

test("tsconfig paths aliases resolve; an alias the config does not declare stays unresolved", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@core/*": ["src/core/*"] } },
      }),
      "src/core/log.ts": "export function log() {}\n",
      "src/app.ts":
        'import { log } from "@core/log";\nimport { other } from "@nope/log";\nlog();\nother();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("src/app.ts", "log", "calls")),
        "src/core/log.ts#log",
      );
      const unknown = graph.link("src/app.ts", '"@nope/log"');
      assert.equal(unknown.resolution, "unresolved");
      assert.equal(unknown.data.reason, "external-package");
    },
  );
});

test("default imports under another name resolve; a named import of a default-only export does not", async () => {
  await project(
    {
      "maker.ts": "export default class Maker {}\n",
      "a.ts": 'import Built from "./maker";\nnew Built();\n',
      "b.ts": 'import { Maker } from "./maker";\nnew Maker();\n',
      "anon.ts": "export default function () {}\n",
      "c.ts": 'import run from "./anon";\nrun();\n',
    },
    async (graph) => {
      assert.equal(
        graph.target(graph.link("a.ts", "Built", "calls")),
        "maker.ts#Maker",
      );
      assert.equal(
        graph.link("b.ts", "Maker", "calls").resolution,
        "unresolved",
      );
      assert.equal(
        graph.link("b.ts", "Maker", "imports").resolution,
        "unresolved",
      );
      assert.equal(
        graph.target(graph.link("c.ts", "run", "calls")),
        "anon.ts#default",
      );
    },
  );
});

test("namespace imports and export * as ns resolve member calls to the original declaration", async () => {
  await project(
    {
      "math.ts": "export function add() {}\n",
      "barrel.ts": 'export * as math from "./math";\n',
      "a.ts": 'import * as m from "./math";\nm.add();\nm.subtract();\n',
      "b.ts": 'import { math } from "./barrel";\nmath.add();\n',
    },
    async (graph) => {
      assert.equal(
        graph.target(graph.link("a.ts", "* as m")),
        "math.ts#math.ts",
      );
      assert.equal(
        graph.target(graph.link("a.ts", "add", "calls")),
        "math.ts#add",
      );
      // Not exported by the module: the checker has no declaration, so no guess.
      assert.equal(
        graph.link("a.ts", "subtract", "calls").resolution,
        "unresolved",
      );
      assert.equal(
        graph.target(graph.link("b.ts", "add", "calls")),
        "math.ts#add",
      );
    },
  );
});

test("calls follow the checker: locals shadow imports, unions give candidates, any stays unresolved", async () => {
  await project(
    {
      "lib.ts":
        "export function format() {}\nexport class A { go() {} }\nexport class B { go() {} }\nexport interface Port { go(): void }\n",
      "use.ts": [
        'import { format, A, B, Port } from "./lib";',
        "export function direct() { format(); }",
        "export function shadowed() { const format = () => 1; format(); }",
        "export function union(x: A | B) { x.go(); }",
        "export function single(x: A) { x.go(); }",
        "export function iface(x: Port) { x.go(); }",
        "export function untyped(x: any) { x.go(); }",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const calls = graph.links("use.ts", "format", "calls");
      assert.equal(calls.length, 2);
      const [direct, shadowed] = calls.sort(
        (a, b) => a.range.start - b.range.start,
      );
      assert.equal(graph.target(direct), "lib.ts#format");
      assert.equal(shadowed.resolution, "unresolved");
      assert.equal(shadowed.data.reason, "local");
      const go = graph
        .links("use.ts", "go", "calls")
        .sort((a, b) => a.range.start - b.range.start);
      assert.equal(go.length, 4);
      assert.equal(go[0].resolution, "ambiguous");
      assert.deepEqual(graph.candidates(go[0]), ["lib.ts#A.go", "lib.ts#B.go"]);
      assert.equal(graph.target(go[1]), "lib.ts#A.go");
      assert.equal(graph.target(go[2]), "lib.ts#Port.go");
      assert.equal(go[3].resolution, "unresolved");
      assert.equal(go[3].targetName, "x.go");
    },
  );
});

test("overloads are one symbol with a definite target; repeated JS declarations keep ordinals", async () => {
  await project(
    {
      "over.ts": [
        "export function pick(a: string): string;",
        "export function pick(a: number): number;",
        "export function pick(a: any) { return a; }",
        "export class K {",
        "  constructor(a: string);",
        "  constructor(a: any) {}",
        "  m(a: string): void;",
        "  m(a: number): void;",
        "  m(a: any) {}",
        "}",
        'pick("x");',
        "pick(1);",
        'new K("x").m(1);',
        "",
      ].join("\n"),
      "repeat.js": "function twice() {}\nfunction twice() {}\ntwice();\n",
    },
    async (graph) => {
      const pick = graph.symbol("over.ts", "pick", "function");
      assert.equal(
        graph.store.findSymbols({ file: "over.ts", name: "pick" }).length,
        1,
      );
      for (const call of graph.links("over.ts", "pick", "calls"))
        assert.equal(call.targetId, pick.id);
      graph.symbol("over.ts", "K.constructor", "constructor");
      assert.equal(
        graph.target(graph.link("over.ts", "m", "calls")),
        "over.ts#K.m",
      );
      // Two complete JS declarations are not overloads: two ordinals, candidates.
      const twice = graph.store.findSymbols({
        file: "repeat.js",
        name: "twice",
      });
      assert.deepEqual(twice.map((s) => s.ordinal).sort(), [0, 1]);
      const call = graph.link("repeat.js", "twice", "calls");
      assert.equal(call.resolution, "ambiguous");
    },
  );
});

test("declaration merging gives candidates; type positions select the type declaration", async () => {
  await project(
    {
      "merge.ts": [
        "export interface Opts { a: string }",
        "export interface Opts { b: string }",
        "export namespace Shape { export const unit = 1; }",
        "export interface Shape { size: number }",
        "",
      ].join("\n"),
      "use.ts": [
        'import { Opts, Shape } from "./merge";',
        "export const o: Opts = { a: '', b: '' };",
        "export const s: Shape = { size: Shape.unit };",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const opts = graph.link("use.ts", "Opts", "references");
      assert.equal(opts.resolution, "ambiguous");
      assert.equal(graph.candidates(opts).length, 2);
      const shapeImport = graph.link("use.ts", "Shape", "imports");
      assert.deepEqual(graph.candidates(shapeImport), [
        "merge.ts#Shape",
        "merge.ts#Shape",
      ]);
      const shapeType = graph.links("use.ts", "Shape", "references");
      assert.equal(shapeType.length, 1);
      assert.equal(
        graph.store.findSymbols().find((s) => s.id === shapeType[0].targetId)
          .kind,
        "interface",
      );
    },
  );
});

test("CommonJS require binds in JS files; a computed require and a require in a .ts file do not", async () => {
  await project(
    {
      "util.ts": "export function add() {}\n",
      "cjs.js": [
        "exports.helper = function () {};",
        "module.exports.other = () => 1;",
        "",
      ].join("\n"),
      "use.js": [
        'const { add } = require("./util");',
        'const whole = require("./cjs");',
        "const name = './util';",
        "const dynamic = require(name);",
        "add();",
        "whole.helper();",
        "dynamic.add();",
        "",
      ].join("\n"),
      // A module, so its `require` declaration does not leak into the global scope.
      "use.ts":
        'export {};\ndeclare const require: any;\nconst x = require("./util");\nx.add();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("use.js", '"./util"')),
        "util.ts#util.ts",
      );
      const [direct, viaDynamic] = graph
        .links("use.js", "add", "calls")
        .sort((a, b) => a.range.start - b.range.start);
      assert.equal(graph.target(direct), "util.ts#add");
      assert.equal(
        graph.target(graph.link("use.js", "helper", "calls")),
        "cjs.js#helper",
      );
      graph.symbol("cjs.js", "other", "function");
      // A computed require is an unresolvable import, not a call to `require`.
      const computed = graph.link("use.js", "require(name)", "imports");
      assert.equal(computed.resolution, "unresolved");
      assert.equal(computed.targetName, "(computed require)");
      assert.equal(computed.data.reason, "computed-specifier");
      assert.equal(graph.links("use.js", "require", "calls").length, 0);
      assert.equal(viaDynamic.resolution, "unresolved");
      // In TypeScript, `require` is an ordinary call: no import edge, no guess.
      assert.equal(graph.links("use.ts", '"./util"', "imports").length, 0);
      assert.equal(
        graph.link("use.ts", "add", "calls").resolution,
        "unresolved",
      );
    },
  );
});

test("JSX components link to the component; intrinsic elements and unknown components do not resolve", async () => {
  await project(
    {
      "ui.tsx": [
        "export function Card() { return <div />; }",
        "export const Panel = () => <section><Card /></section>;",
        "export function Page() { return <Panel><Missing /></Panel>; }",
        "",
      ].join("\n"),
    },
    async (graph) => {
      assert.equal(
        graph.target(graph.link("ui.tsx", "Card", "calls")),
        "ui.tsx#Card",
      );
      assert.equal(graph.symbol("ui.tsx", "Panel").kind, "function");
      assert.equal(
        graph.target(graph.link("ui.tsx", "Panel", "calls")),
        "ui.tsx#Panel",
      );
      assert.equal(graph.links("ui.tsx", "div").length, 0);
      assert.equal(graph.links("ui.tsx", "section").length, 0);
      const missing = graph.link("ui.tsx", "Missing", "calls");
      assert.equal(missing.resolution, "unresolved");
      assert.equal(missing.data.jsx, true);
    },
  );
});

test("workspace packages resolve to project source; an undeclared package directory does not", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/core/package.json": JSON.stringify({
        name: "@w/core",
        main: "./index.ts",
      }),
      "packages/core/index.ts": "export function core() {}\n",
      "loose/package.json": JSON.stringify({
        name: "@w/loose",
        main: "./index.ts",
      }),
      "loose/index.ts": "export function loose() {}\n",
      "packages/app/index.ts":
        'import { core } from "@w/core";\nimport { loose } from "@w/loose";\ncore();\nloose();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("packages/app/index.ts", "core", "calls")),
        "packages/core/index.ts#core",
      );
      const loose = graph.link("packages/app/index.ts", '"@w/loose"');
      assert.equal(loose.resolution, "unresolved");
      assert.equal(loose.data.reason, "external-package");
    },
  );
});

test("extends and implements resolve; an external base class stays unresolved with its name", async () => {
  await project(
    {
      "types.ts":
        "export interface Shape { area(): number }\nexport class Base {}\nexport interface Named { name: string }\nexport interface Both extends Named, Shape {}\n",
      "impl.ts": [
        'import { Shape, Base } from "./types";',
        'import { Emitter } from "events";',
        "export class Sq extends Base implements Shape { area() { return 1; } }",
        "export class Ev extends Emitter {}",
        "",
      ].join("\n"),
    },
    async (graph) => {
      assert.equal(
        graph.target(graph.link("impl.ts", "Base", "extends")),
        "types.ts#Base",
      );
      assert.equal(
        graph.target(graph.link("impl.ts", "Shape", "implements")),
        "types.ts#Shape",
      );
      const external = graph.link("impl.ts", "Emitter", "extends");
      assert.equal(external.resolution, "unresolved");
      assert.equal(external.targetName, "Emitter");
      assert.equal(
        graph.target(graph.link("types.ts", "Named", "extends")),
        "types.ts#Named",
      );
    },
  );
});

test("symbols cover the declaration kinds with scoped identities and exact UTF-16 ranges", async () => {
  const text = [
    "/* 𝒳 non-BMP before declarations */",
    "export enum Color { Red, Green }",
    "export type Id = string;",
    "export namespace Outer.Inner { export function deep() {} }",
    "declare module 'ambient' { export function amb(): void }",
    "declare global { interface Window { extra: number } }",
    "export const { left, right: renamed } = { left: 1, right: 2 };",
    "export let counter = 0;",
    "export const api = { run() {}, data: 1, go: () => 1 };",
    "export default { anonymous: true };",
    "export abstract class Shape {",
    "  static count = 0;",
    "  count = 1;",
    "  #secret = 2;",
    "  get size() { return 1; }",
    "  set size(v: number) {}",
    "  handler = () => this.size;",
    "  abstract area(): number;",
    "}",
    "export const Klass = class { method() {} };",
    "function local() { function nested() {} }",
    "",
  ].join("\n");
  await project({ "kinds.ts": text }, async (graph, report) => {
    clean(report);
    const facts = graph.store
      .findSymbols({ file: "kinds.ts" })
      .map((s) => `${s.kind} ${s.identity}`)
      .sort();
    assert.deepEqual(
      facts,
      [
        "class Klass",
        "class Shape",
        "constant api",
        "variable counter",
        "constant default",
        "constant left",
        "constant renamed",
        "enum Color",
        "enum-member Color.Green",
        "enum-member Color.Red",
        "function Outer.Inner.deep",
        'function "ambient".amb',
        "function local",
        "getter Shape.size",
        "interface global.Window",
        "method Klass.method",
        "method Shape.area",
        "method api.go",
        "method api.run",
        "module kinds.ts",
        'namespace "ambient"',
        "namespace Outer",
        "namespace Outer.Inner",
        "namespace global",
        "property Shape.#secret",
        "property Shape.count",
        "property Shape.handler",
        "property Shape.static count",
        "property global.Window.extra",
        "setter Shape.size",
        "type Id",
      ].sort(),
    );
    const color = graph.symbol("kinds.ts", "Color", "enum");
    assert.equal(color.range.start, text.indexOf("export enum Color"));
    // UTF-16 offsets: the non-BMP character counts as two code units.
    assert.equal(
      color.range.start,
      Buffer.byteLength(text.slice(0, color.range.start), "utf16le") / 2,
    );
    assert.notEqual(
      color.range.start,
      Buffer.byteLength(text.slice(0, color.range.start), "utf8"),
    );
  });
});

test("an unchanged index reopens with links resolved and no file re-parsed or program rebuilt", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@x": ["x.ts"] } },
      }),
      "x.ts": "export function x() {}\n",
      "y.ts": "export function x() {}\n",
      "main.ts": 'import { x } from "@x";\nx();\n',
    },
    async (graph) => {
      const xId = graph.symbol("x.ts", "x").id;
      assert.equal(graph.link("main.ts", "x", "calls").targetId, xId);
      graph.reopen();
      const bytes = await readFile(graph.database);
      const before = { ...statistics };
      const report = await graph.reindex();
      clean(report);
      assert.equal(report.indexed, 0);
      assert.equal(report.unchanged, 3);
      assert.equal(
        statistics.programs,
        before.programs,
        "no compiler program built",
      );
      assert.equal(
        statistics.extracted,
        before.extracted,
        "no file re-extracted",
      );
      assert.equal(statistics.reused, before.reused + 1);
      assert.equal(graph.link("main.ts", "x", "calls").targetId, xId);
      assert.deepEqual(
        await readFile(graph.database),
        bytes,
        "unchanged database bytes",
      );

      // Changing only tsconfig.json re-resolves the affected link.
      await graph.write(
        "tsconfig.json",
        JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@x": ["y.ts"] } },
        }),
      );
      const changed = await graph.reindex();
      clean(changed);
      assert.equal(changed.indexed, 0);
      assert.ok(statistics.programs > before.programs);
      assert.equal(graph.target(graph.link("main.ts", "x", "calls")), "y.ts#x");
      assert.equal(graph.symbol("x.ts", "x").id, xId, "symbol IDs survive");
    },
  );
});

test("a broken config fails only the files it governs and is never silently ignored", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: {},
      }),
      "a.ts": "export const a = 1;\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["a.ts"]);
      assert.match(
        graph.store.getFile("a.ts").result.diagnostics[0].message,
        /extends "\.\/tsconfig\.base\.json".*missing/,
      );
      // Adding the base repairs the analysis.
      await graph.write("tsconfig.base.json", "{}");
      await graph.write(
        "tsconfig.json",
        JSON.stringify({ extends: "./tsconfig.base.json" }),
      );
      const repaired = await graph.reindex();
      clean(repaired);
      assert.deepEqual(repaired.failed, []);
      // A malformed config.
      await graph.write("tsconfig.json", "{ broken");
      const malformed = await graph.reindex();
      assert.deepEqual(malformed.failed, ["a.ts"]);
      assert.match(
        graph.store.getFile("a.ts").result.diagnostics[0].message,
        /Unreadable TypeScript config tsconfig\.json/,
      );
      // A malformed base config fails the config that extends it.
      await graph.write(
        "tsconfig.json",
        JSON.stringify({ extends: "./tsconfig.base.json" }),
      );
      await graph.write("tsconfig.base.json", "{ nope");
      const badBase = await graph.reindex();
      assert.deepEqual(badBase.failed, ["a.ts"]);
      assert.match(
        graph.store.getFile("a.ts").result.diagnostics[0].message,
        /extends tsconfig\.base\.json, which is unreadable/,
      );
      // A config that is not valid UTF-8 fails capture (core-reported, module-wide).
      await graph.write("tsconfig.json", Buffer.from([0x7b, 0xff, 0x7d]));
      const unreadable = await graph.reindex();
      assert.equal(unreadable.analysisErrors.length, 1);
      assert.ok(unreadable.failed.includes("tsconfig.json"));
      // A missing project reference is only a note: references are not used for resolution.
      await graph.write(
        "tsconfig.json",
        JSON.stringify({ references: [{ path: "./pkg" }] }),
      );
      const reference = await graph.reindex();
      clean(reference);
      assert.deepEqual(reference.failed, []);
      assert.equal(graph.store.getFile("a.ts").result.status, "clean");
      assert.match(
        graph.store.getFile("a.ts").result.data.configNotes[0],
        /references "\.\/pkg", which is missing/,
      );
    },
  );
});

// Workspace with two packages; each case breaks only packages/a.
const twoPackages = (overrides) => ({
  "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
  "packages/a/package.json": JSON.stringify({
    name: "@w/a",
    main: "./src/index.ts",
  }),
  "packages/a/tsconfig.json": JSON.stringify({ include: ["src"] }),
  "packages/a/src/index.ts": "export function fromA() {}\n",
  "packages/b/package.json": JSON.stringify({
    name: "@w/b",
    main: "./src/index.ts",
  }),
  "packages/b/tsconfig.json": JSON.stringify({ include: ["src"] }),
  "packages/b/src/index.ts": "export function local() {}\n",
  "packages/b/src/use.ts":
    'import { local } from "./index";\nimport { fromA } from "@w/a";\nlocal();\nfromA();\n',
  ...overrides,
});
for (const [name, overrides, cause] of [
  [
    "a missing extends",
    {
      "packages/a/tsconfig.json": JSON.stringify({
        extends: "./tsconfig.missing.json",
        include: ["src"],
      }),
    },
    /extends "\.\/tsconfig\.missing\.json", which is missing/,
  ],
  [
    "an unparsable package manifest",
    { "packages/a/package.json": "{ not json" },
    /Unreadable package manifest packages\/a\/package\.json/,
  ],
  [
    "an invalid extends value",
    {
      "packages/a/tsconfig.json": JSON.stringify({
        extends: 7,
        include: ["src"],
      }),
    },
    /invalid extends value/,
  ],
])
  test(`${name} in one package fails only that package's files`, async () => {
    await project(twoPackages(overrides), async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.resolutionErrors, []);
      assert.deepEqual(report.failed, ["packages/a/src/index.ts"]);
      assert.match(
        graph.store.getFile("packages/a/src/index.ts").result.diagnostics[0]
          .message,
        cause,
      );
      assert.equal(
        graph.store.getFile("packages/b/src/use.ts").result.status,
        "clean",
      );
      assert.equal(
        graph.target(graph.link("packages/b/src/use.ts", "local", "calls")),
        "packages/b/src/index.ts#local",
      );
      // A link into the failed package keeps its name and stays unresolved.
      const into = graph.link("packages/b/src/use.ts", "fromA", "calls");
      assert.equal(into.resolution, "unresolved");
      assert.equal(into.targetName, "fromA");
    });
  });

test("a missing project reference fails nothing", async () => {
  await project(
    twoPackages({
      "packages/a/tsconfig.json": JSON.stringify({
        include: ["src"],
        references: [{ path: "../c" }],
      }),
    }),
    async (graph, report) => {
      clean(report);
      assert.deepEqual(report.failed, []);
      assert.equal(
        graph.target(graph.link("packages/b/src/use.ts", "fromA", "calls")),
        "packages/a/src/index.ts#fromA",
      );
    },
  );
});

test("a broken config fails its subtree but not files owned by a deeper valid config", async () => {
  await project(
    {
      "tsconfig.json": "{ broken",
      "top.ts": "export const top = 1;\n",
      "inner/tsconfig.json": "{}",
      "inner/ok.ts": "export const ok = 1;\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["top.ts"]);
      assert.equal(graph.store.getFile("inner/ok.ts").result.status, "clean");
    },
  );
});

test("a config extending an external package is reported as a limitation on its files", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "@tsconfig/node20/tsconfig.json",
        include: ["src"],
      }),
      "src/a.ts": "export const a = 1;\n",
      "other.ts": "export const b = 1;\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.partial, ["src/a.ts"]);
      assert.match(
        graph.store.getFile("src/a.ts").result.diagnostics[0].message,
        /external package; node_modules is never captured/,
      );
      // other.ts is not included by any config: inferred project, clean.
      assert.equal(graph.store.getFile("other.ts").result.data.project, null);
    },
  );
});

test("several tsconfig projects in one repository each resolve by their own settings", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./packages/a" }, { path: "./packages/b" }],
      }),
      "packages/a/tsconfig.json": JSON.stringify({
        compilerOptions: {
          composite: true,
          baseUrl: ".",
          paths: { "#dep": ["src/dep.ts"] },
        },
        include: ["src"],
      }),
      "packages/b/tsconfig.json": JSON.stringify({
        compilerOptions: {
          composite: true,
          baseUrl: ".",
          paths: { "#dep": ["lib/dep.ts"] },
        },
        include: ["src", "lib"],
      }),
      "packages/a/src/dep.ts": "export function dep() {}\n",
      "packages/a/src/main.ts": 'import { dep } from "#dep";\ndep();\n',
      "packages/b/lib/dep.ts": "export function dep() {}\n",
      "packages/b/src/main.ts": 'import { dep } from "#dep";\ndep();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("packages/a/src/main.ts", "dep", "calls")),
        "packages/a/src/dep.ts#dep",
      );
      assert.equal(
        graph.target(graph.link("packages/b/src/main.ts", "dep", "calls")),
        "packages/b/lib/dep.ts#dep",
      );
      assert.equal(
        graph.store.getFile("packages/a/src/main.ts").result.data.project,
        "packages/a/tsconfig.json",
      );
      assert.equal(
        graph.store.getFile("packages/b/src/main.ts").result.data.project,
        "packages/b/tsconfig.json",
      );
    },
  );
});

test("a syntax error makes the file partial while its recovered symbols stay linkable", async () => {
  await project(
    {
      "bad.ts": "export function good() {}\nexport function bad( {\n",
      "use.ts": 'import { good } from "./bad";\ngood();\n',
    },
    async (graph, report) => {
      assert.deepEqual(report.partial, ["bad.ts"]);
      const call = graph.link("use.ts", "good", "calls");
      assert.equal(graph.target(call), "bad.ts#good");
      assert.equal(call.targetStatus, "partial");
      assert.ok(
        graph.store.getFile("bad.ts").result.diagnostics.every((d) => d.range),
      );
    },
  );
});

test("unreadable sources are reported failed and never cleaned by analysis", async () => {
  await project(
    {
      "ok.ts": "export const ok = 1;\n",
      "bad.ts": Buffer.from([0x65, 0xff, 0x0a]),
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["bad.ts"]);
      assert.equal(graph.store.getFile("ok.ts").result.status, "clean");
    },
  );
});

test("a relative extends into node_modules is a limitation like a package specifier", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "./node_modules/@tsconfig/node20/tsconfig.json",
        include: ["src"],
      }),
      "src/a.ts": "export const a = 1;\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, []);
      assert.deepEqual(report.partial, ["src/a.ts"]);
      assert.match(
        graph.store.getFile("src/a.ts").result.diagnostics[0].message,
        /inside node_modules; node_modules is never captured/,
      );
    },
  );
});

test("a locally bound require, module or exports is not CommonJS", async () => {
  await project(
    {
      "dep.ts": "export const real = 1;\n",
      "fn.js": [
        "export {};",
        "function require(name) { return 42; }",
        'require("./dep");',
        'const x = require("./dep");',
        "",
      ].join("\n"),
      "param.js": [
        "export function load(require) {",
        '  const { real } = require("./dep");',
        "  return real;",
        "}",
        "",
      ].join("\n"),
      "imported.js": [
        'import { require } from "./loader";',
        'require("./dep");',
        "",
      ].join("\n"),
      "loader.js": "export function require(name) { return name; }\n",
      "shadow.js": [
        "const exports = {};",
        "exports.notExported = function () {};",
        "",
      ].join("\n"),
      "real.js": 'const { real } = require("./dep");\nexports.ok = real;\n',
    },
    async (graph, report) => {
      clean(report);
      for (const file of ["fn.js", "param.js", "imported.js"])
        assert.equal(
          graph.links(file, '"./dep"', "imports").length,
          0,
          `no import edge in ${file}`,
        );
      const calls = graph
        .links("fn.js", "require", "calls")
        .sort((a, b) => a.range.start - b.range.start);
      assert.equal(calls.length, 2);
      for (const call of calls)
        assert.equal(graph.target(call), "fn.js#require");
      // The variable is an ordinary constant, not an import binding.
      graph.symbol("fn.js", "x", "constant");
      assert.equal(graph.links("fn.js", "x", "imports").length, 0);
      assert.equal(
        graph.link("param.js", "require", "calls").data.reason,
        "local",
      );
      assert.equal(graph.links("param.js", "real", "imports").length, 0);
      assert.equal(
        graph.target(graph.link("imported.js", "require", "calls")),
        "loader.js#require",
      );
      // A file-level `exports` binding shadows the CommonJS object.
      assert.equal(
        graph.store.findSymbols({ file: "shadow.js", name: "notExported" })
          .length,
        0,
      );
      // Control: the unshadowed forms are still CommonJS.
      assert.equal(
        graph.target(graph.link("real.js", '"./dep"')),
        "dep.ts#dep.ts",
      );
      assert.equal(
        graph.target(graph.link("real.js", "real", "imports")),
        "dep.ts#real",
      );
      graph.symbol("real.js", "ok", "constant");
    },
  );
});

test("constructor parameter properties are class properties", async () => {
  await project(
    {
      "a.ts": [
        "class Base { constructor(public base: number) {} }",
        "export class A extends Base {",
        "  constructor(public cb: () => void, private readonly id: string, protected override base: number, plain: number) {",
        "    super(base);",
        "  }",
        "}",
        "export function f(a: A) { a.cb(); return a.base; }",
        "",
      ].join("\n"),
    },
    async (graph, report) => {
      clean(report);
      for (const identity of ["A.cb", "A.id", "A.base", "Base.base"])
        graph.symbol("a.ts", identity, "property");
      assert.equal(
        graph.store.findSymbols({ file: "a.ts", name: "plain" }).length,
        0,
      );
      assert.equal(
        graph.target(graph.link("a.ts", "cb", "calls")),
        "a.ts#A.cb",
      );
      const contains = graph
        .links("a.ts", "public cb: () => void", "contains")
        .map(
          (link) =>
            graph.store.findSymbols().find((s) => s.id === link.sourceId)
              .identity,
        );
      assert.deepEqual(contains, ["A"]);
    },
  );
});

test("an incomplete target set is never narrowed to one definite target", async () => {
  await project(
    {
      "foo.ts": [
        "export class Foo { toString() { return 'foo'; } }",
        "export function f(x: Foo | number) { return x.toString(); }",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const call = graph.link("foo.ts", "toString", "calls");
      assert.equal(call.resolution, "unresolved");
      assert.equal(call.data.reason, "external");
      assert.deepEqual(
        call.data.targets.map((target) => target.file),
        ["foo.ts"],
        "the project target is kept",
      );
    },
  );
  // A target whose file failed (its package config is broken) is lost: the
  // surviving project candidate is not promoted to a definite target.
  await project(twoPackagesUnion(), async (graph, report) => {
    assert.deepEqual(report.failed, ["packages/a/src/shape.ts"]);
    const call = graph.link("packages/b/src/use.ts", "go", "calls");
    assert.equal(call.resolution, "unresolved");
    assert.equal(call.data.targets.length, 2);
  });
});
function twoPackagesUnion() {
  return {
    "packages/a/tsconfig.json": JSON.stringify({
      extends: "./tsconfig.gone.json",
      include: ["src"],
    }),
    "packages/a/src/shape.ts": "export class A { go() {} }\n",
    "packages/b/tsconfig.json": JSON.stringify({ include: ["src"] }),
    "packages/b/src/b.ts": "export class B { go() {} }\n",
    "packages/b/src/use.ts": [
      'import { A } from "../../a/src/shape";',
      'import { B } from "./b";',
      "export function run(x: A | B) { x.go(); }",
      "",
    ].join("\n"),
  };
}

test("usage meaning selects declarations: calls, types and values", async () => {
  await project(
    {
      "merged.ts": [
        "export function fn() {}",
        "export namespace fn { export const extra = 1; }",
        "export const Thing = 1;",
        "export type Thing = string;",
        "export class Box {}",
        "export interface Box { size: number }",
        "",
      ].join("\n"),
      "eq.ts":
        "function eq() {}\nnamespace eq { export const x = 1; }\nexport = eq;\n",
      "use.ts": [
        'import { fn, Thing, Box } from "./merged";',
        'import type { Thing as T } from "./merged";',
        'import eq = require("./eq");',
        "fn();",
        "eq();",
        "new Box();",
        "export const v = Thing;",
        "export const t: T = '';",
        "",
      ].join("\n"),
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("use.ts", "fn", "calls")),
        "merged.ts#fn",
      );
      assert.equal(
        graph.store
          .findSymbols()
          .find((s) => s.id === graph.link("use.ts", "fn", "calls").targetId)
          .kind,
        "function",
      );
      assert.equal(
        graph.target(graph.link("use.ts", "eq", "calls")),
        "eq.ts#eq",
      );
      assert.equal(
        graph.store
          .findSymbols()
          .find((s) => s.id === graph.link("use.ts", "eq", "calls").targetId)
          .kind,
        "function",
      );
      const box = graph.link("use.ts", "Box", "calls");
      assert.equal(
        graph.store.findSymbols().find((s) => s.id === box.targetId).kind,
        "class",
      );
      // `import type` selects the type alias, not the constant.
      const typeImport = graph.link("use.ts", "Thing as T", "imports");
      assert.equal(
        graph.store.findSymbols().find((s) => s.id === typeImport.targetId)
          .kind,
        "type",
      );
      // A value import keeps both meanings as candidates.
      assert.equal(
        graph.link("use.ts", "Thing", "imports").resolution,
        "ambiguous",
      );
      // A value read is not a link; a type position picks the type.
      const typeRef = graph.link("use.ts", "T", "references");
      assert.equal(
        graph.store.findSymbols().find((s) => s.id === typeRef.targetId).kind,
        "type",
      );
    },
  );
});

test("unresolved reasons say why", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@app/*": ["src/*"] } },
      }),
      "src/use.ts": [
        'import { gone } from "./missing";',
        'import { nope } from "@app/absent";',
        'import { pkg } from "left-pad";',
        'import { sub } from "#internal";',
        "gone(); nope(); pkg(); sub();",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const reason = (at, kind) =>
        graph.link("src/use.ts", at, kind).data.reason;
      assert.equal(reason('"./missing"'), "missing-module");
      assert.equal(reason("gone", "imports"), "missing-module");
      assert.equal(reason('"@app/absent"'), "unresolved-alias");
      assert.equal(reason("nope", "imports"), "unresolved-alias");
      assert.equal(reason('"left-pad"'), "external-package");
      assert.equal(reason("pkg", "imports"), "external-package");
      assert.equal(reason('"#internal"'), "unresolved-alias");
      for (const name of ["gone", "nope", "pkg", "sub"]) {
        const call = graph.link("src/use.ts", name, "calls");
        assert.equal(call.resolution, "unresolved");
        assert.equal(call.targetName, name);
      }
    },
  );
});

test("triple-slash references are import links", async () => {
  await project(
    {
      "globals.d.ts": "declare const shared: number;\n",
      "main.ts": [
        '/// <reference path="./globals.d.ts" />',
        '/// <reference path="./absent.d.ts" />',
        '/// <reference types="node" />',
        '/// <reference lib="es2020" />',
        "export const x = shared;",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const path = graph.link("main.ts", "./globals.d.ts", "imports");
      assert.equal(graph.target(path), "globals.d.ts#globals.d.ts");
      assert.equal(path.data.reference, "path");
      assert.equal(
        graph.link("main.ts", "./absent.d.ts").data.reason,
        "missing-module",
      );
      const types = graph.link("main.ts", "node");
      assert.equal(types.resolution, "unresolved");
      assert.equal(types.data.reason, "external-package");
      assert.equal(graph.link("main.ts", "es2020").data.reason, "external");
    },
  );
});

test("a broken workspace root fails only root-package files; members stay analysed without guessed links", async () => {
  await project(
    twoPackages({
      "package.json": "{ broken",
      "root.ts": "export const r = 1;\n",
    }),
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["root.ts"]);
      assert.equal(
        graph.target(graph.link("packages/b/src/use.ts", "local", "calls")),
        "packages/b/src/index.ts#local",
      );
      // The workspace list is unknown, so @w/a is not linked rather than guessed.
      const cross = graph.link("packages/b/src/use.ts", '"@w/a"');
      assert.equal(cross.resolution, "unresolved");
      assert.equal(cross.data.reason, "external-package");
    },
  );
});

test("nothing reached through a shadowed-require value links into the required module", async () => {
  const dep = "export function real() {}\nexport class K { run() {} }\n";
  await project(
    {
      "dep.ts": dep,
      "top.js": [
        "export {};",
        "function require(n) { return { real() { return 0; } }; }",
        'const m = require("./dep");',
        "m.real();",
        "new m.K();",
        "const read = m.real;",
        "const n = m;",
        "n.real();",
        "let later;",
        "later = n;",
        "later.real();",
        "const { real } = m;",
        "real();",
        'const { real: direct } = require("./dep");',
        "direct();",
        "function use(x) { x.real(); }",
        "use(m);",
        "const holder = { m };",
        "holder.m.real();",
        "function give() { return m; }",
        "give().real();",
        "",
      ].join("\n"),
      "param.js": [
        "export function load(require) {",
        '  const m = require("./dep");',
        "  m.real();",
        "  new m.K();",
        "}",
        "",
      ].join("\n"),
      "fake.js": [
        "export {};",
        "function fake() {}",
        "function require(n) { return { real: fake }; }",
        'const m = require("./dep");',
        "m.real();",
        "",
      ].join("\n"),
      // Control: the real CommonJS require still links.
      "real.js": 'const m = require("./dep");\nm.real();\nnew m.K();\n',
    },
    async (graph, report) => {
      clean(report);
      const intoDep = (link) =>
        [link.targetId, ...link.candidates.map((c) => c.id)].some(
          (id) =>
            graph.store.findSymbols().find((s) => s.id === id)?.file ===
            "dep.ts",
        ) || (link.data?.targets ?? []).some((t) => t.file === "dep.ts");
      for (const file of ["top.js", "param.js", "fake.js"])
        assert.deepEqual(
          graph.store
            .links()
            .filter((link) => link.file === file && intoDep(link)),
          [],
          `no link into dep.ts from ${file}`,
        );
      const members = graph.store
        .links()
        .filter(
          (link) =>
            ["top.js", "param.js", "fake.js"].includes(link.file) &&
            link.kind === "calls" &&
            /^(m|n|later)\./.test(link.targetName),
        );
      assert.equal(members.length, 7);
      // Carried through an object property or a return value.
      for (const name of ["holder.m.real", "(expression).real"]) {
        const carried = graph
          .links("top.js", "real", "calls")
          .filter((link) => link.targetName === name);
        assert.equal(carried.length, 1, name);
        assert.equal(carried[0].resolution, "unresolved");
        assert.equal(carried[0].data.reason, "shadowed-require");
      }
      for (const link of members) {
        assert.equal(link.resolution, "unresolved");
        assert.equal(link.data.reason, "shadowed-require", link.targetName);
      }
      // Destructured names are local constants, not the module's exports.
      const plain = (name) =>
        graph
          .links("top.js", name, "calls")
          .filter((link) => link.targetName === name);
      assert.equal(plain("real").length, 1);
      assert.equal(graph.target(plain("real")[0]), "top.js#real");
      assert.equal(graph.target(plain("direct")[0]), "top.js#direct");
      // Passing it on: the parameter is untyped, so nothing resolves through it.
      const passed = graph
        .links("top.js", "real", "calls")
        .filter((link) => link.targetName === "x.real");
      assert.equal(passed.length, 1);
      assert.equal(passed[0].resolution, "unresolved");
      assert.equal(
        graph.target(
          graph
            .links("real.js", "real", "calls")
            .find((l) => l.targetName === "m.real"),
        ),
        "dep.ts#real",
      );
      assert.equal(
        graph.target(graph.link("real.js", "K", "calls")),
        "dep.ts#K",
      );
    },
  );
});

test("the nearest containing config owns a file: root depth is zero", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@api": ["root.ts"] } },
      }),
      "root.ts": "export function api() {}\n",
      "z/tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@api": ["local.ts"] } },
      }),
      "z/local.ts": "export function api() {}\n",
      "z/use.ts": 'import { api } from "@api";\napi();\n',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.store.getFile("z/use.ts").result.data.project,
        "z/tsconfig.json",
      );
      assert.equal(
        graph.target(graph.link("z/use.ts", "api", "calls")),
        "z/local.ts#api",
      );
    },
  );
});

const sharedLayout = (app) => ({
  [`packages/${app}/tsconfig.json`]: JSON.stringify({
    include: ["src", "../shared/src"],
    compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } },
  }),
  [`packages/${app}/lib/util.ts`]: "export function helper() {}\n",
  [`packages/${app}/src/a.ts`]: "export const a = 1;\n",
  "packages/shared/tsconfig.json": JSON.stringify({
    include: ["src", "lib"],
    compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } },
  }),
  "packages/shared/lib/util.ts": "export function helper() {}\n",
  "packages/shared/src/s.ts":
    "import { helper } from '@lib/util';\nhelper();\n",
});
for (const app of ["app", "zapp"])
  test(`a config whose directory contains the file outranks one that includes it from elsewhere (${app})`, async () => {
    await project(sharedLayout(app), async (graph, report) => {
      clean(report);
      assert.equal(
        graph.store.getFile("packages/shared/src/s.ts").result.data.project,
        "packages/shared/tsconfig.json",
      );
      assert.equal(
        graph.target(graph.link("packages/shared/src/s.ts", "helper", "calls")),
        "packages/shared/lib/util.ts#helper",
      );
    });
  });

test("equally ranked configs with different settings give candidates or unresolved, never a pick", async () => {
  await project(
    {
      "pkg/tsconfig.a.json": JSON.stringify({
        include: ["src"],
        compilerOptions: {
          baseUrl: ".",
          paths: { "@x": ["one.ts"], "@y": ["one.ts"] },
        },
      }),
      "pkg/tsconfig.b.json": JSON.stringify({
        include: ["src"],
        compilerOptions: { baseUrl: ".", paths: { "@x": ["two.ts"] } },
      }),
      "pkg/one.ts": "export function x() {}\nexport function y() {}\n",
      "pkg/two.ts": "export function x() {}\n",
      "pkg/src/use.ts": [
        'import { x } from "@x";',
        'import { y } from "@y";',
        'import { same } from "./same";',
        "x(); y(); same();",
        "",
      ].join("\n"),
      "pkg/src/same.ts": "export function same() {}\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      const file = graph.store.getFile("pkg/src/use.ts").result;
      assert.deepEqual(file.data.projects, [
        "pkg/tsconfig.a.json",
        "pkg/tsconfig.b.json",
      ]);
      // Differs between the configs and both are complete: candidates.
      const x = graph.link("pkg/src/use.ts", "x", "calls");
      assert.deepEqual(graph.candidates(x), ["pkg/one.ts#x", "pkg/two.ts#x"]);
      // Resolves under one config only: unresolved, targets kept.
      const y = graph.link("pkg/src/use.ts", "y", "calls");
      assert.equal(y.resolution, "unresolved");
      assert.equal(y.data.reason, "ambiguous-project");
      assert.deepEqual(
        y.data.targets.map((t) => t.file),
        ["pkg/one.ts"],
      );
      // The same under both: definite.
      assert.equal(
        graph.target(graph.link("pkg/src/use.ts", "same", "calls")),
        "pkg/src/same.ts#same",
      );
    },
  );
});

test("the nearest package manifest governs a file", async () => {
  await project(
    {
      "package.json": "{ broken",
      "root.ts": "export const r = 1;\n",
      "z/package.json": JSON.stringify({ name: "z" }),
      "z/a.ts": "export const a = 1;\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.failed, ["root.ts"]);
      assert.equal(graph.store.getFile("z/a.ts").result.status, "clean");
    },
  );
});

for (const [label, text] of [
  ["an array", "[1, 2]"],
  ["an empty array", "[]"],
  ["null", "null"],
  ["a number", "7"],
  ["a string", '"x"'],
])
  test(`a config extending a base whose root is ${label} fails its files`, async () => {
    await project(
      {
        "tsconfig.json": JSON.stringify({ extends: "./tsconfig.mid.json" }),
        "tsconfig.mid.json": JSON.stringify({
          extends: "./tsconfig.base.json",
        }),
        "tsconfig.base.json": text,
        "a.ts": "export const a = 1;\n",
      },
      async (graph, report) => {
        assert.deepEqual(report.failed, ["a.ts"]);
        assert.match(
          graph.store.getFile("a.ts").result.diagnostics[0].message,
          /extends tsconfig\.base\.json, which is unreadable: not an object/,
        );
      },
    );
  });

test("a candidate set never omits a possible target outside the project", async () => {
  await project(
    {
      "u.ts": [
        "export class Foo { toString() { return 'f'; } }",
        "export class Bar { toString() { return 'b'; } }",
        "export function f(x: Foo | Bar | Date) { return x.toString(); }",
        "export function g(x: Foo | Bar) { return x.toString(); }",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const [withDate, inside] = graph
        .links("u.ts", "toString", "calls")
        .sort((a, b) => a.range.start - b.range.start);
      assert.equal(withDate.resolution, "unresolved");
      assert.equal(withDate.data.reason, "external");
      assert.equal(withDate.data.targets.length, 2);
      assert.deepEqual(graph.candidates(inside), [
        "u.ts#Bar.toString",
        "u.ts#Foo.toString",
      ]);
    },
  );
});

for (const base of ["./base.json", "./config/ts.json"])
  test(`a relative extends outside the context patterns (${base}) is a partial limitation`, async () => {
    await project(
      {
        "tsconfig.json": JSON.stringify({ extends: base, include: ["src"] }),
        [base.slice(2)]: JSON.stringify({ compilerOptions: { strict: true } }),
        "src/a.ts": "export const a = 1;\n",
      },
      async (graph, report) => {
        assert.deepEqual(report.analysisErrors, []);
        assert.deepEqual(report.failed, []);
        assert.deepEqual(report.partial, ["src/a.ts"]);
        assert.match(
          graph.store.getFile("src/a.ts").result.diagnostics[0].message,
          /not captured as project context .*its settings are missing/,
        );
      },
    );
  });
