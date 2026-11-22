// SPDX-License-Identifier: MIT
// C-38: a TypeScript re-index that extracts only the edited file must leave
// the store identical, row for row, to a cold index of the edited tree. Each
// cross-file shape below is edited three ways: a body-only edit and a comment
// that moves every declaration (both may take the scoped path), and an edit
// another file can see (which must not). Each shape's visible edit is also
// run with the surface comparisons switched off (`trustSurface`), and the
// cold comparison must then catch the stale results.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import typescript, {
  statistics,
  typescriptModule,
} from "../dist/graph/languages/typescript/index.js";
import { producerStatistics } from "../dist/graph/languages/typescript/object-producers.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const cold = new LanguageRegistry([typescript]);

/**
 * Indexes `files`, then applies each step's edits (path → text) and indexes
 * again with `module`, comparing with a cold index after every index. A step
 * with `scoped` set asserts whether the module took the scoped path, and
 * with `reused` whether it reused every stored result without a program.
 */
async function equalAfterEdits(files, steps, module) {
  const base = mkdtempSync(join(tmpdir(), "c38-equality-"));
  const root = join(base, "tree");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  const incrementalPath = join(base, "incremental.sqlite");
  const incremental = new SqliteGraphStore(incrementalPath);
  const registry = new LanguageRegistry([module]);
  let n = 0;
  try {
    const compare = async (name, scoped, reused) => {
      const before = statistics.scoped;
      const reusedBefore = statistics.reused;
      await indexProject(root, registry, incremental);
      if (scoped !== undefined)
        assert.equal(
          statistics.scoped - before,
          scoped ? 1 : 0,
          `${name}: ${scoped ? "scoped" : "full"} path expected`,
        );
      if (reused !== undefined)
        assert.equal(
          statistics.reused - reusedBefore,
          reused ? 1 : 0,
          `${name}: stored results ${reused ? "" : "not "}reused`,
        );
      const coldPath = join(base, `cold-${n++}.sqlite`);
      const store = new SqliteGraphStore(coldPath, incremental.projectId);
      try {
        await indexProject(root, cold, store);
      } finally {
        store.close();
      }
      assert.deepEqual(
        compareRows(storeRows(incrementalPath), storeRows(coldPath)),
        [],
        `after ${name}`,
      );
    };
    await compare("first index");
    for (const step of steps) {
      for (const [path, text] of Object.entries(step.edit)) write(path, text);
      await compare(step.name, step.scoped, step.reused);
      step.check?.(incremental);
    }
  } finally {
    incremental.close();
    rmSync(base, { recursive: true, force: true });
  }
}

const tsconfig = (include = ["src"]) =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      allowJs: true,
      checkJs: true,
      noEmit: true,
    },
    include,
  });

/** A function in the edited file whose body the body-only edit changes. */
const TOUCH = "\nexport function touch(): number {\n  return 0;\n}\n";
const TOUCH_JS = "\nexport function touch() {\n  return 0;\n}\n";

/**
 * Each shape: the files, the edited file, and its visible edit. The edited
 * file ends with `touch` (TOUCH), so the body-only edit is the same for all.
 */
