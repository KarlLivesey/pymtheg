// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { executeGraph } from "../dist/graph/commands.js";
import typescript from "../dist/graph/languages/typescript/index.js";
import { registryRange } from "../dist/graph/languages/typescript/workspace.js";
import { LanguageRegistry, SqliteGraphStore } from "../dist/graph/index.js";

const fixtures = fileURLToPath(
  new URL("fixtures/graph-typescript-installed/", import.meta.url),
);
const manifest = (name, version) =>
  JSON.stringify({ name, version, types: "index.d.ts" });

async function project() {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-installed-types-"));
  const root = join(scratch, "checkout");
  await mkdir(root);
  const registry = new LanguageRegistry([typescript]);
  return {
    root,
    request: (command, args = []) =>
      executeGraph({ command, args, root }, { registry }),
    read(run) {
      const store = new SqliteGraphStore(
        join(root, ".pymtheg/rebuildable/graph.sqlite"),
        undefined,
        { readOnly: true },
      );
      try {
        const call = (file, name) => {
          const links = store
            .links()
            .filter(
              (link) =>
                link.file === file &&
                link.kind === "calls" &&
                link.targetName === name,
            );
          assert.equal(links.length, 1, name);
          return links[0];
        };
        return run(store, call);
      } finally {
        store.close();
      }
    },
    async write(path, text) {
      const destination = join(root, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, text);
    },
  };
}

const target = (link) => {
  assert.equal(link.resolution, "library", JSON.stringify(link.data));
  const [{ id, ...rest }] = link.libraries;
  return rest;
};

test("installed declarations prove members and versions without adding checkout facts", async () => {
  const { root, request, read, write } = await project();
  for (const name of ["package.json", "tsconfig.json", "main.ts", "shadow.ts"])
    await cp(join(fixtures, name), join(root, name));
  await request("index");
  const bareUntyped = read((_, call) => target(call("main.ts", "untyped")));
  const dependencies = join(root, "node_modules");
  await cp(join(fixtures, "node_modules.fixture"), dependencies, {
    recursive: true,
  });
  const physical = ".pnpm/fixture-view@1.0.0";
  await rename(
    join(dependencies, physical, "node_modules.fixture"),
    join(dependencies, physical, "node_modules"),
  );
  await symlink(
    `${physical}/node_modules/fixture-view`,
    join(dependencies, "pnpm-view"),
    "dir",
  );

  assert.equal((await request("search", ["locator"])).sync.mode, "updated");
  read((store, call) => {
    const main = (name) => call("main.ts", name);
    assert.deepEqual(target(main("page.locator")), {
      ecosystem: "npm",
      unit: "fixture-page",
      symbol: "Page.prototype.locator",
      evidence: "declaring-owner",
      version: "1.2.3",
      versionSource: "node_modules/kit-alias/package.json",
    });
    assert.deepEqual(target(main("(expression).refresh")), {
      ecosystem: "npm",
      unit: "fixture-view",
      symbol: "View.prototype.refresh",
      evidence: "declaring-owner",
      version: "1.0.0",
      versionSource: `node_modules/${physical}/node_modules/fixture-view/package.json`,
    });
    assert.deepEqual(target(main("(expression).result")), {
      ecosystem: "npm",
      unit: "fallback-kit",
      symbol: "Fallback.prototype.result",
      evidence: "declaring-owner",
      version: "2.1.0",
      versionSource: "node_modules/@types/fallback-kit/package.json",
    });
    assert.deepEqual(target(main("untyped")), bareUntyped);
    assert.equal(
      target(main("ambientService.execute")).symbol,
      "AmbientService.prototype.execute",
    );
    assert.equal(main("shadow").resolution, "resolved");
    assert.equal(main("fetch").resolution, "ambiguous");
    assert.deepEqual(
      main("fetch")
        .libraries.map(({ ecosystem }) => ecosystem)
        .sort(),
      ["dom", "node"],
    );
    assert.deepEqual(
      store.files().map(({ path }) => path),
      ["main.ts", "shadow.ts"],
    );
    assert.ok(
      store.links().every(({ file }) => !file.includes("node_modules")),
    );
  });

  assert.equal((await request("search", ["locator"])).sync.mode, "unchanged");
  await write(
    "node_modules/kit-alias/types/page.d.ts",
    "export interface NewPage { locator(selector: string): string } export { NewPage as Page };\n",
  );
  assert.equal((await request("search", ["locator"])).sync.mode, "updated");
  read((_, call) =>
    assert.equal(
      target(call("main.ts", "page.locator")).symbol,
      "NewPage.prototype.locator",
    ),
  );
  await write(
    "node_modules/kit-alias/package.json",
    JSON.stringify({
      name: "fixture-page",
      version: "1.2.4",
      type: "module",
      types: "types/index.d.ts",
    }),
  );
  assert.equal((await request("search", ["locator"])).sync.mode, "updated");
  read((_, call) => {
    const result = target(call("main.ts", "page.locator"));
    assert.equal(result.version, "1.2.4");
    assert.equal(result.symbol, "NewPage.prototype.locator");
  });
  await rename(dependencies, join(root, "..", "retired-fixture"));
  assert.equal((await request("search", ["locator"])).sync.mode, "updated");
  read((_, call) =>
    assert.equal(call("main.ts", "page.locator").resolution, "unresolved"),
  );
});

test("workspace resolution keeps installed versions separate and blocks escaping symlinks", async () => {
  const { root, request, read, write } = await project();
  const outside = join(root, "..", "outside");
  await mkdir(outside);
  await writeFile(
    join(outside, "package.json"),
    manifest("outside-kit", "1.0.0"),
  );
  await writeFile(
    join(outside, "index.d.ts"),
    "export declare function outside(): { escaped(): void };\n",
  );
  for (const [workspace, version] of [
    ["one", "1.0.0"],
    ["two", "2.0.0"],
  ]) {
    await write(`${workspace}/tsconfig.json`, '{"files":["main.ts"]}');
    await write(
      `${workspace}/main.ts`,
      'import { create } from "versioned-kit"; import { outside } from "outside-kit"; const value = create(); value.method(); const unsafe = outside(); unsafe.escaped();',
    );
    await write(
      `${workspace}/node_modules/versioned-kit/package.json`,
      manifest("versioned-kit", version),
    );
    await write(
      `${workspace}/node_modules/versioned-kit/index.d.ts`,
      "export declare function create(): Value; export interface Value { method(): void }\n",
    );
    await symlink(
      outside,
      join(root, workspace, "node_modules/outside-kit"),
      "dir",
    );
  }
  await request("index");
  read((_, call) => {
    for (const [workspace, version] of [
      ["one", "1.0.0"],
      ["two", "2.0.0"],
    ]) {
      const link = target(call(`${workspace}/main.ts`, "value.method"));
      assert.equal(link.symbol, "Value.prototype.method");
      assert.equal(link.version, version);
      assert.equal(
        link.versionSource,
        `${workspace}/node_modules/versioned-kit/package.json`,
      );
      assert.equal(
        call(`${workspace}/main.ts`, "unsafe.escaped").resolution,
        "unresolved",
      );
    }
  });
});

test("an installed override wins over an inferred workspace package", async () => {
  const { root, request, read, write } = await project();
  await write("package.json", '{"packageManager":"pnpm@10.15.1"}');
  await write(
    "pnpm-workspace.yaml",
    'packages:\n  - "packages/*"\nlinkWorkspacePackages: true\noverrides:\n  zod: 4.6.6\n',
  );
  await write(
    "packages/app/package.json",
    '{"name":"app","dependencies":{"zod":"^3"}}',
  );
  await write(
    "packages/app/tsconfig.json",
    '{"compilerOptions":{"module":"Node16"},"files":["main.ts"]}',
  );
  const file = "packages/app/main.ts";
  await write(file, 'import { z } from "zod"; z.string();');
  await write(
    "packages/zod/package.json",
    '{"name":"zod","version":"3.24.0","types":"index.ts"}',
  );
  await write(
    "packages/zod/index.ts",
    "export namespace z { export function string() { return 'workspace'; } }",
  );
  const imports = (store) =>
    store.links().find((link) => link.file === file && link.kind === "imports");
  const local = () =>
    read((store, call) => {
      for (const link of [imports(store), call(file, "z.string")]) {
        assert.equal(link.resolution, "resolved");
        assert.equal(
          store.findSymbols().find(({ id }) => id === link.targetId)?.file,
          "packages/zod/index.ts",
        );
      }
    });
  await request("index");
  local();
  const physical = "node_modules/.pnpm/zod@4.6.6/node_modules/zod";
  await write(
    `${physical}/package.json`,
    '{"name":"zod","version":"4.6.6","types":"index.d.cts"}',
  );
  await write(
    `${physical}/index.d.cts`,
    "export declare namespace z { function string(): number; }",
  );
  // A hoisted physical package must win even over a nearer synthetic link.
  const installed = join(root, "node_modules/zod");
  await symlink(".pnpm/zod@4.6.6/node_modules/zod", installed, "dir");
  await request("index");
  read((store, call) => {
    const module = target(imports(store));
    assert.equal(module.unit, "zod");
    assert.equal(module.version, "4.6.6");
    const member = target(call(file, "z.string"));
    assert.equal(member.symbol, "z.string");
    assert.equal(member.versionSource, `${physical}/package.json`);
  });
  await rename(installed, join(root, "node_modules/old-zod"));
  await symlink("../packages/zod", installed, "dir");
  await request("index");
  local();
});

test("a physical workspace link with an unbuilt entry names the missing output", async () => {
  const { root, request, read, write } = await project();
  await write("package.json", '{"workspaces":["packages/*"]}');
  await write(
    "packages/ui/package.json",
    '{"name":"fixture-ui","version":"1.0.0","types":"dist/index.d.ts"}',
  );
  await write(
    "packages/ui/tsconfig.json",
    '{"compilerOptions":{"rootDir":"src","outDir":"dist"},"files":["src/index.ts"]}',
  );
  await write("packages/ui/src/index.ts", "export const button = 1;");
  await write(
    "packages/app/package.json",
    '{"name":"fixture-app","dependencies":{"fixture-ui":"^1"},"devDependencies":{"@types/node":"^24"}}',
  );
  await write(
    "packages/app/tsconfig.json",
    '{"compilerOptions":{"types":[],"lib":["ES2022","DOM"]},"files":["main.ts"]}',
  );
  await write(
    "packages/app/main.ts",
    'import { button } from "./ui"; import "typed"; console.log(button);',
  );
  await write("packages/app/ui.ts", 'export { button } from "fixture-ui";');
  await write("node_modules/typed/package.json", manifest("typed", "1.0.0"));
  await write("node_modules/typed/index.d.ts", "export {};");
  await symlink("../packages/ui", join(root, "node_modules/fixture-ui"), "dir");
  await request("index");
  read((store, call) => {
    const link = store
      .links()
      .find(
        (link) => link.kind === "imports" && link.targetName === "fixture-ui",
      );
    assert.equal(link.resolution, "unresolved");
    assert.equal(link.data.reason, "workspace-build-output-missing");
    const imported = store
      .links()
      .find(
        (link) =>
          link.file === "packages/app/main.ts" &&
          link.kind === "imports" &&
          link.targetName === "button",
      );
    assert.equal(imported.resolution, "unresolved");
    assert.equal(imported.data.reason, "workspace-build-output-missing");
    const log = call("packages/app/main.ts", "console.log");
    assert.equal(log.resolution, "ambiguous");
    assert.deepEqual(log.libraries.map(({ ecosystem }) => ecosystem).sort(), [
      "dom",
      "node",
    ]);
  });
});

