// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { combinePartitions } from "../dist/implementation/partitions.js";
import {
  dependencyChanges,
  dependencyHashes,
} from "../dist/implementation/dependencies.js";
import { hash } from "../dist/shared/identity.js";

const version = { label: "Implicit mutations", gitCommit: null, dirty: true };
function observe(files, split = false) {
  const sources = Object.entries(files).map(([path, text]) => ({
    path,
    text,
    hash: hash(text),
  }));
  return split
    ? combinePartitions(
        sources.map((source) =>
          observeTypescript([source], version, {
            sourcePaths: Object.keys(files),
          }),
        ),
      )
    : observeTypescript(sources, version);
}
function calls(graph, pattern, file = "a.ts") {
  const source = graph.files.find((f) => f.path === file).text;
  const found = graph.edges.filter(
    (e) =>
      e.kind === "calls" &&
      e.span.file === file &&
      pattern.test(source.slice(e.span.start, e.span.end)),
  );
  assert.ok(found.length, String(pattern));
  return found;
}
const classDecorator =
  "function quiet(C:any){C.prototype.notify=()=>0;return C;}";
const memberDecorator =
  "function wrap(m:any,c:any){return function(){return 0}}";
for (const [name, text, pattern] of [
  [
    "class patch",
    `${classDecorator}@quiet class Svc{notify(){return 1}run(){return this.notify()}}`,
    /this\.notify\(/,
  ],
  [
    "class replacement",
    "function swap(C:any){return class{notify(){return 9}}}@swap class Svc{notify(){return 1}}export function run(){return new Svc().notify()}",
    /\.notify\(/,
  ],
  [
    "method",
    `${memberDecorator}class Svc{@wrap notify(){return 1}}export function run(){const s=new Svc();return s.notify()}`,
    /s\.notify\(/,
  ],
  [
    "static method",
    `${memberDecorator}class Svc{@wrap static notify(){return 1}}export function run(){return Svc.notify()}`,
    /Svc\.notify\(/,
  ],
  [
    "field",
    "function mock(t:any,c:any){return ()=>()=>9}class Svc{@mock notify=()=>1;run(){return this.notify()}}",
    /this\.notify\(/,
  ],
  [
    "factory",
    "declare function log():any;class Svc{@log() notify(){return 1}run(){return this.notify()}}",
    /this\.notify\(/,
  ],
  [
    "external",
    "import {Injectable} from 'di-lib';@Injectable() class Svc{notify(){return 1}run(){return this.notify()}}",
    /this\.notify\(/,
  ],
])
  test(`decorator ${name} withholds runtime dispatch`, () => {
    assert.ok(
      calls(observe({ "a.ts": text }), pattern).every((e) => e.to === null),
    );
  });

test("decorated class dependencies retain imported decorator changes across parse partitions", () => {
  for (const split of [false, true]) {
    const make = (n) =>
      observe(
        {
          "deco.ts": `export function quiet(C:any){C.prototype.notify=()=>${n};return C;}`,
          "a.ts":
            'import {quiet} from "./deco";@quiet export class Svc{notify(){return 1}run(){return this.notify()}}',
          "safe.ts":
            "export class Safe{notify(){return 2}run(){return this.notify()}}",
          "use.ts":
            'import {Svc} from "./a";export function run(){return new Svc().notify()}',
        },
        split,
      );
    const a = make(1),
      b = make(9);
    for (const [pattern, file] of [
      [/this\.notify\(/, "a.ts"],
      [/\.notify\(/, "use.ts"],
    ])
      assert.ok(calls(a, pattern, file).every((e) => e.to === null));
    if (!split)
      assert.ok(
        calls(a, /this\.notify\(/, "safe.ts").every(
          (e) => e.to === "safe.ts#method:Safe.notify",
        ),
      );
    const id = "a.ts#method:Svc.run";
    assert.notEqual(dependencyHashes(a).get(id), dependencyHashes(b).get(id));
    const difference = dependencyChanges(a, b, id);
    assert.ok(
      difference.items.some(
        (item) =>
          item.name === "quiet" &&
          item.before.includes("=>1") &&
          item.after.includes("=>9"),
      ),
    );
  }
});

for (const [name, patch] of [
  [
    "member escape",
    'declare function install(t:any):void;export async function load(){const m=await import("./api");install(m.api)}',
  ],
  [
    "direct patch",
    'export async function load(){const m=await import("./api");(m.api as any).notify=()=>9}',
  ],
  [
    "then callback",
    'export function load(){return import("./api").then(m=>{(m.api as any).notify=()=>9})}',
  ],
  [
    "destructured patch",
    'export async function load(){const {api}=await import("./api");(api as any).notify=()=>9}',
  ],
  [
    "literal template",
    "export async function load(){const m=await import(`./api`);(m.api as any).notify=()=>9}",
  ],
])
  test(`dynamic import ${name} invalidates the captured namespace in full and split graphs`, () => {
    for (const split of [false, true]) {
      const g = observe(
        {
          "api.ts":
            "export const api={notify(){return 1}};export class Svc{notify(){return 1}run(){return this.notify()}}",
          "a.ts":
            'import {api} from "./api";export function run(){return api.notify()}',
          "z.ts": patch,
        },
        split,
      );
      assert.ok(calls(g, /api\.notify\(/).every((e) => e.to === null));
      assert.ok(
        calls(g, /this\.notify\(/, "api.ts").every((e) => e.to === null),
      );
      assert.ok(
        g.escapedImports.some((e) => e.file === "api.ts" && e.name === "*"),
      );
    }
  });

test("static namespaces and unaffected classes keep real controls", () => {
  const g = observe({
    "api.ts": "export const api={notify(){return 1}}",
    "a.ts":
      'import {api} from "./api";export function run(){return api.notify()}',
  });
  assert.ok(
    calls(g, /api\.notify\(/).every((e) => e.to === "api.ts#method:api.notify"),
  );
});

for (const [name, api, call, patch] of [
  [
    "object method",
    "export default {notify(){return 1}}",
    "value.notify()",
    "m.default.notify=()=>9",
  ],
  [
    "object function property",
    "export default {notify:()=>1}",
    "value.notify()",
    "m.default.notify=()=>9",
  ],
  [
    "nested object",
    "const api={notify(){return 1}};export default {api}",
    "value.api.notify()",
    "m.default.api.notify=()=>9",
  ],
  [
    "default instance",
    "class Svc{notify(){return 1}};export default new Svc()",
    "value.notify()",
    "m.default.notify=()=>9",
  ],
])
  test(`default-export ${name} exposes its namespace value rather than losing its identity`, () => {
    for (const split of [false, true])
      for (const dynamic of [false, true]) {
        const g = observe(
          {
            "api.ts": api,
            "a.ts": `import value from './api';export function run(){return ${call}}`,
            "z.ts": dynamic
              ? `export async function patch(){const m=await import('./api');${patch}}`
              : `import * as m from './api';${patch}`,
          },
          split,
        );
        assert.ok(calls(g, /value\..*notify\(/).every((e) => e.to === null));
      }
  });

for (const [name, use] of [
  [
    "destructured",
    'const {f}=require("./barrel");exports.run=function(){return f()}',
  ],
  [
    "member copy",
    'const f=require("./barrel").f;exports.run=function(){return f()}',
  ],
  [
    "namespace",
    'const a=require("./barrel");exports.run=function(){return a.f()}',
  ],
])
  test(`CommonJS ${name} checks conditional exports through barrel chains`, () => {
    for (const split of [false, true])
      for (const barrel of [
        'module.exports=require("./a")',
        'const a=require("./a");module.exports=a',
        'module.exports=require("./middle")',
      ]) {
        const g = observe(
          {
            "a.js":
              "function one(){return 1}function two(){return 2}exports.f=one;if(process.env.X)exports.f=two;",
            "middle.js": 'module.exports=require("./a")',
            "barrel.js": barrel,
            "use.js": use,
          },
          split,
        );
        assert.ok(
          calls(g, /(?:a\.)?f\(/, "use.js").every((e) => e.to === null),
        );
      }
  });

test("a single unconditional CommonJS export through a barrel still resolves", () => {
  const g = observe({
    "a.js": "function one(){return 1}exports.f=one;",
    "barrel.js": 'module.exports=require("./a")',
    "use.js":
      'const {f}=require("./barrel");exports.run=function(){return f()}',
  });
  assert.ok(
    calls(g, /f\(/, "use.js").every((e) => e.to === "a.js#function:one"),
  );
});

test("dynamic-import CommonJS defaults do not retain a patched require target", () => {
  for (const use of [
    'const a=require("./api");exports.run=function(){return a.f()}',
    'const {f}=require("./api");exports.run=function(){return f()}',
  ]) {
    const g = observe({
      "api.js": "function one(){return 1}exports.f=one",
      "a.js": use,
      "z.ts":
        'export async function patch(){const m=await import("./api");m.default.f=()=>9}',
    });
    assert.ok(calls(g, /(?:a\.)?f\(/, "a.js").every((e) => e.to === null));
  }
});

test("opaque default values are not dropped when the same partition has named exports and consumers", () => {
  const files = Object.entries({
    "api.ts":
      "export default {notify(){return 1}};export function unrelated(){return 2}",
    "a.ts":
      'import value from "./api";export function run(){return value.notify()}',
    "z.ts":
      'export async function patch(){const m=await import("./api");m.default.notify=()=>9}',
  }).map(([path, text]) => ({ path, text, hash: hash(text) }));
  const options = { sourcePaths: files.map((f) => f.path) };
  const graph = combinePartitions([
    observeTypescript(files.slice(0, 2), version, options),
    observeTypescript(files.slice(2), version, options),
  ]);
  assert.ok(calls(graph, /value\.notify\(/).every((e) => e.to === null));
  assert.ok(
    graph.exports.some(
      (e) => e.name === "default" && e.nodeId === "file:api.ts",
    ),
  );
  assert.ok(
    !graph.edges.some((e) => e.kind === "references" && e.to === "file:api.ts"),
  );
});

test("literal-typed const keys retain the actual static-property writer", () => {
  const make = (n) =>
    observe({
      "a.ts": `const RATE="rate";class Fees{static rate=10;}export function set(){Fees[RATE]=${n}}export function run(){return Fees.rate}`,
    });
  const a = make(20),
    b = make(50),
    id = "a.ts#function:run";
  assert.notEqual(dependencyHashes(a).get(id), dependencyHashes(b).get(id));
  assert.ok(
    dependencyChanges(a, b, id).items.some(
      (i) => i.name === "set" && i.after.includes("=50"),
    ),
  );
});
