const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    allowJs: true,
    checkJs: true,
    noEmit: true,
  },
  include: ["src"],
});
const T = (files) => ({ "tsconfig.json": tsconfig, ...files });

export default [
  {
    name: "js-class-method-this-value",
    files: T({
      "src/c.js": "export class Item {\n  m() {}\n}\n",
      "src/a.js":
        'import { Item } from "./c.js";\nexport class Foo {\n  init() {\n    this.x = 1;\n  }\n}\n',
      "src/b.js": 'import { Foo } from "./a.js";\nnew Foo().x.m();\n',
    }),
    edit: {
      "src/a.js":
        'import { Item } from "./c.js";\nexport class Foo {\n  init() {\n    this.x = new Item();\n  }\n}\n',
    },
  },
  {
    name: "same-named-classes-via-let-assignment",
    files: T({
      "src/c.ts": "export class Item {\n  m() {}\n}\n",
      "src/d.ts": "export class Item {\n  n() {}\n}\n",
      "src/f.ts":
        'import { Item } from "./c";\nimport * as D from "./d";\nexport function make() {\n  let r;\n  r = new Item();\n  return r;\n}\n',
      "src/g.ts": 'import { make } from "./f";\nmake().m();\nmake().n();\n',
    }),
    edit: {
      "src/f.ts":
        'import { Item } from "./c";\nimport * as D from "./d";\nexport function make() {\n  let r;\n  r = new D.Item();\n  return r;\n}\n',
    },
  },
  {
    name: "body-literal-member-moves",
    files: T({
      "src/f.ts":
        "export function make() {\n  console.log(0);\n  return { a: 1 };\n}\n",
      "src/g.ts": 'import { make } from "./f";\nmake().a;\n',
    }),
    edit: {
      "src/f.ts":
        "export function make() {\n  console.log(0);\n  console.log(1);\n  console.log(2);\n  return { a: 1 };\n}\n",
    },
  },
  {
    name: "union-order-by-creation",
    files: T({
      "src/c.ts":
        'import { B } from "./x";\nexport function useB(b: B) {\n  b.m();\n}\n',
      "src/x.ts": "export class B {\n  m() {}\n}\n",
      "src/z.ts":
        'import { A } from "./zz";\nimport { B } from "./x";\nexport function use(x: A | B) {\n  x.m();\n}\n',
      "src/zz.ts": "export class A {\n  m() {}\n}\n",
    }),
    edit: {
      "src/z.ts":
        'import { A } from "./zz";\nimport { B } from "./x";\nexport function use(x: A | B) {\n  x.m();\n  x.m();\n}\n',
    },
  },
  {
    name: "p3-body-shift-merged-and-later",
    files: T({
      "src/f.ts":
        "export function a() {\n  console.log(0);\n}\nexport interface I {\n  x: number;\n}\nexport interface I {\n  y: number;\n}\nexport function o(s: string): void;\nexport function o(n: number): void;\nexport function o(v: unknown) {\n  console.log(v);\n}\nexport class C {\n  m() {}\n}\nexport namespace N {\n  export const k = 1;\n}\nexport namespace N {\n  export const j = 2;\n}\n",
      "src/g.ts":
        'import { a, I, o, C, N } from "./f";\na();\ndeclare const i: I;\ni.x;\ni.y;\no("s");\no(1);\nnew C().m();\nN.k;\nN.j;\n',
    }),
    edit: {
      "src/f.ts":
        "export function a() {\n  console.log(0);\n  console.log(1);\n  console.log(2);\n}\nexport interface I {\n  x: number;\n}\nexport interface I {\n  y: number;\n}\nexport function o(s: string): void;\nexport function o(n: number): void;\nexport function o(v: unknown) {\n  console.log(v);\n  console.log(v);\n}\nexport class C {\n  m() {\n    console.log(3);\n  }\n}\nexport namespace N {\n  export const k = 1;\n}\nexport namespace N {\n  export const j = 2;\n}\n",
    },
  },
  {
    name: "circular-inferred-two-files",
    files: T({
      "src/a.ts":
        'import { b } from "./b";\nexport function a(n: number) {\n  console.log(n);\n  return n > 0 ? b(n - 1) : 0;\n}\nexport const ka = { v: () => kb.v() };\nimport { kb } from "./b";\n',
      "src/b.ts":
        'import { a, ka } from "./a";\nexport function b(n: number) {\n  return a(n);\n}\nexport const kb = { v: () => ka.v() };\nb(1).toFixed();\nka.v().toFixed();\n',
    }),
    edit: {
      "src/a.ts":
        'import { b } from "./b";\nexport function a(n: number) {\n  console.log(n + 1);\n  return n > 0 ? b(n - 1) : 0;\n}\nexport const ka = { v: () => kb.v() };\nimport { kb } from "./b";\n',
    },
  },
];