const SHAPES = [
  {
    name: "an exported signature",
    file: "src/f.ts",
    files: {
      "src/f.ts":
        "export function f(x: number): string {\n  return String(x);\n}\n" +
        TOUCH,
      "src/g.ts": 'import { f } from "./f";\nf(1).toUpperCase();\n',
    },
    edit: "export function f(x: number): number {\n  return x;\n}\n" + TOUCH,
  },
  {
    name: "an inferred return type changed by a body edit",
    file: "src/f.ts",
    files: {
      "src/f.ts":
        "class A {\n  a() {}\n}\nclass B {\n  b() {}\n}\nexport function make(x: A | B) {\n  if (x instanceof A) return x;\n  throw 0;\n}\n" +
        TOUCH,
      "src/g.ts":
        'import { make } from "./f";\ndeclare const v: never;\nmake(v).a();\n',
    },
    edit:
      "class A {\n  a() {}\n}\nclass B {\n  b() {}\n}\nexport function make(x: A | B) {\n  if (x instanceof B) return x;\n  throw 0;\n}\n" +
      TOUCH,
  },
  {
    name: "a re-export chain",
    file: "src/f.ts",
    files: {
      "src/f.ts": 'export function f(): string {\n  return "";\n}\n' + TOUCH,
      "src/m.ts": 'export * from "./f";\n',
      "src/g.ts": 'import { f } from "./m";\nf().toUpperCase();\n',
    },
    edit: "export function f(): number {\n  return 1;\n}\n" + TOUCH,
  },
  {
    name: "declaration merging",
    file: "src/f.ts",
    files: {
      "src/f.ts":
        "export function f() {}\nexport namespace f {\n  export const x = { a() {} };\n}\n" +
        TOUCH,
      "src/g.ts": 'import { f } from "./f";\nf.x.a();\n',
    },
    edit:
      "export function f() {}\nexport namespace f {\n  export const x = { b() {} };\n}\n" +
      TOUCH,
  },
  {
    name: "a module augmentation",
    file: "src/f.ts",
    scoped: false,
    files: {
      "src/base.ts":
        "export interface Box {\n  a(): void;\n}\nexport declare const box: Box;\n",
      "src/f.ts":
        'export {};\ndeclare module "./base" {\n  interface Box {\n    b(): void;\n  }\n}\n' +
        TOUCH,
      "src/g.ts": 'import { box } from "./base";\nbox.b();\n',
    },
    edit:
      'export {};\ndeclare module "./base" {\n  interface Box {\n    c(): void;\n  }\n}\n' +
      TOUCH,
  },
  {
    name: "an enum member",
    file: "src/f.ts",
    files: {
      // The member's value selects the overload another file calls.
      "src/f.ts": "export enum E {\n  A = 1,\n}\n" + TOUCH,
      "src/p.ts":
        "export function pick(x: 1): { one(): void };\nexport function pick(x: number): { other(): void };\nexport function pick(x: number) {\n  return { one() {}, other() {} };\n}\n",
      "src/g.ts":
        'import { E } from "./f";\nimport { pick } from "./p";\npick(E.A).one();\n',
    },
    edit: "export enum E {\n  A = 3,\n}\n" + TOUCH,
  },
  {
    name: "a class member used through inheritance elsewhere",
    file: "src/f.ts",
    files: {
      "src/f.ts":
        "export class Root {\n  m() {}\n}\nexport class Base extends Root {\n  m() {}\n}\n" +
        TOUCH,
      "src/g.ts":
        'import { Base } from "./f";\nclass D extends Base {}\nnew D().m();\n',
    },
    edit:
      "export class Root {\n  m() {}\n}\nexport class Base extends Root {}\n" +
      TOUCH,
  },
  {
    name: "overloads",
    file: "src/f.ts",
    files: {
      "src/f.ts":
        "export function f(x: string): string;\nexport function f(x: number): number;\nexport function f(x: unknown) {\n  return x;\n}\n" +
        TOUCH,
      "src/g.ts": 'import { f } from "./f";\nf(1).toFixed();\n',
    },
    edit:
      "export function f(x: string): string;\nexport function f(x: number): string;\nexport function f(x: unknown) {\n  return x;\n}\n" +
      TOUCH,
  },
  {
    name: "a default export",
    file: "src/f.ts",
    files: {
      "src/f.ts": "export default {\n  a() {},\n};\n" + TOUCH,
      "src/g.ts": 'import d from "./f";\nd.a();\n',
    },
    edit: "export default {\n  a: 1,\n};\n" + TOUCH,
  },
  {
    name: "export *",
    file: "src/f.ts",
    files: {
      "src/f.ts": "export const one = 1;\n" + TOUCH,
      "src/m.ts": 'export * from "./f";\n',
      "src/g.ts": 'import { two } from "./m";\ntwo;\n',
    },
    edit: "export const one = 1;\nexport const two = 2;\n" + TOUCH,
  },
  {
    name: "a type-only import",
    file: "src/f.ts",
    files: {
      "src/f.ts": "export interface T {\n  a(): void;\n}\n" + TOUCH,
      "src/g.ts":
        'import type { T } from "./f";\ndeclare const v: T;\nv.a().toString();\n',
    },
    edit: "export interface T {\n  a(): string;\n}\n" + TOUCH,
  },
  {
    name: "a JavaScript file with JSDoc types",
    file: "src/f.js",
    // In a JavaScript file every token of a body is compared (the binder
    // declares members from bodies there): a body edit is not scoped, a
    // comment is.
    bodyScoped: false,
    files: {
      "src/f.js":
        "/** @returns {string} */\nexport function f() {\n  return globalThis.value;\n}\n" +
        TOUCH_JS,
      "src/g.ts": 'import { f } from "./f.js";\nf().toUpperCase();\n',
    },
    edit:
      "/** @returns {number} */\nexport function f() {\n  return globalThis.value;\n}\n" +
      TOUCH_JS,
  },
  {
    name: "a workspace package",
    file: "packages/lib/index.ts",
    include: ["src", "packages"],
    files: {
      "package.json": JSON.stringify({
        name: "fixture",
        private: true,
        workspaces: ["packages/*"],
      }),
      "packages/lib/package.json": JSON.stringify({
        name: "@fixture/lib",
        version: "1.0.0",
        main: "index.ts",
      }),
      "packages/lib/index.ts":
        'export function helper(): string {\n  return "h";\n}\n' + TOUCH,
      "src/g.ts":
        'import { helper } from "@fixture/lib";\nhelper().toUpperCase();\n',
    },
    edit: "export function helper(): number {\n  return 1;\n}\n" + TOUCH,
  },
];

