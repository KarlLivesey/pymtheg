import test from "node:test";
import assert from "node:assert/strict";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash } from "../dist/shared/identity.js";
const observe = (files) =>
  observeTypescript(
    Object.entries(files).map(([path, text]) => ({
      path,
      text,
      hash: hash(text),
    })),
    {
      label: "Receiver ambiguity",
      gitCommit: null,
      dirty: true,
    },
  );

test("conditional and reassigned object receivers never inherit a convenient compatible method", () => {
  for (const binding of [
    "const chosen = flag ? x : y;",
    "let chosen = x; export function swap(){ chosen = y; }",
    "let original = x; export function swap(){ original = y; } const chosen = original;",
    "const chosen = { item: flag ? x : y };",
  ]) {
    const accessor = binding.includes("item:") ? "chosen.item.go" : "chosen.go";
    const graph = observe({
      "a.ts": `const x = { go() { return 1; } }; const y = { go() { return 2; } }; ${binding}
      export function run(flag: boolean) { return ${accessor}(); }`,
    });
    const call = graph.edges.find((e) => e.targetName === accessor);
    assert.equal(call?.to, null, binding);
    assert.equal(call?.resolution, "unresolved", binding);
  }
});

test("repeated CommonJS property and module replacements stay unresolved in consuming modules", () => {
  for (const source of [
    "function one() {return 1;} function two() {return 2;} exports.f = one; if (flag) exports.f = two;",
    "exports.f = () => 1; if (flag) exports.f = () => 2;",
    "module.exports = { f: () => 1 }; if(flag) module.exports = { f: () => 2 };",
    "module.exports = { f: () => 1 }; if(flag) module.exports.f = () => 2;",
  ]) {
    const graph = observe({
      "lib.js": source,
      "main.js":
        'const api = require("./lib"); function run() { return api.f(); }',
    });
    assert.equal(
      graph.edges.find((e) => e.targetName === "api.f")?.to,
      null,
      source,
    );
  }
});

test("static object aliases resolve and object method identities survive declaration reordering", () => {
  const objects = [
    "const x = { go() { return 1; } };",
    "const y = { go() { return 2; } };",
  ];
  const ids = [];
  for (const declarations of [objects, [...objects].reverse()]) {
    const graph = observe({
      "a.ts":
        declarations.join("\n") +
        "const chosen = x; export function run(){ return chosen.go(); }",
    });
    assert.equal(
      graph.edges.find((e) => e.targetName === "chosen.go")?.to,
      "a.ts#method:x.go",
    );
    ids.push(
      graph.nodes
        .filter((n) => n.kind === "method")
        .map((n) => n.id)
        .sort(),
    );
  }
  assert.deepEqual(ids[0], ids[1]);
});

test("nearby dynamic receiver shapes withhold confident runtime targets", () => {
  const prefix =
    "const x={go(){return 1}}; const y={go(){return 2}}; function other(){return 3};";
  for (const [source, call] of [
    ["const {go}=flag?x:y; function run(){return go()}", "go"],
    ["let o=x; o=y; const {go}=o; function run(){return go()}", "go"],
    ["Object.assign(x,{go:other}); function run(){return x.go()}", "x.go"],
    ["var o=x; var o=y; function run(){return o.go()}", "o.go"],
    ["function run(o=x){return o.go()} run(y)", "o.go"],
    ["function run(o:typeof x){return o.go()} run(y)", "o.go"],
    [
      "class P {go(){return 1}}; (P.prototype as any).go=other; const o=new P(); function run(){return o.go()}",
      "o.go",
    ],
  ]) {
    const graph = observe({ "a.ts": prefix + source });
    assert.equal(
      graph.edges.find((e) => e.kind === "calls" && e.targetName === call)?.to,
      null,
      source,
    );
  }
  for (const source of [
    "function one(){return 1} function two(){return 2} exports.f=one; const e=exports; e.f=two;",
    "function one(){return 1} function two(){return 2} module.exports={f:one}; const e=module.exports; e.f=two;",
    'function one(){return 1} function two(){return 2} exports.f=one; Object.defineProperty(exports,"f",{value:two});',
  ]) {
    const graph = observe({
      "lib.js": source,
      "main.js": 'const api=require("./lib"); function run(){return api.f()}',
    });
    assert.equal(
      graph.edges.find((e) => e.targetName === "api.f")?.to,
      null,
      source,
    );
  }
});

