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

// Round 4: an uncaptured base config never yields a confident link.
const incomplete = (graph, file, at, kind) => {
  const found = graph.link(file, at, kind);
  assert.equal(found.resolution, "unresolved", `${at} ${kind}`);
  assert.equal(found.data.reason, "incomplete-config", `${at} ${kind}`);
  return found;
};
test("settings from an uncaptured base config: paths alias", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "./base.json",
        compilerOptions: { baseUrl: "." },
      }),
      "base.json": JSON.stringify({
        compilerOptions: { paths: { service: ["right.ts"] } },
      }),
      "service.ts": "export function run() {}\n",
      "right.ts": "export function run() {}\n",
      "use.ts":
        'import { run } from "service";\nrun();\nfunction own() {}\nown();\n',
    },
    async (graph, report) => {
      assert.ok(report.partial.includes("use.ts"));
      const call = incomplete(graph, "use.ts", "run", "calls");
      assert.deepEqual(
        call.data.targets.map((t) => t.file),
        ["service.ts"],
      );
      incomplete(graph, "use.ts", "run", "imports");
      incomplete(graph, "use.ts", '"service"', "imports");
      // A same-file call reached without any import stays definite.
      assert.equal(
        graph.target(graph.link("use.ts", "own", "calls")),
        "use.ts#own",
      );
    },
  );
});

test("settings from an uncaptured base config: workspace packages shadowed by paths", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }),
      "base.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@core/*": ["./app/src/core/*"] },
        },
      }),
      "app/tsconfig.json": JSON.stringify({
        extends: "../base.json",
        include: ["src"],
      }),
      "app/src/config.ts": "export function load() {}\n",
      "app/src/core/util.ts": "export function util() {}\n",
      "app/src/use.ts":
        'import { load } from "config";\nload();\nimport { util } from "@core/util";\nutil();\n',
      "packages/config/package.json": JSON.stringify({
        name: "config",
        main: "./index.ts",
      }),
      "packages/config/index.ts": "export function load() {}\n",
      "packages/util/package.json": JSON.stringify({
        name: "@core/util",
        main: "./index.ts",
      }),
      "packages/util/index.ts": "export function util() {}\n",
    },
    async (graph) => {
      for (const at of ["load", "util"]) {
        incomplete(graph, "app/src/use.ts", at, "calls");
        incomplete(graph, "app/src/use.ts", at, "imports");
      }
      incomplete(graph, "app/src/use.ts", '"config"', "imports");
      incomplete(graph, "app/src/use.ts", '"@core/util"', "imports");
    },
  );
});

test("settings from an uncaptured base config: a package base", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "@company/tsconfig/base.json",
        compilerOptions: { baseUrl: "." },
      }),
      "service.ts": "export function run() {}\n",
      "use.ts": 'import { run } from "service";\nrun();\n',
    },
    async (graph) => {
      incomplete(graph, "use.ts", "run", "calls");
      incomplete(graph, "use.ts", '"service"', "imports");
    },
  );
});

test("settings from an uncaptured base config: moduleResolution", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/pkg/package.json": JSON.stringify({
        name: "pkg",
        main: "./legacy.ts",
        exports: { ".": "./modern.ts" },
      }),
      "packages/pkg/legacy.ts": "export function go() {}\n",
      "packages/pkg/modern.ts": "export function go() {}\n",
      "app/tsconfig.json": JSON.stringify({
        extends: "./base.json",
        include: ["*.ts"],
      }),
      "app/base.json": JSON.stringify({
        compilerOptions: { moduleResolution: "bundler", module: "esnext" },
      }),
      "app/use.ts": 'import { go } from "pkg";\ngo();\n',
    },
    async (graph) => {
      const call = incomplete(graph, "app/use.ts", "go", "calls");
      assert.equal(call.data.targets.length, 1);
      incomplete(graph, "app/use.ts", '"pkg"', "imports");
    },
  );
});

test("a broken config with a readable selection fails only what it selects (Vite layout)", async () => {
  const layout = {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [
        { path: "./tsconfig.app.json" },
        { path: "./tsconfig.node.json" },
      ],
    }),
    "tsconfig.app.json": JSON.stringify({ include: ["src"] }),
    "tsconfig.node.json": JSON.stringify({
      extends: "./tsconfig.missing.json",
      include: ["vite.config.ts"],
    }),
    "vite.config.ts": "export default {};\n",
    "src/App.tsx": "export function App() { return <div />; }\n",
    "src/main.tsx": 'import { App } from "./App";\nApp();\n',
    "src/helper.ts": "export const helper = 1;\n",
  };
  await project(layout, async (graph, report) => {
    assert.deepEqual(report.failed, ["vite.config.ts"]);
    assert.equal(
      graph.target(graph.link("src/main.tsx", "App", "calls")),
      "src/App.tsx#App",
    );
  });
  // An unreadable selection falls back to the subtree, but not onto files a
  // healthy config in the same directory explicitly selects.
  await project(
    { ...layout, "tsconfig.node.json": "{ broken" },
    async (graph, report) => {
      assert.deepEqual(report.failed, ["vite.config.ts"]);
      assert.equal(graph.store.getFile("src/helper.ts").result.status, "clean");
    },
  );
});

