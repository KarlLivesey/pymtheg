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
    "export interface Readable { once(event: 'end', listener: () => void): this; }\nexport declare const source: Readable;\n",
  );
  await write(
    "node_modules/busy-kit/package.json",
    manifest("busy-kit", "1.0.0"),
  );
  await write(
    "node_modules/busy-kit/index.d.ts",
    "import 'stream-kit';\ndeclare module 'stream-kit' { interface Readable { once(event: 'limit', listener: () => void): this; } }\nexport {};\n",
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
      'import { source } from "stream-kit";',
      'import { either } from "union-kit";',
      "source.once('end', () => {});",
      "either.run();",
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
    // A union receiver is dispatch: never narrowed to one arm.
    const [run] = calls("either.run");
    assert.ok(
      run.resolution !== "library" || run.libraries.length !== 1,
      JSON.stringify(run),
    );
  });
});
