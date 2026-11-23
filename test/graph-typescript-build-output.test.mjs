// SPDX-License-Identifier: MIT
// C-46: a workspace package entry that points at build output missing from
// an unbuilt checkout, with no compiler proof (C-25), followed to the one
// source a stated convention names, assumption-marked: a bundler config's
// literal entry list, an API Extractor roll-up's main entry, or the `src/`
// twin of the output path. Existing output always wins.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

const root = {
  "package.json": '{"private":true,"workspaces":["packages/*"]}',
  "tsconfig.json":
    '{"compilerOptions":{"strict":true,"module":"ESNext","moduleResolution":"Bundler","target":"ES2022"},"files":["app.ts"]}',
};

/** Each `calls` link in app.ts by its callee text: the target's
 * `file#identity` and assumptions, or `<resolution>:<reason>`. */
async function calls(files) {
  const scratch = await mkdtemp(join(tmpdir(), "c46-"));
  const dir = join(scratch, "project");
  const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), "c46");
  try {
    for (const [path, text] of Object.entries({ ...root, ...files })) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), text);
    }
    const report = await indexProject(
      dir,
      new LanguageRegistry([typescript]),
      store,
    );
    assert.deepEqual(report.analysisErrors, []);
    const symbols = new Map(
      store.findSymbols().map((s) => [s.id, `${s.file}#${s.identity}`]),
    );
    const out = {};
    for (const link of store.links()) {
      if (link.file !== "app.ts" || link.kind !== "calls") continue;
      out[link.targetName] =
        link.resolution === "resolved"
          ? [
              symbols.get(link.targetId),
              link.data?.assumes ?? [],
              link.data?.unbuiltEntry?.source,
            ]
          : `${link.resolution}:${link.data?.reason ?? ""}`;
    }
    return out;
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

const pkg = (name, fields) =>
  JSON.stringify({ name, version: "1.0.0", ...fields });

test("the src/ twin of a missing output: one or two output folders, any source extension", async () => {
  const got = await calls({
    "packages/a/package.json": pkg("a", {
      types: "./dist/index.d.ts",
      scripts: { build: "tsup" },
    }),
    "packages/a/src/index.ts": "export function a() {}",
    "packages/b/package.json": pkg("b", {
      exports: {
        ".": { types: "./dist/types/index.d.ts" },
        "./tool": { import: "./dist/tool.mjs" },
      },
      scripts: { build: "node scripts/build.mjs" },
    }),
    "packages/b/src/index.ts": "export function b() {}",
    "packages/b/src/tool.mts": "export function tool() {}",
    "app.ts":
      'import { a } from "a"; import { b } from "b"; import { tool } from "b/tool"; a(); b(); tool();',
  });
  assert.deepEqual(got, {
    a: [
      "packages/a/src/index.ts#a",
      ["ts-unbuilt-entry-is-src-twin"],
      "packages/a/src/index.ts",
    ],
    b: [
      "packages/b/src/index.ts#b",
      ["ts-unbuilt-entry-is-src-twin"],
      "packages/b/src/index.ts",
    ],
    tool: [
      "packages/b/src/tool.mts#tool",
      ["ts-unbuilt-entry-is-src-twin"],
      "packages/b/src/tool.mts",
    ],
  });
});