test("calls, new, types and heritage through a binding from a missing module say missing-module", async () => {
  await project(
    {
      "use.ts": [
        'import { Foo } from "./missing";',
        'import * as ns from "./missing";',
        "new Foo();",
        "Foo.make();",
        "ns.go();",
        "export let x: Foo;",
        "export class C extends Foo {}",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const reasons = graph.store
        .links()
        .filter((l) => l.file === "use.ts" && l.kind !== "contains")
        .map((l) => `${l.kind} ${l.targetName} ${l.data.reason}`)
        .sort();
      assert.deepEqual(reasons, [
        "calls Foo missing-module",
        "calls Foo.make missing-module",
        "calls ns.go missing-module",
        "extends Foo missing-module",
        "imports * missing-module",
        "imports ./missing missing-module",
        "imports ./missing missing-module",
        "imports Foo missing-module",
        "references Foo missing-module",
      ]);
    },
  );
});

test("a tied file records its tied configs and no single project", async () => {
  await project(
    {
      "tsconfig.a.json": JSON.stringify({ include: ["src"] }),
      "tsconfig.b.json": JSON.stringify({ include: ["src"] }),
      "src/a.ts": "export const a = 1;\n",
    },
    async (graph) => {
      const data = graph.store.getFile("src/a.ts").result.data;
      assert.deepEqual(data.projects, ["tsconfig.a.json", "tsconfig.b.json"]);
      assert.equal("project" in data, false);
    },
  );
});

// Locally bound require: the compiler sees a same-length rename (rename.ts),
// so every route a value can take is typed correctly with no tracking.
const shadowDep = "export function real() {}\nexport class K { run() {} }\n";
const shadowHeader = [
  "export {};",
  "function require(n) { return { real() { return 17; } }; }",
  'const m = require("./dep");',
];
const routes = {
  getter: ["const z = { get value() { return m; } };", "z.value.real();"],
  arrayIndex: ["const z = [];", "z[0] = m;", "z[0].real();"],
  destructuringAssignment: ["let z;", "({ x: z } = { x: m });", "z.real();"],
  arrowReturn: ["const get = () => m;", "get().real();"],
  functionExpressionReturn: [
    "const get2 = function () { return m; };",
    "get2().real();",
  ],
  cycle: [
    "let x; let y;",
    "function h() { x = y; }",
    "x = m;",
    "x.real();",
    "y = x;",
    "y.real();",
  ],
  logicalOr: ["let z;", "z ||= m;", "z.real();"],
  nullish: ["let q = null;", "q ??= m;", "q.real();"],
  arrayLiteral: ["const arr = [m];", "arr[0].real();"],
  arrayPattern: ["const [first] = [m];", "first.real();"],
  spread: ["const s = { ...m };", "s.real();"],
  defaultParameter: ["function use(p = m) { p.real(); }"],
  classFields: [
    "class C { f = m; static s = m; }",
    "new C().f.real();",
    "C.s.real();",
  ],
  // Earlier rounds' routes.
  direct: ["m.real();", "new m.K();", "const read = m.real;"],
  reassigned: [
    "const n = m;",
    "n.real();",
    "let later;",
    "later = n;",
    "later.real();",
  ],
  objectProperty: ["const holder = { m };", "holder.m.real();"],
  functionReturn: ["function give() { return m; }", "give().real();"],
  passedOn: ["function pass(x) { x.real(); }", "pass(m);"],
  destructured: ["const { real } = m;", "real();"],
  longChain: [
    "let v0 = m;",
    ...Array.from({ length: 1000 }, (_, i) => `let v${i + 1} = v${i};`),
    "v1000.real();",
  ],
};
test("a locally bound require never links into the module it names, by any route", async () => {
  const files = { "dep.ts": shadowDep };
  for (const [name, lines] of Object.entries(routes))
    files[`${name}.js`] = [...shadowHeader, ...lines, ""].join("\n");
  files["param.js"] = [
    "export function load(require) {",
    '  const m = require("./dep");',
    "  m.real();",
    "  new m.K();",
    "}",
    "",
  ].join("\n");
  files["fake.js"] = [
    "export {};",
    "function fake() {}",
    "function require(n) { return { real: fake }; }",
    'const m = require("./dep");',
    "m.real();",
    "",
  ].join("\n");
  // Across files: an exported getter, named/default re-exports, a default
  // export of a member, module.exports and exports.x.
  files["ex.js"] = [...shadowHeader, "export const get = () => m;", ""].join(
    "\n",
  );
  files["useEx.ts"] = 'import { get } from "./ex.js";\nget().real();\n';
  files["e.js"] = [
    "export function require(n) { return {}; }",
    'const m = require("./dep");',
    "export { m };",
    "export default m;",
    "",
  ].join("\n");
  files["f.ts"] = [
    'import { m } from "./e.js";',
    'import d from "./e.js";',
    "m.real();",
    "new m.K();",
    "d.real();",
    "",
  ].join("\n");
  files["a.js"] = [
    ...shadowHeader,
    "export default m.real;",
    'import * as legit from "./dep";',
    "legit.real();",
    "",
  ].join("\n");
  files["b.js"] = 'import run from "./a";\nrun();\n';
  files["x.js"] = [
    "function require(n) { return { real() { return 0; } }; }",
    'const m = require("./dep");',
    "module.exports = m;",
    "exports.mm = m;",
    "",
  ].join("\n");
  files["y.js"] = [
    'const x = require("./x");',
    "x.real();",
    "new x.K();",
    'const { mm } = require("./x");',
    "mm.real();",
    "",
  ].join("\n");
  // Controls: the real CommonJS require and createRequire still link.
  files["real.js"] = 'const m = require("./dep");\nm.real();\nnew m.K();\n';
  files["created.mjs"] = [
    'import { createRequire } from "node:module";',
    "const require = createRequire(import.meta.url);",
    'const m = require("./dep");',
    "m.real();",
    "",
  ].join("\n");
  await project(files, async (graph, report) => {
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.analysisErrors, []);
    assert.deepEqual(report.failed, []);
    const intoDep = (link) =>
      [link.targetId, ...link.candidates.map((c) => c.id)].some(
        (id) =>
          graph.store.findSymbols().find((s) => s.id === id)?.file === "dep.ts",
      );
    const shadowedFiles = Object.keys(files).filter(
      (file) =>
        !["dep.ts", "real.js", "created.mjs"].includes(file) && file !== "a.js",
    );
    const wrong = graph.store
      .links()
      .filter((link) => shadowedFiles.includes(link.file) && intoDep(link));
    assert.deepEqual(
      wrong.map((l) => `${l.file} ${l.kind} ${l.targetName}`),
      [],
    );
    // In a.js only the genuine ES namespace import links into dep.ts.
    assert.deepEqual(
      graph.store
        .links()
        .filter((l) => l.file === "a.js" && intoDep(l))
        .map((l) => `${l.kind} ${l.targetName}`)
        .sort(),
      ["calls legit.real", "imports *", "imports ./dep"],
    );
    // Every route's member call was actually extracted (not silently dropped).
    for (const name of Object.keys(routes).filter((r) => r !== "passedOn"))
      assert.ok(
        graph.store
          .links()
          .some(
            (l) =>
              l.file === `${name}.js` &&
              l.kind === "calls" &&
              /real$/.test(l.targetName),
          ),
        name,
      );
    // Names are reported as written, not as the compiler's renamed text.
    assert.equal(
      graph.symbol("direct.js", "require", "function").name,
      "require",
    );
    const call = graph.links("direct.js", "require", "calls")[0];
    assert.equal(call.targetName, "require");
    assert.equal(graph.target(call), "direct.js#require");
    // A named re-export of the local value links to that local constant.
    assert.equal(graph.target(graph.link("f.ts", "m", "imports")), "e.js#m");
    // Controls.
    assert.equal(
      graph.target(
        graph
          .links("real.js", "real", "calls")
          .find((l) => l.targetName === "m.real"),
      ),
      "dep.ts#real",
    );
    assert.equal(graph.target(graph.link("real.js", "K", "calls")), "dep.ts#K");
    assert.equal(
      graph.target(graph.link("created.mjs", '"./dep"', "imports")),
      "dep.ts#dep.ts",
    );
    assert.equal(
      graph.target(
        graph
          .links("created.mjs", "real", "calls")
          .find((l) => l.targetName === "m.real"),
      ),
      "dep.ts#real",
    );
  });
});