test("a dependency linked to the checkout root reports the missing workspace entry", async () => {
  const { root, request, read, write } = await project();
  await write(
    "package.json",
    '{"name":"fixture-root","typings":"dist/index.d.ts"}',
  );
  await write("src/index.ts", "export const member = 1;");
  await write("sample/main.ts", 'import { member } from "fixture-root";');
  await mkdir(join(root, "sample/node_modules"));
  await symlink("../..", join(root, "sample/node_modules/fixture-root"), "dir");
  await request("index");
  read((store) => {
    const link = store
      .links()
      .find(
        (link) => link.kind === "imports" && link.targetName === "fixture-root",
      );
    assert.equal(link.resolution, "unresolved");
    assert.equal(link.data.reason, "workspace-entry-unavailable");
  });
});

test("a physical workspace link follows Astro's declaration-only subpath layout", async () => {
  const { root, request, read, write } = await project();
  const manifest = (build) =>
    JSON.stringify({
      name: "@astrojs/internal-helpers",
      type: "module",
      exports: { "./path": "./dist/path.js" },
      scripts: { build },
    });
  await write("package.json", '{"type":"module"}');
  await write(
    "main.ts",
    'import { prependForwardSlash } from "@astrojs/internal-helpers/path"; prependForwardSlash("docs");',
  );
  await write(
    "checkout-helpers/package.json",
    manifest("tsc -p tsconfig.build.json"),
  );
  await write(
    "checkout-helpers/tsconfig.build.json",
    '{"compilerOptions":{"module":"NodeNext","rootDir":"src","outDir":"dist","declaration":true,"emitDeclarationOnly":true},"include":["src"]}',
  );
  await write(
    "checkout-helpers/src/path.ts",
    'export function prependForwardSlash(path: string) { return "/" + path; }',
  );
  await mkdir(join(root, "node_modules/@astrojs"), { recursive: true });
  await symlink(
    "../../checkout-helpers",
    join(root, "node_modules/@astrojs/internal-helpers"),
    "dir",
  );
  await request("index");
  const check = (assumed) =>
    read((store, call) => {
      const link = call("main.ts", "prependForwardSlash");
      assert.equal(link.resolution, "resolved");
      assert.equal(
        store.findSymbols().find(({ id }) => id === link.targetId)?.file,
        "checkout-helpers/src/path.ts",
      );
      assert.deepEqual(link.data.unbuiltEntry, {
        proof: "tsconfig-emit",
        build: "checkout-helpers/package.json",
        config: "checkout-helpers/tsconfig.build.json",
        output: "checkout-helpers/dist/path.d.ts",
        source: "checkout-helpers/src/path.ts",
        ...(assumed && { assumed: true }),
      });
      assert.deepEqual(
        link.data.assumes,
        assumed ? ["ts-unbuilt-entry-is-compiler-emit"] : undefined,
      );
    });
  check(false);
  await write("checkout-helpers/package.json", manifest("tsdown"));
  await request("index");
  check(true);
});

test("an output directory outside the checkout supplies no workspace entry proof", async () => {
  const { root, request, read, write } = await project();
  await write(
    "package.json",
    '{"name":"fixture-root","types":"./dist/index.d.ts","scripts":{"build":"tsc -p tsconfig.build.json"}}',
  );
  await write(
    "tsconfig.build.json",
    '{"compilerOptions":{"rootDir":"src","outDir":"../dist","declaration":true},"include":["src"]}',
  );
  await write("src/index.ts", "export function rootEntry() {}");
  await write(
    "sample/main.ts",
    'import { rootEntry } from "fixture-root"; rootEntry();',
  );
  await mkdir(join(root, "sample/node_modules"));
  await symlink("../..", join(root, "sample/node_modules/fixture-root"), "dir");
  await request("index");
  read((_, call) =>
    assert.equal(call("sample/main.ts", "rootEntry").resolution, "unresolved"),
  );
});

test("captured competing test types use the compiler's global symbol", async () => {
  const { request, read, write } = await project();
  await write(
    "tsconfig.json",
    '{"compilerOptions":{"types":["vitest/globals","chai"]}}',
  );
  await write("main.ts", "expect(true); vi.fn();");
  await write("node_modules/vitest/package.json", manifest("vitest", "1.0.0"));
  await write(
    "node_modules/vitest/globals.d.ts",
    "declare function expect(value: boolean): void; declare namespace vi { function fn(): void; }",
  );
  await request("index");
  read((_, call) => {
    assert.equal(
      call("main.ts", "expect").data.reason,
      "competing-test-globals",
    );
    assert.equal(target(call("main.ts", "vi.fn")).unit, "vitest");
  });
  await write(
    "node_modules/@types/chai/package.json",
    manifest("@types/chai", "1.0.0"),
  );
  await write(
    "node_modules/@types/chai/index.d.ts",
    "export declare const expect: unknown;",
  );
  await request("index");
  read((_, call) =>
    assert.equal(target(call("main.ts", "expect")).unit, "vitest"),
  );
  await write(
    "node_modules/@types/chai/index.d.ts",
    "declare function expect(value: string): void;",
  );
  await request("index");
  read((_, call) => {
    const link = call("main.ts", "expect");
    assert.equal(link.resolution, "ambiguous");
    assert.deepEqual(link.libraries.map(({ unit }) => unit).sort(), [
      "chai",
      "vitest",
    ]);
  });
});

test("a missing transitive test type request cannot add a global provider", async () => {
  const { request, read, write } = await project();
  await write(
    "tsconfig.json",
    '{"compilerOptions":{"types":["vitest/globals"]}}',
  );
  await write("main.ts", "expect(true);");
  await write("node_modules/vitest/package.json", manifest("vitest", "1.0.0"));
  await write(
    "node_modules/vitest/globals.d.ts",
    '/// <reference types="jest" />\nimport "chai"; declare global { function expect(value: boolean): void; }',
  );
  await request("index");
  read((_, call) =>
    assert.equal(target(call("main.ts", "expect")).unit, "vitest"),
  );
});

test("an augmentation contributes its members, not the installed module's identity", async () => {
  const { request, read, write } = await project();
  await write(
    "node_modules/augment-kit/package.json",
    manifest("augment-kit", "1.0.0"),
  );
  await write(
    "node_modules/augment-kit/index.d.ts",
    "export interface Value { original(): void } export declare const value: Value; declare global { interface Element {} interface ErrorConstructor { fixtureStatic(): void } }",
  );
  await write(
    "main.ts",
    'import { value } from "augment-kit"; declare module "augment-kit" { interface Value { added: () => void } } value.original(); value.added(); export type DomElement = Element; class SubError extends Error { constructor() { super(); } }',
  );
  await request("index");
  read((store, call) => {
    assert.equal(
      target(call("main.ts", "value.original")).symbol,
      "Value.prototype.original",
    );
    const added = call("main.ts", "value.added");
    assert.equal(added.resolution, "resolved");
    assert.equal(
      store.findSymbols().find(({ id }) => id === added.targetId)?.file,
      "main.ts",
    );
    const element = store.links().find((link) => link.targetName === "Element");
    assert.equal(target(element).ecosystem, "dom");
    assert.equal(target(call("main.ts", "super")).ecosystem, "typescript-lib");
  });
});

test("an installed directory augmentation keeps the original type identity", async () => {
  const { request, read, write } = await project();
  await write(
    "tsconfig.json",
    '{"compilerOptions":{"module":"CommonJS","moduleResolution":"Node10","esModuleInterop":true},"files":["main.ts"]}',
  );
  await write(
    "main.ts",
    [
      'import CodeMirror from "codemirror";',
      'import "codemirror/addon/edit/closebrackets";',
      "export type Options = CodeMirror.EditorConfiguration;",
      "export type Extra = CodeMirror.EmptyOptions;",
      "declare const options: Options;",
      "options.closeBrackets();",
    ].join("\n"),
  );
  const types = "node_modules/@types/codemirror";
  await write(`${types}/package.json`, manifest("@types/codemirror", "1.0.0"));
  await write(
    `${types}/index.d.ts`,
    "declare namespace CodeMirror { interface EditorConfiguration { lineNumbers?: boolean } interface EmptyOptions {} } export = CodeMirror;",
  );
  await write(
    `${types}/addon/edit/closebrackets.d.ts`,
    'import "../../"; declare module "../../" { interface EditorConfiguration { closeBrackets(): void } interface EmptyOptions { enabled: boolean } }',
  );
  await request("index");
  read((store, call) => {
    const type = store
      .links()
      .find(
        ({ kind, targetName }) =>
          kind === "references" &&
          targetName === "CodeMirror.EditorConfiguration",
      );
    assert.deepEqual(target(type), {
      ecosystem: "npm",
      unit: "codemirror",
      symbol: "CodeMirror.EditorConfiguration",
      version: "1.0.0",
      versionSource: `${types}/package.json`,
      evidence: "declaring-owner",
    });
    const empty = store
      .links()
      .find(({ targetName }) => targetName === "CodeMirror.EmptyOptions");
    assert.equal(target(empty).symbol, "CodeMirror.EmptyOptions");
    assert.equal(
      target(call("main.ts", "options.closeBrackets")).symbol,
      "EditorConfiguration.prototype.closeBrackets",
    );
  });
});

test("a qualified installed type uses its declaration without a runtime receiver", async () => {
  const { request, read, write } = await project();
  await write(
    "tsconfig.json",
    '{"compilerOptions":{"esModuleInterop":true},"files":["main.ts"]}',
  );
  await write(
    "main.ts",
    'import Messages from "message-kit"; export type Input = Messages.Request;',
  );
  await write(
    "node_modules/message-kit/package.json",
    manifest("message-kit", "1.0.0"),
  );
  await write(
    "node_modules/message-kit/index.d.ts",
    "declare namespace Messages { type Request = { body: string }; } export = Messages;\n",
  );
  await request("index");
  read((store) => {
    const link = store
      .links()
      .find(
        (link) =>
          link.kind === "references" && link.targetName === "Messages.Request",
      );
    assert.equal(target(link).symbol, "Messages.Request");
  });
});