test("a bundler config's literal entries name the source, through a top-level const and a helper call", async () => {
  // Vitest's shape: `input: dtsUtils.dtsInput(dtsEntries)`, keyed by output name.
  const got = await calls({
    "packages/v/package.json": pkg("v", {
      exports: {
        ".": { types: "./dist/index.d.ts" },
        "./node": { types: "./dist/node.d.ts" },
      },
      scripts: { build: "rollup -c" },
    }),
    "packages/v/rollup.config.js": [
      'import { helpers } from "./helpers.js";',
      "const dtsEntries = {",
      "  index: 'src/public/index.ts',",
      "  node: 'src/public/node.ts',",
      "};",
      "export default [{ input: helpers.dtsInput(dtsEntries), output: { dir: 'dist' } }];",
      "",
    ].join("\n"),
    "packages/v/src/public/index.ts": "export function run() {}",
    "packages/v/src/public/node.ts": "export function serve() {}",
    // A twin that the config contradicts: never chosen.
    "packages/v/src/index.ts": "export function run() {}",
    "app.ts":
      'import { run } from "v"; import { serve } from "v/node"; run(); serve();',
  });
  assert.deepEqual(got, {
    run: [
      "packages/v/src/public/index.ts#run",
      ["ts-unbuilt-entry-is-bundler-entry"],
      "packages/v/src/public/index.ts",
    ],
    serve: [
      "packages/v/src/public/node.ts#serve",
      ["ts-unbuilt-entry-is-bundler-entry"],
      "packages/v/src/public/node.ts",
    ],
  });
});

test("readable entries that list other outputs, two configs that disagree, or no source leave the link unresolved", async () => {
  const got = await calls({
    // The tsup config lists only `cli`; `dist/index.d.ts` is not its output.
    "packages/other/package.json": pkg("other", {
      types: "./dist/index.d.ts",
      scripts: { build: "tsup" },
    }),
    "packages/other/tsup.config.ts":
      'import { defineConfig } from "tsup"; export default defineConfig({ entry: { cli: "src/cli.ts" } });',
    "packages/other/src/cli.ts": "export function cli() {}",
    "packages/other/src/index.ts": "export function other() {}",
    // Two configs name different sources for the same output.
    "packages/split/package.json": pkg("split", {
      types: "./dist/index.d.ts",
      scripts: { build: "tsup && vite build" },
    }),
    "packages/split/tsup.config.ts":
      'export default { entry: { index: "src/one.ts" } };',
    "packages/split/rollup.config.mjs":
      'export default { input: { index: "src/two.ts" } };',
    "packages/split/src/one.ts": "export function split() {}",
    "packages/split/src/two.ts": "export function split() {}",
    // A generated entry with no source.
    "packages/gen/package.json": pkg("gen", {
      types: "./dist/generated.d.ts",
      scripts: { build: "node codegen.mjs" },
    }),
    "packages/gen/src/index.ts": "export function gen() {}",
    "app.ts": [
      'import { other } from "other";',
      'import { split } from "split";',
      'import { gen } from "gen";',
      "other(); split(); gen();",
    ].join("\n"),
  });
  for (const name of ["other", "split", "gen"])
    assert.match(String(got[name]), /^unresolved:workspace-/, name);
});

test("existing output wins over every convention", async () => {
  const got = await calls({
    "packages/built/package.json": pkg("built", {
      types: "./dist/index.d.ts",
      scripts: { build: "tsup" },
    }),
    "packages/built/dist/index.d.ts": "export declare function built(): void;",
    "packages/built/src/index.ts": "export function built() {}",
    "app.ts": 'import { built } from "built"; built();',
  });
  assert.equal(got.built[0], "packages/built/dist/index.d.ts#built");
  assert.deepEqual(got.built[1], []);
});

