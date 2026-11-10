import test from "node:test";
import assert from "node:assert/strict";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { combinePartitions } from "../dist/implementation/partitions.js";
import {
  dependencyHashes,
  dependencyChanges,
} from "../dist/implementation/dependencies.js";
import { hash } from "../dist/shared/identity.js";
const version = { label: "Escapes", gitCommit: null, dirty: true };
const file = (path, text) => ({ path, text, hash: hash(text) });
const observe = (text) => observeTypescript([file("a.ts", text)], version);
const prefix =
  "const x={go(){return 1}},y={go(){return 2}};function other(){return 3}";
test("objects escaping through containers, callbacks, constructors and unresolved calls never retain certain method dispatch", () => {
  for (const use of [
    "class Patch{constructor(t){t.go=other}}new Patch(x);",
    "function patch({target}){target.go=other}patch({target:x});",
    "function patch(){arguments[0].go=other}patch(x);",
    "const arr=[x];arr[0].go=other;",
    'const map=new Map([["x",x]]);map.get("x").go=other;',
    "[x].forEach(t=>t.go=other);",
    "for(const t of [x])t.go=other;",
    "const c={t:x};c.t.go=other;",
    "function id(t){return t}id(x).go=other;",
    "const {assign}=Object;assign(x,{go:other});",
    'const R=Reflect;R.set(x,"go",other);',
    "globalThis.Object.assign(x,{go:other});",
    "declare const install:any;install(x);",
    "function readOnly(t){return t.go}readOnly(x);",
  ]) {
    const g = observe(prefix + use + "export function run(){return x.go()}");
    assert.equal(
      g.edges.find((e) => e.kind === "calls" && e.targetName === "x.go")?.to,
      null,
      use,
    );
  }
  const g = observe(
    "const x={go(){return 1},reset(){this.go=()=>3}};x.reset();export function run(){return x.go()}",
  );
  assert.equal(
    g.edges.find((e) => e.kind === "calls" && e.targetName === "x.go")?.to,
    null,
  );
});
test("static local calls and callable identity remain useful even when values are passed as callbacks", () => {
  const g = observe(
    prefix +
      "const callbacks={other};[other].forEach(f=>f());export function run(){other();return y.go()}",
  );
  assert.equal(
    g.edges.find((e) => e.kind === "calls" && e.targetName === "other")?.to,
    "a.ts#function:other",
  );
  assert.equal(
    g.edges.find((e) => e.kind === "calls" && e.targetName === "y.go")?.to,
    "a.ts#method:y.go",
  );
  const c = observeTypescript(
    [
      file("lib.js", "function one(){return 1}exports.f=one;"),
      file(
        "use.js",
        'const a=require("./lib");exports.run=function(){return a.f()}',
      ),
    ],
    version,
  );
  assert.equal(
    c.edges.find((e) => e.kind === "calls" && e.targetName === "a.f")?.to,
    "lib.js#function:one",
  );
});
test("cross-partition plugin escapes withhold calls established before the plugin was parsed", () => {
  const files = [
    file("api.ts", "export const api={notify(){return 1}};"),
    file(
      "use.ts",
      'import {api} from "./api.js";export function send(){return api.notify()}',
    ),
    file(
      "plugin.ts",
      'import {api} from "./api.js";declare const plugins:any[];plugins.forEach(p=>p.install(api));',
    ),
  ];
  for (const g of [
    observeTypescript(files, version),
    combinePartitions([
      observeTypescript(files.slice(0, 2), version, {
        sourcePaths: files.map((f) => f.path),
      }),
      observeTypescript(files.slice(2), version, {
        sourcePaths: files.map((f) => f.path),
      }),
    ]),
  ])
    assert.equal(
      g.edges.find((e) => e.kind === "calls" && e.targetName === "api.notify")
        ?.to,
      null,
    );
});
test("destructured module constants and class static writers retain exact dependency changes", () => {
  for (const text of [
    "const LIMITS={max:10};const {max}=LIMITS;export function f(){return max}",
    "class Cfg{static max=10}export function set(){Cfg.max=20}export function f(){return Cfg.max}",
  ]) {
    const a = observe(text),
      b = observe(
        text.replace(
          text.includes("max=20") ? "max=20" : "max:10",
          text.includes("max=20") ? "max=30" : "max:30",
        ),
      );
    assert.notEqual(
      dependencyHashes(a).get("a.ts#function:f"),
      dependencyHashes(b).get("a.ts#function:f"),
      text,
    );
    const diff = dependencyChanges(a, b, "a.ts#function:f");
    assert.ok(
      diff.items.some(
        (i) =>
          (i.before?.includes("20") && i.after?.includes("30")) ||
          (i.before?.includes("10") && i.after?.includes("30")),
      ),
      text,
    );
  }
});