test("a require shadowed only inside one function is renamed only there", async () => {
  await project(
    {
      "dep.ts": shadowDep,
      "mixed.js": [
        'const outer = require("./dep");',
        "outer.real();",
        "function inner(require) {",
        '  const m = require("./dep");',
        "  m.real();",
        "}",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const calls = graph.store
        .links()
        .filter(
          (l) =>
            l.file === "mixed.js" &&
            l.kind === "calls" &&
            /real$/.test(l.targetName),
        );
      const byName = Object.fromEntries(calls.map((l) => [l.targetName, l]));
      assert.equal(graph.target(byName["outer.real"]), "dep.ts#real");
      assert.equal(byName["m.real"].resolution, "unresolved");
      assert.equal(graph.links("mixed.js", '"./dep"', "imports").length, 1);
    },
  );
});

test("a locally declared module or exports is not read as CommonJS exports", async () => {
  await project(
    {
      "a.js":
        "const module = { exports: {} };\nmodule.exports = { fake() {} };\n",
      "b.js": "const exports = {};\nexports.fake2 = function () {};\n",
      "c.js":
        'const x = require("./a");\nx.fake();\nconst y = require("./b");\ny.fake2();\n',
    },
    async (graph) => {
      assert.equal(
        graph.store.findSymbols({ file: "b.js", name: "fake2" }).length,
        0,
      );
      assert.equal(
        graph.store.findSymbols({ file: "a.js", name: "module.exports" })
          .length,
        0,
      );
      graph.symbol("a.js", "module", "constant");
      for (const name of ["x.fake", "y.fake2"])
        assert.equal(
          graph.store
            .links()
            .find((l) => l.file === "c.js" && l.targetName === name).resolution,
          "unresolved",
          name,
        );
    },
  );
});

test("a type through a namespace import of a missing module says missing-module", async () => {
  await project(
    { "use.ts": 'import * as ns from "./missing";\nexport let b: ns.T;\n' },
    async (graph) => {
      assert.equal(
        graph.link("use.ts", "ns.T", "references").data.reason,
        "missing-module",
      );
    },
  );
});

for (const [label, text] of [
  ["an array", "[1, 2]"],
  ["null", "null"],
  ["unparsable", "{ broken"],
])
  test(`a sibling config whose root is ${label} never fails a healthy config's files`, async () => {
    await project(
      {
        "tsconfig.json": JSON.stringify({
          files: [],
          references: [
            { path: "./tsconfig.web.json" },
            { path: "./tsconfig.tools.json" },
          ],
        }),
        "tsconfig.web.json": JSON.stringify({ include: ["web/**/*.ts"] }),
        "tsconfig.tools.json": text,
        "web/a.ts": "export function a() {}\n",
        "web/b.ts": 'import { a } from "./a";\na();\n',
        "tools/build.ts": "export const build = 1;\n",
      },
      async (graph, report) => {
        // Only files no healthy config selects fall back to the broken config.
        assert.deepEqual(report.failed, ["tools/build.ts"]);
        assert.equal(
          graph.store.getFile("web/a.ts").result.data.project,
          "tsconfig.web.json",
        );
        assert.equal(
          graph.target(graph.link("web/b.ts", "a", "calls")),
          "web/a.ts#a",
        );
      },
    );
  });

// Round 6: exact scope, dynamic scope, createRequire origin, spelling,
// cross-file names, containment and labels.
const freshFor = async (files) => {
  const { freshNames } = await import(
    "../dist/graph/languages/typescript/rename.js"
  );
  return freshNames(Object.values(files).map(String));
};
/** No compiler-only name may appear in any stored fact, identity or diagnostic. */
async function assertNoFreshNames(graph, files) {
  const fresh = await freshFor(files);
  const names = [
    ...Object.values(fresh.local),
    ...Object.values(fresh.uncertain),
  ];
  const stored =
    JSON.stringify(graph.store.files().map((file) => file.result)) +
    JSON.stringify(graph.store.findSymbols()) +
    JSON.stringify(graph.store.links());
  for (const name of names)
    assert.ok(!stored.includes(name), `fresh name ${name} leaked`);
}
const dep6 = "export function real() {}\nexport class K { run() {} }\n";
const linksInto = (graph, file, target = "dep.ts") =>
  graph.store
    .links()
    .filter(
      (l) =>
        l.file === file &&
        [l.targetId, ...l.candidates.map((c) => c.id)].some(
          (id) =>
            graph.store.findSymbols().find((s) => s.id === id)?.file === target,
        ),
    )
    .map((l) => `${l.kind} ${l.targetName}`)
    .sort();

test("exact scope: Annex B, catch clauses, static blocks and the CommonJS wrapper", async () => {
  const files = {
    "dep.ts": dep6,
    // Sloppy function code: the block function is hoisted into g (Annex B).
    "annexb.js": [
      "function g(c) {",
      "  if (c) { function require(n) { return { real() {} }; } }",
      '  const m = require("./dep");',
      "  return m.real();",
      "}",
      "",
    ].join("\n"),
    // CommonJS top level: Annex B never hoists a wrapper parameter name, so
    // after the block `require` is Node's loader (checked against Node).
    "cjstop.js": [
      "if (true) { function require(n) { return {}; } }",
      'const m = require("./dep");',
      "m.real();",
      "",
    ].join("\n"),
    // A catch binding is scoped to its block only.
    "catch.js": [
      "export {};",
      "try {} catch (require) {}",
      'const d = require("./dep");',
      "d.real();",
      "",
    ].join("\n"),
    "other.js": "function require(n) { return 1; }\n",
    // A class static block is its own var scope.
    "static.js": [
      "class S { static { var require = 1; } }",
      'const m = require("./dep");',
      "m.real();",
      "",
    ].join("\n"),
  };
  await project(files, async (graph, report) => {
    clean(report);
    assert.deepEqual(linksInto(graph, "annexb.js"), []);
    for (const file of ["cjstop.js", "catch.js", "static.js"]) {
      const out = linksInto(graph, file);
      assert.ok(out.includes("imports ./dep"), `${file}: ${out}`);
      assert.ok(
        out.some((l) => /real$/.test(l)),
        `${file}: ${out}`,
      );
    }
    assert.deepEqual(linksInto(graph, "catch.js", "other.js"), []);
    await assertNoFreshNames(graph, files);
  });
});

test("direct eval and with make require uncertain; indirect eval does not", async () => {
  const files = {
    "dep.ts": dep6,
    "direct.js": [
      "function run() {",
      '  eval("var require = () => ({})");',
      '  const m = require("./dep");',
      "  m.real();",
      "}",
      "",
    ].join("\n"),
    "within.js": [
      "with ({ require: () => ({}) }) {",
      '  const w = require("./dep");',
      "  w.real();",
      "}",
      "",
    ].join("\n"),
    "indirect.js": [
      '(0, eval)("var require = () => ({})");',
      'globalThis.eval("var require = 1");',
      'new Function("var require = 1")();',
      'const m = require("./dep");',
      "m.real();",
      "",
    ].join("\n"),
  };
  await project(files, async (graph, report) => {
    assert.deepEqual(report.failed, []);
    for (const file of ["direct.js", "within.js"]) {
      assert.deepEqual(linksInto(graph, file), [], file);
      const result = graph.store.getFile(file).result;
      assert.equal(result.status, "partial", file);
      assert.match(
        result.diagnostics.map((d) => d.message).join("\n"),
        /cannot be decided statically/,
      );
      const imported = graph.link(file, '"./dep"', "imports");
      assert.equal(imported.resolution, "unresolved");
      assert.equal(imported.data.reason, "dynamic-scope");
      assert.deepEqual(imported.data.targets, [
        { file: "dep.ts", key: "module@0" },
      ]);
      const member = graph.store
        .links()
        .find(
          (l) =>
            l.file === file && l.kind === "calls" && /real$/.test(l.targetName),
        );
      assert.equal(member.data.reason, "dynamic-scope", file);
      assert.equal(
        graph.link(file, "require", "calls").data.reason,
        "dynamic-scope",
      );
    }
    assert.equal(graph.store.getFile("indirect.js").result.status, "clean");
    assert.ok(linksInto(graph, "indirect.js").includes("imports ./dep"));
    await assertNoFreshNames(graph, files);
  });
});

test("createRequire is recognised by origin, not spelling", async () => {
  const files = {
    "dep.ts": dep6,
    "spoof.js": [
      "export {};",
      "function createRequire() { return (n) => ({ real() {} }); }",
      "const require = createRequire();",
      'const m = require("./dep");',
      "m.real();",
      "",
    ].join("\n"),
    "renamed.mjs": [
      'import { createRequire as cr } from "node:module";',
      "const createRequire = () => () => ({});",
      "const require = createRequire();",
      'require("./dep").real();',
      "",
    ].join("\n"),
    "namespace.mjs": [
      'import * as nodeModule from "node:module";',
      "const require = nodeModule.createRequire(import.meta.url);",
      'const m = require("./dep");',
      "m.real();",
      "",
    ].join("\n"),
    "commonjs.js": [
      'const { createRequire } = require("module");',
      "function load() {",
      "  const require = createRequire(__filename);",
      '  const m = require("./dep");',
      "  return m.real();",
      "}",
      "",
    ].join("\n"),
  };
  await project(files, async (graph) => {
    assert.deepEqual(linksInto(graph, "spoof.js"), []);
    assert.deepEqual(linksInto(graph, "renamed.mjs"), []);
    for (const file of ["namespace.mjs", "commonjs.js"]) {
      const out = linksInto(graph, file);
      assert.ok(
        out.includes("imports ./dep") && out.includes("calls m.real"),
        `${file}: ${out}`,
      );
    }
    await assertNoFreshNames(graph, files);
  });
});

test("identifier spelling: decoded names, escapes fail the file, existing look-alikes do not collide", async () => {
  const files = {
    "plain.js":
      'export {};\nfunction require(n) { return {}; }\nrequire("x");\n',
    "escaped.js":
      'export {};\nfunction require(n) { return {}; }\n\\u{0072}equire("x");\n',
    "realEscape.js": '\\u{0072}equire("./plain");\n',
    "lookalike.js":
      'export {};\nconst requirf = 1;\nconst requirg = 2;\nfunction require(n) { return requirf + requirg; }\nrequire("x");\n',
  };
  await project(files, async (graph, report) => {
    assert.equal(
      graph.symbol("plain.js", "require", "function").name,
      "require",
    );
    assert.equal(
      graph.target(graph.link("plain.js", "require", "calls")),
      "plain.js#require",
    );
    assert.deepEqual(report.failed, ["escaped.js"]);
    assert.match(
      graph.store.getFile("escaped.js").result.diagnostics[0].message,
      /escape sequence/,
    );
    // An escaped *real* require needs no renaming: the file is fine.
    assert.equal(graph.store.getFile("realEscape.js").result.status, "clean");
    // The existing requirf/requirg are ordinary constants; the call still binds locally.
    graph.symbol("lookalike.js", "requirf", "constant");
    graph.symbol("lookalike.js", "requirg", "constant");
    assert.equal(
      graph.target(graph.link("lookalike.js", "require", "calls")),
      "lookalike.js#require",
    );
    await assertNoFreshNames(graph, files);
  });
});

test("renamed names agree across files and never bind to a look-alike export", async () => {
  const files = {
    "e.js":
      "export function require(n) { return 1; }\nexport const requirf = 2;\n",
    "imp.js": 'import { require } from "./e.js";\nrequire("x");\n',
    "alias.js": 'import { require as r } from "./e.js";\nr("x");\n',
    "loader.js":
      "function require(n) { return 1; }\nexport { require as loader };\n",
    "useLoader.js": 'import { loader } from "./loader.js";\nloader("x");\n',
  };
  await project(files, async (graph, report) => {
    clean(report);
    assert.equal(
      graph.target(graph.link("imp.js", "require", "imports")),
      "e.js#require",
    );
    assert.equal(
      graph.target(graph.link("imp.js", "require", "calls")),
      "e.js#require",
    );
    assert.equal(
      graph.target(graph.link("alias.js", "require as r", "imports")),
      "e.js#require",
    );
    assert.equal(
      graph.target(graph.link("alias.js", "r", "calls")),
      "e.js#require",
    );
    assert.equal(
      graph.target(graph.link("useLoader.js", "loader", "calls")),
      "loader.js#require",
    );
    await assertNoFreshNames(graph, files);
  });
});

test("checker stack limits: warm-up makes a deep chain clean; an overflow stays contained", async () => {
  // Return-type chains: f(i+1) returns f(i)(). Declared in this order, the
  // source-order warm-up computes each return type on top of the previous one.
  const forward = [
    "export class Box { go() { return 1; } }",
    "export function f0() { return new Box(); }",
    ...Array.from(
      { length: 1000 },
      (_, i) => `export function f${i + 1}() { return f${i}(); }`,
    ),
    "f1000().go();",
    "",
  ].join("\n");
  // Reversed, the first warm-up step already recurses through the whole chain.
  const reversed = [
    "export class Crate { go() { return 1; } }",
    "export function ok() {}",
    "ok();",
    "g0().go();",
    ...Array.from(
      { length: 10000 },
      (_, i) => `function g${i}() { return g${i + 1}(); }`,
    ),
    "function g10000() { return new Crate(); }",
    "",
  ].join("\n");
  await project(
    {
      "forward.ts": forward,
      "deep.ts": reversed,
      "other.ts": "export function x() {}\nx();\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.failed, []);
      // Needs the source-order warm-up: without it this lookup overflows.
      assert.equal(graph.store.getFile("forward.ts").result.status, "clean");
      assert.equal(
        graph.target(graph.link("forward.ts", "go", "calls")),
        "forward.ts#Box.go",
      );
      // Still overflows: that one link is compiler-limit, the file partial, the rest intact.
      const deep = graph.store.getFile("deep.ts").result;
      assert.equal(deep.status, "partial");
      assert.match(
        deep.diagnostics.map((d) => d.message).join("\n"),
        /exhausted its stack/,
      );
      const go = graph.link("deep.ts", "go", "calls");
      assert.equal(go.resolution, "unresolved");
      assert.equal(go.data.reason, "compiler-limit");
      // Every compiler-limit link lies in the one deep expression `g0().go()`
      // (the lookups of `g0` and of `.go` both recurse through the chain).
      const text = graph.store.getFile("deep.ts").text;
      const deepStart = text.indexOf("g0().go()");
      const limited = graph.store
        .links()
        .filter(
          (l) => l.file === "deep.ts" && l.data?.reason === "compiler-limit",
        );
      assert.ok(limited.length >= 1 && limited.length <= 2);
      for (const l of limited)
        assert.ok(
          l.range.start >= deepStart &&
            l.range.end <= deepStart + "g0().go()".length,
        );
      assert.equal(
        graph.target(graph.link("deep.ts", "ok", "calls")),
        "deep.ts#ok",
      );
      assert.equal(
        graph.target(graph.link("other.ts", "x", "calls")),
        "other.ts#x",
      );
    },
  );
});

test("a parser stack overflow fails only that file", async () => {
  const nested = `export const x = ${"(".repeat(10000)}1${")".repeat(10000)};\n`;
  await project(
    { "nested.ts": nested, "fine.ts": "export function f() {}\nf();\n" },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["nested.ts"]);
      assert.match(
        graph.store.getFile("nested.ts").result.diagnostics[0].message,
        /parser failed/,
      );
      assert.equal(
        graph.target(graph.link("fine.ts", "f", "calls")),
        "fine.ts#f",
      );
    },
  );
});