test("static destructuring and class receivers retain useful targets", () => {
  const graph = observe({
    "a.ts":
      "const x={go(){return 1}}; const {go}=x; class P{ run(){return go()} }; const o=new P(); o.run();",
  });
  assert.equal(
    graph.edges.find((e) => e.kind === "calls" && e.targetName === "go")?.to,
    "a.ts#method:x.go",
  );
  assert.equal(
    graph.edges.find((e) => e.targetName === "o.run")?.to,
    "a.ts#method:P.run",
  );
});

test("receiver annotations, casts and known virtual overrides never borrow the declared type's method", () => {
  for (const [source, call] of [
    [
      "const x={go(){return 1}}, y={go(){return 2}}; const o:typeof x=y; o.go();",
      "o.go",
    ],
    [
      "class A{go(){return 1}} class B extends A{go(){return 2}} const o:A=new B(); o.go();",
      "o.go",
    ],
    ["const x={go(){return 1}}; const o={} as typeof x; o.go();", "o.go"],
    [
      "const x={go(){return 1}}, y={go(){return 2}}; (<typeof x>y).go();",
      "(<typeof x>y).go",
    ],
    [
      "class A{go(){return 1} run(){return this.go()}} class B extends A{go(){return 2}} new B().run();",
      "this.go",
    ],
  ]) {
    const graph = observe({ "a.ts": source });
    const edge = graph.edges.find(
      (e) =>
        e.kind === "calls" &&
        e.targetName.replace(/\s/g, "") === call.replace(/\s/g, ""),
    );
    assert.ok(edge, source);
    assert.equal(edge.to, null, source);
  }
  const graph = observe({ "a.ts": "const f:()=>number=()=>1; f();" });
  assert.equal(
    graph.edges.find((e) => e.kind === "calls" && e.targetName === "f").to,
    "a.ts#function:f",
  );
});

test("spreads of typed receivers, getter-returned functions and replacement constructors remain unresolved", () => {
  for (const source of [
    "const x={go(){return 1}}, z={go(){return 2}}; const y:typeof x=z; const o={...y}; o.go();",
    "const o={get go(){return ()=>2}};o.go();",
    "const o={get go(){return ()=>2}};const {go}=o;go();",
    "class A{constructor(){return {go(){return 2}}}go(){return 1}}class B extends A{go(){return 3}}const o=new B();o.go();",
    "class P{constructor(){return {go(){return 2}}}go(){return 1}} const o=new P();o.go();",
  ]) {
    const graph = observe({ "a.ts": source });
    assert.equal(
      graph.edges.find(
        (e) =>
          e.kind === "calls" &&
          (e.targetName === "o.go" || e.targetName === "go"),
      ).to,
      null,
      source,
    );
  }
});

test("imported live bindings and mutation through forwarded parameters never select the initial receiver", () => {
  for (const setup of [
    "export let cur=x; export function swap(){cur=y;}",
    "function patch(t){t.go=other} function forward(v){patch(v)} forward(x); export const cur=x;",
    'Reflect.set(x,"go",other); export const cur=x;',
    'const set=Reflect["set"];set(x,"go",other);export const cur=x;',
    "let o=x,p=y;[o,p]=[p,o];export const cur=o;",
  ]) {
    const graph = observe({
      "a.ts":
        "const x={go(){return 1}},y={go(){return 2}};function other(){return 3} " +
        setup,
      "b.ts": 'import {cur} from "./a.js";function run(){return cur.go()}',
    });
    assert.equal(
      graph.edges.find((e) => e.kind === "calls" && e.targetName === "cur.go")
        ?.to,
      null,
      setup,
    );
  }
});

test("mutated classes retain type references without granting runtime dispatch certainty", () => {
  const graph = observe({
    "lib.ts":
      "export class Service { static limit=1; go(){return 1} } export function configure(){Service.limit=2}",
    "main.ts":
      'import {Service} from "./lib.js"; export function run(service:Service){return service.go()}',
  });
  assert.equal(
    graph.edges.find(
      (e) => e.kind === "uses-type" && e.targetName === "Service",
    )?.to,
    "lib.ts#class:Service",
  );
  assert.equal(
    graph.edges.find((e) => e.kind === "calls" && e.targetName === "service.go")
      ?.to,
    null,
  );
});

test("receiver writes after destructuring assignments propagate to possible source containers", () => {
  for (const swap of ["[x,y]=[y,x]", "({x,y}={x:y,y:x})"]) {
    const graph = observe({
      "a.ts": `const a={go(){return 1}},b={go(){return 2}};let x=a,y=b;${swap};x.go=()=>3;export function run(){return b.go()}`,
    });
    assert.equal(
      graph.edges.find((e) => e.kind === "calls" && e.targetName === "b.go")
        ?.to,
      null,
      swap,
    );
  }
});