test("CommonJS export objects and unresolved namespace imports retain conservative escape provenance", () => {
  const files = [
    file("api.ts", "export const api={notify(){return 1}};"),
    file(
      "use.ts",
      'import {api} from "./api.js";export function send(){return api.notify()}',
    ),
    file(
      "plugin.ts",
      'import * as ns from "./api.js";declare const install:any;install(ns.api);',
    ),
  ];
  const g = combinePartitions([
    observeTypescript(files.slice(0, 2), version, {
      sourcePaths: files.map((f) => f.path),
    }),
    observeTypescript(files.slice(2), version, {
      sourcePaths: files.map((f) => f.path),
    }),
  ]);
  assert.equal(
    g.edges.find((e) => e.kind === "calls" && e.targetName === "api.notify")
      ?.to,
    null,
  );
  const c = observeTypescript(
    [
      file(
        "lib.js",
        "function one(){return 1}exports.f=one;unknownHelper(exports);",
      ),
      file(
        "use.js",
        'const a=require("./lib");exports.run=function(){return a.f()}',
      ),
    ],
    version,
  );
  assert.equal(
    c.edges.find((e) => e.kind === "calls" && e.targetName === "a.f")?.to,
    null,
  );
});

test("escaped instances invalidate internal this dispatch across parse partitions", () => {
  const files = [
    file(
      "api.ts",
      "export class Svc{notify(){return 1}run(){return this.notify()}}export const service=new Svc();",
    ),
    file(
      "plugin.ts",
      'import {service} from "./api.js";declare const install:any;install(service);',
    ),
  ];
  for (const g of [
    observeTypescript(files, version),
    combinePartitions(
      files.map((f) =>
        observeTypescript([f], version, {
          sourcePaths: files.map((f) => f.path),
        }),
      ),
    ),
  ])
    assert.equal(
      g.edges.find((e) => e.kind === "calls" && e.targetName === "this.notify")
        ?.to,
      null,
    );
});
test("initializer calls, element writes and instance fields retain dependency changes", () => {
  for (const [text, from, to, id] of [
    [
      "function load(){return {max:10}}const {max}=load();export function f(){return max}",
      "max:10",
      "max:20",
      "a.ts#function:f",
    ],
    [
      'class Cfg{static max=10}function tune(){Cfg["max"]=20}export function f(){return Cfg.max}',
      "=20",
      "=30",
      "a.ts#function:f",
    ],
    [
      "class Svc{max=10;tune(){this.max=20}f(){return this.max}}",
      "max=10",
      "max=30",
      "a.ts#method:Svc.f",
    ],
    [
      "class Svc{max=10;tune(){this.max=20}f(){return this.max}}",
      "max=20",
      "max=30",
      "a.ts#method:Svc.f",
    ],
  ]) {
    const a = observe(text),
      b = observe(text.replace(from, to));
    assert.notEqual(
      dependencyHashes(a).get(id),
      dependencyHashes(b).get(id),
      text,
    );
    assert.ok(dependencyChanges(a, b, id).total > 0, text);
  }
});