test("requiring an existing script file links to it and labels its bindings not-a-module", async () => {
  await project(
    {
      "script.js": "var counter = 0;\ncounter++;\n",
      "use.js": 'const s = require("./script");\nrequire("./missing");\n',
    },
    async (graph) => {
      const edge = graph.link("use.js", '"./script"', "imports");
      assert.equal(graph.target(edge), "script.js#script.js");
      assert.equal(edge.data.notAModule, true);
      assert.equal(
        graph.link("use.js", "s", "imports").data.reason,
        "not-a-module",
      );
      assert.equal(
        graph.link("use.js", '"./missing"', "imports").data.reason,
        "missing-module",
      );
    },
  );
});

for (const [key, value] of [
  ["include", 42],
  ["files", "a.ts"],
  ["exclude", { x: 1 }],
])
  test(`a config with a non-array "${key}" is an unreadable selection`, async () => {
    await project(
      {
        "tsconfig.json": JSON.stringify({ [key]: value }),
        "a.ts": "export const a = 1;\n",
      },
      async (graph, report) => {
        assert.deepEqual(report.failed, ["a.ts"]);
        assert.match(
          graph.store.getFile("a.ts").result.diagnostics[0].message,
          new RegExp(`invalid "${key}"`),
        );
      },
    );
  });