test("an API Extractor roll-up follows its main entry; trimmed @internal declarations are withheld, @beta trimming has no route", async () => {
  const extractor = (trim, path) =>
    JSON.stringify({
      mainEntryPointFilePath: "<projectFolder>/lib/esm/core.d.ts",
      dtsRollup: { enabled: true, [trim]: path },
    });
  const got = await calls({
    // Puppeteer's shape: `lib/types.d.ts` is the alpha-trimmed roll-up of
    // `lib/esm/core.d.ts`, which the package's tsconfig emits from src/core.ts.
    "packages/core/package.json": pkg("core", {
      types: "./lib/types.d.ts",
      scripts: { build: "wireit" },
      wireit: { build: { command: "tsc -b && api-extractor run" } },
    }),
    "packages/core/tsconfig.json":
      '{"compilerOptions":{"declaration":true,"rootDir":"src","outDir":"lib/esm"},"include":["src"]}',
    "packages/core/api-extractor.json": extractor(
      "alphaTrimmedFilePath",
      "lib/types.d.ts",
    ),
    "packages/core/src/core.ts":
      "export function launch() {}\n/** @internal */\nexport function secret() {}\n",
    // Public trimming drops @beta declarations, which cannot be withheld one by one.
    "packages/beta/package.json": pkg("beta", {
      types: "./lib/types.d.ts",
      scripts: { build: "api-extractor run" },
    }),
    "packages/beta/tsconfig.json":
      '{"compilerOptions":{"declaration":true,"rootDir":"src","outDir":"lib/esm"},"include":["src"]}',
    "packages/beta/api-extractor.json": extractor(
      "publicTrimmedFilePath",
      "lib/types.d.ts",
    ),
    "packages/beta/src/core.ts":
      "export function open() {}\n/** @beta */\nexport function preview() {}\n",
    "app.ts": [
      'import { launch, secret } from "core";',
      'import { open } from "beta";',
      "launch(); secret(); open();",
    ].join("\n"),
  });
  assert.deepEqual(got.launch, [
    "packages/core/src/core.ts#launch",
    ["ts-unbuilt-entry-is-rollup-entry"],
    "packages/core/src/core.ts",
  ]);
  assert.match(String(got.secret), /^unresolved:/);
  assert.match(String(got.open), /^unresolved:workspace-/);
});

test("a config a script names with -c, and the compiler emit under Wireit or beside a roll-up", async () => {
  const got = await calls({
    // React Hook Form's shape: `rollup -c ./scripts/rollup/rollup.config.js`.
    "packages/named/package.json": pkg("named", {
      types: "./dist/index.d.ts",
      scripts: { build: "rollup -c ./scripts/rollup/rollup.config.js" },
    }),
    "packages/named/scripts/rollup/rollup.config.js":
      'export default { input: { index: "src/main.ts" }, output: { dir: "dist" } };',
    "packages/named/src/main.ts": "export function named() {}",
    // Puppeteer's shape: `./internal/*` is per-file tsc output beside an
    // API Extractor roll-up of another entry, built under Wireit.
    "packages/core/package.json": pkg("core", {
      types: "./lib/types.d.ts",
      exports: {
        ".": { types: "./lib/types.d.ts" },
        "./internal/*": { import: "./lib/out/*" },
      },
      scripts: { build: "wireit" },
      wireit: { build: { command: "tsc -b && api-extractor run" } },
    }),
    "packages/core/tsconfig.json":
      '{"compilerOptions":{"declaration":true,"rootDir":"src","outDir":"lib/out"},"include":["src"]}',
    "packages/core/api-extractor.json": JSON.stringify({
      mainEntryPointFilePath: "<projectFolder>/lib/out/index.d.ts",
      dtsRollup: { enabled: true, untrimmedFilePath: "lib/types.d.ts" },
    }),
    "packages/core/src/index.ts": 'export { Page } from "./api/Page.js";',
    "packages/core/src/api/Page.ts": "export class Page { goto() {} }",
    "app.ts": [
      'import { named } from "named";',
      'import { Page } from "core/internal/api/Page.js";',
      "named();",
      "new Page().goto();",
    ].join("\n"),
  });
  assert.deepEqual(got.named, [
    "packages/named/src/main.ts#named",
    ["ts-unbuilt-entry-is-bundler-entry"],
    "packages/named/src/main.ts",
  ]);
  const goto = got["(expression).goto"];
  assert.deepEqual(goto, [
    "packages/core/src/api/Page.ts#Page.goto",
    ["ts-unbuilt-entry-is-wrapped-compiler-emit"],
    "packages/core/src/api/Page.ts",
  ]);
});