for (const shape of SHAPES) {
  const files = { "tsconfig.json": tsconfig(shape.include), ...shape.files };
  const text = shape.files[shape.file];
  const scoped = shape.scoped ?? true;
  const bodyScoped = shape.bodyScoped ?? scoped;
  test(`TypeScript re-index equals cold: ${shape.name}`, async () => {
    await equalAfterEdits(
      files,
      [
        {
          name: "a body-only edit",
          edit: {
            [shape.file]: text.replace("  return 0;", "  void 0;\n  return 0;"),
          },
          scoped: bodyScoped,
        },
        {
          name: "a comment that moves every declaration",
          edit: {
            [shape.file]:
              "// moved\n" +
              text.replace("  return 0;", "  void 0;\n  return 0;"),
          },
          scoped,
        },
        { name: shape.name, edit: { [shape.file]: shape.edit }, scoped: false },
      ],
      typescriptModule(),
    );
  });
  test(`TypeScript re-index without the surface comparisons is caught: ${shape.name}`, async () => {
    await assert.rejects(
      equalAfterEdits(
        files,
        [
          {
            name: shape.name,
            edit: { [shape.file]: shape.edit },
            // It must really take the scoped path, so the stale results are
            // what the comparison sees.
            scoped: true,
          },
        ],
        typescriptModule({ trustSurface: true }),
      ),
      (error) => error.message.startsWith(`after ${shape.name}`),
    );
  });
}

/** The stored result's data of `path`. */
const dataOf = (store, path) => store.getFile(path).result.data;

test("TypeScript re-index equals cold: the body of an exported arrow function", async () => {
  // Hono's shape: `export const splitPath = (path: string): string[] => {…}`.
  const f =
    'export const split = (path: string): string[] => {\n  return path.split("/");\n};\n';
  await equalAfterEdits(
    {
      "tsconfig.json": tsconfig(),
      "src/f.ts": f,
      "src/g.ts": 'import { split } from "./f";\nsplit("a").map((x) => x);\n',
    },
    [
      {
        name: "a statement in the arrow function's body",
        edit: { "src/f.ts": f.replace("=> {\n", "=> {\n  void 0;\n") },
        scoped: true,
      },
      {
        name: "its returned value",
        edit: {
          "src/f.ts": f.replace('path.split("/")', 'path.split("/").reverse()'),
        },
        scoped: false,
      },
    ],
    typescriptModule(),
  );
});

test("TypeScript re-index equals cold: a file of two tied projects", async () => {
  const f = "export function f(): string {\n  return 'f';\n}\n" + TOUCH;
  // Hono's layout: a solution config references a build and a spec config,
  // both of which include the sources.
  await equalAfterEdits(
    {
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [
          { path: "./tsconfig.build.json" },
          { path: "./tsconfig.spec.json" },
        ],
      }),
      "tsconfig.build.json": tsconfig(),
      "tsconfig.spec.json": tsconfig(),
      "src/f.ts": f,
      "src/g.ts": 'import { f } from "./f";\nf().toUpperCase();\n',
    },
    [
      {
        name: "a body-only edit",
        edit: {
          "src/f.ts": f.replace("  return 0;", "  void 0;\n  return 0;"),
        },
        scoped: true,
        // Both projects analysed the file: its result is their merge.
        check: (store) =>
          assert.deepEqual(dataOf(store, "src/f.ts").loadedBy, [
            "tsconfig.build.json",
            "tsconfig.spec.json",
          ]),
      },
      {
        name: "its signature",
        edit: { "src/f.ts": f.replace("(): string", "(): number") },
        scoped: false,
      },
    ],
    typescriptModule(),
  );
});