test("an augmentation does not own a synthetic default export", async () => {
  const { request, read, write } = await project();
  await write("tsconfig.json", '{"compilerOptions":{"esModuleInterop":true}}');
  await write(
    "main.ts",
    'import React from "react"; import "fixture-augment"; React.open();',
  );
  await write("node_modules/react/package.json", manifest("react", "1.2.3"));
  await write(
    "node_modules/react/index.d.ts",
    "export = React; declare namespace React { function open(): void; }",
  );
  await write(
    "node_modules/fixture-augment/package.json",
    manifest("fixture-augment", "1.0.0"),
  );
  await write(
    "node_modules/fixture-augment/index.d.ts",
    'import "react"; declare module "react" { interface Extra { value: boolean } }',
  );
  await request("index");
  read((store, call) => {
    const binding = store
      .links()
      .find((link) => link.file === "main.ts" && link.targetName === "default");
    assert.equal(target(binding).unit, "react");
    assert.equal(target(binding).version, "1.2.3");
    assert.equal(target(call("main.ts", "React.open")).unit, "react");
  });
});

test("identical DOM heritage in an installed stub leaves the native type as owner", async () => {
  const { request, read, write } = await project();
  await write(
    "main.ts",
    'import "fixture-dom"; export type Input = HTMLInputElement; export type Label = HTMLLabelElement;',
  );
  await write(
    "node_modules/fixture-dom/package.json",
    manifest("fixture-dom", "1.0.0"),
  );
  await write(
    "node_modules/fixture-dom/index.d.ts",
    "export {}; declare global { interface HTMLInputElement extends HTMLElement {} interface Extra { fixtureOnly: boolean } interface HTMLLabelElement extends Extra {} }",
  );
  await request("index");
  read((store) => {
    const reference = (name) =>
      store
        .links()
        .find((link) => link.targetName === name && link.kind === "references");
    assert.equal(target(reference("HTMLInputElement")).ecosystem, "dom");
    assert.equal(reference("HTMLLabelElement").resolution, "ambiguous");
  });
});

test("a named re-exported namespace keeps its installed binding even beside a failed source", async () => {
  const { request, read, write } = await project();
  await write("tsconfig.json", '{"files":["main.ts","broken.ts"]}');
  await write(
    "main.ts",
    'import { z, missing } from "zod"; export const spec = z;',
  );
  await write("broken.ts", "export const fail = ;");
  await write("node_modules/zod/package.json", manifest("zod", "4.6.6"));
  await write(
    "node_modules/zod/index.d.ts",
    'export * as z from "./namespace";',
  );
  await write(
    "node_modules/zod/namespace.d.ts",
    "export declare function string(): string;",
  );
  await request("index");
  read((store) => {
    const binding = (name) =>
      store
        .links()
        .find(
          (link) =>
            link.kind === "imports" &&
            link.file === "main.ts" &&
            link.targetName === name,
        );
    assert.deepEqual(target(binding("z")), {
      ecosystem: "npm",
      unit: "zod",
      symbol: "z",
      evidence: "import-binding",
      version: "4.6.6",
      versionSource: "node_modules/zod/package.json",
    });
    assert.equal(binding("missing").resolution, "unresolved");
  });
});

test("a failed file does not withdraw an independently written installed import binding", async () => {
  const { request, read, write } = await project();
  await write("tsconfig.json", '{"files":["main.ts","broken.ts"]}');
  await write("package.json", '{"dependencies":{"direct-kit":"^1"}}');
  await write("main.ts", 'import { open } from "direct-kit"; open();');
  await write("broken.ts", "export const = ;");
  await write(
    "node_modules/direct-kit/package.json",
    manifest("direct-kit", "1.2.0"),
  );
  await write(
    "node_modules/direct-kit/index.d.ts",
    "export declare function open(): void;\n",
  );
  await request("index");
  read((_, call) =>
    assert.deepEqual(target(call("main.ts", "open")), {
      ecosystem: "npm",
      unit: "direct-kit",
      symbol: "open",
      evidence: "import-binding",
      version: "1.2.0",
      versionSource: "node_modules/direct-kit/package.json",
    }),
  );
});

test("a mapped member keeps the proven package without inventing a declaring name", async () => {
  const { request, read, write } = await project();
  await write("package.json", '{"dependencies":{"query-kit":"^1"}}');
  await write("main.ts", 'import { screen } from "query-kit"; screen.find();');
  await write(
    "node_modules/query-kit/package.json",
    manifest("query-kit", "1.0.0"),
  );
  await write(
    "node_modules/query-kit/index.d.ts",
    'export type Bound = { [Name in "find"]: () => void }; export declare const screen: Bound;',
  );
  await request("index");
  read((_, call) =>
    assert.deepEqual(target(call("main.ts", "screen.find")), {
      ecosystem: "npm",
      unit: "query-kit",
      evidence: "import-path",
      version: "1.0.0",
      versionSource: "node_modules/query-kit/package.json",
    }),
  );
});

test("a named installed factory proves a member of its explicit return type", async () => {
  const { request, read, write } = await project();
  await write("package.json", '{"dependencies":{"fixture-checker":"^1"}}');
  await write(
    "main.ts",
    'import { createTypeScriptChecker, choose } from "fixture-checker"; const linter = createTypeScriptChecker(); linter.getRootFileNames(); const result = choose("a"); result.pick();',
  );
  await write(
    "node_modules/fixture-checker/package.json",
    manifest("fixture-checker", "1.0.0"),
  );
  await write(
    "node_modules/fixture-checker/index.d.ts",
    'export declare function createTypeScriptChecker(): { getRootFileNames: () => string[] }; export declare function choose(mode: "a"): { pick(): string }; export declare function choose(mode: "b"): { pick(): number };',
  );
  await request("index");
  read((_, call) => {
    assert.deepEqual(target(call("main.ts", "linter.getRootFileNames")), {
      ecosystem: "npm",
      unit: "fixture-checker",
      symbol:
        "index.d.ts:ReturnType<typeof createTypeScriptChecker>.getRootFileNames",
      evidence: "declaring-owner",
      version: "1.0.0",
      versionSource: "node_modules/fixture-checker/package.json",
    });
    assert.equal(call("main.ts", "result.pick").resolution, "unresolved");
  });
});

test("same-named installed factory declarations keep separate direct and union targets", async () => {
  const { request, read, write } = await project();
  await write(
    "main.ts",
    `import { register as configure, publicApi, exportedApi } from "fixture-server/configuration";
import { register as registerFolders } from "fixture-server/folders";
import support = require("fixture-server/support");
declare const useConfiguration: boolean;
const configuration = configure();
const folders = registerFolders();
configuration.onDidChange(() => {});
folders.onDidChange(() => {});
(useConfiguration ? configuration : folders).onDidChange(() => {});
configuration.local.change();
folders.local.change();
configuration.detail.refresh();
folders.detail.refresh();
publicApi.open();
exportedApi.read();
support.list();
`,
  );
  await write(
    "node_modules/fixture-server/package.json",
    manifest("fixture-server", "1.0.0"),
  );
  await write(
    "node_modules/fixture-server/support.d.ts",
    "export = Support; declare namespace Support { function list(): string[] }",
  );
  for (const name of ["configuration", "folders"])
    await write(
      `node_modules/fixture-server/${name}.d.ts`,
      `export {};
interface Local { change(): void }
export type Detail = { refresh(): void };
export declare function register(): {
  readonly source: "${name}";
  onDidChange(action: () => void): void;
  local: Local;
  detail: Detail;
};
` +
        (name === "configuration"
          ? `interface PublicApi { open(): void }
export { PublicApi as p };
export declare const publicApi: PublicApi;
export interface ExportedApi { read(): void }
export declare const exportedApi: ExportedApi;
`
          : ""),
    );
  await request("index");
  const symbols = ["configuration", "folders"].map(
    (module) => `${module}.d.ts:ReturnType<typeof register>.onDidChange`,
  );
  read((_, call) => {
    const main = (name) => call("main.ts", name);
    assert.equal(target(main("configuration.onDidChange")).symbol, symbols[0]);
    assert.equal(target(main("folders.onDidChange")).symbol, symbols[1]);
    const union = main("(expression).onDidChange");
    assert.equal(union.resolution, "ambiguous");
    assert.deepEqual(
      union.libraries.map(({ symbol }) => symbol).sort(),
      symbols,
    );
    assert.equal(
      target(main("configuration.local.change")).symbol,
      "configuration.d.ts:Local.prototype.change",
    );
    assert.equal(
      target(main("folders.local.change")).symbol,
      "folders.d.ts:Local.prototype.change",
    );
    assert.equal(
      target(main("configuration.detail.refresh")).symbol,
      "configuration.d.ts:Detail.refresh",
    );
    assert.equal(
      target(main("folders.detail.refresh")).symbol,
      "folders.d.ts:Detail.refresh",
    );
    assert.equal(
      target(main("publicApi.open")).symbol,
      "PublicApi.prototype.open",
    );
    assert.equal(
      target(main("exportedApi.read")).symbol,
      "ExportedApi.prototype.read",
    );
    assert.equal(target(main("support.list")).symbol, "Support.list");
  });
  for (const [index, symbol] of symbols.entries()) {
    const { data } = await request("uses", ["fixture-server", symbol]);
    assert.deepEqual(data.classCounts, { library: 1, candidateSet: 1 });
    assert.deepEqual(data.links.map(({ targetName }) => targetName).sort(), [
      "(expression).onDidChange",
      index === 0 ? "configuration.onDidChange" : "folders.onDidChange",
    ]);
  }
  const { data } = await request("uses", [
    "fixture-server",
    "ReturnType<typeof register>.onDidChange",
  ]);
  assert.deepEqual(data.links, []);
});

// Shared test-global declarations: Vitest's `vitest/globals` and Jest's
// `@types/jest`, each declaring a global `expect`.
async function testGlobals(write) {
  await write("node_modules/vitest/package.json", manifest("vitest", "1.0.0"));
  await write(
    "node_modules/vitest/globals.d.ts",
    "declare global { function expect(value: unknown): void; }\nexport {};\n",
  );
  await write(
    "node_modules/@types/jest/package.json",
    manifest("@types/jest", "1.0.0"),
  );
  await write(
    "node_modules/@types/jest/index.d.ts",
    "declare function expect(value: unknown): void;\n",
  );
}
const ownerOf = (store, path) => store.getFile(path).result.data;

