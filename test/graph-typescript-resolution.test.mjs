// SPDX-License-Identifier: MIT
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
import tsCompiler from "typescript";

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

test("lexical references and calls use the declaration in the checker's scope", async () => {
  // A small version of the nested submitNewProject call in CommandPalette.tsx.
  const source = [
    'import { shadow } from "./outer";',
    "export function CommandPalette(callback: () => void, { project }: { project: string }) {",
    "  const title = project;",
    "  const submitNewProject = () => title;",
    "  let render = function () { return submitNewProject(); };",
    "  render();",
    "  { function helper() {} helper(); }",
    "  { function helper() {} helper(); }",
    "  class Dialog {}",
    "  enum Mode { Default }",
    "  const options: Mode = 0;",
    "  new Dialog();",
    "  callback();",
    "  void callback;",
    "  const shadow = () => {};",
    "  shadow();",
    "  let unstable = () => {};",
    "  if (title) ({ unstable } = { unstable: callback });",
    "  unstable();",
    "  let alias = render;",
    "  if (title) alias = callback;",
    "  alias();",
    "  return { render, options };",
    "}",
  ].join("\n");
  await project(
    { "outer.ts": "export function shadow() {}", "use.ts": source },
    async (graph, report) => {
      clean(report);
      const target = (name, kind) =>
        graph.target(graph.link("use.ts", name, kind));
      assert.equal(
        target("submitNewProject", "calls"),
        "use.ts#CommandPalette.submitNewProject",
      );
      assert.equal(target("render", "calls"), "use.ts#CommandPalette.render");
      assert.equal(target("Dialog", "calls"), "use.ts#CommandPalette.Dialog");
      assert.equal(target("Mode", "references"), "use.ts#CommandPalette.Mode");
      assert.equal(
        target("project", "references"),
        "use.ts#CommandPalette.project",
      );
      assert.deepEqual(
        graph.links("use.ts", "title", "references").map(graph.target),
        ["use.ts#CommandPalette.title", "use.ts#CommandPalette.title"],
      );
      assert.equal(
        target("callback", "references"),
        "use.ts#CommandPalette.callback",
      );
      for (const name of ["callback", "shadow", "unstable", "alias"])
        assert.equal(
          graph.link("use.ts", name, "calls").resolution,
          "unresolved",
        );
      const helpers = () =>
        graph
          .links("use.ts", "helper", "calls")
          .sort((a, b) => a.range.start - b.range.start)
          .map((link) => link.targetId);
      const before = helpers();
      assert.equal(before.length, 2);
      assert.ok(before.every(Boolean));
      assert.notEqual(before[0], before[1]);
      assert.deepEqual(
        graph.store.searchSymbols("project", 10).map((symbol) => symbol.name),
        ["submitNewProject"],
      );
      assert.equal(
        graph.store.namedSymbols("CommandPalette.project", 10)[0]?.kind,
        "lexical",
      );
      await graph.write(
        "use.ts",
        source.replace(
          "  const title",
          "  function unrelated() {}\n  const title",
        ),
      );
      clean(await graph.reindex());
      assert.deepEqual(helpers(), before);
    },
  );
});

test("a generator callback calls the local emitRemoved in its enclosing generator", async () => {
  // Adapted from SessionCredentialService.ts:476 in the pinned T3 Code checkout.
  await project(
    {
      "session.ts": [
        "export function* makeSessionCredentialService() {",
        "  const emitRemoved = function* (sessionId: string) { yield sessionId; };",
        "  const revoke = (sessionId: string) =>",
        "    (function* () { yield* emitRemoved(sessionId); })();",
        "  return revoke;",
        "}",
      ].join("\n"),
    },
    async (graph, report) => {
      clean(report);
      const call = graph.link("session.ts", "emitRemoved", "calls");
      assert.equal(
        graph.target(call),
        "session.ts#makeSessionCredentialService.emitRemoved",
      );
      assert.equal(
        graph.store.getSymbol(call.sourceId)?.identity,
        "makeSessionCredentialService.revoke",
      );
    },
  );
});

test("pnpm subpath exports and checkout path dependencies use TypeScript's resolution mode", async () => {
  const exports = {
    "./devHome": { import: "./src/devHome.ts", require: "./dist/devHome.cjs" },
    "./missing": "./dist/missing.js",
  };
  await project(
    {
      "package.json": JSON.stringify({ packageManager: "pnpm@10.0.0" }),
      "pnpm-workspace.yaml":
        "packages:\n  - 'apps/*'\n  - 'packages/**'\n  - '!packages/excluded'\n",
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module: "NodeNext" },
      }),
      "apps/server/package.json": JSON.stringify({
        type: "module",
        dependencies: {
          "@t3tools/shared": "workspace:*",
          "@pkg/linked": "link:../../loose",
          "@pkg/file": "file:../../loose",
          "@pkg/excluded": "workspace:*",
        },
      }),
      "apps/server/migrate-dev-db.ts": [
        'import { resolveWorktreeT3Home } from "@t3tools/shared/devHome";',
        'import { resolveHome } from "@t3tools/shared/missing";',
        'import { linked } from "@pkg/linked";',
        'import { linked as localFile } from "@pkg/file";',
        'import "@pkg/excluded";',
        'import "external-package";',
        "resolveWorktreeT3Home(); resolveHome(); linked(); localFile();",
      ].join("\n"),
      "apps/server/require.cts":
        'import shared = require("@t3tools/shared/devHome"); shared.resolveWorktreeT3Home();',
      "packages/nested/shared/package.json": JSON.stringify({
        name: "@t3tools/shared",
        type: "module",
        exports,
      }),
      "packages/nested/shared/src/devHome.ts":
        "export function resolveWorktreeT3Home() {}",
      "packages/nested/shared/src/missing.ts":
        "export function resolveHome() {}",
      "packages/excluded/package.json": JSON.stringify({
        name: "@pkg/excluded",
        main: "./index.ts",
      }),
      "packages/excluded/index.ts": "export function excluded() {}",
      "loose/package.json": JSON.stringify({
        name: "loose",
        type: "module",
        exports: { ".": "./index.js" },
      }),
      "loose/index.js": "export function linked() {}",
    },
    async (graph, report) => {
      clean(report);
      const file = "apps/server/migrate-dev-db.ts";
      assert.equal(
        graph.target(graph.link(file, "resolveWorktreeT3Home", "calls")),
        "packages/nested/shared/src/devHome.ts#resolveWorktreeT3Home",
      );
      assert.equal(
        graph.target(graph.link(file, "linked", "calls")),
        "loose/index.js#linked",
      );
      assert.equal(
        graph.target(graph.link(file, "localFile", "calls")),
        "loose/index.js#linked",
      );
      for (const name of ['"@t3tools/shared/missing"', "resolveHome"]) {
        const link = graph.link(
          file,
          name,
          name.startsWith('"') ? "imports" : "calls",
        );
        assert.equal(link.resolution, "unresolved");
        assert.equal(link.data.reason, "workspace-build-output-missing");
      }
      for (const name of ['"@pkg/excluded"', '"external-package"'])
        assert.equal(
          graph.link(file, name, "imports").data.reason,
          "external-package",
        );
      const require = graph.link(
        "apps/server/require.cts",
        '"@t3tools/shared/devHome"',
        "imports",
      );
      assert.equal(require.resolution, "unresolved");
      assert.equal(require.data.reason, "workspace-build-output-missing");
    },
  );
});