test("TypeScript re-index equals cold: a file another project loads under other options", async () => {
  // The test project reads src/f.ts without strict null checks: the edit
  // is compared in both programs.
  const f = "export function f(x?: string) {\n  return x;\n}\n" + TOUCH;
  await equalAfterEdits(
    {
      "tsconfig.json": tsconfig(),
      "test/tsconfig.json": JSON.stringify({
        compilerOptions: {
          ...JSON.parse(tsconfig()).compilerOptions,
          strict: false,
        },
        include: ["."],
      }),
      "src/f.ts": f,
      "test/g.ts": 'import { f } from "../src/f";\nf("x").toUpperCase();\n',
    },
    [
      {
        name: "a body-only edit",
        edit: {
          "src/f.ts": f.replace("  return 0;", "  void 0;\n  return 0;"),
        },
        scoped: true,
        check: (store) =>
          assert.deepEqual(dataOf(store, "src/f.ts").loadedBy, [
            "test/tsconfig.json",
            "tsconfig.json",
          ]),
      },
      {
        name: "a return type only the strict program sees",
        edit: {
          "src/f.ts": f.replace("return x;", "return x ?? undefined;"),
        },
        scoped: false,
      },
    ],
    typescriptModule(),
  );
});

test("TypeScript re-index equals cold: a failed file in a project that does not load the edited one", async () => {
  const f = "export function f(): string {\n  return 'f';\n}\n" + TOUCH;
  await equalAfterEdits(
    {
      "tsconfig.json": tsconfig(),
      "fixtures/tsconfig.json": JSON.stringify({ include: ["."] }),
      "fixtures/broken.ts": "export const = ;\n",
      "src/f.ts": f,
      "src/g.ts": 'import { f } from "./f";\nf().toUpperCase();\n',
    },
    [
      {
        name: "a body-only edit beside a failed file",
        edit: {
          "src/f.ts": f.replace("  return 0;", "  void 0;\n  return 0;"),
        },
        scoped: true,
      },
    ],
    typescriptModule(),
  );
});

test("TypeScript re-index equals cold: a broken config elsewhere, retried on every index", async () => {
  // trpc's Nuxt examples: a config extends a generated file that is missing,
  // so the files it governs fail, and the core retries them every time.
  const f = "export function f(): string {\n  return 'f';\n}\n" + TOUCH;
  await equalAfterEdits(
    {
      "tsconfig.json": tsconfig(),
      "examples/tsconfig.json": JSON.stringify({
        extends: "./.generated/tsconfig.json",
        include: ["."],
      }),
      "examples/app.ts": "export const app = 1;\n",
      "src/f.ts": f,
      "src/g.ts": 'import { f } from "./f";\nf().toUpperCase();\n',
    },
    [
      {
        name: "a body-only edit beside the broken config",
        edit: {
          "src/f.ts": f.replace("  return 0;", "  void 0;\n  return 0;"),
        },
        scoped: true,
      },
      {
        // Only the retried files changed: no program is built.
        name: "a re-index with no edit",
        edit: {},
        scoped: false,
        reused: true,
      },
      {
        name: "an edit of the file the broken config governs",
        edit: { "examples/app.ts": "export const app = 2;\n" },
        scoped: false,
      },
    ],
    typescriptModule(),
  );
});