test("PR 67 review: rollup output.file, unreadable roll-ups block the twin, stripInternal from every governing config", async () => {
  const got = await calls({
    // rollup-plugin-dts: `input` beside `output.file` names the roll-up's source.
    "packages/r/package.json": pkg("r", {
      types: "./dist/bundle.d.ts",
      scripts: { build: "rollup -c" },
    }),
    "packages/r/rollup.config.mjs":
      "export default [{ input: 'src/main.ts', output: { file: 'dist/bundle.d.ts', format: 'es' } }];",
    "packages/r/src/main.ts": "export function rolled() {}",
    "packages/r/src/bundle.ts": "export function twin() {}",
    // An API Extractor config that does not parse: its roll-up may write the
    // entry, so the twin does not apply.
    "packages/x/package.json": pkg("x", {
      types: "./dist/index.d.ts",
      scripts: { build: "api-extractor run" },
    }),
    "packages/x/api-extractor.json": "{ mainEntryPointFilePath: ",
    "packages/x/src/index.ts": "export function broken() {}",
    // A roll-up field with a token the walk does not expand.
    "packages/y/package.json": pkg("y", {
      types: "./dist/index.d.ts",
      scripts: { build: "api-extractor run" },
    }),
    "packages/y/api-extractor.json": JSON.stringify({
      mainEntryPointFilePath: "<projectFolder>/temp/<unscopedPackageName>.d.ts",
      dtsRollup: {
        enabled: true,
        untrimmedFilePath: "<projectFolder>/dist/index.d.ts",
      },
    }),
    "packages/y/src/index.ts": "export function tokened() {}",
    // A rollup config whose entries are not data.
    "packages/z/package.json": pkg("z", {
      types: "./dist/index.d.ts",
      scripts: { build: "rollup -c" },
    }),
    "packages/z/rollup.config.mjs":
      "import { entries } from './entries.mjs';\nexport default { input: entries(), output: { dir: 'dist' } };",
    "packages/z/src/index.ts": "export function opaque() {}",
    // A build config outside the package governs its sources with stripInternal.
    "packages/s/package.json": pkg("s", {
      types: "./dist/index.d.ts",
      scripts: { build: "tsup" },
    }),
    "packages/s/src/index.ts":
      "export function open() {}\n/** @internal */\nexport function hidden() {}\n",
    "tsconfig.build.json":
      '{"compilerOptions":{"stripInternal":true,"declaration":true,"noEmit":false},"include":["packages/s/src"]}',
    "app.ts": [
      'import { rolled } from "r";',
      'import { broken } from "x";',
      'import { tokened } from "y";',
      'import { opaque } from "z";',
      'import { open, hidden } from "s";',
      "rolled(); broken(); tokened(); opaque(); open(); hidden();",
    ].join("\n"),
  });
  assert.deepEqual(got.rolled, [
    "packages/r/src/main.ts#rolled",
    ["ts-unbuilt-entry-is-bundler-entry"],
    "packages/r/src/main.ts",
  ]);
  for (const name of ["broken", "tokened", "opaque"])
    assert.match(String(got[name]), /^unresolved:workspace-/, name);
  assert.deepEqual(got.open, [
    "packages/s/src/index.ts#open",
    ["ts-unbuilt-entry-is-src-twin"],
    "packages/s/src/index.ts",
  ]);
  assert.match(String(got.hidden), /^unresolved:/);
});

test("PR 67 review: the pass without assumed entries extracts only the files that can see one", async () => {
  // Cold cost: the neutral program re-extracted every file of the program.
  const unrelated = Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [
      `lib/u${i}.ts`,
      `export function u${i}() { return ${i}; }\n`,
    ]),
  );
  const before = { ...statistics };
  const got = await calls({
    "tsconfig.json":
      '{"compilerOptions":{"strict":true,"module":"ESNext","moduleResolution":"Bundler","target":"ES2022"},"files":["app.ts","lib/u0.ts","lib/u1.ts","lib/u2.ts","lib/u3.ts","lib/u4.ts","lib/u5.ts"]}',
    "packages/a/package.json": pkg("a", {
      types: "./dist/index.d.ts",
      scripts: { build: "tsup" },
    }),
    "packages/a/src/index.ts": "export function a() {}",
    ...unrelated,
    "app.ts": 'import { a } from "a"; a();',
  });
  assert.deepEqual(got.a, [
    "packages/a/src/index.ts#a",
    ["ts-unbuilt-entry-is-src-twin"],
    "packages/a/src/index.ts",
  ]);
  const extracted = statistics.neutralExtracted - before.neutralExtracted;
  // app.ts and the entry's source, not the six unrelated files.
  assert.ok(
    extracted > 0 && extracted <= 2,
    `neutral extractions: ${extracted}`,
  );
});