test("a base config that projects only extend does not compete for their files (solution with build and spec configs)", async () => {
  // The shape of a solution config referencing a build config that excludes
  // tests and a spec config with Vitest globals, both extending one base
  // that selects nothing of its own.
  const { request, read, write } = await project();
  await testGlobals(write);
  await write(
    "tsconfig.json",
    JSON.stringify({
      files: [],
      references: [
        { path: "./tsconfig.build.json" },
        { path: "./tsconfig.spec.json" },
      ],
    }),
  );
  await write(
    "tsconfig.base.json",
    JSON.stringify({
      compilerOptions: {
        strict: true,
        types: [],
        moduleResolution: "Bundler",
        module: "ESNext",
      },
    }),
  );
  await write(
    "tsconfig.build.json",
    JSON.stringify({
      extends: "./tsconfig.base.json",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
    }),
  );
  await write(
    "tsconfig.spec.json",
    JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { types: ["vitest/globals"] },
      include: ["src"],
    }),
  );
  await write("src/app.ts", "export function app() {}\n");
  await write(
    "src/app.test.ts",
    'import { app } from "./app";\nexpect(app());\n',
  );
  await request("index");
  read((store, call) => {
    assert.equal(
      ownerOf(store, "src/app.test.ts").project,
      "tsconfig.spec.json",
    );
    assert.equal(ownerOf(store, "src/app.test.ts").projects, undefined);
    const expect = target(call("src/app.test.ts", "expect"));
    assert.equal(expect.unit, "vitest");
    assert.equal(expect.symbol, "expect");
    // A file both project configs include is still analysed under both.
    assert.deepEqual(ownerOf(store, "src/app.ts").projects, [
      "tsconfig.build.json",
      "tsconfig.spec.json",
    ]);
    assert.equal(call("src/app.test.ts", "app").resolution, "resolved");
  });
});

test("spec files that every tsconfig.json excludes belong to the spec config, not to the base the build configs extend", async () => {
  // A monorepo shape: package build configs extend `packages/tsconfig.build.json`,
  // which names no files; the root `tsconfig.json` excludes spec files; the
  // root `tsconfig.spec.json` includes them with Vitest globals.
  const { request, read, write } = await project();
  await testGlobals(write);
  await write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: { types: [] },
      include: ["packages/**/*"],
      exclude: ["node_modules", "**/*.spec.ts"],
    }),
  );
  await write(
    "tsconfig.spec.json",
    JSON.stringify({
      extends: "./tsconfig.json",
      compilerOptions: { types: ["vitest/globals"] },
      include: ["packages/**/*.spec.ts"],
      exclude: ["node_modules"],
    }),
  );
  await write(
    "packages/tsconfig.build.json",
    JSON.stringify({ compilerOptions: { strict: true, types: [] } }),
  );
  await write(
    "packages/tsconfig.json",
    JSON.stringify({
      files: [],
      references: [{ path: "./p/tsconfig.build.json" }],
    }),
  );
  await write(
    "packages/p/tsconfig.build.json",
    JSON.stringify({
      extends: "../tsconfig.build.json",
      include: ["*.ts"],
      exclude: ["test/**/*", "*.spec.ts"],
    }),
  );
  // A sample's own script compiles its own `tsconfig.build.json`, not the
  // packages' base of the same name.
  await write(
    "sample/app/package.json",
    JSON.stringify({
      name: "app",
      scripts: { build: "tsc -p tsconfig.build.json" },
    }),
  );
  await write("packages/p/index.ts", "export function run() {}\n");
  await write(
    "packages/p/test/run.spec.ts",
    'import { run } from "../index";\nexpect(run());\n',
  );
  await request("index");
  read((store, call) => {
    assert.equal(
      ownerOf(store, "packages/p/test/run.spec.ts").project,
      "tsconfig.spec.json",
    );
    assert.equal(
      target(call("packages/p/test/run.spec.ts", "expect")).unit,
      "vitest",
    );
    assert.equal(
      call("packages/p/test/run.spec.ts", "run").resolution,
      "resolved",
    );
    // The package's own source keeps its build config.
    assert.equal(
      ownerOf(store, "packages/p/index.ts").project,
      "packages/p/tsconfig.build.json",
    );
  });
});

test("two project configs that bind different test globals stay undecided, even beside a shared base", async () => {
  const { request, read, write } = await project();
  await testGlobals(write);
  await write(
    "tsconfig.base.json",
    JSON.stringify({ compilerOptions: { strict: true } }),
  );
  await write(
    "tsconfig.jest.json",
    JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { types: ["jest"] },
      include: ["src"],
    }),
  );
  await write(
    "tsconfig.vitest.json",
    JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { types: ["vitest/globals"] },
      include: ["src"],
    }),
  );
  await write("src/a.test.ts", "expect(1);\n");
  await request("index");
  read((store, call) => {
    assert.deepEqual(ownerOf(store, "src/a.test.ts").projects, [
      "tsconfig.jest.json",
      "tsconfig.vitest.json",
    ]);
    const expect = call("src/a.test.ts", "expect");
    assert.notEqual(expect.resolution, "resolved");
    assert.ok(
      expect.resolution !== "library" || expect.libraries.length > 1,
      JSON.stringify(expect),
    );
  });
});

test("a base config that a package script compiles, or that a solution references, still competes", async () => {
  for (const variant of ["script", "reference"]) {
    const { request, read, write } = await project();
    await testGlobals(write);
    await write(
      "package.json",
      JSON.stringify({
        name: "fixture",
        private: true,
        ...(variant === "script"
          ? { scripts: { check: "tsc -p tsconfig.base.json" } }
          : {}),
      }),
    );
    if (variant === "reference")
      await write(
        "tsconfig.json",
        JSON.stringify({
          files: [],
          references: [{ path: "./tsconfig.base.json" }],
        }),
      );
    await write(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { types: [] } }),
    );
    await write(
      "tsconfig.spec.json",
      JSON.stringify({
        extends: "./tsconfig.base.json",
        compilerOptions: { types: ["vitest/globals"] },
        include: ["src"],
      }),
    );
    await write("src/a.test.ts", "expect(1);\n");
    await request("index");
    read((store, call) => {
      assert.deepEqual(
        ownerOf(store, "src/a.test.ts").projects,
        ["tsconfig.base.json", "tsconfig.spec.json"],
        variant,
      );
      assert.equal(
        call("src/a.test.ts", "expect").data.reason,
        "ambiguous-project",
        variant,
      );
    });
  }
});

// Two configs that both select `consumer.test-d.ts` and map `pick` to
// different declarations; one of them is a base the other extends.
async function pickLayout(write) {
  await write(
    "tsconfig.base.json",
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        types: [],
        paths: { pick: ["./one.ts"] },
      },
    }),
  );
  await write(
    "tsconfig.spec.json",
    JSON.stringify({
      extends: "./tsconfig.base.json",
      compilerOptions: { paths: { pick: ["./two.ts"] } },
      include: ["consumer.test-d.ts", "one.ts", "two.ts"],
    }),
  );
  await write("one.ts", "export function pick() {}\n");
  await write("two.ts", "export function pick() {}\n");
  await write("consumer.test-d.ts", 'import { pick } from "pick";\npick();\n');
}

test("a base config that a test runner type-checks with is a project, not a shared base", async () => {
  const runners = {
    "vitest literal": [
      "vitest.config.ts",
      "export default { test: { typecheck: { enabled: true, tsconfig: './tsconfig.base.json' } } };\n",
    ],
    "ts-jest literal": [
      "jest.config.js",
      "module.exports = { transform: { '^.+\\\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.base.json' }] } };\n",
    ],
    "package.json jest": [
      "package.json",
      JSON.stringify({
        name: "fixture",
        jest: {
          transform: {
            "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.base.json" }],
          },
        },
      }),
    ],
    "vitest non-literal": [
      "vitest.config.ts",
      "const project = './tsconfig.base.json';\nexport default { test: { typecheck: { tsconfig: project } } };\n",
    ],
  };
  for (const [variant, [path, text]] of Object.entries(runners)) {
    const { request, read, write } = await project();
    await pickLayout(write);
    await write(path, text);
    await request("index");
    read((store, call) => {
      assert.deepEqual(
        ownerOf(store, "consumer.test-d.ts").projects,
        ["tsconfig.base.json", "tsconfig.spec.json"],
        variant,
      );
      assert.notEqual(
        call("consumer.test-d.ts", "pick").resolution,
        "resolved",
        variant,
      );
    });
  }
  // Without a runner naming it, the base does not compete.
  const { request, read, write } = await project();
  await pickLayout(write);
  await write(
    "vitest.config.ts",
    "export default { test: { globals: true } };\n",
  );
  await request("index");
  read((store, call) => {
    assert.equal(
      ownerOf(store, "consumer.test-d.ts").project,
      "tsconfig.spec.json",
    );
    const pick = call("consumer.test-d.ts", "pick");
    assert.equal(pick.resolution, "resolved");
    assert.equal(
      store.findSymbols().find(({ id }) => id === pick.targetId)?.file,
      "two.ts",
    );
  });
});

test("the shared-base rule's guards keep project configs competing", async () => {
  // Each case: a config that is not a shared base still owns or ties.
  const cases = {
    // A root tsconfig.json with compiler options only, extended by another
    // config, is the editor's project for the files it selects by default.
    "tsconfig.json name": {
      files: {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { types: ["vitest/globals"] },
        }),
        "tsconfig.other.json": JSON.stringify({
          extends: "./tsconfig.json",
          compilerOptions: { types: ["jest"] },
          include: ["src"],
        }),
      },
      expected: { project: "tsconfig.json" },
    },
    // A config with its own `include` is a project even when extended.
    "own selection": {
      files: {
        "tsconfig.a.json": JSON.stringify({
          compilerOptions: { types: ["vitest/globals"] },
          include: ["src"],
        }),
        "tsconfig.b.json": JSON.stringify({
          extends: "./tsconfig.a.json",
          compilerOptions: { types: ["jest"] },
          include: ["src"],
        }),
      },
      expected: { projects: ["tsconfig.a.json", "tsconfig.b.json"] },
    },
    // A config nothing extends is a standalone project, not a base.
    "not extended": {
      files: {
        "tsconfig.standalone.json": JSON.stringify({
          compilerOptions: { types: ["vitest/globals"] },
        }),
        "tsconfig.x.json": JSON.stringify({
          compilerOptions: { types: ["jest"] },
          include: ["src"],
        }),
      },
      expected: { projects: ["tsconfig.standalone.json", "tsconfig.x.json"] },
    },
    // A script that changes directory first still names the base.
    "script after cd": {
      files: {
        "package.json": JSON.stringify({
          name: "fixture",
          scripts: { check: "cd packages && tsc -p ../tsconfig.base.json" },
        }),
        "tsconfig.base.json": JSON.stringify({
          compilerOptions: { types: [] },
        }),
        "tsconfig.spec.json": JSON.stringify({
          extends: "./tsconfig.base.json",
          compilerOptions: { types: ["vitest/globals"] },
          include: ["src"],
        }),
      },
      expected: { projects: ["tsconfig.base.json", "tsconfig.spec.json"] },
    },
  };
  for (const [variant, { files, expected }] of Object.entries(cases)) {
    const { request, read, write } = await project();
    await testGlobals(write);
    for (const [path, text] of Object.entries(files)) await write(path, text);
    await write("src/a.test.ts", "expect(1);\n");
    await request("index");
    read((store) => {
      const data = ownerOf(store, "src/a.test.ts");
      assert.deepEqual(
        { project: data.project, projects: data.projects },
        { project: expected.project, projects: expected.projects },
        variant,
      );
    });
  }
});