// A failed file in the edited file's own program (vite's syntax-error
// fixtures). Unreferenced and declaring no global name, it leaves the
// failed-file walk empty: scoped. Imported by another file, or a script
// whose global names other files may use: not scoped.
for (const [name, broken, g, scoped] of [
  [
    "an unreferenced failed file in the edited file's program",
    "export const = ;\n",
    'import { f } from "./f";\nf().toUpperCase();\n',
    true,
  ],
  [
    // vite's syntax-error-dep.ts: `import './syntax-error.ts'`.
    "a failed file only a side-effect import reads",
    "export const = ;\n",
    'import { f } from "./f";\nimport "./broken";\nf().toUpperCase();\n',
    true,
  ],
  [
    "a failed file another file imports",
    "export const = ;\n",
    'import { f } from "./f";\nimport { x } from "./broken";\nf().toUpperCase();\nx;\n',
    false,
  ],
  [
    "a failed script that declares a global name",
    "function shared() {}\nconst = ;\n",
    'import { f } from "./f";\nf().toUpperCase();\n',
    false,
  ],
])
  test(`TypeScript re-index equals cold: ${name}`, async () => {
    const f = "export function f(): string {\n  return 'f';\n}\n" + TOUCH;
    await equalAfterEdits(
      {
        "tsconfig.json": tsconfig(),
        "src/broken.ts": broken,
        "src/f.ts": f,
        "src/g.ts": g,
      },
      [
        {
          name: "a body-only edit",
          edit: {
            "src/f.ts": f.replace("  return 0;", "  void 0;\n  return 0;"),
          },
          scoped,
        },
      ],
      typescriptModule(),
    );
  });

test("TypeScript re-index equals cold: a duplicate installed package the compiler redirects", async () => {
  // The same package name and version under two node_modules folders: the
  // compiler reads one and redirects the other to it (excalidraw's install).
  const dup = {
    "package.json": JSON.stringify({
      name: "dup",
      version: "1.0.0",
      types: "index.d.ts",
    }),
    "index.d.ts": "export declare class D {\n  m(): void;\n}\n",
  };
  const installed = {};
  for (const owner of ["a", "b"]) {
    installed[`node_modules/${owner}/package.json`] = JSON.stringify({
      name: owner,
      version: "1.0.0",
      types: "index.d.ts",
    });
    installed[`node_modules/${owner}/index.d.ts`] =
      'export { D } from "dup";\n';
    for (const [name, text] of Object.entries(dup))
      installed[`node_modules/${owner}/node_modules/dup/${name}`] = text;
  }
  const f =
    'import { D as A } from "a";\nimport { D as B } from "b";\nexport const pair = (a: A, b: B) => [a, b] as const;\n' +
    TOUCH;
  await equalAfterEdits(
    {
      "package.json": JSON.stringify({
        name: "fixture",
        private: true,
        dependencies: { a: "1.0.0", b: "1.0.0" },
      }),
      "tsconfig.json": tsconfig(),
      ...installed,
      "src/f.ts": f,
      "src/g.ts":
        'import { pair } from "./f";\ndeclare const a: never;\npair(a, a)[0].m();\n',
    },
    [
      {
        name: "a body-only edit beside the redirected package",
        edit: {
          "src/f.ts": f.replace("  return 0;", "  void 0;\n  return 0;"),
        },
        scoped: true,
      },
    ],
    typescriptModule(),
  );
});

test("TypeScript re-index equals cold: a project reference reads the edited file's source", async () => {
  // Excalidraw's layout: the app program reads the library through a
  // project reference, so the compiler redirects to the library's source.
  const lib = "export function helper(): string {\n  return 'h';\n}\n" + TOUCH;
  const options = JSON.parse(tsconfig()).compilerOptions;
  await equalAfterEdits(
    {
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./packages/lib" }, { path: "./packages/app" }],
      }),
      "packages/lib/tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, composite: true, noEmit: false },
        include: ["."],
      }),
      "packages/app/tsconfig.json": JSON.stringify({
        compilerOptions: { ...options, composite: true, noEmit: false },
        references: [{ path: "../lib" }],
        include: ["."],
      }),
      "packages/lib/index.ts": lib,
      "packages/app/main.ts":
        'import { helper } from "../lib/index";\nhelper().toUpperCase();\n',
    },
    [
      {
        name: "a body-only edit in the library",
        edit: {
          "packages/lib/index.ts": lib.replace(
            "  return 0;",
            "  void 0;\n  return 0;",
          ),
        },
        scoped: true,
      },
      {
        name: "the library's signature",
        edit: {
          "packages/lib/index.ts": lib.replace("(): string", "(): number"),
        },
        scoped: false,
      },
    ],
    typescriptModule(),
  );
});