test("a binder stack overflow fails only that file", async () => {
  // Stack thresholds shift as the JIT optimises a long-running process, so
  // this runs in a fresh Node process: there 1,600 nested blocks parse but
  // overflow the binder (measured window about 1,500-1,700 under the
  // indexer). Without containment that overflow is a module-wide analysis
  // error; the assertions below would then fail.
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-binder-"));
  try {
    const root = join(scratch, "project");
    await mkdir(root);
    await writeFile(
      join(root, "blocks.js"),
      "{".repeat(1600) + "}".repeat(1600) + "\n",
    );
    await writeFile(join(root, "fine.ts"), "export function f() {}\nf();\n");
    const script = join(scratch, "run.mjs");
    const dist = new URL("../dist/graph/", import.meta.url).href;
    await writeFile(
      script,
      [
        `import { indexProject, LanguageRegistry, SqliteGraphStore } from ${JSON.stringify(dist + "index.js")};`,
        `import ts from ${JSON.stringify(dist + "languages/typescript/index.js")};`,
        `const store = new SqliteGraphStore(${JSON.stringify(join(scratch, "g.sqlite"))}, "binder");`,
        `const report = await indexProject(${JSON.stringify(root)}, new LanguageRegistry([ts]), store);`,
        `const fine = store.links().find((l) => l.file === "fine.ts" && l.kind === "calls");`,
        "console.log(JSON.stringify({ analysisErrors: report.analysisErrors, failed: report.failed,",
        '  message: store.getFile("blocks.js").result.diagnostics[0]?.message, fine: fine?.resolution }));',
        "store.close();",
      ].join("\n"),
    );
    const { execFileSync } = await import("node:child_process");
    const out = JSON.parse(
      execFileSync(process.execPath, [script], { encoding: "utf8" }),
    );
    assert.deepEqual(out.analysisErrors, []);
    assert.deepEqual(out.failed, ["blocks.js"]);
    assert.match(out.message, /(binder exhausted its stack|parser failed)/);
    assert.equal(out.fine, "resolved");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("one file's checker overflow does not change another file's facts", async () => {
  // b.ts depends on a 1,000-step return-type chain in a.ts (needs warm-up).
  const a = [
    "export class Box { go() { return 1; } }",
    "export function f0() { return new Box(); }",
    ...Array.from(
      { length: 1000 },
      (_, i) => `export function f${i + 1}() { return f${i}(); }`,
    ),
    "",
  ].join("\n");
  const b = 'import { f1000 } from "./a";\nf1000().go();\n';
  const deep = [
    "export class Crate { go() { return 1; } }",
    "g0().go();",
    ...Array.from(
      { length: 10000 },
      (_, i) => `function g${i}() { return g${i + 1}(); }`,
    ),
    "function g10000() { return new Crate(); }",
    "",
  ].join("\n");
  const facts = (graph) => {
    const link = graph.link("b.ts", "go", "calls");
    return {
      target: graph.target(link),
      resolution: link.resolution,
      reason: link.data.reason ?? null,
    };
  };
  let alone;
  await project({ "a.ts": a, "b.ts": b }, async (graph) => {
    alone = facts(graph);
  });
  assert.deepEqual(alone, {
    target: "a.ts#Box.go",
    resolution: "resolved",
    reason: null,
  });
  // The overflowing file sorts between a.ts and b.ts in extraction order.
  await project({ "a.ts": a, "aa-deep.ts": deep, "b.ts": b }, async (graph) => {
    assert.equal(graph.store.getFile("aa-deep.ts").result.status, "partial");
    assert.deepEqual(facts(graph), alone);
  });
});

test("a free require in an ES module is linked but flagged as a bundler assumption", async () => {
  await project(
    {
      "dep.ts": dep6,
      "esm.js":
        'export {};\nconst d = require("./dep");\nd.real();\nconst { real } = require("./dep");\nreal();\n',
      "cjs.js": 'const d = require("./dep");\nd.real();\n',
    },
    async (graph) => {
      for (const link of graph.links("esm.js", '"./dep"', "imports"))
        assert.equal(link.data.assumes, "bundler-require");
      assert.equal(
        graph.link("esm.js", "d", "imports").data.assumes,
        "bundler-require",
      );
      const member = graph.store
        .links()
        .find((l) => l.file === "esm.js" && l.targetName === "d.real");
      assert.equal(graph.target(member), "dep.ts#real");
      assert.equal(member.data.assumes, "bundler-require");
      const destructured = graph.store
        .links()
        .find(
          (l) =>
            l.file === "esm.js" &&
            l.kind === "calls" &&
            l.targetName === "real",
        );
      assert.equal(destructured.data.assumes, "bundler-require");
      // An ordinary CommonJS file carries no assumption.
      assert.equal(
        graph.link("cjs.js", '"./dep"', "imports").data.assumes,
        undefined,
      );
    },
  );
});

test("createRequire with a base other than this file is unresolved with its own reason", async () => {
  await project(
    {
      "dep.ts": dep6,
      "sub/dep.ts": dep6,
      "base.mjs": [
        'import { createRequire } from "node:module";',
        'const require = createRequire(new URL("./sub/", import.meta.url));',
        'const m = require("./dep");',
        "m.real();",
        "",
      ].join("\n"),
      "own.mjs": [
        'import { createRequire } from "node:module";',
        "const require = createRequire(import.meta.url);",
        'const m = require("./dep");',
        "m.real();",
        "",
      ].join("\n"),
    },
    async (graph) => {
      const edge = graph.link("base.mjs", '"./dep"', "imports");
      assert.equal(edge.resolution, "unresolved");
      assert.equal(edge.data.reason, "createrequire-base");
      assert.equal(edge.data.targets, undefined);
      assert.deepEqual(linksInto(graph, "base.mjs"), []);
      assert.deepEqual(linksInto(graph, "base.mjs", "sub/dep.ts"), []);
      assert.ok(linksInto(graph, "own.mjs").includes("imports ./dep"));
    },
  );
});

test("not-a-module means only that the target file has no exports", async () => {
  await project(
    {
      "script.js": "var counter = 0;\ncounter++;\n",
      "dep.ts": dep6,
      "use.js": [
        'const s = require("./script");',
        'const d = (0, require)("./dep");',
        'const e = \\u{0072}equire("./dep");',
        "",
      ].join("\n"),
    },
    async (graph) => {
      const script = graph.link("use.js", '"./script"', "imports");
      assert.equal(graph.target(script), "script.js#script.js");
      assert.equal(script.data.notAModule, true);
      for (const edge of graph.links("use.js", '"./dep"', "imports")) {
        assert.equal(graph.target(edge), "dep.ts#dep.ts");
        assert.equal(edge.data.notAModule, undefined);
      }
      for (const binding of graph.store
        .links()
        .filter(
          (l) => l.file === "use.js" && l.kind === "imports" && l.data.reason,
        ))
        assert.notEqual(
          binding.data.reason === "not-a-module" && binding.targetName !== "*",
          true,
        );
      assert.equal(
        graph.link("use.js", "s", "imports").data.reason,
        "not-a-module",
      );
    },
  );
});

test("parenthesised, comma and module.require forms keep the import", async () => {
  await project(
    {
      "dep.ts": dep6,
      "forms.js": [
        'const a = (require)("./dep");',
        'const b = (0, require)("./dep");',
        'const c = module.require("./dep");',
        "",
      ].join("\n"),
    },
    async (graph) => {
      const edges = graph.links("forms.js", '"./dep"', "imports");
      assert.equal(edges.length, 3);
      assert.deepEqual(edges.map((edge) => edge.data.calleeForm).sort(), [
        "(0, require)",
        "(require)",
        "module.require",
      ]);
      for (const edge of edges)
        assert.equal(graph.target(edge), "dep.ts#dep.ts");
    },
  );
});

test("reviewers' round 7 reproductions: no link into the module where Node uses a local", async () => {
  const files = {
    "dep.ts": dep6,
    "ifbranch.js": [
      "function g() {",
      "  if (true) function require(n) { return { real() {} }; }",
      '  const m = require("./dep");',
      "  return m.real();",
      "}",
      "",
    ].join("\n"),
    "arrowargs.js": [
      '(() => { arguments[1] = () => ({ marker: "LOCAL" }); })();',
      'const a = require("./dep");',
      "a.real();",
      "",
    ].join("\n"),
    "patch.js": [
      "const patch = () => { arguments[1] = (n) => ({ real() {} }); };",
      "patch();",
      'const b = require("./dep");',
      "b.real();",
      "",
    ].join("\n"),
    "returned.js": [
      "const f = () => arguments;",
      "f()[1] = () => ({});",
      'const c = require("./dep");',
      "c.real();",
      "",
    ].join("\n"),
    "replaced.mjs": [
      'import m from "node:module";',
      'm.createRequire = () => () => ({ marker: "LOCAL" });',
      "const require = m.createRequire(import.meta.url);",
      'const d = require("./dep");',
      "d.real();",
      "",
    ].join("\n"),
    "aliased.mjs": [
      'import { createRequire as cr } from "node:module";',
      "const require = cr(import.meta.url);",
      'const e = require("./dep");',
      "e.real();",
      "",
    ].join("\n"),
    "strictargs.js": [
      '"use strict";',
      "(() => { arguments[1] = () => ({}); })();",
      'const s = require("./dep");',
      "s.real();",
      "",
    ].join("\n"),
  };
  await project(files, async (graph) => {
    for (const file of [
      "ifbranch.js",
      "arrowargs.js",
      "patch.js",
      "returned.js",
      "replaced.mjs",
    ])
      assert.deepEqual(linksInto(graph, file), [], file);
    // Aliased createRequire from node:module is the real loader.
    assert.ok(linksInto(graph, "aliased.mjs").includes("calls e.real"));
    // Strict code: `arguments` is not mapped to the parameters.
    assert.ok(linksInto(graph, "strictargs.js").includes("calls s.real"));
    await assertNoFreshNames(graph, files);
  });
});