test("PR 67 review 2: a noEmit package config that strips internals withholds @internal declarations", async () => {
  // Vitest's shape: tsconfig.base.json sets noEmit and stripInternal, the
  // package config extends it, the bundler builds the declarations.
  const got = await calls({
    "packages/v/package.json": pkg("v", {
      exports: { ".": { types: "./dist/index.d.ts" } },
      scripts: { build: "rollup -c" },
    }),
    "packages/v/tsconfig.json":
      '{"compilerOptions":{"declaration":true,"noEmit":true,"stripInternal":true},"include":["src"]}',
    "packages/v/rollup.config.js":
      "export default { input: { index: 'src/index.ts' } };",
    "packages/v/src/index.ts": [
      "export class Core {",
      "  open() {}",
      "  /** @internal */",
      "  rerunFiles() {}",
      "}",
      "/** @internal */",
      "export function hidden() {}",
      "export function shown() {}",
      "",
    ].join("\n"),
    "app.ts": [
      'import { Core, hidden, shown } from "v";',
      "const core = new Core();",
      "core.open(); core.rerunFiles(); hidden(); shown();",
    ].join("\n"),
  });
  assert.deepEqual(got.shown, [
    "packages/v/src/index.ts#shown",
    ["ts-unbuilt-entry-is-bundler-entry"],
    "packages/v/src/index.ts",
  ]);
  assert.deepEqual(got["core.open"]?.[0], "packages/v/src/index.ts#Core.open");
  assert.match(String(got.hidden), /^unresolved:/);
  assert.match(String(got["core.rerunFiles"]), /^unresolved:/);
});