test("a call on a member merged from several declarations links the declaration its signature selects", async () => {
  const { request, read, write } = await project();
  await write(
    "node_modules/stream-kit/package.json",
    manifest("stream-kit", "1.0.0"),
  );
  await write(
    "node_modules/stream-kit/index.d.ts",
    "export interface Readable { once(event: 'end', listener: () => void): this; }\nexport declare const source: Readable;\nexport interface Logger { log(message: string): void; }\nexport declare const logger: Logger;\n",
  );
  await write(
    "node_modules/busy-kit/package.json",
    manifest("busy-kit", "1.0.0"),
  );
  await write(
    "node_modules/busy-kit/index.d.ts",
    "import 'stream-kit';\ndeclare module 'stream-kit' { interface Readable { once(event: 'limit', listener: () => void): this; } interface Logger { log(message: string, ...rest: unknown[]): void; } }\nexport {};\n",
  );
  await write(
    "node_modules/union-kit/package.json",
    manifest("union-kit", "1.0.0"),
  );
  await write(
    "node_modules/union-kit/index.d.ts",
    "export interface A { run(): void } export interface B { run(): void }\nexport declare const either: A | B;\n",
  );
  await write(
    "main.ts",
    [
      'import "busy-kit";',
      'import { logger, source } from "stream-kit";',
      'import { either } from "union-kit";',
      "source.once('end', () => {});",
      "either.run();",
      "logger.log('x');",
      "",
    ].join("\n"),
  );
  await request("index");
  read((store) => {
    const calls = (name) =>
      store
        .links()
        .filter(
          (link) =>
            link.file === "main.ts" &&
            link.kind === "calls" &&
            link.targetName === name,
        );
    const [end] = calls("source.once");
    assert.equal(end.resolution, "library", JSON.stringify(end.data));
    assert.deepEqual(
      end.libraries.map(({ unit, symbol }) => [unit, symbol]),
      [["stream-kit", "Readable.prototype.once"]],
    );
    // Both merged declarations accept the arguments: the checker's choice is
    // declaration order, so it stays a candidate set.
    const [log] = calls("logger.log");
    assert.ok(
      log.resolution !== "library" || log.libraries.length !== 1,
      JSON.stringify(log),
    );
    // A union receiver is dispatch: never narrowed to one arm.
    const [run] = calls("either.run");
    assert.ok(
      run.resolution !== "library" || run.libraries.length !== 1,
      JSON.stringify(run),
    );
  });
});

test("a merged-member call keeps one identity for a same-package directory augmentation", async () => {
  const { request, read, write } = await project();
  await write(
    "tsconfig.json",
    '{"compilerOptions":{"module":"CommonJS","moduleResolution":"Node10","esModuleInterop":true},"files":["main.ts"]}',
  );
  const types = "node_modules/@types/codemirror";
  await write(`${types}/package.json`, manifest("@types/codemirror", "1.0.0"));
  await write(
    `${types}/index.d.ts`,
    "declare namespace CodeMirror { interface Editor { setOption(name: 'a'): void } } export = CodeMirror;",
  );
  await write(
    `${types}/addon/edit/closebrackets.d.ts`,
    'import "../../"; declare module "../../" { interface Editor { setOption(name: \'b\'): void } }',
  );
  await write(
    "node_modules/cm-extra/package.json",
    manifest("cm-extra", "1.0.0"),
  );
  await write(
    "node_modules/cm-extra/index.d.ts",
    "import 'codemirror'; declare module 'codemirror' { interface Editor { setOption(name: 'c'): void } }\nexport {};\n",
  );
  await write(
    "main.ts",
    [
      'import CodeMirror from "codemirror";',
      'import "codemirror/addon/edit/closebrackets";',
      'import "cm-extra";',
      "declare const a: CodeMirror.Editor;",
      "declare const b: CodeMirror.Editor;",
      "declare const c: CodeMirror.Editor;",
      "a.setOption('a');",
      "b.setOption('b');",
      "c.setOption('c');",
    ].join("\n"),
  );
  await request("index");
  read((_, call) => {
    // The original's overload: its own identity.
    assert.deepEqual(
      [target(call("main.ts", "a.setOption"))].map(({ unit, symbol }) => [
        unit,
        symbol,
      ]),
      [["codemirror", "CodeMirror.Editor.prototype.setOption"]],
    );
    // The same-package augmentation's overload never gets an identity of its
    // own: it is not narrowed away from the original's.
    const own = call("main.ts", "b.setOption");
    assert.ok(
      own.resolution !== "library" ||
        own.libraries.every(({ unit, symbol }) =>
          unit === "codemirror"
            ? symbol === "CodeMirror.Editor.prototype.setOption"
            : true,
        ),
      JSON.stringify(own),
    );
    // Another package's overload: that package's declaration.
    assert.equal(target(call("main.ts", "c.setOption")).unit, "cm-extra");
  });
});

// C-42: one global declared by the DOM library and by @types/node.
async function environmentLayout(write, main, extra = {}) {
  await write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        strict: true,
        lib: ["es2022", "dom"],
        types: ["node", "kit-a", "kit-b"],
      },
      include: ["src"],
    }),
  );
  await write(
    "node_modules/@types/node/package.json",
    manifest("@types/node", "20.0.0"),
  );
  await write(
    "node_modules/@types/node/index.d.ts",
    [
      "export {};",
      "declare global {",
      "  interface Console { log(...data: any[]): void }",
      "  var console: Console;",
      "  function setTimeout(callback: () => void, ms?: number): number;",
      "  interface URL { href: string }",
      // As @types/node declares it: the DOM's type where the DOM library is loaded.
      "  var URL: typeof globalThis extends { onmessage: any; URL: infer T } ? T : { new (url: string): URL };",
      "}",
      "",
    ].join("\n"),
  );
  for (const name of ["kit-a", "kit-b"]) {
    await write(`node_modules/${name}/package.json`, manifest(name, "1.0.0"));
    await write(
      `node_modules/${name}/index.d.ts`,
      `interface Runner${name.at(-1).toUpperCase()} { run(): void }\n`,
    );
  }
  await write("src/main.ts", main);
  for (const [path, text] of Object.entries(extra)) await write(path, text);
}
const linkAt = (store, name) => {
  const links = store
    .links()
    .filter((link) => link.file === "src/main.ts" && link.targetName === name);
  assert.equal(links.length, 1, name);
  return links[0];
};
const units = (link) =>
  (link.libraries ?? [])
    .map(({ ecosystem, unit }) => `${ecosystem}:${unit}`)
    .sort();

test("a global declared by the DOM library and by @types/node is one merged environment global", async () => {
  const { request, read, write } = await project();
  await environmentLayout(
    write,
    [
      'console.log("x");',
      "setTimeout(() => {}, 1);",
      // As in vitejs/vite packages/vite/src/shared/moduleRunnerTransport.ts.
      'export const url = new URL("ws://localhost");',
      "",
    ].join("\n"),
  );
  await request("index");
  read((store) => {
    for (const name of ["console.log", "setTimeout", "URL"]) {
      const link = linkAt(store, name);
      assert.equal(link.resolution, "ambiguous", name);
      assert.equal(link.data.mergedGlobal, true, name);
      assert.deepEqual(link.candidates, [], name);
      assert.equal(units(link).length, 2, name);
      assert.ok(units(link).includes("dom:dom"), name);
      assert.ok(
        link.libraries.every(({ symbol }) => !!symbol),
        name,
      );
    }
  });
});

// C-42 (narrowed D23) and the guards of the mark: each case below is a set
// the compiler merges, or one that spans programs, that must not be marked.
async function globalsCase(files, file = "src/main.ts", name) {
  const { request, read, write } = await project();
  for (const [path, text] of Object.entries(files)) await write(path, text);
  await request("index");
  let link;
  read((store) => {
    const links = store
      .links()
      .filter((l) => l.file === file && l.targetName === name);
    assert.equal(links.length, 1, `${file} ${name}`);
    link = links[0];
  });
  return link;
}
const config = (compilerOptions, include = ["src"]) =>
  JSON.stringify({
    compilerOptions: { strict: true, ...compilerOptions },
    include,
  });
const typesPackage = (name, text) => ({
  [`node_modules/${name}/package.json`]: manifest(name, "1.0.0"),
  [`node_modules/${name}/index.d.ts`]: text,
});

test("globals that competing test packages both declare are not a merged global", async () => {
  // types: ["jest", "mocha"]: describe from two frameworks.
  const describe = await globalsCase(
    {
      "tsconfig.json": config({ lib: ["es2022"], types: ["jest", "mocha"] }),
      ...typesPackage(
        "@types/jest",
        "declare function describe(name: string, fn: () => void): void;\n",
      ),
      ...typesPackage(
        "@types/mocha",
        "declare function describe(title: string, fn: () => void): void;\n",
      ),
      "src/main.ts": 'describe("x", () => {});\nexport {};\n',
    },
    "src/main.ts",
    "describe",
  );
  assert.equal(describe.data.mergedGlobal, undefined);
  // vitest/globals and @types/chai: expect from two assertion libraries.
  const expect = await globalsCase(
    {
      "tsconfig.json": config({
        lib: ["es2022"],
        types: ["vitest/globals", "chai"],
      }),
      "node_modules/vitest/package.json": manifest("vitest", "1.0.0"),
      "node_modules/vitest/index.d.ts": "export {};\n",
      "node_modules/vitest/globals.d.ts":
        "declare function expect(value: unknown): void;\n",
      ...typesPackage(
        "@types/chai",
        "declare function expect(target: unknown): void;\n",
      ),
      "src/main.ts": "expect(1);\nexport {};\n",
    },
    "src/main.ts",
    "expect",
  );
  assert.equal(expect.data.mergedGlobal, undefined);
});

