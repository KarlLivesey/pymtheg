const opts = {
  strict: true,
  target: "ES2022",
  module: "ESNext",
  moduleResolution: "Bundler",
  allowJs: true,
  checkJs: true,
  noEmit: true,
};
const tsconfig = JSON.stringify({ compilerOptions: opts, include: ["src"] });
const T = (files) => ({ "tsconfig.json": tsconfig, ...files });
const types =
  'export interface A { k: "a"; m(): void; onlyA(): void }\nexport interface B { k: "b"; m(): void }\nexport interface C { k: "c"; m(): void; onlyC(): void }\n';

export default [
  {
    // TS 5.5 inferred type predicate: a throw guard (not a return) changes it.
    name: "inferred-predicate-guard",
    files: T({
      "src/t.ts": types,
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport function isAC(x: A | B | C) {\n  return x.k !== "b";\n}\n',
      "src/g.ts":
        'import type { A, B, C } from "./t";\nimport { isAC } from "./f";\ndeclare const v: A | B | C;\nif (isAC(v)) {\n  v.m();\n  v.onlyA();\n}\n',
    }),
    edit: {
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport function isAC(x: A | B | C) {\n  if (x.k === "c") throw new Error("c");\n  return x.k !== "b";\n}\n',
    },
  },
  {
    // Inferred predicate on a class method, gained by a guard.
    name: "inferred-predicate-method",
    files: T({
      "src/t.ts": types,
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport class Checks {\n  isAC(x: A | B | C) {\n    return x.k !== "b";\n  }\n}\n',
      "src/g.ts":
        'import type { A, B, C } from "./t";\nimport { Checks } from "./f";\ndeclare const v: A | B | C;\nif (new Checks().isAC(v)) {\n  v.m();\n}\n',
    }),
    edit: {
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport class Checks {\n  isAC(x: A | B | C) {\n    if (x.k === "c") throw new Error("c");\n    return x.k !== "b";\n  }\n}\n',
    },
  },
  {
    // Inferred predicate used by Array.filter in another file.
    name: "inferred-predicate-filter",
    files: T({
      "src/t.ts": types,
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport function keep(x: A | B | C) {\n  return x.k !== "b";\n}\n',
      "src/g.ts":
        'import type { A, B, C } from "./t";\nimport { keep } from "./f";\ndeclare const list: (A | B | C)[];\nlist.filter(keep).forEach((v) => v.m());\n',
    }),
    edit: {
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport function keep(x: A | B | C) {\n  if (x.k === "c") throw new Error("c");\n  return x.k !== "b";\n}\n',
    },
  },
  {
    // Dynamic import() added inside a body: a new module enters the program.
    name: "dynamic-import-in-body",
    files: T({
      "src/f.ts": "export function load() {\n  void 0;\n}\n",
      "extra/aug.ts":
        "export {};\ndeclare global {\n  interface Window { extra: { go(): void } }\n}\n",
      "src/g.ts": "declare const w: Window;\nw.extra.go();\n",
    }),
    edit: {
      "src/f.ts":
        'export function load() {\n  void import("../extra/aug");\n}\n',
    },
  },
  {
    // require() inside a JS body.
    name: "require-in-js-body",
    files: T({
      "src/f.js": "export function load() {\n  return 1;\n}\n",
      "extra/aug.ts":
        "export {};\ndeclare global {\n  interface Window { extra: { go(): void } }\n}\n",
      "src/g.ts": "declare const w: Window;\nw.extra.go();\n",
    }),
    edit: {
      "src/f.js":
        'export function load() {\n  require("../extra/aug");\n  return 1;\n}\n',
    },
  },
  {
    // TS expando: f.x = at top level vs. inside a body.
    name: "ts-expando-in-body",
    files: T({
      "src/f.ts": "export function f() {\n  void 0;\n}\nf.x = 1;\n",
      "src/g.ts": 'import { f } from "./f";\nf.x.toFixed();\nf();\n',
    }),
    edit: {
      "src/f.ts": "export function f() {\n  f.y = 2;\n}\nf.x = 1;\n",
    },
  },
  {
    // JS expando inside a body of another function.
    name: "js-expando-in-body",
    files: T({
      "src/f.js": "export function f() {}\nexport function init() {\n  void 0;\n}\n",
      "src/g.ts": 'import { f } from "./f.js";\nf.y;\n',
    }),
    edit: {
      "src/f.js":
        "export function f() {}\nexport function init() {\n  f.y = { z: 1 };\n}\n",
    },
  },
  {
    // @ts-nocheck added to a JS file (a comment).
    name: "js-ts-nocheck-pragma",
    files: T({
      "src/f.js":
        "export class Foo {\n  constructor() {\n    this.x = { b: 1 };\n  }\n}\n",
      "src/g.ts": 'import { Foo } from "./f.js";\nnew Foo().x.b.toFixed();\n',
    }),
    edit: {
      "src/f.js":
        "// @ts-nocheck\nexport class Foo {\n  constructor() {\n    this.x = { b: 1 };\n  }\n}\n",
    },
  },
  {
    // @ts-nocheck in a TS file.
    name: "ts-ts-nocheck-pragma",
    files: T({
      "src/f.ts": "export function f() {\n  return { b: 1 };\n}\n",
      "src/g.ts": 'import { f } from "./f";\nf().b.toFixed();\n',
    }),
    edit: {
      "src/f.ts":
        "// @ts-nocheck\nexport function f() {\n  return { b: 1 };\n}\n",
    },
  },
  {
    // A JSX pragma comment (multi-line, not JSDoc) changes the JSX factory.
    name: "jsx-pragma-comment",
    files: {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...opts, jsx: "react", jsxFactory: "h" },
        include: ["src"],
      }),
      "src/h.ts":
        "export function h(..._: unknown[]) {\n  return { kind: 'h' as const };\n}\nexport function k(..._: unknown[]) {\n  return { kind: 'k' as const, more: 1 };\n}\ndeclare global { namespace JSX { interface IntrinsicElements { div: {} } } }\n",
      "src/f.tsx":
        'import { h, k } from "./h";\nexport const el = () => <div />;\nvoid k;\nvoid h;\n',
      "src/g.ts": 'import { el } from "./f";\nel();\n',
    },
    edit: {
      "src/f.tsx":
        '/* @jsx k */\nimport { h, k } from "./h";\nexport const el = () => <div />;\nvoid k;\nvoid h;\n',
    },
  },
  {
    // Generator: a yield (not a return) inside a body changes the yield type.
    name: "generator-yield",
    files: T({
      "src/t.ts": types,
      "src/f.ts":
        'import type { A, C } from "./t";\ndeclare const a: A;\ndeclare const c: C;\nexport function* gen() {\n  yield a;\n}\n',
      "src/g.ts":
        'import { gen } from "./f";\nfor (const v of gen()) v.m();\n',
    }),
    edit: {
      "src/f.ts":
        'import type { A, C } from "./t";\ndeclare const a: A;\ndeclare const c: C;\nexport function* gen() {\n  yield a;\n  yield c;\n}\n',
    },
  },
  {
    // A unique symbol created in a body and returned through a closure.
    name: "unique-symbol-in-body",
    files: T({
      "src/f.ts":
        "export const make = () => {\n  const key = Symbol();\n  return { key, get: (o: { [k: symbol]: number }) => o[key] };\n};\n",
      "src/g.ts": 'import { make } from "./f";\nmake().get({}).toFixed();\n',
    }),
    edit: {
      "src/f.ts":
        "export const make = () => {\n  const key: unique symbol = Symbol();\n  return { key, get: (o: { [k: symbol]: number }) => o[key] };\n};\n",
    },
  },
];