test("PR 67 review 3: the types entry's own config, API Extractor's extends and tokens, unreadable roll-ups and entries", async () => {
  const extractorBase = JSON.stringify({
    mainEntryPointFilePath: "<projectFolder>/lib/<unscopedPackageName>.d.ts",
    dtsRollup: {
      enabled: true,
      untrimmedFilePath: "<projectFolder>/dist/<unscopedPackageName>.d.ts",
    },
  });
  const got = await calls({
    // A rollup array: the declaration bundle comes from a narrower input.
    "packages/r/package.json": pkg("r", {
      types: "./dist/index.d.ts",
      scripts: { build: "rollup -c" },
    }),
    "packages/r/rollup.config.mjs": [
      "import dts from 'rollup-plugin-dts';",
      "export default [",
      "  { input: 'src/index.ts', output: { file: 'dist/index.js' } },",
      "  { input: 'src/public-api.ts', output: { file: 'dist/index.d.ts' }, plugins: [dts()] },",
      "];",
    ].join("\n"),
    "packages/r/src/index.ts":
      "export * from './public-api';\nexport function internalHelper() {}\n",
    "packages/r/src/public-api.ts": "export function api() {}\n",
    // API Extractor under config/, extending a base, with the package-name token.
    "packages/e/package.json": pkg("@scope/e", {
      types: "./dist/e.d.ts",
      scripts: { build: "wireit" },
      wireit: {
        build: {
          command: "tsc -b && api-extractor run -c config/api-extractor.json",
        },
      },
    }),
    "packages/e/tsconfig.json":
      '{"compilerOptions":{"declaration":true,"rootDir":"src","outDir":"lib"},"include":["src"]}',
    "packages/e/config/api-extractor.base.json": extractorBase,
    "packages/e/config/api-extractor.json":
      '{ "extends": "./api-extractor.base.json" }',
    "packages/e/src/e.ts": "export function fromRollup() {}\n",
    // API Extractor runs, but its config extends a package: unreadable, no twin.
    "packages/n/package.json": pkg("n", {
      types: "./dist/index.d.ts",
      scripts: { build: "api-extractor run" },
    }),
    "packages/n/api-extractor.json":
      '{ "extends": "@company/configs/api-extractor.json" }',
    "packages/n/src/index.ts": "export function notTwin() {}\n",
    // A template-literal entry: present but not data, so no twin either.
    "packages/t/package.json": pkg("t", {
      types: "./dist/index.d.ts",
      scripts: { build: "tsup" },
    }),
    "packages/t/tsup.config.ts":
      "const dir = 'lib';\nexport default { entry: [`${dir}/index.ts`] };",
    "packages/t/src/index.ts": "export function templated() {}\n",
    "app.ts": [
      'import { api, internalHelper } from "r";',
      'import { fromRollup } from "@scope/e";',
      'import { notTwin } from "n";',
      'import { templated } from "t";',
      "api(); internalHelper(); fromRollup(); notTwin(); templated();",
    ].join("\n"),
  });
  assert.deepEqual(got.api, [
    "packages/r/src/public-api.ts#api",
    ["ts-unbuilt-entry-is-bundler-entry"],
    "packages/r/src/public-api.ts",
  ]);
  assert.match(String(got.internalHelper), /^unresolved:/);
  assert.deepEqual(got.fromRollup, [
    "packages/e/src/e.ts#fromRollup",
    ["ts-unbuilt-entry-is-rollup-entry"],
    "packages/e/src/e.ts",
  ]);
  for (const name of ["notTwin", "templated"])
    assert.match(String(got[name]), /^unresolved:workspace-/, name);
});

test("PR 67 review 3: a manifest field as an entry, and output.file beside dir objects", async () => {
  const got = await calls({
    // React Hook Form's shape: `input: pkg.source` with pkg the manifest.
    "packages/m/package.json": pkg("m", {
      source: "src/index.ts",
      types: "./dist/index.d.ts",
      scripts: { build: "rollup -c" },
    }),
    "packages/m/rollup.config.mjs": [
      "import pkg from './package.json' with { type: 'json' };",
      "export default [{ input: pkg.source, output: { dir: 'dist' } }];",
    ].join("\n"),
    "packages/m/src/index.ts": "export function fromManifest() {}\n",
    // One object writes a single file, another a folder: the folder's
    // entries still decide outputs the single file does not name.
    "packages/d/package.json": pkg("d", {
      types: "./dist/index.d.ts",
      scripts: { build: "rollup -c" },
    }),
    "packages/d/rollup.config.mjs": [
      "export default [",
      "  { input: { index: 'src/main.ts' }, output: { dir: 'dist' } },",
      "  { input: 'src/cli.ts', output: { file: 'dist/cli.js' } },",
      "];",
    ].join("\n"),
    "packages/d/src/main.ts": "export function fromDir() {}\n",
    "packages/d/src/cli.ts": "export function cli() {}\n",
    "packages/d/src/index.ts": "export function twinNotUsed() {}\n",
    "app.ts": [
      'import { fromManifest } from "m";',
      'import { fromDir } from "d";',
      "fromManifest(); fromDir();",
    ].join("\n"),
  });
  assert.deepEqual(got.fromManifest, [
    "packages/m/src/index.ts#fromManifest",
    ["ts-unbuilt-entry-is-bundler-entry"],
    "packages/m/src/index.ts",
  ]);
  assert.deepEqual(got.fromDir, [
    "packages/d/src/main.ts#fromDir",
    ["ts-unbuilt-entry-is-bundler-entry"],
    "packages/d/src/main.ts",
  ]);
});
