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
import typescript from "../dist/graph/languages/typescript/index.js";

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
    const report = await indexProject(dir, new LanguageRegistry([typescript]), store);
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
    a: ["packages/a/src/index.ts#a", ["ts-unbuilt-entry-is-src-twin"], "packages/a/src/index.ts"],
    b: ["packages/b/src/index.ts#b", ["ts-unbuilt-entry-is-src-twin"], "packages/b/src/index.ts"],
    tool: ["packages/b/src/tool.mts#tool", ["ts-unbuilt-entry-is-src-twin"], "packages/b/src/tool.mts"],
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
    run: ["packages/v/src/public/index.ts#run", ["ts-unbuilt-entry-is-bundler-entry"], "packages/v/src/public/index.ts"],
    serve: ["packages/v/src/public/node.ts#serve", ["ts-unbuilt-entry-is-bundler-entry"], "packages/v/src/public/node.ts"],
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
    "packages/core/api-extractor.json": extractor("alphaTrimmedFilePath", "lib/types.d.ts"),
    "packages/core/src/core.ts":
      "export function launch() {}\n/** @internal */\nexport function secret() {}\n",
    // Public trimming drops @beta declarations, which cannot be withheld one by one.
    "packages/beta/package.json": pkg("beta", {
      types: "./lib/types.d.ts",
      scripts: { build: "api-extractor run" },
    }),
    "packages/beta/tsconfig.json":
      '{"compilerOptions":{"declaration":true,"rootDir":"src","outDir":"lib/esm"},"include":["src"]}',
    "packages/beta/api-extractor.json": extractor("publicTrimmedFilePath", "lib/types.d.ts"),
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