test("instance escape withholds methods while retaining the constructor identity in full and split captures", () => {
  const files = [
    file("api.ts", "export class C{go(){return 1}run(){return this.go()}}"),
    file(
      "use.ts",
      'import {C} from "./api.js";const c=new C();declare const install:any;install(c);',
    ),
  ];
  for (const g of [
    observeTypescript(files, version),
    combinePartitions(
      files.map((f) =>
        observeTypescript([f], version, {
          sourcePaths: files.map((f) => f.path),
        }),
      ),
    ),
  ]) {
    assert.equal(
      g.edges.find((e) => e.kind === "calls" && e.targetName === "C")?.to,
      "api.ts#class:C",
    );
    assert.equal(
      g.edges.find((e) => e.kind === "calls" && e.targetName === "this.go")?.to,
      null,
    );
  }
});

test("this mutation provenance follows nested field objects and dynamically bound function methods", () => {
  for (const text of [
    "class C{api={go(){return 1},reset(){(this as any).go=()=>2}};run(){this.api.reset();return this.api.go()}}",
    "class C{api={reset:()=>{(this as any).notify=()=>2}};notify(){return 1}run(){this.api.reset();return this.notify()}}",
    "function reset(){(this as any).go=()=>2}const x={go(){return 1},reset};x.reset();export function run(){return x.go()}",
  ]) {
    const g = observe(text);
    const call = g.edges.find(
      (e) =>
        e.kind === "calls" &&
        ["this.api.go", "this.notify", "x.go"].includes(e.targetName),
    );
    assert.ok(call);
    assert.equal(call.to, null, text);
  }
});

test("escaping a module namespace withholds its contained mutable objects and class dispatch", () => {
  const files = [
    file(
      "api.ts",
      "export const api={go(){return 1}};export class C{go(){return 1}run(){return this.go()}}",
    ),
    file(
      "use.ts",
      'import {api} from "./api.js";export function run(){return api.go()}',
    ),
    file(
      "boot.ts",
      'import * as ns from "./api.js";declare const install:any;install(ns);',
    ),
  ];
  for (const g of [
    observeTypescript(files, version),
    combinePartitions([
      observeTypescript(files.slice(0, 2), version, {
        sourcePaths: files.map((f) => f.path),
      }),
      observeTypescript(files.slice(2), version, {
        sourcePaths: files.map((f) => f.path),
      }),
    ]),
  ]) {
    const calls = g.edges.filter(
      (e) => e.kind === "calls" && ["api.go", "this.go"].includes(e.targetName),
    );
    assert.equal(calls.length, 2);
    assert.ok(calls.every((e) => e.to === null));
  }
  const cjs = observeTypescript(
    [
      file("api.js", "function one(){return 1}exports.go=one;"),
      file("boot.js", 'const mod=require("./api");unknownPlugin(mod);'),
      file(
        "use.js",
        'const mod=require("./api");exports.run=function(){return mod.go()}',
      ),
    ],
    version,
  );
  assert.equal(
    cjs.edges.find((e) => e.kind === "calls" && e.targetName === "mod.go")?.to,
    null,
  );
});

test("anonymous default classes retain this provenance when their module or instance escapes", () => {
  for (const boot of [
    'import C from "./api.js";const c=new C();declare const install:any;install(c);',
    'import * as ns from "./api.js";declare const install:any;install(ns);',
  ]) {
    const g = observeTypescript(
      [
        file(
          "api.ts",
          "export default class {go(){return 1}run(){return this.go()}}",
        ),
        file("boot.ts", boot),
      ],
      version,
    );
    assert.equal(
      g.edges.find((e) => e.kind === "calls" && e.targetName === "this.go")?.to,
      null,
      boot,
    );
  }
});

test("class expressions never borrow an enclosing class this identity", () => {
  const g = observe(
    "class Outer{Inner=class{go(){return 1}reset(){(this as any).go=()=>2}run(){return this.go()}}}const o=new Outer();const i=new o.Inner();i.reset();export function run(){return i.go()}",
  );
  const calls = g.edges.filter(
    (e) => e.kind === "calls" && ["this.go", "i.go"].includes(e.targetName),
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((e) => e.to === null));
});