test("a global whose variable declarations disagree on the type is not a merged global; one that agrees is", async () => {
  const layout = (a, b) => ({
    "tsconfig.json": config({ lib: ["es2022"], types: ["env-a", "env-b"] }),
    ...typesPackage("env-a", `declare var shared: ${a};\n`),
    ...typesPackage("env-b", `declare var shared: ${b};\n`),
    "src/main.ts": "shared();\nexport {};\n",
  });
  const differ = await globalsCase(
    layout("() => void", "(x?: number) => string"),
    "src/main.ts",
    "shared",
  );
  assert.equal(differ.data.mergedGlobal, undefined);
  const agree = await globalsCase(
    layout("() => void", "() => void"),
    "src/main.ts",
    "shared",
  );
  assert.equal(agree.data.mergedGlobal, true);
});

// C-42 review N1: TS2403 compares the types for identity. Two types each
// assignable to the other but not identical (`any` against `number`) are in
// conflict, as the compiler says even under skipLibCheck's default.
test("variable types assignable both ways but not identical are in conflict (TS2403), and the mark is withheld", async () => {
  const layout = (a, b) => ({
    "tsconfig.json": config({ lib: ["es2022"], types: ["env-a", "env-b"] }),
    ...typesPackage("env-a", `declare var shared: { (): void; n: ${a} };\n`),
    ...typesPackage("env-b", `declare var shared: { (): void; n: ${b} };\n`),
    "src/main.ts": "shared();\nexport {};\n",
  });
  const mutual = await globalsCase(
    layout("any", "number"),
    "src/main.ts",
    "shared",
  );
  assert.equal(mutual.data.mergedGlobal, undefined);
  // The reviewer's repro: a parameter widened in one package only.
  const flag = await globalsCase(
    {
      "tsconfig.json": config({
        lib: ["es2022", "dom"],
        types: ["env-a", "env-b"],
      }),
      ...typesPackage(
        "env-a",
        "declare var flag: { (): void; go(x: string | URL): void };\n",
      ),
      ...typesPackage(
        "env-b",
        "declare var flag: { (): void; go(x: string): void };\n",
      ),
      "src/main.ts": "flag();\nexport {};\n",
    },
    "src/main.ts",
    "flag",
  );
  assert.equal(flag.data.mergedGlobal, undefined);
  const identical = await globalsCase(
    layout("number", "number"),
    "src/main.ts",
    "shared",
  );
  assert.equal(identical.data.mergedGlobal, true);
});

// C-42 review N1b: units in conflict on one shared global are alternatives;
// no other global they both declare is marked, functions included.
test("two units in conflict on any shared global mark none of their merged globals", async () => {
  const layout = (agree) => ({
    "tsconfig.json": config({ lib: ["es2022"], types: ["env-a", "env-b"] }),
    ...typesPackage(
      "env-a",
      "declare var Thing: { make(): void };\ndeclare function helper(): void;\n",
    ),
    ...typesPackage(
      "env-b",
      `declare var Thing: { make(): ${agree ? "void" : "number"} };\ndeclare function helper(): void;\n`,
    ),
    "src/main.ts": "helper();\nexport {};\n",
  });
  const conflicting = await globalsCase(layout(false), "src/main.ts", "helper");
  assert.equal(conflicting.data.mergedGlobal, undefined);
  const agreeing = await globalsCase(layout(true), "src/main.ts", "helper");
  assert.equal(agreeing.data.mergedGlobal, true);
});

// C-42 review round 2: the compiler's other conflicts between two units.
// bun-types redeclares DOM stream and fetch types with different property
// types (TS2717); its units are alternatives to the DOM's.
test("units in conflict by a member's type (the bun-types shape) mark none of their merged globals", async () => {
  const files = (closed) => ({
    "tsconfig.json": config({ lib: ["es2022", "dom"], types: ["env-bun"] }),
    ...typesPackage(
      "env-bun",
      `interface ReadableStreamGenericReader { readonly closed: ${closed}; cancel(reason?: any): Promise<void> }\ninterface Headers { toJSON(): Record<string, string> }\n`,
    ),
    "src/main.ts":
      "declare const r: ReadableStreamDefaultReader<string>;\nr.cancel();\nexport const h = new Headers();\n",
  });
  const cancel = await globalsCase(
    files("Promise<undefined>"),
    "src/main.ts",
    "r.cancel",
  );
  assert.equal(cancel.data.mergedGlobal, undefined);
  const headers = await globalsCase(
    files("Promise<undefined>"),
    "src/main.ts",
    "Headers",
  );
  assert.equal(headers.data.mergedGlobal, undefined);
  // The same declarations with the DOM's own type for `closed` agree.
  const agreeing = await globalsCase(
    files("Promise<void>"),
    "src/main.ts",
    "r.cancel",
  );
  assert.equal(agreeing.data.mergedGlobal, true);
});

// One case for each conflict the compiler reports between two units; a
// function both units declare alike is unmarked because of it.
for (const [code, a, b] of [
  [2717, "interface Thing { p: string }", "interface Thing { p: number }"],
  [2300, "declare var dup: number;", "declare function dup(): void;"],
  [2451, "declare let block: number;", "declare let block: number;"],
  [2428, "interface Box<T> { t: T }", "interface Box<U, V> { u: U }"],
  [
    2687,
    "interface Flag { readonly f: string }",
    "interface Flag { f: string }",
  ],
])
  test(`units the compiler finds in conflict by TS${code} are alternatives`, async () => {
    const link = await globalsCase(
      {
        "tsconfig.json": config({ lib: ["es2022"], types: ["env-a", "env-b"] }),
        ...typesPackage("env-a", `${a}\ndeclare function helper(): void;\n`),
        ...typesPackage("env-b", `${b}\ndeclare function helper(): void;\n`),
        "src/main.ts": "helper();\nexport {};\n",
      },
      "src/main.ts",
      "helper",
    );
    assert.equal(link.data.mergedGlobal, undefined);
  });

test("a conflict declared in a global block inside an ambient module is found", async () => {
  const link = await globalsCase(
    {
      "tsconfig.json": config({ lib: ["es2022"], types: ["env-a", "env-b"] }),
      ...typesPackage(
        "env-a",
        'declare module "env-a" { global { var shared: { n: number }; function helper(): void; } }\n',
      ),
      ...typesPackage(
        "env-b",
        "declare var shared: { n: string };\ndeclare function helper(): void;\n",
      ),
      "src/main.ts": "helper();\nexport {};\n",
    },
    "src/main.ts",
    "helper",
  );
  assert.equal(link.data.mergedGlobal, undefined);
});

test("a conflict inside a global namespace both units declare is found", async () => {
  const files = (type) => ({
    "tsconfig.json": config({ lib: ["es2022"], types: ["env-a", "env-b"] }),
    ...typesPackage(
      "env-a",
      "declare namespace Env { var mode: string; }\ndeclare function helper(): void;\n",
    ),
    ...typesPackage(
      "env-b",
      `declare namespace Env { var mode: ${type}; }\ndeclare function helper(): void;\n`,
    ),
    "src/main.ts": "helper();\nexport {};\n",
  });
  const conflicting = await globalsCase(
    files("number"),
    "src/main.ts",
    "helper",
  );
  assert.equal(conflicting.data.mergedGlobal, undefined);
  const agreeing = await globalsCase(files("string"), "src/main.ts", "helper");
  assert.equal(agreeing.data.mergedGlobal, true);
});

test("with three units, the unit that differs and the first it differs from conflict with every other unit (deny by default)", async () => {
  const files = {
    "tsconfig.json": config({
      lib: ["es2022"],
      types: ["env-a", "env-b", "env-c"],
    }),
    ...typesPackage(
      "env-a",
      "declare var trio: { n: number };\ndeclare function both(): void;\n",
    ),
    ...typesPackage(
      "env-b",
      "declare var trio: { n: number };\ndeclare function both(): void;\ndeclare function later(): void;\n",
    ),
    ...typesPackage(
      "env-c",
      "declare var trio: { n: string };\ndeclare function later(): void;\n",
    ),
    "src/main.ts": "both();\nlater();\nexport {};\n",
  };
  // C's diagnostic names C and, as related, A: both conflict with every
  // other unit (review round 3, deny by default), so A and B's shared
  // global is unmarked too.
  const both = await globalsCase(files, "src/main.ts", "both");
  assert.equal(both.data.mergedGlobal, undefined);
  const later = await globalsCase(files, "src/main.ts", "later");
  assert.equal(later.data.mergedGlobal, undefined);
});

test("a conflict and a link name a declaration inside @types/node's ambient module by the same unit", async () => {
  const link = await globalsCase(
    {
      "tsconfig.json": config({ lib: ["es2022"], types: ["node", "env-b"] }),
      ...typesPackage(
        "@types/node",
        'declare module "url" { global { var keyed: { n: number }; function helper(): void; } }\n',
      ),
      ...typesPackage(
        "env-b",
        "declare var keyed: { n: string };\ndeclare function helper(): void;\n",
      ),
      "src/main.ts": "helper();\nexport {};\n",
    },
    "src/main.ts",
    "helper",
  );
  assert.equal(link.data.mergedGlobal, undefined);
});

// C-42 review round 2: conflicts are between typings packages; every
// node:* unit is @types/node. bun-types conflicts with @types/node's
// stream/web globals, so console.log {node:console, bun} is unmarked.
test("every node:* unit is one package for the conflict test", async () => {
  const link = await globalsCase(
    {
      "tsconfig.json": config({ lib: ["es2022"], types: ["node", "env-bun"] }),
      ...typesPackage(
        "@types/node",
        'declare module "stream/web" { global { var Thing: { n: number }; } }\ndeclare module "console" { global { function helper(): void; } }\n',
      ),
      ...typesPackage(
        "env-bun",
        "declare var Thing: { n: string };\ndeclare function helper(): void;\n",
      ),
      "src/main.ts": "helper();\nexport {};\n",
    },
    "src/main.ts",
    "helper",
  );
  assert.equal(link.data.mergedGlobal, undefined);
});