test("TypeScript re-index equals cold: an object-producer lookup cut by its depth limit is not scoped", async () => {
  // `v40.m()` reads the object `make` returns through 41 bindings, past the
  // lookup's depth limit. A cut lookup's answer can depend on what other
  // files' lookups cached in a full analysis (a cached `v20` would answer
  // it), so the edited file is not extracted alone (object-producers.ts).
  let chain =
    "function make() {\n  return { m() {} };\n}\nconst v0 = make();\n";
  for (let i = 1; i <= 40; i++) chain += `const v${i} = v${i - 1};\n`;
  const f = chain + "v40.m();\nexport { v20 };\n" + TOUCH;
  const before = producerStatistics.cuts;
  await equalAfterEdits(
    {
      "tsconfig.json": tsconfig(),
      "src/f.ts": f,
      "src/g.ts": 'import { v20 } from "./f";\nv20.m();\n',
    },
    [
      {
        name: "a body-only edit beside the cut lookup",
        edit: {
          "src/f.ts": f.replace("  return 0;", "  void 0;\n  return 0;"),
        },
        scoped: false,
      },
    ],
    typescriptModule(),
  );
  assert.ok(producerStatistics.cuts > before, "the fixture's lookup is cut");
});

// What a function body can contribute to what another file links to (the
// C-38 review). Each edit changes only a body; each must leave the store
// equal to cold. The audit in docs/changes/C-38.md lists every family.
const BODY_CASES = [
  // JavaScript: the binder declares members from statements in bodies.
  {
    name: "a JS constructor's this.x value",
    files: {
      "src/a.js":
        "export class Foo {\n  constructor() {\n    this.x = 1;\n  }\n}\n",
      "src/b.ts":
        'import { Foo } from "./a.js";\nnew Foo().x.b.toFixed();\nnew Foo().x.toFixed();\n',
    },
    edit: {
      "src/a.js":
        "export class Foo {\n  constructor() {\n    this.x = { b: 1 };\n  }\n}\n",
    },
  },
  {
    name: "JSDoc on a this.x assignment in a JS constructor",
    files: {
      "src/c.js":
        "export class Item {\n  m() {}\n}\nexport class Other {\n  n() {}\n}\n",
      "src/a.js":
        'import { Item, Other } from "./c.js";\nexport class Foo {\n  constructor() {\n    /** @type {Item | null} */\n    this.x = null;\n  }\n}\n',
      "src/b.ts":
        'import { Foo } from "./a.js";\nnew Foo().x?.m();\nnew Foo().x?.n();\n',
    },
    edit: {
      "src/a.js":
        'import { Item, Other } from "./c.js";\nexport class Foo {\n  constructor() {\n    /** @type {Other | null} */\n    this.x = null;\n  }\n}\n',
    },
  },
  {
    name: "a JS method's this.x value",
    files: {
      "src/c.js": "export class Item {\n  m() {}\n}\n",
      "src/a.js":
        'import { Item } from "./c.js";\nexport class Foo {\n  init() {\n    this.x = 1;\n  }\n}\n',
      "src/b.js": 'import { Foo } from "./a.js";\nnew Foo().x.m();\n',
    },
    edit: {
      "src/a.js":
        'import { Item } from "./c.js";\nexport class Foo {\n  init() {\n    this.x = new Item();\n  }\n}\n',
    },
  },
  {
    name: "an ES5 constructor function's this.x value",
    files: {
      "src/a.js": "export function Foo() {\n  this.x = 1;\n}\n",
      "src/b.js": 'import { Foo } from "./a.js";\nnew Foo().x.b;\n',
    },
    edit: { "src/a.js": "export function Foo() {\n  this.x = { b: 1 };\n}\n" },
  },
  {
    name: "a JSDoc typedef inside a JS function body",
    files: {
      "src/a.js":
        "export function f() {\n  /** @typedef {{ run(): void }} Task */\n  return 0;\n}\n",
      "src/b.ts":
        'declare const t: import("./a.js").Task;\nt.run();\n',
    },
    edit: {
      "src/a.js":
        "export function f() {\n  /** @typedef {{ stop(): void }} Task */\n  return 0;\n}\n",
    },
  },
  // TypeScript: a body-local declaration escapes through an inferred type.
  {
    name: "a member added to a local class a function returns",
    files: {
      "src/f.ts":
        "export function make() {\n  class Local {\n    a() {}\n  }\n  return new Local();\n}\n",
      "src/g.ts": 'import { make } from "./f";\nmake().a();\nmake().b();\n',
    },
    edit: {
      "src/f.ts":
        "export function make() {\n  class Local {\n    a() {}\n    b() {}\n  }\n  return new Local();\n}\n",
    },
  },
  {
    name: "a member added to a local interface a function returns",
    files: {
      "src/f.ts":
        "export function load(s: string) {\n  interface R {\n    a: number;\n  }\n  return JSON.parse(s) as R;\n}\n",
      "src/g.ts": 'import { load } from "./f";\nload("").a;\nload("").b;\n',
    },
    edit: {
      "src/f.ts":
        "export function load(s: string) {\n  interface R {\n    a: number;\n    b: string;\n  }\n  return JSON.parse(s) as R;\n}\n",
    },
  },
  {
    name: "two same-named local classes whose members swap",
    files: {
      "src/f.ts":
        "export function make(k: boolean) {\n  class Local {\n    a() {}\n  }\n  if (k) {\n    class Local {\n      b() {}\n    }\n  }\n  return new Local();\n}\n",
      "src/g.ts": 'import { make } from "./f";\nmake(true).a();\n',
    },
    edit: {
      "src/f.ts":
        "export function make(k: boolean) {\n  class Local {\n    b() {}\n  }\n  if (k) {\n    class Local {\n      a() {}\n    }\n  }\n  return new Local();\n}\n",
    },
  },
  {
    name: "a mixin class declared in a function body",
    files: {
      "src/f.ts":
        "type Ctor = new (...args: any[]) => {};\nexport function Tagged<T extends Ctor>(Base: T) {\n  class WithTag extends Base {\n    tag() {}\n  }\n  return WithTag;\n}\n",
      "src/g.ts":
        'import { Tagged } from "./f";\nclass A {}\nconst B = Tagged(A);\nnew B().tag();\nnew B().untag();\n',
    },
    edit: {
      "src/f.ts":
        "type Ctor = new (...args: any[]) => {};\nexport function Tagged<T extends Ctor>(Base: T) {\n  class WithTag extends Base {\n    tag() {}\n    untag() {}\n  }\n  return WithTag;\n}\n",
    },
  },
  {
    name: "a local class reached through a generic's inferred argument",
    files: {
      "src/f.ts":
        "function wrap<T>(make: () => T): { value: T } {\n  return { value: make() };\n}\nexport const box = wrap(() => {\n  class L {\n    a() {}\n  }\n  return new L();\n});\n",
      "src/g.ts": 'import { box } from "./f";\nbox.value.a();\nbox.value.b();\n',
    },
    edit: {
      "src/f.ts":
        "function wrap<T>(make: () => T): { value: T } {\n  return { value: make() };\n}\nexport const box = wrap(() => {\n  class L {\n    a() {}\n    b() {}\n  }\n  return new L();\n});\n",
    },
  },
  {
    name: "a class property initialised from a local class",
    files: {
      "src/f.ts":
        "export class C {\n  p = (() => {\n    class L {\n      a() {}\n    }\n    return new L();\n  })();\n}\n",
      "src/g.ts": 'import { C } from "./f";\nnew C().p.a();\nnew C().p.b();\n',
    },
    edit: {
      "src/f.ts":
        "export class C {\n  p = (() => {\n    class L {\n      a() {}\n      b() {}\n    }\n    return new L();\n  })();\n}\n",
    },
  },
  {
    name: "a returned value assigned through a let in the body",
    files: {
      "src/c.ts": "export class Item {\n  m() {}\n}\n",
      "src/d.ts": "export class Item {\n  n() {}\n}\n",
      "src/f.ts":
        'import { Item } from "./c";\nimport * as D from "./d";\nexport function make() {\n  let r;\n  r = new Item();\n  return r;\n}\n',
      "src/g.ts": 'import { make } from "./f";\nmake().m();\nmake().n();\n',
    },
    edit: {
      "src/f.ts":
        'import { Item } from "./c";\nimport * as D from "./d";\nexport function make() {\n  let r;\n  r = new D.Item();\n  return r;\n}\n',
    },
  },
];

for (const { name, files, edit } of BODY_CASES)
  test(`TypeScript re-index equals cold: ${name}`, async () => {
    await equalAfterEdits(
      { "tsconfig.json": tsconfig(), ...files },
      [{ name, edit, scoped: false }],
      typescriptModule(),
    );
  });
