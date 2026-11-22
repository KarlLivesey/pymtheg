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
    // A guard removed: the predicate widens (A -> A | C).
    name: "pred-guard-removed",
    files: T({
      "src/t.ts": types,
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport function isAC(x: A | B | C) {\n  if (x.k === "c") throw new Error("c");\n  return x.k !== "b";\n}\n',
      "src/g.ts":
        'import type { A, B, C } from "./t";\nimport { isAC } from "./f";\ndeclare const v: A | B | C;\nif (isAC(v)) v.m();\n',
    }),
    edit: {
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport function isAC(x: A | B | C) {\n  return x.k !== "b";\n}\n',
    },
  },
  {
    // An assertion call (invariant style) added before the return.
    name: "pred-assert-call",
    files: T({
      "src/t.ts": types,
      "src/inv.ts":
        "export function invariant(c: unknown, m?: string): asserts c {\n  if (!c) throw new Error(m);\n}\n",
      "src/f.ts":
        'import type { A, B, C } from "./t";\nimport { invariant } from "./inv";\nexport function isAC(x: A | B | C) {\n  return x.k !== "b";\n}\n',
      "src/g.ts":
        'import type { A, B, C } from "./t";\nimport { isAC } from "./f";\ndeclare const v: A | B | C;\nif (isAC(v)) v.m();\n',
    }),
    edit: {
      "src/f.ts":
        'import type { A, B, C } from "./t";\nimport { invariant } from "./inv";\nexport function isAC(x: A | B | C) {\n  invariant(x.k !== "c", "no c");\n  return x.k !== "b";\n}\n',
    },
  },
  {
    // Predicate on an exported arrow variable: printed as `x is ...`.
    name: "pred-arrow-variable",
    files: T({
      "src/t.ts": types,
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport const isAC = (x: A | B | C) => {\n  return x.k !== "b";\n};\n',
      "src/g.ts":
        'import type { A, B, C } from "./t";\nimport { isAC } from "./f";\ndeclare const v: A | B | C;\nif (isAC(v)) v.m();\n',
    }),
    edit: {
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport const isAC = (x: A | B | C) => {\n  if (x.k === "c") throw new Error("c");\n  return x.k !== "b";\n};\n',
    },
  },
  {
    // Predicate as a method of an exported object literal.
    name: "pred-object-method",
    files: T({
      "src/t.ts": types,
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport const checks = {\n  isAC(x: A | B | C) {\n    return x.k !== "b";\n  },\n};\n',
      "src/g.ts":
        'import type { A, B, C } from "./t";\nimport { checks } from "./f";\ndeclare const v: A | B | C;\nif (checks.isAC(v)) v.m();\n',
    }),
    edit: {
      "src/f.ts":
        'import type { A, B, C } from "./t";\nexport const checks = {\n  isAC(x: A | B | C) {\n    if (x.k === "c") throw new Error("c");\n    return x.k !== "b";\n  },\n};\n',
    },
  },
  {
    // A JS predicate function (every JS body token compared).
    name: "pred-js-function",
    files: T({
      "src/t.ts": types,
      "src/f.js":
        '/** @param {import("./t").A | import("./t").B | import("./t").C} x */\nexport function isAC(x) {\n  return x.k !== "b";\n}\n',
      "src/g.ts":
        'import type { A, B, C } from "./t";\nimport { isAC } from "./f.js";\ndeclare const v: A | B | C;\nif (isAC(v)) v.m();\n',
    }),
    edit: {
      "src/f.js":
        '/** @param {import("./t").A | import("./t").B | import("./t").C} x */\nexport function isAC(x) {\n  if (x.k === "c") throw new Error("c");\n  return x.k !== "b";\n}\n',
    },
  },
];
