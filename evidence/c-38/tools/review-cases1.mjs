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
    name: "js-class-ctor-this-value",
    files: T({
      "src/a.js":
        "export class Foo {\n  constructor() {\n    this.x = 1;\n  }\n}\n",
      "src/b.ts":
        'import { Foo } from "./a.js";\nnew Foo().x.b.toFixed();\nnew Foo().x.toFixed();\n',
    }),
    edit: {
      "src/a.js":
        "export class Foo {\n  constructor() {\n    this.x = { b: 1 };\n  }\n}\n",
    },
  },
  {
    name: "js-class-ctor-jsdoc-type",
    files: T({
      "src/c.js":
        "export class Item {\n  m() {}\n}\nexport class Other {\n  n() {}\n}\n",
      "src/a.js":
        'import { Item, Other } from "./c.js";\nexport class Foo {\n  constructor() {\n    /** @type {Item | null} */\n    this.x = null;\n  }\n}\n',
      "src/b.ts":
        'import { Foo } from "./a.js";\nnew Foo().x?.m();\nnew Foo().x?.n();\n',
    }),
    edit: {
      "src/a.js":
        'import { Item, Other } from "./c.js";\nexport class Foo {\n  constructor() {\n    /** @type {Other | null} */\n    this.x = null;\n  }\n}\n',
    },
  },
  {
    name: "js-es5-ctor-this-value",
    files: T({
      "src/a.js":
        "export function Foo() {\n  this.x = 1;\n}\n",
      "src/b.js":
        'import { Foo } from "./a.js";\nnew Foo().x.b;\n',
    }),
    edit: {
      "src/a.js": "export function Foo() {\n  this.x = { b: 1 };\n}\n",
    },
  },
  {
    name: "ts-local-class-member-added",
    files: T({
      "src/f.ts":
        "export function make() {\n  class Local {\n    a() {}\n  }\n  return new Local();\n}\n",
      "src/g.ts": 'import { make } from "./f";\nmake().a();\nmake().b();\n',
    }),
    edit: {
      "src/f.ts":
        "export function make() {\n  class Local {\n    a() {}\n    b() {}\n  }\n  return new Local();\n}\n",
    },
  },
  {
    name: "ts-local-interface-member-added",
    files: T({
      "src/f.ts":
        "export function load(s: string) {\n  interface R {\n    a: number;\n  }\n  return JSON.parse(s) as R;\n}\n",
      "src/g.ts": 'import { load } from "./f";\nload("").a;\nload("").b;\n',
    }),
    edit: {
      "src/f.ts":
        "export function load(s: string) {\n  interface R {\n    a: number;\n    b: string;\n  }\n  return JSON.parse(s) as R;\n}\n",
    },
  },
  {
    name: "ts-local-class-swap-same-name",
    files: T({
      "src/f.ts":
        "export function make(k: boolean) {\n  class Local {\n    a() {}\n  }\n  if (k) {\n    class Local {\n      b() {}\n    }\n  }\n  return new Local();\n}\n",
      "src/g.ts": 'import { make } from "./f";\nmake(true).a();\n',
    }),
    edit: {
      "src/f.ts":
        "export function make(k: boolean) {\n  class Local {\n    b() {}\n  }\n  if (k) {\n    class Local {\n      a() {}\n    }\n  }\n  return new Local();\n}\n",
    },
  },
  {
    name: "ts-mixin-named-local",
    files: T({
      "src/f.ts":
        "type Ctor = new (...args: any[]) => {};\nexport function Tagged<T extends Ctor>(Base: T) {\n  class WithTag extends Base {\n    tag() {}\n  }\n  return WithTag;\n}\n",
      "src/g.ts":
        'import { Tagged } from "./f";\nclass A {}\nconst B = Tagged(A);\nnew B().tag();\nnew B().untag();\n',
    }),
    edit: {
      "src/f.ts":
        "type Ctor = new (...args: any[]) => {};\nexport function Tagged<T extends Ctor>(Base: T) {\n  class WithTag extends Base {\n    tag() {}\n    untag() {}\n  }\n  return WithTag;\n}\n",
    },
  },
];
