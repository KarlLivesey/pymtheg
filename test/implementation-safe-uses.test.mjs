import test from "node:test";
import assert from "node:assert/strict";
// Review 27: new escape/alias shapes for reader v11. Expectation "none" means the runtime target can differ, so a confident target is wrong.
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash } from "../dist/shared/identity.js";
const f = (path, text) => ({ path, text, hash: hash(text) });
const v = { label: "x", gitCommit: null, dirty: true };
const XY = `const x = { go() { return 1; } };\nconst y = { go() { return 2; } };\n`;
const O = `function other() { return 3; }\n`;
const R = `export function run() { return x.go(); }`;
const cases = {
  // CommonJS repeated/replaced exports through other import forms
  "C destructured require, conditional re-export": [
    [
      [
        "a.js",
        `function one() { return 1; }\nfunction two() { return 2; }\nexports.f = one;\nif (process.env.X) exports.f = two;`,
      ],
      [
        "b.js",
        `const { f } = require("./a");\nexports.run = function () { return f(); };`,
      ],
    ],
    /\bf\(\)/,
    "none",
  ],
  "C destructured require, unconditional repeat": [
    [
      [
        "a.js",
        `function one() { return 1; }\nfunction two() { return 2; }\nexports.f = one;\nexports.f = two;`,
      ],
      [
        "b.js",
        `const { f } = require("./a");\nexports.run = function () { return f(); };`,
      ],
    ],
    /\bf\(\)/,
    "noneOrTwo",
  ],
  "C require().f member, conditional": [
    [
      [
        "a.js",
        `function one() { return 1; }\nfunction two() { return 2; }\nexports.f = one;\nif (process.env.X) exports.f = two;`,
      ],
      [
        "b.js",
        `const f = require("./a").f;\nexports.run = function () { return f(); };`,
      ],
    ],
    /\bf\(\)/,
    "none",
  ],
  "C a.f() conditional (control)": [
    [
      [
        "a.js",
        `function one() { return 1; }\nfunction two() { return 2; }\nexports.f = one;\nif (process.env.X) exports.f = two;`,
      ],
      [
        "b.js",
        `const a = require("./a");\nexports.run = function () { return a.f(); };`,
      ],
    ],
    /a\.f\(\)/,
    "none",
  ],
  "C destructured require, setter export": [
    [
      [
        "a.js",
        `function one() { return 1; }\nexports.f = one;\nexports.use = function (g) { exports.f = g; };`,
      ],
      [
        "b.js",
        `const { f } = require("./a");\nexports.run = function () { return f(); };`,
      ],
    ],
    /\bf\(\)/,
    "none",
  ],
  "C destructured require, module.exports.f twice": [
    [
      [
        "a.js",
        `function one() { return 1; }\nfunction two() { return 2; }\nmodule.exports.f = one;\nif (process.env.X) module.exports.f = two;`,
      ],
      [
        "b.js",
        `const { f } = require("./a");\nexports.run = function () { return f(); };`,
      ],
    ],
    /\bf\(\)/,
    "none",
  ],
  "C destructured require, static single (control)": [
    [
      ["a.js", `function one() { return 1; }\nexports.f = one;`],
      [
        "b.js",
        `const { f } = require("./a");\nexports.run = function () { return f(); };`,
      ],
    ],
    /\bf\(\)/,
    "one",
  ],
  // escape forms not in the enumerated list
  "E arrow expression-body return": [
    [["a.ts", XY + O + `const get = (): any => x;\nget().go = other;\n` + R]],
    /x\.go\(\)/,
    "none",
  ],
  "E logical || argument": [
    [
      [
        "a.ts",
        XY +
          O +
          `declare const opt: any;\nfunction patch(t: any) { t.go = other; }\npatch(opt || x);\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E nullish ?? argument to unknown": [
    [
      [
        "a.ts",
        XY +
          `declare const opt: any;\ndeclare function install(t: any): void;\ninstall(opt ?? x);\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E comma argument": [
    [
      [
        "a.ts",
        XY +
          O +
          `function patch(t: any) { t.go = other; }\npatch((0, x));\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E class field initializer": [
    [["a.ts", XY + O + `class H { t: any = x; }\nnew H().t.go = other;\n` + R]],
    /x\.go\(\)/,
    "none",
  ],
  "E default parameter": [
    [
      [
        "a.ts",
        XY + O + `function patch(t: any = x) { t.go = other; }\npatch();\n` + R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E binding default value": [
    [
      [
        "a.ts",
        XY +
          O +
          `declare const opts: any;\nconst { t = x } = opts;\n(t as any).go = other;\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E array binding default": [
    [
      [
        "a.ts",
        XY +
          O +
          `declare const list: any[];\nconst [t = x] = list;\n(t as any).go = other;\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E generator yield": [
    [
      [
        "a.ts",
        XY +
          O +
          `function* g(): Generator<any> { yield x; }\nfor (const t of g()) t.go = other;\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E tagged template": [
    [
      [
        "a.ts",
        XY +
          O +
          `function tag(_s: TemplateStringsArray, t: any) { t.go = other; return ""; }\ntag\`\${x}\`;\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E await expression argument": [
    [
      [
        "a.ts",
        XY +
          O +
          `export async function init() { const t: any = await Promise.resolve(x); t.go = other; }\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E self = this alias in literal": [
    [
      [
        "a.ts",
        O +
          `const x = { go() { return 1; }, init() { const self: any = this; self.go = other; } };\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E instance escapes; class this.notify": [
    [
      [
        "a.ts",
        O +
          `class Svc { notify() { return 1; } run() { return this.notify(); } }\nexport const s = new Svc();\ndeclare const plugins: { install(t: any): void }[];\nplugins.forEach((p) => p.install(s));`,
      ],
    ],
    /this\.notify\(\)/,
    "none",
  ],
  "E instance escapes; s.notify()": [
    [
      [
        "a.ts",
        O +
          `class Svc { notify() { return 1; } }\nconst s = new Svc();\ndeclare const plugins: { install(t: any): void }[];\nplugins.forEach((p) => p.install(s));\nexport function run() { return s.notify(); }`,
      ],
    ],
    /s\.notify\(\)/,
    "none",
  ],
  "E local helper patches instance; this.notify": [
    [
      [
        "a.ts",
        O +
          `class Svc { notify() { return 1; } run() { return this.notify(); } }\nexport const s = new Svc();\nfunction quiet(t: any) { t.notify = other; }\nquiet(s);`,
      ],
    ],
    /this\.notify\(\)/,
    "none",
  ],
  "E class escapes; new C().go()": [
    [
      [
        "a.ts",
        O +
          `class P { go() { return 1; } }\ndeclare const plugins: { install(t: any): void }[];\nplugins.forEach((p) => p.install(P));\nexport function run() { return new P().go(); }`,
      ],
    ],
    /go\(\)/,
    "none",
  ],
  "E class passed to local prototype patcher": [
    [
      [
        "a.ts",
        O +
          `class P { go() { return 1; } }\nfunction patch(C: any) { C.prototype.go = other; }\npatch(P);\nexport function run() { return new P().go(); }`,
      ],
    ],
    /go\(\)/,
    "none",
  ],
  "E JSX prop escape": [
    [
      [
        "a.tsx",
        XY +
          O +
          `declare namespace JSX { interface IntrinsicElements { [k: string]: any } }\nfunction Patch(props: any) { props.t.go = other; return null; }\nexport const el = <Patch t={x} />;\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E Proxy wrap": [
    [["a.ts", XY + `const p: any = new Proxy(x, {});\np.go = () => 9;\n` + R]],
    /x\.go\(\)/,
    "none",
  ],
  "E stored in module array then patched elsewhere": [
    [
      [
        "a.ts",
        XY + `export const registry: any[] = [];\nregistry.push(x);\n` + R,
      ],
      [
        "b.ts",
        `import { registry } from "./a";\nfor (const r of registry) r.go = () => 9;`,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E getter returns object": [
    [
      [
        "a.ts",
        XY +
          O +
          `const h = { get t(): any { return x; } };\nh.t.go = other;\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E closure returns object": [
    [
      [
        "a.ts",
        XY +
          O +
          `function make() { return () => x; }\n(make()() as any).go = other;\n` +
          R,
      ],
    ],
    /x\.go\(\)/,
    "none",
  ],
  "E namespace import passed to unknown plugin": [
    [
      ["api.ts", `export function notify(m: string) { return m; }`],
      [
        "main.ts",
        `import * as api from "./api";\ndeclare const plugins: { install(t: any): void }[];\nplugins.forEach((p) => p.install(api));\nexport function run() { return api.notify("x"); }`,
      ],
    ],
    /notify\(/,
    "notifyOk",
  ],
  // controls that should stay resolved
  "S scalar copy (control)": [
    [
      [
        "a.ts",
        XY + `declare function log(n: number): void;\nlog(x.go());\n` + R,
      ],
    ],
    /x\.go\(\)/,
    "x",
  ],
  "S unrelated object escapes (control)": [
    [
      [
        "a.ts",
        XY + `declare function install(t: any): void;\ninstall(y);\n` + R,
      ],
    ],
    /x\.go\(\)/,
    "x",
  ],
  "S local fn call (control)": [
    [["a.ts", O + `export function run() { return other(); }`]],
    /other\(\)/,
    "other",
  ],
  "S callable passed elsewhere (control)": [
    [
      [
        "a.ts",
        O +
          `declare function register(f: any): void;\nregister(other);\nexport function run() { return other(); }`,
      ],
    ],
    /other\(\)/,
    "other",
  ],
};

for (const [name, [files, re, expected]] of Object.entries(cases))
  test(name, () => {
    const g = observeTypescript(
      files.map(([path, text]) => f(path, text)),
      v,
    );
    const source = Object.fromEntries(files);
    const edges = g.edges.filter(
      (e) =>
        e.kind === "calls" &&
        re.test(source[e.span.file].slice(e.span.start, e.span.end)),
    );
    assert.ok(edges.length, name);
    if (expected === "none" || expected === "noneOrTwo")
      assert.ok(
        edges.every((e) => e.to === null),
        name,
      );
    else if (["one", "x", "other"].includes(expected))
      assert.ok(
        edges.some((e) => e.to !== null),
        name,
      );
  });
