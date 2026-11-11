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
      // A computed require is not an import edge; calls through it stay unresolved.
      assert.equal(graph.links("use.js", "name", "imports").length, 0);
      assert.equal(
        graph.link("use.js", "require", "calls").resolution,
        "unresolved",
      );
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

test("missing or unreadable configs are analysis errors, never silently ignored", async () => {
  await project(
    {
      "tsconfig.json": JSON.stringify({
        extends: "./base.json",
        compilerOptions: {},
      }),
      "a.ts": "export const a = 1;\n",
    },
    async (graph, report) => {
      assert.equal(report.analysisErrors.length, 1);
      assert.match(
        report.analysisErrors[0].message,
        /extends "\.\/base\.json".*missing/,
      );
      assert.deepEqual(report.failed, ["a.ts"]);
      // Adding the base repairs the analysis.
      await graph.write("base.json", "{}");
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
      assert.equal(malformed.analysisErrors.length, 1);
      assert.match(
        malformed.analysisErrors[0].message,
        /Unreadable TypeScript config tsconfig\.json/,
      );
      // A config that is not valid UTF-8 fails capture.
      await graph.write("tsconfig.json", Buffer.from([0x7b, 0xff, 0x7d]));
      const unreadable = await graph.reindex();
      assert.equal(unreadable.analysisErrors.length, 1);
      assert.ok(unreadable.failed.includes("tsconfig.json"));
      // A missing project reference.
      await graph.write(
        "tsconfig.json",
        JSON.stringify({ references: [{ path: "./pkg" }] }),
      );
      const reference = await graph.reindex();
      assert.match(reference.analysisErrors[0].message, /references "\.\/pkg"/);
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