test("a TypeScript project reference can redirect a missing workspace declaration to its source", async () => {
  await project(
    {
      "package.json": JSON.stringify({
        workspaces: ["packages/*"],
        type: "module",
      }),
      "packages/library/package.json": JSON.stringify({
        name: "library",
        type: "module",
        exports: "./dist/index.js",
      }),
      "packages/library/tsconfig.json": JSON.stringify({
        compilerOptions: {
          composite: true,
          module: "NodeNext",
          rootDir: "src",
          outDir: "dist",
        },
        include: ["src"],
      }),
      "packages/library/src/index.ts": "export function helper() {}",
      "packages/app/tsconfig.json": JSON.stringify({
        compilerOptions: { module: "NodeNext" },
        references: [{ path: "../library" }],
      }),
      "packages/app/index.ts": 'import { helper } from "library"; helper();',
    },
    async (graph, report) => {
      clean(report);
      assert.equal(
        graph.target(graph.link("packages/app/index.ts", "helper", "calls")),
        "packages/library/src/index.ts#helper",
      );
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

test("checker stack limits: warm-up makes a deep chain clean; an overflow stays contained", async (t) => {
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
      // Holds at any stack size: each warm-up step builds on a computed one.
      assert.equal(graph.store.getFile("forward.ts").result.status, "clean");
      assert.equal(
        graph.target(graph.link("forward.ts", "go", "calls")),
        "forward.ts#Box.go",
      );
      assert.equal(
        graph.target(graph.link("other.ts", "x", "calls")),
        "other.ts#x",
      );
      // The containment part needs the 10,000-step chain to overflow, which
      // depends on the stack size: if it does not, that part is unresolved.
      const deep = graph.store.getFile("deep.ts").result;
      if (
        graph.link("deep.ts", "go", "calls").data.reason !== "compiler-limit"
      ) {
        t.skip(
          "the 10,000-step chain did not overflow at this stack size; containment not exercised",
        );
        return;
      }
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

test("a parser stack overflow fails only that file, as a transient resource limit", async (t) => {
  // A nesting depth at which the parser overflows in THIS process (it
  // depends on the stack size), found by search rather than assumed.
  let depth = 10000;
  const nestedAt = (n) =>
    `export const x = ${"(".repeat(n)}1${")".repeat(n)};\n`;
  const overflows = (n) => {
    try {
      tsCompiler.createSourceFile(
        "probe.ts",
        nestedAt(n),
        tsCompiler.ScriptTarget.Latest,
        true,
      );
      return false;
    } catch (error) {
      if (error instanceof RangeError) return true;
      throw error;
    }
  };
  while (depth <= 1_280_000 && !overflows(depth)) depth *= 2;
  if (depth > 1_280_000) {
    t.skip("the parser never overflowed up to 1,280,000 nested parentheses");
    return;
  }
  await project(
    {
      "nested.ts": nestedAt(depth),
      "fine.ts": "export function f() {}\nf();\n",
    },
    async (graph, report) => {
      assert.deepEqual(report.analysisErrors, []);
      assert.deepEqual(report.failed, ["nested.ts"]);
      const result = graph.store.getFile("nested.ts").result;
      // An environment limit, not invalid code and not a defect.
      assert.equal(result.failureKind, "transient");
      assert.match(
        result.diagnostics[0].message,
        /^The TypeScript parser exhausted its stack on this file \(a resource limit of the TypeScript compiler in this environment, not a defect in the file; it is retried on the next index\)$/,
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

test("a binder stack overflow fails only that file", async (t) => {
  // The depth at which the binder (but not the parser) overflows depends on
  // the stack size and on how warm the JIT is. So a fresh Node process
  // searches for it: it grows the nesting until indexing gives anything
  // other than a clean file. If that is a binder failure, the containment
  // is asserted at that depth; if the parser fails first, there is no such
  // depth on this machine and the test reports that as unresolved (a skip).
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-binder-"));
  try {
    const script = join(scratch, "run.mjs");
    const dist = new URL("../dist/graph/", import.meta.url).href;
    await writeFile(
      script,
      [
        `import { mkdir, writeFile, rm } from "node:fs/promises";`,
        `import { join } from "node:path";`,
        `import { indexProject, LanguageRegistry, SqliteGraphStore } from ${JSON.stringify(dist + "index.js")};`,
        `import ts from ${JSON.stringify(dist + "languages/typescript/index.js")};`,
        `const scratch = ${JSON.stringify(scratch)};`,
        "let result = { found: false };",
        "for (let depth = 200; depth <= 8000; depth += 50) {",
        "  const root = join(scratch, `p${depth}`);",
        "  await mkdir(root, { recursive: true });",
        '  await writeFile(join(root, "blocks.js"), "{".repeat(depth) + "}".repeat(depth) + "\\n");',
        '  await writeFile(join(root, "fine.ts"), "export function f() {}\\nf();\\n");',
        '  const store = new SqliteGraphStore(join(scratch, `g${depth}.sqlite`), "binder");',
        "  const report = await indexProject(root, new LanguageRegistry([ts]), store);",
        '  const message = store.getFile("blocks.js").result.diagnostics[0]?.message ?? null;',
        '  const fine = store.links().find((l) => l.file === "fine.ts" && l.kind === "calls")?.resolution ?? null;',
        "  store.close();",
        "  await rm(root, { recursive: true, force: true });",
        "  if (!report.failed.length && !report.analysisErrors.length) continue;",
        '  result = { found: /binder exhausted its stack/.test(message ?? ""), depth, analysisErrors: report.analysisErrors, failed: report.failed, message, fine };',
        "  break;",
        "}",
        "console.log(JSON.stringify(result));",
      ].join("\n"),
    );
    const { execFileSync } = await import("node:child_process");
    const out = JSON.parse(
      // Inherit a --stack-size given to this process, so the search runs
      // under the same stack as the test.
      execFileSync(
        process.execPath,
        [
          ...process.execArgv.filter((flag) => flag.startsWith("--stack-size")),
          script,
        ],
        { encoding: "utf8" },
      ),
    );
    if (!out.found) {
      t.skip(
        `no nesting depth at which parsing succeeds and the binder overflows on this machine (first failure: ${out.message ?? "none up to 8,000"}); binder containment not exercised`,
      );
      return;
    }
    assert.deepEqual(out.analysisErrors, []);
    assert.deepEqual(out.failed, ["blocks.js"]);
    assert.match(out.message, /binder exhausted its stack/);
    assert.equal(out.fine, "resolved");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("one file's checker overflow does not change another file's facts", async (t) => {
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
    // The other file's facts must match whether or not anything overflowed.
    assert.deepEqual(facts(graph), alone);
    if (graph.store.getFile("aa-deep.ts").result.status !== "partial")
      t.skip(
        "the 10,000-step chain did not overflow at this stack size; independence after a rebuild not exercised",
      );
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
        assert.deepEqual(link.data.assumes, ["bundler-require"]);
      assert.deepEqual(graph.link("esm.js", "d", "imports").data.assumes, [
        "bundler-require",
      ]);
      const member = graph.store
        .links()
        .find((l) => l.file === "esm.js" && l.targetName === "d.real");
      assert.equal(graph.target(member), "dep.ts#real");
      assert.deepEqual(member.data.assumes, ["bundler-require"]);
      const destructured = graph.store
        .links()
        .find(
          (l) =>
            l.file === "esm.js" &&
            l.kind === "calls" &&
            l.targetName === "real",
        );
      assert.deepEqual(destructured.data.assumes, ["bundler-require"]);
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

test("the bundler assumption travels through aliases, destructuring, re-exports and barrels", async () => {
  const depCjs = "module.exports = { real() {} };\n";
  await project(
    {
      "dep.cjs": depCjs,
      "a.mjs": [
        'export const d = require("./dep.cjs");',
        "const alias = d;",
        "alias.real();",
        'const { real } = require("./dep.cjs");',
        "export { real };",
        "export default d;",
        "",
      ].join("\n"),
      "barrel.mjs": 'export * from "./a.mjs";\n',
      "consumer.ts": [
        'import { d, real } from "./a.mjs";',
        'import dflt from "./a.mjs";',
        'import { d as viaBarrel } from "./barrel.mjs";',
        "d.real();",
        "real();",
        "dflt.real();",
        "viaBarrel.real();",
        "",
      ].join("\n"),
      "c.js": 'import * as ns from "./a.mjs";\nns.d.real();\n',
    },
    async (graph) => {
      const dep = new Set(
        graph.store.findSymbols({ file: "dep.cjs" }).map((s) => s.id),
      );
      const intoDep = (l) =>
        dep.has(l.targetId) || l.candidates.some((c) => dep.has(c.id));
      for (const file of ["a.mjs", "consumer.ts", "c.js"]) {
        const reached = graph.store
          .links()
          .filter(
            (l) => l.file === file && intoDep(l) && l.kind !== "contains",
          );
        assert.ok(reached.length > 0, file);
        for (const link of reached)
          assert.deepEqual(
            link.data.assumes,
            ["bundler-require"],
            `${file} ${link.kind} ${link.targetName}`,
          );
      }
      // The consumer's bindings and calls are among them.
      for (const name of ["d.real", "real", "dflt.real", "viaBarrel.real"])
        assert.ok(
          graph.store
            .links()
            .some(
              (l) =>
                l.file === "consumer.ts" && l.targetName === name && intoDep(l),
            ),
          name,
        );
    },
  );
});

test("indirect loader forms emit untyped-require bindings and members", async () => {
  await project(
    {
      "dep.ts": dep6,
      "p.js":
        'const p = (0, require)("./dep");\np.real();\nconst { real } = (require)("./dep");\n',
    },
    async (graph) => {
      const whole = graph.link("p.js", "p", "imports");
      assert.equal(whole.data.reason, "untyped-require");
      assert.equal(
        graph.link("p.js", "real", "imports").data.reason,
        "untyped-require",
      );
      const member = graph.store
        .links()
        .find((l) => l.file === "p.js" && l.targetName === "p.real");
      assert.equal(member.data.reason, "untyped-require");
    },
  );
});

test("failed and invalid targets get their own reasons, never not-a-module", async () => {
  await project(
    {
      "failed.js":
        'export {};\nfunction require(n) { return {}; }\n\\u{0072}equire("x");\n',
      "partial.js": "var x = ;\n",
      "use.js":
        'const f = require("./failed");\nconst q = require("./partial");\n',
    },
    async (graph, report) => {
      assert.ok(report.failed.includes("failed.js"));
      const failedEdge = graph.link("use.js", '"./failed"', "imports");
      assert.equal(failedEdge.data.notAModule, undefined);
      assert.equal(failedEdge.data.reason, "target-unavailable");
      assert.equal(
        graph.link("use.js", "f", "imports").data.reason,
        "target-unavailable",
      );
      // A syntax error: the file failed, the edge and binding fail with it.
      assert.ok(report.failed.includes("partial.js"));
      const invalidEdge = graph.link("use.js", '"./partial"', "imports");
      assert.equal(invalidEdge.data.notAModule, undefined);
      assert.equal(invalidEdge.data.reason, "invalid-code");
      assert.equal(invalidEdge.data.cause.file, "partial.js");
      assert.equal(
        graph.link("use.js", "q", "imports").data.reason,
        "invalid-code",
      );
    },
  );
});

// ----- Round 9: the differential analysis (untrusted.ts) -----

/**
 * The last `calls` link to `method` on each line marked `// D` (depends on
 * untrusted input) or `// C` (control), as [mark, line, link].
 */
function markedCalls(graph, file, method) {
  const text = graph.store.getFile(file).text;
  const links = graph.store
    .links()
    .filter((l) => l.file === file && l.kind === "calls");
  const found = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const mark = / \/\/ ([DC])$/.exec(line)?.[1];
    const end = offset + line.length;
    if (mark) {
      const onLine = links
        .filter(
          (l) =>
            l.range.start >= offset &&
            l.range.end <= end &&
            text.slice(l.range.start, l.range.end) === method,
        )
        .sort((a, b) => b.range.start - a.range.start);
      assert.ok(onLine.length, `a ${method} call on: ${line}`);
      found.push([mark, line, onLine[0]]);
    }
    offset = end + 1;
  }
  return found;
}

const DEP_CJS = "module.exports = { real() {} };\n";
const ROUTES = [
  "export const holder = { d };",
  "export const boxed = { value: d };",
  "export function ret() { return d; }",
  "export const arr = [d];",
  "export const spread = { ...holder };",
  "export class K { field = d; }",
  "/** @template T @param {T} v @returns {T} */",
  "export function id(v) { return v; }",
  "const a0 = d;",
  ...Array.from({ length: 29 }, (_, i) => `const a${i + 1} = a${i};`),
  "export const a30 = a29;",
  "export const own = { real() {} };",
];

test("the bundler label follows every route the checker follows; independent links stay unflagged", async () => {
  await project(
    {
      "dep.cjs": DEP_CJS,
      "a.mjs": [
        'export const d = require("./dep.cjs");',
        ...ROUTES,
        "holder.d.real(); // D",
        "boxed.value.real(); // D",
        "ret().real(); // D",
        "arr[0].real(); // D",
        "const { d: destructured } = holder;",
        "destructured.real(); // D",
        "spread.d.real(); // D",
        "new K().field.real(); // D",
        "id(d).real(); // D",
        "a30.real(); // D",
        "own.real(); // C",
        "id(own).real(); // C",
        "",
      ].join("\n"),
      "barrel.mjs": 'export * from "./a.mjs";\n',
      "use.ts": [
        'import { holder, boxed, ret, arr, spread, K, id, a30, own } from "./a.mjs";',
        'import { holder as viaBarrel, own as ownViaBarrel } from "./barrel.mjs";',
        "holder.d.real(); // D",
        "boxed.value.real(); // D",
        "ret().real(); // D",
        "arr[0].real(); // D",
        "const [first] = arr;",
        "first.real(); // D",
        "spread.d.real(); // D",
        "new K().field.real(); // D",
        "id(holder.d).real(); // D",
        "a30.real(); // D",
        "viaBarrel.d.real(); // D",
        "own.real(); // C",
        "ownViaBarrel.real(); // C",
        "id(own).real(); // C",
        "",
      ].join("\n"),
    },
    async (graph) => {
      for (const file of ["a.mjs", "use.ts"])
        for (const [mark, line, link] of markedCalls(graph, file, "real")) {
          if (mark === "D") {
            assert.equal(link.resolution, "resolved", `${file}: ${line}`);
            assert.equal(
              graph.target(link),
              "dep.cjs#module.exports.real",
              `${file}: ${line}`,
            );
            assert.deepEqual(
              link.data.assumes,
              ["bundler-require"],
              `${file}: ${line}`,
            );
          } else {
            assert.equal(link.resolution, "resolved", `${file}: ${line}`);
            assert.equal(
              graph.target(link),
              "a.mjs#own.real",
              `${file}: ${line}`,
            );
            assert.equal(link.data.assumes, undefined, `${file}: ${line}`);
          }
        }
      // An import of a name declared in a.mjs targets that declaration in
      // both programs: it does not rest on the loader, whatever its value.
      for (const name of ["own", "holder"]) {
        const binding = graph.link("use.ts", name, "imports");
        assert.equal(graph.target(binding), `a.mjs#${name}`);
        assert.equal(binding.data.assumes, undefined, name);
      }
    },
  );
});

test("any call that receives the wrapper's arguments makes require uncertain; only an array spread does not", async () => {
  const dep = "exports.real = function real() {};\n";
  const tail = 'const d = require("./dep.cjs");\nd.real();\n';
  const fake = "function (a) { a[1] = () => ({ real() {} }); return []; }";
  const uncertain = {
    "from.cjs": "Array.from(arguments);\n",
    "slice.cjs": "Array.prototype.slice.call(arguments);\n",
    "empty-slice.cjs": "[].slice.call(arguments);\n",
    "call-spread.cjs": "function f() {}\nf(...arguments);\n",
    "local.cjs": `const Array = { from: ${fake} };\nArray.from(arguments);\n`,
    "other-file.cjs": 'require("./patch.cjs");\nArray.from(arguments);\n',
    "constructor-key.cjs": `const k = "fr" + "om";\n[].constructor[k] = ${fake};\nArray.from(arguments);\n`,
    "function-call.cjs": `Function.prototype.call = ${fake};\nArray.prototype.slice.call(arguments);\n`,
    "proto-key.cjs":
      'const k = "sli" + "ce";\nObject.getPrototypeOf([])[k] = function () { this[1] = () => ({ real() {} }); return []; };\n[].slice.call(arguments);\n',
    "assign.cjs": `Object.assign([].constructor, { ["fr" + "om"]: ${fake} });\nArray.from(arguments);\n`,
    "global-name.cjs": `const w = globalThis, n = "Arr" + "ay";\nw[n] = { from: ${fake} };\nArray.from(arguments);\n`,
  };
  const files = { "dep.cjs": dep, "patch.cjs": `Array.from = ${fake};\n` };
  for (const [name, head] of Object.entries(uncertain))
    files[name] = head + tail;
  files["array-spread.cjs"] = "const copy = [...arguments];\n" + tail;
  files["array-spread-local.cjs"] =
    "const Array = 1;\nconst copy = [...arguments];\n" + tail;
  await project(files, async (graph) => {
    for (const file of Object.keys(uncertain)) {
      const edge = graph.link(file, '"./dep.cjs"', "imports");
      assert.equal(edge.resolution, "unresolved", file);
      assert.equal(edge.data.reason, "dynamic-scope", file);
      assert.equal(
        graph.link(file, "real", "calls").resolution,
        "unresolved",
        file,
      );
    }
    for (const file of ["array-spread.cjs", "array-spread-local.cjs"]) {
      assert.equal(
        graph.target(graph.link(file, '"./dep.cjs"', "imports")),
        "dep.cjs#dep.cjs",
        file,
      );
      assert.equal(
        graph.target(graph.link(file, "real", "calls")),
        "dep.cjs#real",
        file,
      );
    }
  });
});

// ----- Round 11: a file that cannot be read is not valid code -----

/** The single `calls` link whose text is `name` on the line containing `marker`. */
function callOn(graph, file, marker, name) {
  const text = graph.store.getFile(file).text;
  const lineStart = text.lastIndexOf("\n", text.indexOf(marker)) + 1;
  const lineEnd = text.indexOf("\n", lineStart);
  const found = graph.store
    .links()
    .filter(
      (l) =>
        l.file === file &&
        l.kind === "calls" &&
        l.range.start >= lineStart &&
        l.range.end <= lineEnd &&
        text.slice(l.range.start, l.range.end) === name,
    );
  assert.equal(found.length, 1, `one ${name} call on the ${marker} line`);
  return found[0];
}
/** Failed: unresolved, invalid-code, nothing that names a likely answer. */
const failedLink = (link, cause, what) => {
  assert.equal(link.resolution, "unresolved", what);
  assert.equal(link.data.reason, "invalid-code", what);
  assert.equal(link.data.targets, undefined, `${what}: no targets`);
  assert.equal(link.targetId ?? null, null, `${what}: no target`);
  assert.deepEqual(link.candidates ?? [], [], `${what}: no candidates`);
  const { via, ...files } = link.data.cause ?? {};
  assert.deepEqual(files, cause, `${what}: cause`);
  assert.ok(typeof via === "string" && via.length, `${what}: via`);
};
const FLAG = "no-unseen-declarations";
const flagged = (graph, link, target, what) => {
  assert.equal(link.resolution, "resolved", what);
  assert.equal(graph.target(link), target, what);
  assert.ok(link.data.assumes?.includes(FLAG), `${what}: flagged`);
};

const BROKEN_FILES = {
  "tsconfig.json": '{ "compilerOptions": { "allowJs": true } }\n',
  // One syntax error in one function body: the whole file has failed.
  "maths.ts": [
    "export const pi = 3.14;",
    "export const phi = 1.618;",
    "export function absolute(x: number) {",
    "  return x < 0 ? -x : x +;",
    "}",
    "export class Shape { area() { return 0; } }",
    "",
  ].join("\n"),
  "other.ts": "export const other = () => 1;\n",
  "barrel.ts": 'export * from "./maths";\nexport * from "./other";\n',
  "globals.js": "function scriptHelper() {}\nvar broken = (;\n",
  "use.ts": [
    'import { pi, phi, absolute } from "./maths";',
    'import { other } from "./barrel";',
    'import { Shape as ViaBarrel } from "./barrel";',
    'import { Shape } from "./maths";',
    'import { gone } from "./nowhere";',
    "absolute(phi); // absolute",
    "other(); // other",
    "class Square extends Shape {}",
    "new Square().area(); // inherited",
    "new ViaBarrel(); // via-barrel",
    "scriptHelper(); // global",
    "export const area = pi;",
    "",
  ].join("\n"),
};

test("a syntax error fails the whole file; every link into it fails and names the file", async () => {
  await project(BROKEN_FILES, async (graph, report) => {
    assert.ok(report.failed.includes("maths.ts"));
    assert.ok(report.failed.includes("globals.js"));
    assert.deepEqual(graph.store.findSymbols({ file: "maths.ts" }), []);
    const maths = { file: "maths.ts" };
    for (const edge of graph.links("use.ts", '"./maths"', "imports"))
      failedLink(edge, maths, "import");
    for (const name of ["pi", "phi", "absolute"])
      failedLink(
        graph.links("use.ts", name, "imports")[0],
        maths,
        `binding ${name}`,
      );
    failedLink(
      callOn(graph, "use.ts", "// absolute", "absolute"),
      maths,
      "call",
    );
    // Through `export *` from the failed file, and through a base in it.
    failedLink(
      callOn(graph, "use.ts", "// via-barrel", "ViaBarrel"),
      maths,
      "through export *",
    );
    failedLink(
      callOn(graph, "use.ts", "// inherited", "area"),
      maths,
      "inherited from a class in the failed file",
    );
    // A global the failed script might have declared.
    failedLink(
      callOn(graph, "use.ts", "// global", "scriptHelper"),
      { file: "globals.js" },
      "script global",
    );
    // Missing is not broken: an ordinary unresolved import.
    const missing = graph.link("use.ts", '"./nowhere"', "imports");
    assert.equal(missing.data.reason, "missing-module");
    assert.equal(missing.data.cause, undefined);
    // Unrelated links of the same program: resolved, flagged.
    flagged(
      graph,
      callOn(graph, "use.ts", "// other", "other"),
      "other.ts#other",
      "unrelated",
    );
    // Where and why, like a compiler error.
    const failure = graph.store.getFile("maths.ts");
    assert.equal(failure.result?.status ?? failure.status, "failed");
  });
});

test("a failed file reports its first syntax error with line, column, message and text", async () => {
  await project(
    { "bad.ts": "export const a = 1;\nexport const b = (;\n" },
    async (graph, report) => {
      assert.ok(report.failed.includes("bad.ts"));
      const result = graph.store.getFile("bad.ts");
      const diagnostics =
        result.result?.diagnostics ?? result.diagnostics ?? [];
      assert.ok(diagnostics.length > 0, "diagnostics");
      assert.equal(
        diagnostics[0].message,
        'Syntax error at line 2, column 19: Expression expected. Found: ";".',
      );
      const starts = diagnostics.map((d) => d.range.start);
      assert.deepEqual(
        starts,
        [...starts].sort((a, b) => a - b),
      );
    },
  );
});

test("a name through export * from two failed files names both; fixing them restores everything with no flags", async () => {
  const files = {
    "a.ts": "export function fromA() {}\nconst x = (;\n",
    "b.ts": "export function fromB() {}\nconst y = (;\n",
    "barrel.ts": 'export * from "./a";\nexport * from "./b";\n',
    "use.ts": 'import { fromA } from "./barrel";\nfromA(); // call\n',
  };
  await project(files, async (graph) => {
    failedLink(
      callOn(graph, "use.ts", "// call", "fromA"),
      { files: ["a.ts", "b.ts"] },
      "two causes",
    );
    // Unchanged re-index re-parses nothing.
    const reused = statistics.reused;
    const built = statistics.programs;
    await graph.reindex();
    assert.equal(statistics.reused, reused + 1);
    assert.equal(statistics.programs, built);
    // Fixed: resolved, and no assumption left anywhere.
    await graph.write("a.ts", "export function fromA() {}\n");
    await graph.write("b.ts", "export function fromB() {}\n");
    const report = await graph.reindex();
    assert.deepEqual(report.failed ?? [], []);
    const call = callOn(graph, "use.ts", "// call", "fromA");
    assert.equal(graph.target(call), "a.ts#fromA");
    for (const link of graph.store.links()) {
      assert.equal(link.data?.assumes, undefined, link.targetName);
      assert.equal(link.data?.cause, undefined, link.targetName);
    }
  });
});

test("only programs that would include a failed file are flagged", async () => {
  await project(
    {
      "one/tsconfig.json": '{ "include": ["*.ts"] }\n',
      "one/broken.ts": "export const lost = (;\n",
      "one/a.ts": "export function f() {}\nf(); // one\n",
      "two/tsconfig.json": '{ "include": ["*.ts"] }\n',
      // Includes the failed file through an import: flagged too.
      "two/b.ts":
        'import { lost } from "../one/broken";\nexport function g() {}\ng(); // two\n',
      "three/tsconfig.json": '{ "include": ["*.ts"] }\n',
      "three/c.ts": "export function h() {}\nh(); // three\n",
    },
    async (graph) => {
      flagged(
        graph,
        callOn(graph, "one/a.ts", "// one", "f"),
        "one/a.ts#f",
        "one",
      );
      flagged(
        graph,
        callOn(graph, "two/b.ts", "// two", "g"),
        "two/b.ts#g",
        "two",
      );
      failedLink(
        graph.link("two/b.ts", "lost", "imports"),
        { file: "one/broken.ts" },
        "shared failed file",
      );
      const clean = callOn(graph, "three/c.ts", "// three", "h");
      assert.equal(graph.target(clean), "three/c.ts#h");
      assert.equal(clean.data.assumes, undefined);
    },
  );
});

test("the program flag and the bundler assumption together", async () => {
  await project(
    {
      "package.json": '{ "type": "module" }\n',
      "dep.cjs": "module.exports = { real() {} };\n",
      "broken.js": "const lost = (;\n",
      "a.js": 'export const d = require("./dep.cjs");\nd.real(); // real\n',
    },
    async (graph) => {
      const link = callOn(graph, "a.js", "// real", "real");
      assert.equal(link.resolution, "resolved");
      assert.deepEqual(link.data.assumes, ["bundler-require", FLAG]);
    },
  );
});

test("tied configs: six orders of three variants merge to identical output", async () => {
  const { mergeTied } = await import(
    "../dist/graph/languages/typescript/index.js"
  );
  const variant = (config, extra) => ({
    status: "clean",
    diagnostics: [],
    symbols: [],
    links: [
      {
        sourceKey: "module@0",
        kind: "calls",
        targetName: "f",
        range: { start: 0, end: 1 },
        data: { targets: [{ file: "x.ts", key: "function@0" }], ...extra },
      },
    ],
    data: {
      analyzer: "a",
      project: config,
      ...(config === "tsconfig.b.json" ? { configNotes: ["missing ref"] } : {}),
    },
  });
  const all = [
    ["tsconfig.a.json", variant("tsconfig.a.json", {})],
    [
      "tsconfig.b.json",
      variant("tsconfig.b.json", { assumes: ["bundler-require"] }),
    ],
    ["tsconfig.c.json", variant("tsconfig.c.json", { reason: "external" })],
  ];
  const orders = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  const outputs = orders.map((order) =>
    JSON.stringify(
      mergeTied(
        order.map((i) => all[i][1]),
        order.map((i) => all[i][0]),
      ),
    ),
  );
  for (const output of outputs) assert.equal(output, outputs[0]);
  const merged = JSON.parse(outputs[0]);
  assert.deepEqual(merged.data.byProject["tsconfig.b.json"], {
    configNotes: ["missing ref"],
  });
  assert.deepEqual(merged.links[0].data.assumes, ["bundler-require"]);
  assert.equal(merged.links[0].data.reason, "ambiguous-project");
});

test("tied configs merge the same way whichever config comes first", async () => {
  const files = (first, second) => ({
    "dep.cjs": 'exports.real = function real() { return "DEP"; };\n',
    "real.js":
      'import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nexport const value = require("./dep.cjs");\n',
    "assumed.js": 'export const value = require("./dep.cjs");\n',
    "other.ts": "export function other() {}\n",
    "use.ts":
      'import { value } from "@provider";\nimport { other } from "@second";\nvalue.real();\nother();\n',
    "tsconfig.a.json": `{ "files": ["use.ts"], "compilerOptions": { "allowJs": true, "baseUrl": ".", "paths": { "@provider": ["./${first}"], "@second": ["./${first === "real.js" ? "other.ts" : "missing.ts"}"] }, "module": "ESNext", "moduleResolution": "Bundler" } }\n`,
    "tsconfig.b.json": `{ "files": ["use.ts"], "compilerOptions": { "allowJs": true, "baseUrl": ".", "paths": { "@provider": ["./${second}"], "@second": ["./${second === "real.js" ? "other.ts" : "missing.ts"}"] }, "module": "ESNext", "moduleResolution": "Bundler" } }\n`,
  });
  const outcomes = [];
  for (const order of [
    ["real.js", "assumed.js"],
    ["assumed.js", "real.js"],
  ])
    await project(files(...order), async (graph) => {
      const member = graph.store
        .links()
        .find((l) => l.file === "use.ts" && l.targetName === "value.real");
      assert.ok(member, "value.real");
      assert.deepEqual(member.data.assumes, ["bundler-require"], order.join());
      // Every link of use.ts, independent of which config maps what.
      outcomes.push(
        graph.store
          .links()
          .filter((l) => l.file === "use.ts")
          .map((l) => {
            const { byProject, ...rest } = l.data ?? {};
            return JSON.stringify({
              kind: l.kind,
              range: l.range,
              resolution: l.resolution,
              ...rest,
              byProject: Object.values(byProject ?? {})
                .map((v) => JSON.stringify(v))
                .sort(),
            });
          })
          .sort(),
      );
      const call = graph.store
        .links()
        .find((l) => l.file === "use.ts" && l.targetName === "other");
      assert.equal(call.data.reason, "ambiguous-project", order.join());
    });
  assert.deepEqual(outcomes[0], outcomes[1]);
});

test("meaningless heritage grammar is a syntax error: the file fails", async () => {
  await project(
    {
      "bases.ts": "export class A {}\nexport class B {}\n",
      "c.ts":
        'import { A, B } from "./bases";\nexport class C extends A, B {}\n',
      "use.ts": 'import { C } from "./c";\nnew C(); // c\n',
    },
    async (graph, report) => {
      assert.ok(report.failed.includes("c.ts"));
      const diagnostics = graph.store.getFile("c.ts").result.diagnostics;
      assert.match(
        diagnostics[0].message,
        /^Syntax error at line 2, column 27: Classes can only extend a single class\. Found: "B"\.$/,
      );
      failedLink(callOn(graph, "use.ts", "// c", "C"), { file: "c.ts" }, "C");
    },
  );
});

test("a failed file edited but still failing is analysed again when it changes what others see", async () => {
  await project(
    {
      "tsconfig.json": '{ "compilerOptions": { "allowJs": true } }\n',
      // A broken script: its globals are unseen.
      "a.js": "function g() {}\nvar x = (;\n",
      "use.js": "g(); // g\n",
    },
    async (graph) => {
      failedLink(callOn(graph, "use.js", "// g", "g"), { file: "a.js" }, "g");
      // Still broken, but now a module that does not mention `g`: it can
      // declare no global, and no unseen declaration could be named `g`.
      await graph.write("a.js", "export function h() {}\nvar x = (;\n");
      await graph.reindex();
      const call = callOn(graph, "use.js", "// g", "g");
      assert.equal(call.data.reason, "no-symbol");
      assert.equal(call.data.cause, undefined);
    },
  );
});

// ----- Round 12: a failure passes through every lookup that depends on it -----

/** Indexes files in a scratch project: links keyed by site, targets by identity. */
async function indexFiles(files) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-ts-diff-"));
  const root = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "diff");
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), text);
    }
    const report = await indexProject(root, registry(), store);
    const symbols = new Map(
      store.findSymbols().map((s) => [s.id, `${s.file}#${s.identity}`]),
    );
    const texts = new Map(store.files().map((f) => [f.path, f.text]));
    const links = new Map();
    for (const l of store.links()) {
      let key = `${l.file}\0${l.kind}\0${l.range.start}\0${l.range.end}`;
      while (links.has(key)) key += "+";
      const text = texts.get(l.file);
      const lineStart = text.lastIndexOf("\n", l.range.start - 1) + 1;
      const lineEnd = text.indexOf("\n", l.range.start);
      links.set(key, {
        file: l.file,
        kind: l.kind,
        line: text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd),
        text: text.slice(l.range.start, l.range.end),
        resolution: l.resolution,
        reason: l.data?.reason,
        cause: l.data?.cause,
        assumes: l.data?.assumes,
        targets:
          l.resolution === "resolved"
            ? [symbols.get(l.targetId)]
            : l.resolution === "ambiguous"
              ? l.candidates.map((c) => symbols.get(c.id)).sort()
              : (l.data?.targets ?? []).map((t) => `${t.file}#${t.key}`),
        targetFiles:
          l.resolution === "resolved"
            ? [symbols.get(l.targetId).split("#")[0]]
            : l.resolution === "ambiguous"
              ? l.candidates.map((c) => symbols.get(c.id).split("#")[0])
              : (l.data?.targets ?? []).map((t) => t.file),
      });
    }
    return { report, links };
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Indexes `files` clean and with `broken` replacing some of them, for
 * fixtures that exercise the attribution rules. It checks, for every link of
 * a valid file: identical to the clean index (maybe plus the flag), or
 * `invalid-code` naming a broken file with a `via`; and a link whose clean
 * target is in a broken file fails, naming it. That is STRICTER than the
 * contract (W2-D.md), which requires equality only of unflagged links: a
 * flagged link may differ from the clean index, and the known-limit
 * fixtures, whose flagged links do differ, do not use this helper.
 */
async function differential(files, broken, unflaggedFiles = []) {
  const clean = await indexFiles(files);
  const bad = await indexFiles({ ...files, ...broken });
  const brokenPaths = new Set(Object.keys(broken));
  for (const path of brokenPaths)
    assert.ok(bad.report.failed.includes(path), `${path} fails`);
  const counts = {
    failed: 0,
    flagged: 0,
    unflagged: 0,
    changedTarget: 0,
    changedReason: 0,
  };
  const problems = [];
  const causeFiles = (cause) =>
    cause?.file ? [cause.file] : (cause?.files ?? []);
  for (const [key, c] of clean.links) {
    if (brokenPaths.has(c.file)) continue;
    const b = bad.links.get(key);
    assert.ok(b, `link ${key} exists in both`);
    const intoBroken = c.targetFiles.filter((f) => brokenPaths.has(f));
    if (b.reason === "invalid-code") {
      counts.failed++;
      const causes = causeFiles(b.cause);
      if (!causes.length || causes.some((f) => !brokenPaths.has(f)))
        problems.push(`${key}: failed with cause ${JSON.stringify(b.cause)}`);
      if (b.targets.length) problems.push(`${key}: failed but names targets`);
      if (!b.cause?.via)
        problems.push(`${key}: failed without a justification`);
      for (const f of intoBroken)
        if (!causes.includes(f)) problems.push(`${key}: cause lacks ${f}`);
      continue;
    }
    if (intoBroken.length)
      problems.push(
        `${key} (${c.text} in ${c.line.trim()}): clean target in ${intoBroken} but broken is ${b.resolution} ${b.reason}`,
      );
    if (JSON.stringify(c.targets) !== JSON.stringify(b.targets)) {
      counts.changedTarget++;
      problems.push(
        `${key} (${c.text} in ${c.line.trim()}): target ${c.targets} -> ${b.targets}`,
      );
    } else if (c.reason !== b.reason) {
      counts.changedReason++;
      problems.push(
        `${key} (${c.text} in ${c.line.trim()}): reason ${c.reason} -> ${b.reason}`,
      );
    }
    // K3: in a program that includes a failed file, EVERY link that is not
    // invalid-code is flagged (resolved or unresolved alike).
    if (b.assumes?.includes("no-unseen-declarations")) counts.flagged++;
    else {
      counts.unflagged++;
      if (!unflaggedFiles.includes(c.file))
        problems.push(
          `${key} (${c.text} in ${c.line.trim()}): ${b.resolution} ${b.reason ?? ""} is not flagged`,
        );
    }
  }
  return { counts, problems, clean, bad };
}

/** The single link with text `at` on the line containing `marker` in `file`. */
function linkAt(result, file, marker, at, kind = "calls") {
  const found = [...result.links.values()].filter(
    (l) =>
      l.file === file &&
      l.kind === kind &&
      l.text === at &&
      l.line.includes(marker),
  );
  assert.equal(found.length, 1, `one ${kind} ${at} on ${marker} in ${file}`);
  return found[0];
}
const isFailed = (link, cause, what) => {
  assert.equal(
    link.reason,
    "invalid-code",
    `${what}: ${link.resolution} ${link.reason}`,
  );
  assert.deepEqual(link.targets, [], `${what}: no targets`);
  const { via, ...files } = link.cause ?? {};
  assert.deepEqual(files, cause, `${what}: cause`);
  assert.ok(typeof via === "string" && via.length, `${what}: via`);
};
const isResolved = (link, target, what) => {
  assert.equal(link.resolution, "resolved", `${what}: ${link.reason}`);
  assert.deepEqual(link.targets, [target], what);
};

const TAINT_FILES = {
  "tsconfig.json":
    '{ "compilerOptions": { "allowJs": true, "jsx": "preserve", "strict": true } }\n',
  "bad.ts": [
    "export class Base { m() {} static s() {} }",
    "export interface BaseI { m(): void }",
    "export const holder = { inner() {} };",
    "export function Widget() { return null; }",
    "",
  ].join("\n"),
  "oo.ts":
    "export interface OtherI { m(): void; n(): void }\nexport class OtherC { m() {} }\n",
  "bad2.ts": "export interface X { m(): void; }\n",
  "bad.cts": "function x() {}\nexport = x;\n",
  "barrel.cts": 'import x = require("./bad.cjs");\nexport = x;\n',
  "use.cts": 'import x = require("./barrel.cjs");\nx(); // 2b\n',
  "badc.cjs": "exports.x = function () {};\n",
  "barrelc.cjs": 'module.exports = require("./badc.cjs");\n',
  "usec.cjs": 'const b = require("./barrelc.cjs");\nb.x(); // 2c\n',
  "bad3.ts": "export function x3() {}\nexport type T3 = number;\n",
  "barrel3.ts":
    'export { x3 } from "./bad3"; // 3\nexport type { T3 } from "./bad3"; // 3t\n',
  "job.ts":
    "export class Job { getState() {} other() {} }\nexport function helper() {}\n",
  "queue.ts":
    'import { Job } from "./job";\nexport class Queue { add(): Job { return null as any; } }\n',
  "broken.js": "exports.x = function () {};\n",
  "eqmid.ts": 'import b = require("./broken.js");\nexport = b;\n',
  "useeq.ts": 'import m = require("./eqmid.js");\nm.x(); // eq\n',
  "gns.ts": "namespace N { export function a() {} }\n",
  "dg.ts": "export {};\ndeclare global { function globalThing(): void; }\n",
  "a2.ts": 'import { Base } from "./bad";\nexport class A2 extends Base {}\n',
  "b2.ts": 'import { A2 } from "./a2";\nexport class B2 extends A2 {}\n',
  "d.ts": 'import { Base } from "./bad";\nexport default new Base();\n',
  "comp.tsx":
    'import { Widget } from "./bad";\nexport const el = <Widget />; // jsx\n',
  "use2.ts": [
    'import type { X } from "./bad2";',
    "type Y = X;",
    "declare let x: Y;",
    "x.m(); // 2a",
    "",
  ].join("\n"),
  "usej.ts": [
    'import { Queue } from "./queue";',
    "export async function run() {",
    "  const j = new Queue().add();",
    "  j.getState(); // job-state",
    '  const m = await import("./job");',
    "  m.helper(); // dynamic",
    "}",
    "",
  ].join("\n"),
  "use.ts": [
    'import { Base, BaseI } from "./bad";',
    'import * as ns from "./bad";',
    'import { OtherI, OtherC } from "./oo";',
    'import { B2 } from "./b2";',
    'import dflt from "./d";',
    "class Other { m() {} }",
    "interface Derived extends Other {}",
    "class Derived extends Base {}",
    "new Derived().m(); // derived",
    "interface I extends BaseI, OtherI {}",
    "declare const i: I;",
    "i.m(); // merged-interface",
    "class K extends Base {}",
    "interface K extends OtherC {}",
    "new K().m(); // k-merge",
    "declare const t: BaseI & OtherI;",
    "t.m(); // intersection",
    'interface J extends Pick<BaseI, "m">, OtherI {}',
    "declare const jj: J;",
    "jj.m(); // pick",
    "const b = new Base();",
    "b.m(); // variable",
    "function make(): Base { return null as any; }",
    "make().m(); // return-type",
    "function make2() { return new Base(); }",
    "make2().m(); // inferred-return",
    "class Box<T> { value!: T; }",
    "declare const box: Box<Base>;",
    "box.value.m(); // generic",
    "class Impl implements BaseI { m() {} own2() {} }",
    "new Impl().own2(); // impl-own",
    "declare const viaI: BaseI;",
    "viaI.m(); // via-interface",
    "new B2().m(); // chain",
    "dflt.m(); // default",
    "ns.holder.inner(); // namespace",
    "class Own extends Base { own() {} }",
    "new Own().own(); // own",
    "N.a(); // global-namespace",
    "globalThing(); // declare-global",
    "class Clean { c() {} }",
    "new Clean().c(); // control",
    "",
  ].join("\n"),
};
const TAINT_BROKEN = {
  "bad.ts": TAINT_FILES["bad.ts"] + "const bad = (;\n",
  "bad2.ts": TAINT_FILES["bad2.ts"] + "const bad = (;\n",
  "bad.cts": TAINT_FILES["bad.cts"] + "const bad = (;\n",
  "badc.cjs": TAINT_FILES["badc.cjs"] + "var bad = (;\n",
  "bad3.ts": TAINT_FILES["bad3.ts"] + "const bad = (;\n",
  "job.ts":
    "export class Job { getState() {} bad(x: , y) {} }\nexport function helper() {}\n",
  "broken.js": TAINT_FILES["broken.js"] + "var bad = (;\n",
  "gns.ts": TAINT_FILES["gns.ts"] + "const bad = (;\n",
  "dg.ts": TAINT_FILES["dg.ts"] + "const bad = (;\n",
};

test("a failure passes through every lookup that depends on it (clean vs broken)", async () => {
  const { counts, problems, bad } = await differential(
    TAINT_FILES,
    TAINT_BROKEN,
  );
  assert.deepEqual(problems, []);
  assert.equal(counts.changedTarget, 0);
  assert.equal(counts.changedReason, 0);
  const one = (file) => ({ file });
  const failedAt = (file, marker, at, cause, kind) =>
    isFailed(linkAt(bad, file, marker, at, kind), one(cause), marker);
  // Reviewer 1 and the Opus heritage/merge cases.
  for (const [marker, at] of [
    ["// derived", "m"],
    ["// merged-interface", "m"],
    ["// k-merge", "m"],
    ["// intersection", "m"],
    ["// pick", "m"],
    ["// variable", "m"],
    ["// return-type", "m"],
    ["// inferred-return", "m"],
    ["// generic", "m"],
    ["// via-interface", "m"],
    ["// chain", "m"],
    ["// default", "m"],
    ["// namespace", "inner"],
  ])
    failedAt("use.ts", marker, at, "bad.ts");
  failedAt("use2.ts", "// 2a", "m", "bad2.ts");
  failedAt("use.cts", "// 2b", "x", "bad.cts");
  failedAt("usec.cjs", "// 2c", "x", "badc.cjs");
  failedAt("barrel3.ts", "// 3", "x3", "bad3.ts", "exports");
  failedAt("barrel3.ts", "// 3t", "T3", "bad3.ts", "exports");
  failedAt("usej.ts", "// job-state", "getState", "job.ts");
  failedAt("usej.ts", "// dynamic", "helper", "job.ts");
  failedAt("useeq.ts", "// eq", "x", "broken.js");
  failedAt("use.ts", "// global-namespace", "a", "gns.ts");
  failedAt("use.ts", "// declare-global", "globalThing", "dg.ts");
  failedAt("comp.tsx", "// jsx", "Widget", "bad.ts");
  // Own members of a tainted class stay resolved, flagged; so does a control.
  isResolved(linkAt(bad, "use.ts", "// own", "own"), "use.ts#Own.own", "own");
  isResolved(
    linkAt(bad, "use.ts", "// impl-own", "own2"),
    "use.ts#Impl.own2",
    "impl-own",
  );
  // A binding of a valid declaration whose value depends on a failed file
  // names that declaration correctly: resolved, flagged.
  isResolved(
    linkAt(bad, "use.ts", 'import dflt from "./d"', "dflt", "imports"),
    "d.ts#default",
    "default-export binding",
  );
  const control = linkAt(bad, "use.ts", "// control", "c");
  isResolved(control, "use.ts#Clean.c", "control");
  assert.ok(control.assumes.includes("no-unseen-declarations"));
});

test("TypeScript-only syntax in a JS file is a syntax error: the file fails", async () => {
  await project(
    {
      "tsonly.js":
        "export enum E { A = 1 }\nexport interface I { m(): void }\nexport function f(x: number) { return x as number; }\n",
      "use.js": 'import { f } from "./tsonly.js";\nf(1); // f\n',
    },
    async (graph, report) => {
      assert.ok(report.failed.includes("tsonly.js"));
      assert.deepEqual(graph.store.findSymbols({ file: "tsonly.js" }), []);
      failedLink(
        callOn(graph, "use.js", "// f", "f"),
        { file: "tsonly.js" },
        "f",
      );
    },
  );
});

test("the first syntax error's position is tsc's: a byte-order mark is not a column", async () => {
  await project({ "bom.ts": "﻿let a = ;\n" }, async (graph, report) => {
    assert.ok(report.failed.includes("bom.ts"));
    assert.match(
      graph.store.getFile("bom.ts").result.diagnostics[0].message,
      /^Syntax error at line 1, column 9: Expression expected\./,
    );
  });
});

test("tied configs: a variant that failed makes the merged link failed with the union of causes", async () => {
  const config = (target) =>
    `{ "files": ["use.ts"], "compilerOptions": { "baseUrl": ".", "paths": { "@provider": ["./${target}"] } } }\n`;
  for (const [a, b] of [
    ["ok.ts", "broken.ts"],
    ["broken.ts", "ok.ts"],
  ])
    await project(
      {
        "ok.ts": "export function value() {}\n",
        "broken.ts": "export function value() {}\nconst x = (;\n",
        "use.ts": 'import { value } from "@provider";\nvalue(); // v\n',
        "tsconfig.a.json": config(a),
        "tsconfig.b.json": config(b),
      },
      async (graph) => {
        failedLink(
          callOn(graph, "use.ts", "// v", "value"),
          { file: "broken.ts" },
          `${a}, ${b}`,
        );
      },
    );
});

test("a failed file is served to programs as absent, not as empty text", async () => {
  const ts = (await import("typescript")).default;
  const { projectModel } = await import(
    "../dist/graph/languages/typescript/project.js"
  );
  const files = [
    { path: "bad.ts", text: "export const a = (;\n" },
    { path: "use.ts", text: 'import { a } from "./bad";\n' },
  ];
  const model = projectModel(files, []);
  const group = model.groups.find((g) => g.roots.length);
  const host = model.host(group);
  const program = ts.createProgram({
    rootNames: group.roots,
    options: group.options,
    host,
  });
  assert.ok(model.syntaxFailures.has("bad.ts"));
  assert.equal(
    host.getSourceFile("/bad.ts", ts.ScriptTarget.Latest),
    undefined,
  );
  assert.equal(program.getSourceFile("/bad.ts"), undefined);
  assert.ok(model.requested(host).has("bad.ts"));
  // The file still exists for module resolution: an import of it is an
  // import of a broken file, not of a missing one.
  assert.ok(host.fileExists("/bad.ts"));
});

test("each dependency kind carries the failure (the member's name is not in the failed file)", async () => {
  const files = {
    "local.ts":
      "export interface Local { q(): void }\nexport class LocalC { q() {} }\n",
    "fx.ts": [
      'import { Local, LocalC } from "./local";',
      "export interface X extends Local {}",
      "export class C extends LocalC {}",
      "",
    ].join("\n"),
    "dflt.ts": 'import { C } from "./fx";\nexport default new C();\n',
    "eqv.ts": 'import { C } from "./fx";\nconst v = new C();\nexport = v;\n',
    "eqx.ts": 'import { C } from "./fx";\nexport = new C();\n',
    "usek.ts": [
      'import { X, C } from "./fx";',
      'import d from "./dflt";',
      'import eqv = require("./eqv");',
      'import eqx = require("./eqx");',
      "declare const a: X;",
      "a.q(); // annotation",
      "type AY = X;",
      "declare const ay: AY;",
      "ay.q(); // alias-body",
      "interface H extends X {}",
      "declare const h: H;",
      "h.q(); // heritage",
      "const ini = new C();",
      "ini.q(); // initializer",
      "function rt(): C { return null as any; }",
      "rt().q(); // return-type",
      "function ir() { return new C(); }",
      "ir().q(); // inferred-return",
      "eqv.q(); // export-equals",
      "eqx.q(); // expression-export",
      "d.q(); // default-export",
      "function first<T extends C>(v: T): T { return v; }",
      "first(null as any).q(); // constraint",
      "",
    ].join("\n"),
  };
  const { problems, bad } = await differential(files, {
    "fx.ts": files["fx.ts"] + "const bad = (;\n",
  });
  assert.deepEqual(problems, []);
  for (const marker of [
    "annotation",
    "alias-body",
    "heritage",
    "initializer",
    "return-type",
    "inferred-return",
    "export-equals",
    "expression-export",
    "default-export",
    "constraint",
  ])
    isFailed(
      linkAt(bad, "usek.ts", `// ${marker}`, "q"),
      { file: "fx.ts" },
      marker,
    );
});

test("a call's result carries the failure of its arguments' types", async () => {
  const gen = "export class Job<A, B, C> { a!: A; }\n";
  const files = {
    "gen.ts": gen,
    "use.ts": [
      'import { Job } from "./gen";',
      "declare const arr: Promise<Job<any, any, string>>[];",
      "export async function all() {",
      "  const [last] = (await Promise.all(arr)).splice(-1); // args",
      "}",
      "",
    ].join("\n"),
  };
  const { problems, bad } = await differential(files, {
    "gen.ts": gen + "const bad = (;\n",
  });
  assert.deepEqual(problems, []);
  isFailed(
    linkAt(bad, "use.ts", "// args", "splice"),
    { file: "gen.ts" },
    "splice",
  );
});

test("arguments decide only overloads and generic results: a correct link is not thrown away", async () => {
  const bad = "export class Base { m() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Base } from "./bad";',
      "class Local { lm() {} }",
      "class Q { add(x: Base): number { return 1; } }",
      "declare const q: Q;",
      "declare const b: Base;",
      "q.add(b); // single-signature",
      "interface O { f(x: Base): void; }",
      "interface O { f(x: string): void; }",
      "declare const o: O;",
      "o.f(b); // overloaded",
      "function gen<T>(v: T): T { return v; }",
      "gen(b).toString(); // generic-result",
      "function plain(x: Base): Local { return new Local(); }",
      "plain(b).lm(); // plain-result",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  // Rule 1: one declaration decides the call whatever its arguments.
  const single = linkAt(broken, "use.ts", "// single-signature", "add");
  isResolved(single, "use.ts#Q.add", "single signature");
  assert.ok(single.assumes.includes("no-unseen-declarations"));
  // Rule 1: distinct overload targets are picked by the arguments.
  const overloaded = linkAt(broken, "use.ts", "// overloaded", "f");
  isFailed(overloaded, { file: "bad.ts" }, "overloaded");
  assert.match(overloaded.cause.via, /^argument b of overloaded o\.f$/);
  // Rule 2: a generic callee's result carries its argument's failure.
  isFailed(
    linkAt(broken, "use.ts", "// generic-result", "toString"),
    { file: "bad.ts" },
    "generic result",
  );
  // Rule 2: a non-generic single signature's result does not.
  isResolved(
    linkAt(broken, "use.ts", "// plain-result", "lm"),
    "use.ts#Local.lm",
    "plain result",
  );
});

test("type arguments of a class or interface keep its members; a type alias's arguments decide them", async () => {
  const bad =
    "export class Base { m() {} }\nexport interface BaseI { m(): void }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Base, BaseI } from "./bad";',
      "class Holder<T> { x() {} item!: T; }",
      "declare const h: Holder<Base>;",
      "h.x(); // class-argument",
      "h.item.m(); // member-typed-by-argument",
      "declare const list: Base[];",
      "list[0].m(); // element",
      'declare const p: Pick<BaseI, "m">;',
      "p.m(); // alias-argument",
      "declare const v: unknown;",
      "(v as Base).m(); // assertion",
      "class Local { lm() {} }",
      "declare const q: Holder<Base>;",
      "(q as any as Local).lm(); // assertion-any",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  // Members of a class do not depend on its type arguments.
  isResolved(
    linkAt(broken, "use.ts", "// class-argument", "x"),
    "use.ts#Holder.x",
    "class argument",
  );
  // A member typed by the argument, an element, a type alias's argument
  // and an asserted type do.
  for (const [marker, at] of [
    ["// member-typed-by-argument", "m"],
    ["// element", "m"],
    ["// alias-argument", "m"],
    ["// assertion", "m"],
  ])
    isFailed(linkAt(broken, "use.ts", marker, at), { file: "bad.ts" }, marker);
  // An assertion replaces the expression's type: no dependence remains.
  isResolved(
    linkAt(broken, "use.ts", "// assertion-any", "lm"),
    "use.ts#Local.lm",
    "asserted type",
  );
});

test("each route the failure travels, and each that keeps a correct answer", async () => {
  const job = [
    "export class Job { getState() {} }",
    "export function makeJob(): Job { return new Job(); }",
    "",
  ].join("\n");
  const files = {
    "job.ts": job,
    "use.ts": [
      'import { Job } from "./job";',
      'import type { Missing } from "uncaptured-package";',
      "class LocalBase { lm() {} }",
      "class Sub extends LocalBase {}",
      // Routes that carry the failure.
      "declare const jobs: Job[];",
      "jobs.map((j) => j.getState()); // contextual-receiver",
      "interface Events { done: (job: Job) => void }",
      "declare function on<K extends keyof Events>(k: K, l: Events[K]): void;",
      'on("done", (job) => job.getState()); // contextual-type',
      "for (const j of jobs) j.getState(); // for-of",
      "interface Tree { job: Job }",
      "declare const tree: Tree;",
      "const { job } = tree;",
      "job.getState(); // destructured",
      "class Maker<T> { make(): Job { return null as any; } t!: T; }",
      "declare const maker: Maker<number>;",
      "const made = maker.make();",
      "made.getState(); // instantiated",
      // Routes that keep a correct answer (inherited members: strong taint
      // would fail them).
      "class Holder<T> extends LocalBase { item!: T; }",
      "declare const holder: Holder<Job>;",
      "holder.lm(); // class-type-argument",
      "declare const factory: { new (p: (j: Job) => void): Sub };",
      "const built = new factory(() => {});",
      "built.lm(); // signature-parameter",
      "function plain(x: Job): Sub { return new Sub(); }",
      "declare const aJob: Job;",
      "plain(aJob).lm(); // plain-result",
      "const stored = plain(aJob);",
      "stored.lm(); // stored-plain",
      "const asserted = aJob as unknown as Sub;",
      "asserted.lm(); // assertion-stored",
      "class Q2<T> { client!: Missing; t!: T; }",
      "declare const q2: Q2<Job>;",
      "const client = q2.client;",
      "client.scard(); // member-object",
      "q2.client.scard(); // direct-member-object",
      "function plainMissing(x: Job): Missing { return null as any; }",
      "const fromPlain = plainMissing(aJob);",
      "fromPlain.scard(); // plain-missing",
      "",
    ].join("\n"),
  };
  const { problems, bad } = await differential(files, {
    "job.ts": job + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  for (const marker of [
    "contextual-receiver",
    "contextual-type",
    "for-of",
    "destructured",
    "instantiated",
  ])
    isFailed(
      linkAt(bad, "use.ts", `// ${marker}`, "getState"),
      { file: "job.ts" },
      marker,
    );
  for (const marker of [
    "class-type-argument",
    "signature-parameter",
    "plain-result",
    "stored-plain",
    "assertion-stored",
  ])
    isResolved(
      linkAt(bad, "use.ts", `// ${marker}`, "lm"),
      "use.ts#LocalBase.lm",
      marker,
    );
  // Unresolved for a reason that has nothing to do with job.ts (an
  // uncaptured package): no cause.
  for (const marker of [
    "member-object",
    "direct-member-object",
    "plain-missing",
  ]) {
    const link = linkAt(bad, "use.ts", `// ${marker}`, "scard");
    assert.notEqual(link.reason, "invalid-code", marker);
    assert.equal(link.cause, undefined, marker);
  }
});

// ----- Round 14: the structural rule -----

const keeps = (link, what) => {
  assert.notEqual(
    link.reason,
    "invalid-code",
    `${what}: kept (failed via ${link.cause?.via})`,
  );
  assert.equal(link.cause, undefined, `${what}: no cause`);
};

test("the structural rule: the receiver's type decides, in both directions", async () => {
  const bad = [
    "export class Failed { m() {} kind!: string; }",
    'export interface FailedI { m(): void; kind: "failed" }',
    "export function failedFn(): Failed { return new Failed(); }",
    "",
  ].join("\n");
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Failed, FailedI, failedFn } from "./bad";',
      "class A { m() {} }",
      "class B { m() {} }",
      "class LocalBase { lm() {} }",
      // Sol 1: a type-level computation over a tainted argument.
      'class Box<T> { value!: keyof T extends "kind" ? A : B; plain!: T; many!: T[]; count!: number; }',
      "declare let bx: Box<FailedI>;",
      "bx.value.m(); // computed",
      "bx.plain.m(); // member-T",
      "bx.many.map((x) => x); // member-array",
      "bx.many[0].m(); // member-array-element",
      "bx.count.toFixed(); // member-number",
      "declare const map: Map<string, Failed>;",
      'map.get("k")!.m(); // map-get',
      'map.has("k"); // map-has',
      "declare const promise: Promise<Failed>;",
      "promise.then((v) => v.m()); // promise-then",
      "function make(): (j: Failed) => void { return () => {}; }",
      "make().call(null, null as any); // returned-function",
      'declare const pk: Pick<FailedI, "m">;',
      "pk.m(); // pick",
      "declare const rt: ReturnType<typeof failedFn>;",
      "rt.m(); // return-type-of",
      "declare const un: A | Failed;",
      "un.m(); // union",
      // Sol 4: library members keep their answers.
      "function factory<T>(x: T): T[] { return [x]; }",
      "declare let fb: Failed;",
      "factory(fb).map((x) => x); // factory-map",
      "function sandbox() { return function process(job: Failed): void {}; }",
      "sandbox().bind(null); // sandbox-bind",
      "export async function all() {",
      "  (await Promise.all([new Failed()])).map((x) => x); // promise-all",
      "}",
      // Opus 6: a returned closure's body is not its type.
      "export const make2 = () => () => { new Failed(); return 1; };",
      "make2().call(null); // closure-body",
      // Opus 1: overloads and computing generics with a weakly tainted argument.
      "interface PA { method(): number }",
      "interface PB { method(): string }",
      "declare const cb: (j: Failed) => void;",
      "declare function pick2(x: (j: number) => void): PB;",
      "declare function pick2(x: (j: Failed) => void): PA;",
      "pick2(cb).method(); // overload",
      "type Sel<T> = T extends (j: number) => void ? PB : PA;",
      "declare function sel<T>(x: T): Sel<T>;",
      "sel(cb).method(); // generic-computation",
      // Overloads that all give one untainted class: its member set decides,
      // until the result is awaited or read from (its type arguments then
      // depend on the overload chosen).
      "class Wk {",
      "  constructor(n: string, p: (j: Failed) => void);",
      "  constructor(n: string);",
      "  constructor(n: string, p?: (j: Failed) => void) {}",
      "  on() {}",
      "  getF(): Failed { return null as any; }",
      "}",
      'const wk = new Wk("q", (j) => {});',
      "wk.on(); // ctor-overload",
      "declare function boxed(x: (j: number) => void): Promise<A>;",
      "declare function boxed(x: (j: Failed) => void): Promise<B>;",
      "boxed(cb).then(() => {}); // same-class-overload",
      "export async function awaited() {",
      "  (await boxed(cb)).m(); // awaited-overload",
      "}",
      // A computation's inputs decide, not the receiver's route.
      "declare const itc: InstanceType<typeof Wk>;",
      "itc.on(); // instance-type-clean",
      "itc.getF().m(); // instance-type-member",
      "declare const itf: InstanceType<typeof Failed>;",
      "itf.m(); // instance-type-failed",
      "declare const cw: Required<{ k(): void }> & { p: Promise<Failed> };",
      "cw.k(); // computation-clean-input",
      "declare const mw: Map<Partial<A>, Failed>;",
      "mw.forEach(() => {}); // computation-beside-taint",
      // An own member stands even when the failed file has that name.
      "class D2 extends Failed { m() {} }",
      "new D2().m(); // own-member-named-in-failed",
      // A function type with a failed parameter is a tainted input of a
      // computation over it (iii): accepted over-fail.
      "type Proc = (j: Failed) => string;",
      "declare const pr: ReturnType<Proc>;",
      "pr.trim(); // return-of-function-type",
      "declare const pp: Parameters<Proc>;",
      "pp[0].m(); // parameter-of-function-type",
      // A closure's body is not its type: it returns `any`, untainted.
      'const mk = () => { new Failed(); return JSON.parse("1"); };',
      "mk().foo(); // closure-any",
      // Sol 3: a long chain reaches its fixpoint.
      ...Array.from(
        { length: 90 },
        (_, i) => `const x${89 - i} = ${i === 89 ? "Failed" : `x${88 - i}`};`,
      ),
      "new x89().m(); // long-chain",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  const failedOn = [
    ["computed", "m"],
    ["member-T", "m"],
    ["member-array-element", "m"],
    ["map-get", "m"],
    ["promise-then", "m"],
    ["pick", "m"],
    ["return-type-of", "m"],
    ["union", "m"],
    ["promise-all", "map"],
    ["overload", "method"],
    ["generic-computation", "method"],
    ["awaited-overload", "m"],
    ["instance-type-failed", "m"],
    ["parameter-of-function-type", "m"],
    ["instance-type-member", "m"],
    ["return-of-function-type", "trim"],
    ["long-chain", "m"],
  ];
  for (const [marker, at] of failedOn)
    isFailed(
      linkAt(broken, "use.ts", `// ${marker}`, at),
      { file: "bad.ts" },
      marker,
    );
  for (const [marker, at] of [
    ["member-array", "map"],
    ["member-number", "toFixed"],
    ["map-has", "has"],
    ["promise-then", "then"],
    ["returned-function", "call"],
    ["factory-map", "map"],
    ["sandbox-bind", "bind"],
    ["closure-body", "call"],
    ["ctor-overload", "on"],
    ["same-class-overload", "then"],
    ["instance-type-clean", "on"],
    ["computation-clean-input", "k"],
    ["computation-beside-taint", "forEach"],
    ["own-member-named-in-failed", "m"],
    ["closure-any", "foo"],
  ])
    keeps(linkAt(broken, "use.ts", `// ${marker}`, at), marker);
});

test("failed scripts, declare global, import types and reference paths carry the failure", async () => {
  const script =
    "namespace N { export class C { m() {} } export function a() {} }\n";
  const global =
    "export {};\ndeclare global { interface Thing { m(): void } interface Window { fromBad(): void } }\n";
  const helper = "export function helper() {}\nexport function helperX() {}\n";
  const files = {
    "tsconfig.json": '{ "compilerOptions": { "lib": ["es2020", "dom"] } }\n',
    "ns.ts": script,
    "dg.ts": global,
    "mod.ts": helper,
    "ref.ts": "declare function refd(): void;\n",
    "use.ts": [
      "declare let n: N.C;",
      "n.m(); // ns-member",
      "N.a(); // ns-function",
      "declare const th: Thing;",
      "th.m(); // global-interface",
      'import "./dg";',
      "window.fromBad(); // global-merge",
      'type TI = typeof import("./mod");',
      "declare const ti: TI;",
      "ti.helper(); // import-type",
      "",
    ].join("\n"),
    "use-module.ts":
      "export {};\ndeclare let n3: N.C;\nn3.m(); // module-consumer\n",
    "use-bare.ts": 'import "./mod";\nhelperX(); // module-name\n',
    "use-ref.ts": '/// <reference path="./ref.ts" />\nrefd(); // ref-call\n',
  };
  const broken = {
    "ns.ts": script + "const x = (;\n",
    "dg.ts": global + "const x = (;\n",
    "mod.ts": helper + "const x = (;\n",
    "ref.ts": "declare function refd(): void;\nconst x = (;\n",
  };
  const { problems, bad } = await differential(files, broken);
  assert.deepEqual(problems, []);
  isFailed(
    linkAt(bad, "use.ts", "// ns-member", "m"),
    { file: "ns.ts" },
    "ns member",
  );
  isFailed(
    linkAt(bad, "use.ts", "// ns-function", "a"),
    { file: "ns.ts" },
    "ns function",
  );
  isFailed(
    linkAt(bad, "use-module.ts", "// module-consumer", "m"),
    { file: "ns.ts" },
    "module consumer",
  );
  isFailed(
    linkAt(bad, "use.ts", "// global-interface", "m"),
    { file: "dg.ts" },
    "declare global",
  );
  isFailed(
    linkAt(bad, "use.ts", "// global-merge", "fromBad"),
    { file: "dg.ts" },
    "global merge",
  );
  isFailed(
    linkAt(bad, "use.ts", "// import-type", "helper"),
    { file: "mod.ts" },
    "import type",
  );
  // A failed module's own top-level names are not globals: no cause.
  keeps(linkAt(bad, "use-bare.ts", "// module-name", "helperX"), "module name");
  // A reference path to a failed file is broken, not missing.
  const reference = [...bad.links.values()].find(
    (l) => l.file === "use-ref.ts" && l.kind === "imports",
  );
  assert.equal(reference.reason, "invalid-code");
  assert.equal(reference.cause.file, "ref.ts");
});

test("through a member set that reaches a failed file, only members declared in the receiver's own declarations stand (O1)", async () => {
  const bad =
    "export class Base { m() {} }\nexport interface BaseI { m(): void }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Base, BaseI } from "./bad";',
      "class A { m() {} }",
      "class Other { own() {} m() {} child(): A { return new A(); } }",
      "interface Derived extends Other {}",
      "class Derived extends Base { mine() {} }",
      "new Derived().own(); // derived-own",
      "new Derived().m(); // derived-m",
      "new Derived().mine(); // derived-mine",
      "new Derived().child().m(); // through-inherited",
      "interface Merged { merged(): void }",
      "class Merged extends Base {}",
      "declare const mg: Merged;",
      "mg.merged(); // merged-own",
      "interface I extends BaseI, Other { declared(): void }",
      "declare const i: I;",
      "i.own(); // interface-own",
      "i.m(); // interface-m",
      "i.declared(); // interface-declared",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  // Inherited through any base, failed or valid: fails (accepted over-fail
  // for `own`, which only the valid `Other` declares).
  for (const [marker, at] of [
    ["derived-own", "own"],
    ["interface-own", "own"],
    ["derived-m", "m"],
    ["interface-m", "m"],
    // The chain continues past an inherited member: it fails too.
    ["through-inherited", "m"],
  ])
    isFailed(
      linkAt(broken, "use.ts", `// ${marker}`, at),
      { file: "bad.ts" },
      marker,
    );
  // Declared directly in the class body or a merged declaration's body.
  isResolved(
    linkAt(broken, "use.ts", "// derived-mine", "mine"),
    "use.ts#Derived.mine",
    "derived-mine",
  );
  isResolved(
    linkAt(broken, "use.ts", "// merged-own", "merged"),
    "use.ts#Merged.merged",
    "merged-own",
  );
  isResolved(
    linkAt(broken, "use.ts", "// interface-declared", "declared"),
    "use.ts#I.declared",
    "interface-declared",
  );
});

test("a failed base also has the members it inherits and computes: no token test (O1)", async () => {
  const bad = [
    'import { Root, Src } from "./root";',
    "export class Base extends Root {}",
    "export interface BaseI extends Readonly<Src> {}",
    "",
  ].join("\n");
  const files = {
    "root.ts":
      "export class Root { m() {} }\nexport interface Src { r(): void }\n",
    "bad.ts": bad,
    "use.ts": [
      'import { Base, BaseI } from "./bad";',
      "export class Other { m() {} r() {} }",
      "class Derived extends Base {}",
      "interface Derived extends Other {}",
      "new Derived().m(); // root-member",
      "interface DI extends BaseI, Other {}",
      "declare const di: DI;",
      "di.r(); // computed-member",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  isFailed(
    linkAt(broken, "use.ts", "// root-member", "m"),
    { file: "bad.ts" },
    "root-member",
  );
  isFailed(
    linkAt(broken, "use.ts", "// computed-member", "r"),
    { file: "bad.ts" },
    "computed-member",
  );
});

test("JSDoc import types in JS files carry the failure", async () => {
  const bad = "export class Failed { m() {} }\n";
  const files = {
    "tsconfig.json":
      '{ "compilerOptions": { "allowJs": true, "checkJs": false } }\n',
    "bad.ts": bad,
    "use.js": [
      '/** @type {import("./bad").Failed} */',
      "let jf;",
      "jf.m(); // jsdoc-at-type",
      '/** @typedef {import("./bad").Failed} F */',
      "/** @type {F} */",
      "let jt;",
      "jt.m(); // jsdoc-typedef",
      '/** @returns {import("./bad").Failed} */',
      "function mk() { return undefined; }",
      "mk().m(); // jsdoc-returns",
      "",
    ].join("\n"),
  };
  const { problems, bad: broken } = await differential(files, {
    "bad.ts": bad + "const x = (;\n",
  });
  assert.deepEqual(problems, []);
  for (const marker of ["jsdoc-at-type", "jsdoc-typedef", "jsdoc-returns"])
    isFailed(
      linkAt(broken, "use.js", `// ${marker}`, "m"),
      { file: "bad.ts" },
      marker,
    );
});

/** Indexes clean and broken, checks the differential, and returns the broken index. */
async function brokenOf(files, broken) {
  const { problems, bad } = await differential(files, broken);
  assert.deepEqual(problems, []);
  return bad;
}
const failsWith = (link, cause, via, what) => {
  isFailed(link, cause, what);
  if (via)
    assert.ok(link.cause.via.includes(via), `${what}: via ${link.cause.via}`);
};

test("default-deny: the four reproductions of round 13 (Sol)", async () => {
  const bad = 'export interface Failed { kind: "yes" }\n';
  const aliases = Array.from(
    { length: 12 },
    (_, i) => `type C${i + 1}<T> = C${i}<T>;`,
  );
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Failed } from "./bad";',
      "class A { m() {} }",
      "class B { m() {} }",
      // 1. Element access with a literal key, and an index signature.
      'class Box<T> { value!: keyof T extends "kind" ? A : B; self(): this { return this; } }',
      "declare let b: Box<Failed>;",
      'b["value"].m(); // element-literal',
      'class IBox<T> { [key: string]: keyof T extends "kind" ? A : B; }',
      "declare let ib: IBox<Failed>;",
      'ib["anything"].m(); // index-signature',
      // 2. A method returning `this` keeps the receiver's type arguments.
      "b.self().value.m(); // this-method",
      // 3. No depth limit on alias expansion.
      'type C0<T> = keyof T extends "kind" ? A : B;',
      ...aliases,
      "class Deep<T> { value!: C12<T>; }",
      "declare let deep: Deep<Failed>;",
      "deep.value.m(); // alias-chain",
      // 4. A type parameter is tainted only if its argument is.
      "class Two<T, U> { value!: T extends string ? A : B; u!: U; }",
      "declare let two: Two<string, Failed>;",
      "two.value.m(); // untainted-parameter",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  for (const marker of [
    "element-literal",
    "index-signature",
    "this-method",
    "alias-chain",
  ])
    isFailed(
      linkAt(broken, "use.ts", `// ${marker}`, "m"),
      { file: "bad.ts" },
      marker,
    );
  isResolved(
    linkAt(broken, "use.ts", "// untainted-parameter", "m"),
    "use.ts#A.m",
    "untainted-parameter",
  );
});

test("O2: an overload whose parameter type depends on a failed file is not chosen, whatever the arguments", async () => {
  const bad = "export class Job { x() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Job } from "./bad";',
      "export class A { m() {} }",
      "export class B { m() {} }",
      "declare function k(x: Job): A;",
      "declare function k(x: number): B;",
      "declare let n: number;",
      "k(n).m(); // direct",
      "const r = k(n);",
      "r.m(); // variable",
      "class W<T> { val!: T; }",
      "declare function f(x: Job): W<A>;",
      "declare function f(x: number): W<B>;",
      "f(n).val.m(); // member-of-result",
      "class S { pick(x: Job): A; pick(x: number): B; pick(x: unknown): A | B { return null as any; } }",
      "new S().pick(n).m(); // method",
      // Routes: destructuring, assignment, conditional, comma, ??, ||,
      // a wrapper, element access, a callback parameter.
      "const { val: dv } = f(n);",
      "dv.m(); // destructuring",
      "let as2: A | B = new A();",
      "(as2 = k(n)).m(); // assignment",
      "declare const flag: boolean;",
      "(flag ? k(n) : k(n)).m(); // conditional",
      "(0, k(n)).m(); // comma",
      "(k(n) ?? k(n)).m(); // nullish",
      "(k(n) || k(n)).m(); // or",
      "function wrap() { return k(n); }",
      "wrap().m(); // wrapper",
      "[k(n)][0].m(); // element",
      "[k(n)].forEach((x) => x.m()); // callback",
      // One signature: nothing to choose.
      "declare function one(x: Job): A;",
      "one(n).m(); // single-signature",
      // R-1: every overload returns the same class: its member set decides.
      "declare function same(x: Job): A;",
      "declare function same(x: number): A;",
      "same(n).m(); // same-class",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  for (const marker of [
    "direct",
    "variable",
    "member-of-result",
    "method",
    "destructuring",
    "assignment",
    "conditional",
    "comma",
    "nullish",
    "or",
    "wrapper",
    "element",
    "callback",
  ])
    failsWith(
      linkAt(broken, "use.ts", `// ${marker}`, "m"),
      { file: "bad.ts" },
      "parameter types depend on the failed file",
      marker,
    );
  isResolved(
    linkAt(broken, "use.ts", "// single-signature", "m"),
    "use.ts#A.m",
    "single-signature",
  );
  isResolved(
    linkAt(broken, "use.ts", "// same-class", "m"),
    "use.ts#A.m",
    "same-class",
  );
});

test("R-1 does not need the shared class to be untainted: its member set rule decides (M6)", async () => {
  const bad = "export class Job { x() {} inherited() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Job } from "./bad";',
      "export class TD extends Job { own() {} }",
      "declare function same(x: Job): TD;",
      "declare function same(x: number): TD;",
      "declare let n: number;",
      "same(n).own(); // own-member",
      "same(n).inherited(); // inherited-member",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  isResolved(
    linkAt(broken, "use.ts", "// own-member", "own"),
    "use.ts#TD.own",
    "own-member",
  );
  isFailed(
    linkAt(broken, "use.ts", "// inherited-member", "inherited"),
    { file: "bad.ts" },
    "inherited-member",
  );
});

test("O3: `this` denotes the receiver with its type arguments, along every route", async () => {
  const bad = "export class Failed { m() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Failed } from "./bad";',
      "class TT<T> { self(): this { return this; } v!: T; }",
      "declare let t: TT<Failed>;",
      "t.v.m(); // control",
      "t.self().v.m(); // self",
      "const s = t.self();",
      "s.v.m(); // variable",
      "const { v: dv } = t.self();",
      "dv.m(); // destructuring",
      "declare const flag: boolean;",
      "(flag ? t.self() : t).v.m(); // conditional",
      "(0, t.self()).v.m(); // comma",
      "(t.self() ?? t).v.m(); // nullish",
      "function wrap() { return t.self(); }",
      "wrap().v.m(); // wrapper",
      "[t.self()][0].v.m(); // element",
      "[t.self()].forEach((x) => x.v.m()); // callback",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  for (const marker of [
    "control",
    "self",
    "variable",
    "destructuring",
    "conditional",
    "comma",
    "nullish",
    "wrapper",
    "element",
    "callback",
  ])
    isFailed(
      linkAt(broken, "use.ts", `// ${marker}`, "m"),
      { file: "bad.ts" },
      marker,
    );
});

test("default-deny: each explicit case, in both directions", async () => {
  const bad = "export class Failed { m() {} }\n";
  const files = {
    "bad.ts": bad,
    "ok.ts": "export class Fine { m() {} }\n",
    "use.ts": [
      'import { Failed } from "./bad";',
      "class A { m() {} n!: number; }",
      "class Box<T> { t!: T; a!: A; count!: number; self(): this { return this; } get gt(): T { return null as any; } get ga(): A { return new A(); } }",
      "declare const bf: Box<Failed>;",
      "declare const flag: boolean;",
      // Expressions.
      "const idT = bf.t;",
      "idT.m(); // e-identifier-fail",
      "const idA = bf.a;",
      "idA.m(); // e-identifier-keep",
      "class HF { f!: Failed; a!: A; run() {",
      "  this.f.m(); // e-this-fail",
      "  this.a.m(); // e-this-keep",
      "} }",
      "class SubB extends Box<Failed> { run() {",
      "  super.self().t.m(); // e-super-fail",
      "  super.self().a.m(); // e-super-keep",
      "} }",
      'bf["t"].m(); // e-element-fail',
      'bf["a"].m(); // e-element-keep',
      'declare const key: "t" | "a";',
      "bf[key].m(); // e-element-computed",
      "new Box<Failed>().t.m(); // e-new-fail",
      "new Box<Failed>().a.m(); // e-new-keep",
      "declare function tag(s: TemplateStringsArray): Box<Failed>;",
      "tag`x`.t.m(); // e-tagged-fail",
      "tag`x`.a.m(); // e-tagged-keep",
      "declare const pbf: Promise<Box<Failed>>;",
      "export async function aw() {",
      "  (await pbf).t.m(); // e-await-fail",
      "  (await pbf).a.m(); // e-await-keep",
      "}",
      "declare const u: unknown;",
      "(u as Box<Failed>).t.m(); // e-as-fail",
      "(bf as unknown as Box<A>).t.m(); // e-as-keep",
      "(<Box<Failed>>u).t.m(); // e-assertion-fail",
      "(bf satisfies object).t.m(); // e-satisfies-fail",
      "(bf satisfies object).a.m(); // e-satisfies-keep",
      "(flag ? bf : bf).t.m(); // e-conditional-fail",
      "(flag ? bf : bf).a.m(); // e-conditional-keep",
      "(bf || bf).t.m(); // e-binary-fail",
      "(bf || bf).a.m(); // e-binary-keep",
      "(bf.a.n + bf.count).toFixed(); // e-arithmetic-keep",
      "[bf][0].t.m(); // e-array-fail",
      "[bf][0].a.m(); // e-array-keep",
      "({ v: bf }).v.t.m(); // e-object-fail",
      "({ v: bf }).v.a.m(); // e-object-keep",
      "(() => bf)().t.m(); // e-arrow-fail",
      "(() => bf)().a.m(); // e-arrow-keep",
      "(function () { return bf; })().t.m(); // e-function-fail",
      "(function () { return bf; })().a.m(); // e-function-keep",
      "new (class { b = bf; })().b.t.m(); // e-class-fail",
      "new (class { b = bf; })().b.a.m(); // e-class-keep",
      // Types (members of a container over the failed type).
      'class W<T> { arr!: T[]; tup!: [A, T]; named!: [a: A, t: T]; opt!: [A, T?]; rest!: [A, ...T[]]; par!: (T); fn!: (x: T) => A; fnr!: () => T; ctor!: new () => T; lit!: { t: T; a: A }; uni!: T | A; inter!: T & A; ro!: readonly T[]; cond!: T extends object ? A : A; cond2!: string extends string ? A : A; imp!: import("./ok").Fine; }',
      "declare const w: W<Failed>;",
      "w.arr[0].m(); // t-array-fail",
      "w.arr.length.toFixed(); // t-array-keep",
      "w.tup[1].m(); // t-tuple-fail",
      "w.tup[0].m(); // t-tuple-keep",
      "w.named[1].m(); // t-named-fail",
      "w.named[0].m(); // t-named-keep",
      "w.opt[1]!.m(); // t-optional-fail",
      "w.rest[1]!.m(); // t-rest-fail",
      "w.par.m(); // t-paren-fail",
      "w.fn(null!).m(); // t-function-keep",
      "w.fnr().m(); // t-function-fail",
      "new w.ctor().m(); // t-constructor-fail",
      "w.lit.t.m(); // t-literal-fail",
      "w.lit.a.m(); // t-literal-keep",
      "w.uni.m(); // t-union-fail",
      "w.inter.m(); // t-intersection-fail",
      "w.ro[0].m(); // t-readonly-fail",
      "w.ro.length.toFixed(); // t-readonly-keep",
      "w.cond.m(); // t-conditional-fail",
      "w.cond2.m(); // t-conditional-keep",
      "w.imp.m(); // t-import-keep",
      // Declarations.
      "function pf(p: Box<Failed>) {",
      "  p.t.m(); // d-parameter-fail",
      "  p.a.m(); // d-parameter-keep",
      "}",
      "const { t: dt, a: da } = bf;",
      "dt.m(); // d-binding-fail",
      "da.m(); // d-binding-keep",
      "const t = bf;",
      "({ t }).t.t.m(); // d-shorthand-fail",
      "({ t }).t.a.m(); // d-shorthand-keep",
      "interface I<T> { get(): T; a: A }",
      "declare const ii: I<Failed>;",
      "ii.get().m(); // d-method-signature-fail",
      "ii.a.m(); // d-property-signature-keep",
      "bf.gt.m(); // d-getter-fail",
      "bf.ga.m(); // d-getter-keep",
      // Contextual parameters.
      "declare const arrF: Failed[];",
      "arrF.forEach((x) => x.m()); // c-call-fail",
      "class Runner<T> { constructor(run: (x: T) => void, a: (y: A) => void) {} }",
      "new Runner<Failed>((x) => x.m(), (y) => y.m()); // c-new",
      "const cbf: (x: Failed) => void = (x) => x.m(); // c-variable-fail",
      "const cba: (x: A) => void = (x) => x.m(); // c-variable-keep",
      // Elements.
      "declare const setF: Set<Failed>;",
      "for (const s of setF) s.m(); // l-set-fail",
      "declare const mapF: Map<A, Failed>;",
      "for (const [k, v] of mapF) {",
      "  k.m(); // l-map-keep",
      "  v.m(); // l-map-fail",
      "}",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  const lines = files["use.ts"].split("\n");
  const markers = lines.flatMap((line) =>
    [...line.matchAll(/\/\/ ([a-z]-[a-z0-9-]+)/g)].map((m) => m[1]),
  );
  for (const marker of markers) {
    if (marker === "c-new") continue;
    const at =
      marker.startsWith("t-array-keep") || marker.startsWith("t-readonly-keep")
        ? "toFixed"
        : marker === "e-arithmetic-keep"
          ? "toFixed"
          : "m";
    const link = linkAt(broken, "use.ts", marker, at);
    if (marker.endsWith("-fail") || marker === "e-element-computed")
      isFailed(link, { file: "bad.ts" }, marker);
    else keeps(link, marker);
  }
  // A constructor's callback parameters: the first is the failed type.
  const runner = [...broken.links.values()].filter(
    (l) => l.file === "use.ts" && l.line.includes("// c-new") && l.text === "m",
  );
  assert.equal(runner.length, 2);
  isFailed(runner[0], { file: "bad.ts" }, "c-new x");
  keeps(runner[1], "c-new y");
});

test("default-deny: each default branch fails a kind it does not handle", async () => {
  const bad = "export class Failed { m() {} }\n";
  const files = {
    "tsconfig.json":
      '{ "compilerOptions": { "allowJs": true, "checkJs": false, "target": "es2020", "lib": ["es2020"] } }\n',
    "bad.ts": bad,
    "box.ts":
      'import { Failed } from "./bad";\nexport class Box<T> { t!: T; }\nexport declare const bf: Box<Failed>;\n',
    "use.ts": [
      'import { Failed } from "./bad";',
      'import { bf } from "./box";',
      // expression: yield
      "export function* gen() { (yield bf).t.m(); /* default-expression */ }",
      // declaration: a set-only accessor
      "class SA<T> { set w(x: T) {} }",
      "declare const sa: SA<Failed>;",
      "sa.w.m(); // default-declaration",
      // contextual: a callback in an object literal property
      "declare function takes(o: { f: (x: Failed) => void }): void;",
      "takes({ f: (x) => x.m() }); // default-contextual",
      // element: a project iterable
      "class Bag<T> { *[Symbol.iterator](): Iterator<T> { } }",
      "declare const bag: Bag<Failed>;",
      "for (const x of bag) x.m(); // default-element",
      // await: a project thenable
      "class Th<T> { then(r: (v: T) => void) { } }",
      "declare const th: Th<Failed>;",
      "export async function aw() { (await th).m(); /* default-await */ }",
      // call: a generator's result
      "function* g2() { yield bf; }",
      "g2().next(); // default-call",
      "",
    ].join("\n"),
    "use.js": [
      'import { bf } from "./box";',
      "/** @type {?import('./box').Box<import('./bad').Failed>} */",
      "let jn = bf;",
      "jn.t.m(); // default-type",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  const cases = [
    [
      "use.ts",
      "default-expression",
      "m",
      "unhandled expression YieldExpression",
    ],
    ["use.ts", "default-declaration", "m", "unhandled declaration SetAccessor"],
    [
      "use.ts",
      "default-contextual",
      "m",
      "unhandled contextual PropertyAssignment",
    ],
    ["use.ts", "default-element", "m", "unhandled element Bag"],
    ["use.ts", "default-await", "m", "unhandled await Th"],
    ["use.ts", "default-call", "next", "unhandled call a generator"],
    ["use.js", "default-type", "m", "unhandled type JSDocNullableType"],
  ];
  for (const [file, marker, at, via] of cases)
    failsWith(
      linkAt(broken, file, marker, at),
      { file: "bad.ts" },
      via,
      marker,
    );
});

test("default-deny: the handled kinds of each switch are listed", async () => {
  await indexFiles({ "a.ts": "export const a = 1;\n" });
  const { HANDLED } = await import(
    "../dist/graph/languages/typescript/judge.js"
  );
  // Only kinds with an explicit case; everything else is FAILED.
  assert.deepEqual(HANDLED, {
    types: [
      "AnyKeyword",
      "UnknownKeyword",
      "NumberKeyword",
      "BigIntKeyword",
      "BooleanKeyword",
      "StringKeyword",
      "SymbolKeyword",
      "VoidKeyword",
      "UndefinedKeyword",
      "NeverKeyword",
      "ObjectKeyword",
      "IntrinsicKeyword",
      "LiteralType",
      "TypePredicate",
      "ThisType",
      "TypeReference",
      "ExpressionWithTypeArguments",
      "ArrayType",
      "TupleType",
      "NamedTupleMember",
      "OptionalType",
      "RestType",
      "ParenthesizedType",
      "FunctionType",
      "ConstructorType",
      "TypeLiteral",
      "UnionType",
      "IntersectionType",
      "TypeOperator",
      "ConditionalType",
      "MappedType",
      "IndexedAccessType",
      "InferType",
      "TemplateLiteralType",
      "TypeQuery",
      "ImportType",
    ],
    expressions: [
      "Identifier",
      "ThisKeyword",
      "SuperKeyword",
      "QualifiedName",
      "PropertyAccessExpression",
      "ElementAccessExpression",
      "CallExpression",
      "NewExpression",
      "TaggedTemplateExpression",
      "AwaitExpression",
      "ParenthesizedExpression",
      "NonNullExpression",
      "AsExpression",
      "TypeAssertionExpression",
      "SatisfiesExpression",
      "ConditionalExpression",
      "BinaryExpression",
      "ArrayLiteralExpression",
      "ObjectLiteralExpression",
      "FunctionExpression",
      "ArrowFunction",
      "ClassExpression",
      "StringLiteral",
      "NumericLiteral",
      "BigIntLiteral",
      "NoSubstitutionTemplateLiteral",
      "TemplateExpression",
      "RegularExpressionLiteral",
      "TrueKeyword",
      "FalseKeyword",
      "NullKeyword",
      "PrefixUnaryExpression",
      "PostfixUnaryExpression",
      "TypeOfExpression",
      "VoidExpression",
      "DeleteExpression",
      "MetaProperty",
    ],
    declarations: [
      "VariableDeclaration",
      "Parameter",
      "BindingElement",
      "PropertyDeclaration",
      "PropertySignature",
      "PropertyAssignment",
      "ShorthandPropertyAssignment",
      "MethodDeclaration",
      "MethodSignature",
      "FunctionDeclaration",
      "FunctionExpression",
      "ArrowFunction",
      "GetAccessor",
      "IndexSignature",
      "EnumMember",
      "EnumDeclaration",
      "ClassDeclaration",
      "ClassExpression",
      "ModuleDeclaration",
      "SourceFile",
    ],
    contextual: [
      "CallExpression",
      "NewExpression",
      "VariableDeclaration",
      "PropertyDeclaration",
      "ExpressionStatement",
    ],
    element: [
      "failed",
      "clean",
      "union",
      "tuple",
      "checked",
      "object (library iterables)",
    ],
    await: [
      "failed",
      "clean",
      "union",
      "checked",
      "object (library promises, non-thenables)",
      "literal (non-thenable)",
      "other non-thenables",
    ],
    call: [
      "failed",
      "clean",
      "checked",
      "function",
      "static (new of a class)",
      "object (call/construct signatures)",
      "literal (call/construct signatures)",
      "union",
    ],
  });
});

test("O2 at the call link: distinct targets with a failed parameter type fail; a tainted argument does too", async () => {
  const bad = "export class Job { x() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Job } from "./bad";',
      "export class A { m() {} }",
      "export class B { m() {} }",
      "interface I1 { f(x: Job): A }",
      "interface I2 { f(x: number): B }",
      "declare const u12: I1 | I2;",
      "declare let n: number;",
      "u12.f(n as never); // union-targets",
      // Neither signature mentions the failed file: the argument decides.
      "declare function pk3(x: number): A;",
      "declare function pk3(x: unknown): B;",
      "declare const fv: Job;",
      "pk3(fv).m(); // tainted-argument",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  failsWith(
    linkAt(broken, "use.ts", "// union-targets", "f"),
    { file: "bad.ts" },
    "overloaded callee whose parameter types depend on the failed file",
    "union-targets",
  );
  failsWith(
    linkAt(broken, "use.ts", "// tainted-argument", "m"),
    { file: "bad.ts" },
    "with a tainted argument",
    "tainted-argument",
  );
});

test("a member set reaches a failed file through any number of heritage steps (no pass limit)", async () => {
  const bad = "export class Failed { m() {} }\n";
  const chain = Array.from(
    { length: 90 },
    (_, i) => `class H${i + 1} extends H${i} {}`,
  );
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Failed } from "./bad";',
      "class V { v() {} }",
      "class H0 extends Failed {}",
      ...chain,
      "interface H90 extends V {}",
      "new H90().v(); // deep-heritage",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  isFailed(
    linkAt(broken, "use.ts", "// deep-heritage", "v"),
    { file: "bad.ts" },
    "deep-heritage",
  );
});

test("heritage through a name only a failed script declares taints the member set (O1)", async () => {
  const script = "class SC { m() {} }\n";
  const files = {
    "sc.ts": script,
    "use.ts": [
      "export {};",
      "class V { v() {} }",
      "class D extends SC {}",
      "interface D extends V {}",
      "new D().v(); // script-heritage",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "sc.ts": script + "const broken = (;\n",
  });
  isFailed(
    linkAt(broken, "use.ts", "// script-heritage", "v"),
    { file: "sc.ts" },
    "script-heritage",
  );
});

test("operators and computed keys keep only plainly clean operands (B1)", async () => {
  const bad =
    'export interface Failed { kind: "yes"; count: number; big: bigint; big2: bigint; key: "a" }\n';
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import { Failed } from "./bad";',
      "class A { m() {} }",
      "class B { m() {} }",
      "declare const f: Failed;",
      "declare function k(x: bigint): A;",
      "declare function k(x: number): B;",
      "k(-f.big).m(); // b1-negate",
      "k(f.big - f.big2).m(); // b1-subtract",
      "let i = f.big;",
      "k(i++).m(); // b1-postfix",
      "declare function k2(x: number): A;",
      "declare function k2(x: string): B;",
      "k2(f.count + 1).m(); // b1-add",
      "const r = k2(f.count + 1);",
      "r.m(); // b1-variable",
      "declare const obj: { a: A; b: B };",
      "obj[f.key].m(); // b1-key",
      "(f.count + 1).toFixed(); // b1-number",
      // An operand that is a container over the failed type (not failed
      // itself, not plainly clean).
      "class Box<T> { t!: T; }",
      "declare const bx: Box<Failed>;",
      'k2(bx + "").m(); // b1-object-operand',
      // A computed key that is not plainly clean, on objects whose own
      // judgement is clean or the checker's (only the key check fails these).
      "class C2 { a!: A; b!: B; }",
      'declare const p: Pick<C2, "a" | "b">;',
      "p[f.key].m(); // b1-pick-key",
      "declare const s: string;",
      "s[f.count].toUpperCase(); // b1-string-key",
      'declare const rec: Record<"a" | "b", A>;',
      "rec[f.key].m(); // b1-record-key",
      'declare const mapped: { [K in "a" | "b"]: A };',
      "mapped[f.key].m(); // b1-mapped-key",
      // Plainly clean operands and keys keep.
      "declare const n: number;",
      "k2(n + 1).m(); // b1-clean-add",
      'declare const key: "a" | "b";',
      "obj[key].m(); // b1-clean-key",
      "",
    ].join("\n"),
  };
  const broken = await brokenOf(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  for (const [marker, at] of [
    ["b1-negate", "m"],
    ["b1-subtract", "m"],
    ["b1-postfix", "m"],
    ["b1-add", "m"],
    ["b1-variable", "m"],
    ["b1-key", "m"],
    ["b1-number", "toFixed"],
    ["b1-object-operand", "m"],
    ["b1-pick-key", "m"],
    ["b1-string-key", "toUpperCase"],
    ["b1-record-key", "m"],
    ["b1-mapped-key", "m"],
  ])
    isFailed(
      linkAt(broken, "use.ts", `// ${marker}`, at),
      { file: "bad.ts" },
      marker,
    );
  isResolved(
    linkAt(broken, "use.ts", "// b1-clean-add", "m"),
    "use.ts#A.m",
    "b1-clean-add",
  );
  keeps(linkAt(broken, "use.ts", "// b1-clean-key", "m"), "b1-clean-key");
});

// Known limits (the contract for a program with a failed file, W2-D.md):
// a link the module cannot attribute to the failed file is FLAGGED
// `no-unseen-declarations` (unverified: computed without the failed file)
// and may differ from the clean index. Each case pins that it is flagged
// and what it gives today, with the clean index's answer for the record.
const knownLimitFiles = (() => {
  const bad = [
    'export interface Failed { kind: "yes" }',
    "export declare function isF(v: unknown): v is Failed;",
    "export declare function assertF(v: unknown): asserts v is Failed;",
    'export const KIND_A = "a";',
    'export enum Kind { A = "a", B = "b" }',
    "",
  ].join("\n");
  return {
    bad,
    use: [
      'import { Failed, isF, assertF, KIND_A, Kind } from "./bad";',
      'class A { m() {} kind!: "a" }',
      'class B { m() {} kind!: "b" }',
      "class Param { value!: Failed }",
      "function pick(x: Param): A;",
      "function pick(x: { value: number }): B;",
      "function pick(x: unknown): A | B { return new A(); }",
      "pick({ value: 123 }).m(); // kl-structural-overload",
      "type Select<T> = T extends { value: number } ? A : B;",
      "declare let sel: Select<Param>;",
      "sel.m(); // kl-structural-computation",
      "declare const x: A | B;",
      "if (isF(x)) x.m(); // kl-guard-union",
      "declare const y: B;",
      "if (isF(y)) y.m(); // kl-guard-single",
      "declare const z: A | B;",
      "assertF(z); z.m(); // kl-asserts",
      "declare const w1: A | B;",
      "if (w1.kind === KIND_A) w1.m(); // kl-constant",
      "declare const w2: A | B;",
      "if (w2.kind === Kind.A) w2.m(); // kl-enum",
      "declare const w3: A | B;",
      "switch (w3.kind) { case Kind.B: w3.m(); } // kl-switch",
      "",
    ].join("\n"),
  };
})();
let knownLimitIndex;
const knownLimitBroken = () =>
  (knownLimitIndex ??= indexFiles({
    "bad.ts": knownLimitFiles.bad + "const broken = (;\n",
    "use.ts": knownLimitFiles.use,
  }));
for (const [marker, title, today] of [
  [
    "kl-structural-overload",
    "overload selection through a class property's type (clean B.m)",
    { resolution: "resolved", targets: ["use.ts#A.m"] },
  ],
  [
    "kl-structural-computation",
    "a conditional type over a class whose member type is failed (clean B.m)",
    { resolution: "resolved", targets: ["use.ts#A.m"] },
  ],
  [
    "kl-guard-union",
    "narrowing by a type guard declared in the failed file (clean no-symbol)",
    { resolution: "ambiguous", targets: ["use.ts#A.m", "use.ts#B.m"] },
  ],
  [
    "kl-guard-single",
    "a type guard that narrows to never when readable (clean no-symbol)",
    { resolution: "resolved", targets: ["use.ts#B.m"] },
  ],
  [
    "kl-asserts",
    "an assertion function declared in the failed file (clean no-symbol)",
    { resolution: "ambiguous", targets: ["use.ts#A.m", "use.ts#B.m"] },
  ],
  [
    "kl-constant",
    "narrowing by `=== KIND_A`, a constant of the failed file (clean A.m)",
    { resolution: "ambiguous", targets: ["use.ts#A.m", "use.ts#B.m"] },
  ],
  [
    "kl-enum",
    "narrowing by `=== Kind.A`, an enum of the failed file (clean A.m)",
    { resolution: "ambiguous", targets: ["use.ts#A.m", "use.ts#B.m"] },
  ],
  [
    "kl-switch",
    "narrowing by `switch … case Kind.B` (clean B.m)",
    { resolution: "ambiguous", targets: ["use.ts#A.m", "use.ts#B.m"] },
  ],
])
  test(`known limit: ${title}`, async () => {
    const link = linkAt(
      await knownLimitBroken(),
      "use.ts",
      `// ${marker}`,
      "m",
    );
    // The requirement: the link is flagged unverified.
    assert.ok(
      link.assumes?.includes("no-unseen-declarations"),
      `${marker}: flagged (${JSON.stringify(link.assumes)})`,
    );
    assert.notEqual(link.reason, "invalid-code", `${marker}: not attributed`);
    // What it gives today (recorded so that a change is visible).
    assert.equal(link.resolution, today.resolution, `${marker}: resolution`);
    assert.deepEqual(link.targets, today.targets, `${marker}: targets`);
  });

test("K3: in a program with a failed file, unresolved links are flagged too", async () => {
  const bad = "export class Failed { m() {} }\n";
  const files = {
    "bad.ts": bad,
    "use.ts": [
      'import "./bad";',
      'import { gone } from "./missing";',
      'import { readFileSync } from "node:fs";',
      "undeclaredName(); // no-symbol",
      'readFileSync("x"); // external',
      "Math.floor(1); // lib",
      "gone(); // missing-module",
      "export function outer(local: () => number) {",
      "  local(); // local",
      "  return (null as any).whatever(); // any-member",
      "}",
      "",
    ].join("\n"),
  };
  const { bad: broken } = await differential(files, {
    "bad.ts": bad + "const broken = (;\n",
  });
  const seen = new Set();
  for (const link of broken.links.values()) {
    if (link.file !== "use.ts" || link.reason === "invalid-code") continue;
    assert.ok(
      link.assumes?.includes("no-unseen-declarations"),
      `${link.text} (${link.resolution} ${link.reason}) is flagged`,
    );
    if (link.resolution === "unresolved") seen.add(link.reason);
  }
  // The unresolved reasons this fixture produces, each flagged.
  for (const reason of ["no-symbol", "external", "local", "missing-module"])
    assert.ok(
      seen.has(reason),
      `an unresolved ${reason} link is covered (${[...seen]})`,
    );
});