// C-42 review round 6: a set whose units are all one unit key (only
// node:* units) has no other unit to conflict with: it stays marked though
// @types/node has a diagnostic (here a missing type, against env-b's
// `thing`), while a set of @types/node and env-b is unmarked by it.
test("a set of node:* units alone stays marked despite a diagnostic in @types/node", async () => {
  const files = {
    "tsconfig.json": config({ lib: ["es2022"], types: ["node", "env-b"] }),
    ...typesPackage(
      "@types/node",
      'declare module "process" { global { var thing: Missing; function helper(): void; function other(): void; } }\ndeclare module "console" { global { function helper(): void; } }\n',
    ),
    ...typesPackage(
      "env-b",
      "declare var thing: number;\ndeclare function other(): void;\n",
    ),
    "src/main.ts": "helper();\nother();\nexport {};\n",
  };
  const nodeOnly = await globalsCase(files, "src/main.ts", "helper");
  assert.deepEqual(units(nodeOnly).sort(), ["node:console", "node:process"]);
  assert.equal(nodeOnly.data.mergedGlobal, true);
  const withEnvB = await globalsCase(files, "src/main.ts", "other");
  assert.equal(withEnvB.data.mergedGlobal, undefined);
});

test("two units that differ from the first declaration are unmarked with each other too (deny by default)", async () => {
  const link = await globalsCase(
    {
      "tsconfig.json": config({
        lib: ["es2022"],
        types: ["env-a", "env-b", "env-c"],
      }),
      ...typesPackage("env-a", "declare var pair: { n: number };\n"),
      ...typesPackage(
        "env-b",
        "declare var pair: { n: string };\ndeclare function duo(): void;\n",
      ),
      ...typesPackage(
        "env-c",
        "declare var pair: { n: string };\ndeclare function duo(): void;\n",
      ),
      "src/main.ts": "duo();\nexport {};\n",
    },
    "src/main.ts",
    "duo",
  );
  assert.equal(link.data.mergedGlobal, undefined);
});

// The tRPC shape: Workers' Request is the first declaration; the other two
// agree with each other and differ from it. Round 2 paired only each with
// Workers; deny by default (round 3) unmarks every set among the three.
test("two units reported against a third are unmarked with each other too (deny by default)", async () => {
  const files = {
    "tsconfig.json": config({
      lib: ["es2022"],
      types: ["env-workers", "env-web", "node"],
    }),
    ...typesPackage(
      "env-workers",
      "interface Request { cf: number }\ndeclare var Request: { new (): Request; workers: true };\ndeclare function cfOnly(): void;\n",
    ),
    ...typesPackage(
      "env-web",
      "interface Request { url: string }\ndeclare var Request: { new (): Request };\ndeclare function webAndNode(): void;\ndeclare function cfOnly(): void;\n",
    ),
    "node_modules/@types/node/package.json": manifest("@types/node", "20.0.0"),
    "node_modules/@types/node/index.d.ts":
      'declare module "undici" { global { var Request: { new (): Request }; function webAndNode(): void; function cfNode(): void; } }\n',
    "src/main.ts": "webAndNode();\ncfOnly();\nexport {};\n",
  };
  // Web and Node agree with each other, but each is reported against
  // Workers: both conflict with every other unit (review round 3).
  const agreeing = await globalsCase(files, "src/main.ts", "webAndNode");
  assert.equal(agreeing.data.mergedGlobal, undefined);
  // Workers and Web disagree: paired.
  const differing = await globalsCase(files, "src/main.ts", "cfOnly");
  assert.equal(differing.data.mergedGlobal, undefined);
});

// Two installed versions of @types/node (Dexie) share one unit key. This
// fixture gives no diagnostic; it checks only that two versions share one
// unit key, so the merged global stays marked. (The DOM and WebWorker
// libraries, both the unit `dom`, are the next test.)
test("two installed versions of @types/node share one unit key and leave a merged global marked", async () => {
  const nodeTypes = (version, n) => ({
    "package.json": manifest("@types/node", version),
    "index.d.ts": `declare module "url" { global { var dual: { n: ${n} }; function helper(): void; } }\n`,
  });
  const files = {
    "tsconfig.json": config({
      lib: ["es2022"],
      types: ["node", "env-pkg", "env-b"],
    }),
    ...Object.fromEntries(
      Object.entries(nodeTypes("20.0.0", "number")).map(([k, v]) => [
        `node_modules/@types/node/${k}`,
        v,
      ]),
    ),
    ...typesPackage("env-pkg", '/// <reference types="node" />\nexport {};\n'),
    ...Object.fromEntries(
      Object.entries(nodeTypes("18.0.0", "string")).map(([k, v]) => [
        `node_modules/env-pkg/node_modules/@types/node/${k}`,
        v,
      ]),
    ),
    // A third declaration of the same names; this fixture gives no
    // diagnostic.
    ...typesPackage(
      "env-b",
      "declare var dual: { n: number };\ndeclare function helper(): void;\n",
    ),
    "src/main.ts": "helper();\nexport {};\n",
  };
  const link = await globalsCase(files, "src/main.ts", "helper");
  assert.equal(link.data.mergedGlobal, true);
});

test("the DOM and WebWorker libraries in conflict leave a merged global of the DOM and Node marked", async () => {
  const link = await globalsCase(
    {
      "tsconfig.json": config({
        lib: ["es2022", "dom", "webworker"],
        types: ["node"],
      }),
      "node_modules/@types/node/package.json": manifest(
        "@types/node",
        "20.0.0",
      ),
      "node_modules/@types/node/index.d.ts": [
        "export {};",
        "declare global {",
        "  interface Console { log(...data: any[]): void }",
        "  var console: Console;",
        "}",
        "",
      ].join("\n"),
      "src/main.ts": 'console.log("x");\nexport {};\n',
    },
    "src/main.ts",
    "console.log",
  );
  assert.equal(link.data.mergedGlobal, true);
});

test("the units in conflict are computed once per program, not once per file", async () => {
  const { graphWork, resetGraphWork } = await import("../dist/graph/work.js");
  resetGraphWork();
  await globalsCase(
    {
      "tsconfig.json": config({ lib: ["es2022"], types: ["env-a", "env-b"] }),
      ...typesPackage("env-a", "declare function helper(): void;\n"),
      ...typesPackage("env-b", "declare function helper(): void;\n"),
      "src/main.ts": "helper();\nexport {};\n",
      "src/other.ts": "helper();\nexport {};\n",
      "src/third.ts": "helper();\nexport {};\n",
    },
    "src/main.ts",
    "helper",
  );
  assert.equal(graphWork.counts["typescript.conflictScans"], 1);
  // The statements submitted to the second checker: one per file here.
  assert.equal(graphWork.counts["typescript.conflictChecks"], 2);
});

test("the conflict check counts statements, not declarations", async () => {
  // `var first, second` is one statement of two declarations.
  const { graphWork, resetGraphWork } = await import("../dist/graph/work.js");
  resetGraphWork();
  await globalsCase(
    {
      "tsconfig.json": config({ lib: ["es2022"], types: ["env-a", "env-b"] }),
      ...typesPackage(
        "env-a",
        "declare var first: number, second: number;\ndeclare function helper(): void;\n",
      ),
      ...typesPackage(
        "env-b",
        "declare var first: number;\ndeclare var second: number;\ndeclare function helper(): void;\n",
      ),
      "src/main.ts": "helper();\nexport {};\n",
    },
    "src/main.ts",
    "helper",
  );
  assert.equal(graphWork.counts["typescript.conflictChecks"], 5);
});

// C-42 review round 3: deny by default. Any diagnostic the second checker
// reports in a unit's declaration file, whatever its code, unmarks: one
// with related locations pairs their units, one without makes its unit
// conflict with every other.
test("any diagnostic in a unit's declarations unmarks its sets, whatever its code", async () => {
  for (const [what, a, b] of [
    // TS2304, a missing type: no related location.
    [
      "a missing type",
      "declare var thing: number;",
      "declare var thing: Missing;",
    ],
    // An optional and a required member of one merged interface.
    [
      "optional and required overloads",
      "interface Probe { resolve(x: string): string }",
      "interface Probe { resolve?(x: number): string }",
    ],
  ]) {
    const link = await globalsCase(
      {
        "tsconfig.json": config({ lib: ["es2022"], types: ["env-a", "env-b"] }),
        ...typesPackage("env-a", `${a}\ndeclare function helper(): void;\n`),
        ...typesPackage("env-b", `${b}\ndeclare function helper(): void;\n`),
        "src/main.ts": "helper();\nexport {};\n",
      },
      "src/main.ts",
      "helper",
    );
    assert.equal(link.data.mergedGlobal, undefined, what);
  }
});

test("a conflict across packages counts when one package declares the global in two files", async () => {
  // env-a's typings span two files joined by a triple-slash reference, each
  // declaring `shared`; env-b's differs. Only a pair inside one unit is
  // dropped; this pair is across two.
  const link = await globalsCase(
    {
      "tsconfig.json": config({ lib: ["es2022"], types: ["env-a", "env-b"] }),
      "node_modules/env-a/package.json": manifest("env-a", "1.0.0"),
      "node_modules/env-a/index.d.ts":
        '/// <reference path="./more.d.ts" />\ndeclare var shared: { n: number };\ndeclare function helper(): void;\n',
      "node_modules/env-a/more.d.ts": "declare var shared: { n: number };\n",
      ...typesPackage(
        "env-b",
        "declare var shared: { n: string };\ndeclare function helper(): void;\n",
      ),
      "src/main.ts": "helper();\nexport {};\n",
    },
    "src/main.ts",
    "helper",
  );
  assert.equal(link.data.mergedGlobal, undefined);
});

test("a file in two programs, one of which unmarks, keeps no mark anywhere in its data", async () => {
  // The same DOM and @types/node candidates in both programs; the server's
  // program also reads a file of @types/node that conflicts with the DOM's
  // `name`, so only there are the two units in conflict.
  const link = await globalsCase(
    {
      "packages/web/tsconfig.json": config(
        { lib: ["es2022", "dom"], types: ["node"] },
        ["../shared"],
      ),
      "packages/server/tsconfig.json": config(
        { lib: ["es2022", "dom"], types: ["node"] },
        ["../shared", "ref.ts"],
      ),
      ...typesPackage(
        "@types/node",
        "export {};\ndeclare global { interface Console { log(...data: any[]): void } var console: Console; }\n",
      ),
      "node_modules/@types/node/extra.d.ts": "declare var name: number;\n",
      "packages/server/ref.ts":
        '/// <reference path="../../node_modules/@types/node/extra.d.ts" />\nexport {};\n',
      "packages/shared/log.ts": 'console.log("x");\nexport {};\n',
    },
    "packages/shared/log.ts",
    "console.log",
  );
  assert.equal(JSON.stringify(link.data).includes("mergedGlobal"), false);
});

test("a set with a Node target the module synthesised is not marked", async () => {
  // No @types/node: the module adds a Node target for `setTimeout` beside
  // the DOM's declaration. The set does not name the compiler's
  // declarations, so it is not marked.
  const link = await globalsCase(
    {
      // A Node builtin import, and no @types/node: the program expects Node
      // without its typings.
      "tsconfig.json": config({ lib: ["es2022", "dom"] }),
      "src/main.ts":
        'import { readFileSync } from "node:fs";\nsetTimeout(() => {}, 1);\nexport const read = readFileSync;\n',
    },
    "src/main.ts",
    "setTimeout",
  );
  assert.ok(
    (link.libraries ?? []).some(
      ({ ecosystem, evidence }) =>
        ecosystem === "node" && evidence === "declared-builtin",
    ),
    JSON.stringify(link.libraries),
  );
  assert.equal(link.data.mergedGlobal, undefined);
});

test("an ambient module merged across two packages, a checkout augmentation and a file in two programs are not a merged global", async () => {
  // An ambient `declare module` is not the global scope.
  const ambient = await globalsCase(
    {
      "tsconfig.json": config({ lib: ["es2022"], types: ["amb-a", "amb-b"] }),
      ...typesPackage(
        "amb-a",
        'declare module "shared" { export interface Box { open(): void } export const box: Box; }\n',
      ),
      ...typesPackage(
        "amb-b",
        'declare module "shared" { export interface Box { open(): void } }\n',
      ),
      "src/main.ts": 'import { box } from "shared";\nbox.open();\n',
    },
    "src/main.ts",
    "box.open",
  );
  assert.equal(ambient.data.mergedGlobal, undefined);
  // A checkout `declare global` adds a checkout declaration to the set.
  const checkout = await globalsCase(
    {
      "tsconfig.json": config({ lib: ["es2022", "dom"], types: ["node"] }),
      ...typesPackage(
        "@types/node",
        "export {};\ndeclare global { interface Console { log(...data: any[]): void } var console: Console; }\n",
      ),
      "src/globals.d.ts":
        "export {};\ndeclare global { interface Console { log(...data: any[]): void } }\n",
      "src/main.ts": 'console.log("x");\nexport {};\n',
    },
    "src/main.ts",
    "console.log",
  );
  assert.equal(checkout.data.mergedGlobal, undefined);
  // One file in two programs, each of which marks console.log, with
  // different units (DOM and @types/node; DOM and another environment
  // package). The sets differ, so the mark is dropped.
  const twoPrograms = await globalsCase(
    {
      "packages/web/tsconfig.json": config(
        { lib: ["es2022", "dom"], types: ["node"] },
        ["../shared"],
      ),
      "packages/server/tsconfig.json": config(
        { lib: ["es2022", "dom"], types: ["env-c"] },
        ["../shared"],
      ),
      ...typesPackage(
        "@types/node",
        "export {};\ndeclare global { interface Console { log(...data: any[]): void } var console: Console; }\n",
      ),
      ...typesPackage(
        "env-c",
        "export {};\ndeclare global { interface Console { log(...data: any[]): void } var console: Console; }\n",
      ),
      "packages/shared/log.ts": 'console.log("x");\nexport {};\n',
    },
    "packages/shared/log.ts",
    "console.log",
  );
  assert.equal(twoPrograms.data.mergedGlobal, undefined);
});

test("different global symbols that share a member name are not a merged global", async () => {
  const { request, read, write } = await project();
  await environmentLayout(
    write,
    "declare const r: RunnerA | RunnerB;\nr.run();\nexport {};\n",
  );
  await request("index");
  read((store) => {
    const link = linkAt(store, "r.run");
    assert.notEqual(link.resolution, "library");
    assert.equal(link.data.mergedGlobal, undefined);
  });
});

test("a merged global beside an unread file stays withheld", async () => {
  const { request, read, write } = await project();
  await environmentLayout(write, 'console.log("x");\nexport {};\n', {
    "src/broken.ts": "export const z = 1;\nlet = ;\n",
  });
  await request("index");
  read((store) => {
    const link = linkAt(store, "console.log");
    assert.equal(link.resolution, "unresolved");
    assert.equal(link.data.mergedGlobal, undefined);
  });
});

// C-39: the compiler's semver parser throws on some published ranges.
test("a manifest range the compiler cannot parse does not fail the importing file", async () => {
  const { request, read, write } = await project();
  await write(
    "package.json",
    JSON.stringify({ dependencies: { "drizzle-orm": "^1.0.0-beta.9-8d6992" } }),
  );
  await write(
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: { strict: true, types: [] },
      include: ["src"],
    }),
  );
  await write(
    "node_modules/drizzle-orm/package.json",
    manifest("drizzle-orm", "1.0.0-beta.9-8d6992"),
  );
  await write(
    "node_modules/drizzle-orm/index.d.ts",
    "export declare function sql(): void;\n",
  );
  await write("src/main.ts", 'import { sql } from "drizzle-orm";\nsql();\n');
  // A registry range the parser cannot read is "unknown", never a throw.
  assert.equal(registryRange("^1.0.0-beta.9-8d6992"), "unknown");
  assert.equal(registryRange("^1.2.3"), "known");
  assert.equal(registryRange("latest"), "known");
  assert.equal(registryRange("github:owner/repo"), false);
  await request("index");
  read((store, call) => {
    assert.notEqual(store.getFile("src/main.ts").result.status, "failed");
    const link = target(call("src/main.ts", "sql"));
    assert.equal(link.unit, "drizzle-orm");
    assert.equal(link.symbol, "sql");
    // The version comes from the installed package, not from the range.
    assert.equal(link.versionSource, "node_modules/drizzle-orm/package.json");
  });
});

// C-60: a base whose root is not an object (TS5092) is dropped by the
// compiler. Reached by package name, the link stays `incomplete-config`, as
// for an unreadable base; reached by relative path, the file fails.
test("a config base by package name whose root is not an object keeps the config incomplete; by relative path it fails the file", async () => {
  for (const root of ["[]", "55"]) {
    for (const by of ["package", "relative"]) {
      const { root: dir, request, read, write } = await project();
      await write("node_modules/kit/package.json", manifest("kit", "1.0.0"));
      await write(
        "node_modules/kit/index.d.ts",
        "export interface Box { open(): void }\nexport declare const box: Box;\n",
      );
      await write(
        "packages/tsconfig/package.json",
        JSON.stringify({ name: "@scope/tsconfig", version: "0.0.0" }),
      );
      await write("packages/tsconfig/library.json", root);
      await write(
        "packages/app/tsconfig.json",
        JSON.stringify({
          extends:
            by === "package"
              ? "@scope/tsconfig/library.json"
              : "../tsconfig/library.json",
          include: ["src"],
        }),
      );
      await write(
        "packages/app/src/a.ts",
        'import { box } from "kit";\nbox.open();\n',
      );
      if (by === "package") {
        const link = join(dir, "packages/app/node_modules/@scope/tsconfig");
        await mkdir(dirname(link), { recursive: true });
        await symlink("../../../tsconfig", link);
      }
      await request("index");
      read((store, call) => {
        const file = store.getFile("packages/app/src/a.ts").result;
        const variant = `${by} base ${root}`;
        if (by === "relative") assert.equal(file.status, "failed", variant);
        else {
          assert.ok(
            file.diagnostics.some(({ message }) =>
              message.includes("node_modules is never captured"),
            ),
            variant,
          );
          const open = call("packages/app/src/a.ts", "box.open");
          assert.notEqual(open.resolution, "library", variant);
          assert.equal(open.data.reason, "incomplete-config", variant);
        }
      });
    }
  }
});

test("a config extended by package name through an installed workspace link is read; an absent one stays incomplete", async () => {
  const cases = {
    "workspace config package": {
      extendsName: "@scope/tsconfig/library.json",
      link: ["packages/app/node_modules/@scope/tsconfig", "../../../tsconfig"],
      files: {
        "packages/tsconfig/package.json": JSON.stringify({
          name: "@scope/tsconfig",
          version: "0.0.0",
        }),
        "packages/tsconfig/library.json": JSON.stringify({
          compilerOptions: { strict: true, types: [] },
        }),
      },
      complete: true,
    },
    "exports-mapped shared configs": {
      extendsName: "astro/tsconfigs/strict",
      link: ["packages/app/node_modules/astro", "../../astro"],
      files: {
        "packages/astro/package.json": JSON.stringify({
          name: "astro",
          version: "0.0.0",
          exports: { "./tsconfigs/*": "./tsconfigs/*.json" },
        }),
        "packages/astro/tsconfigs/base.json": JSON.stringify({
          compilerOptions: { types: [] },
        }),
        "packages/astro/tsconfigs/strict.json": JSON.stringify({
          extends: "./base.json",
          compilerOptions: { strict: true },
        }),
      },
      complete: true,
    },
    "absent package": {
      extendsName: "@scope/missing/library.json",
      files: {},
      complete: false,
    },
    // tsc reports 1005 and drops what it cannot parse: settings are missing.
    "workspace config package with a JSON syntax error": {
      extendsName: "@scope/tsconfig/library.json",
      link: ["packages/app/node_modules/@scope/tsconfig", "../../../tsconfig"],
      files: {
        "packages/tsconfig/package.json": JSON.stringify({
          name: "@scope/tsconfig",
          version: "0.0.0",
        }),
        "packages/tsconfig/library.json":
          '{ "compilerOptions": { "strict": true "types": [] } }',
      },
      complete: false,
    },
  };
  for (const [
    variant,
    { extendsName, link, files, complete },
  ] of Object.entries(cases)) {
    const { root, request, read, write } = await project();
    await write("node_modules/kit/package.json", manifest("kit", "1.0.0"));
    await write(
      "node_modules/kit/index.d.ts",
      "export interface Box { open(): void }\nexport declare const box: Box;\n",
    );
    for (const [path, text] of Object.entries(files)) await write(path, text);
    await write(
      "packages/app/tsconfig.json",
      JSON.stringify({ extends: extendsName, include: ["src"] }),
    );
    await write(
      "packages/app/src/a.ts",
      'import { box } from "kit";\nbox.open();\n',
    );
    if (link) {
      await mkdir(dirname(join(root, link[0])), { recursive: true });
      await symlink(link[1], join(root, link[0]));
    }
    await request("index");
    read((store, call) => {
      const file = store.getFile("packages/app/src/a.ts").result;
      const missing = file.diagnostics.some(({ message }) =>
        message.includes("node_modules is never captured"),
      );
      const open = call("packages/app/src/a.ts", "box.open");
      if (complete) {
        assert.equal(missing, false, variant);
        assert.equal(open.resolution, "library", variant);
        assert.equal(open.libraries[0].symbol, "Box.prototype.open", variant);
      } else {
        assert.equal(missing, true, variant);
        assert.equal(open.data.reason, "incomplete-config", variant);
      }
    });
  }
});
