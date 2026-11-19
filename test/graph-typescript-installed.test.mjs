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
`,
  );
  await write(
    "node_modules/fixture-server/package.json",
    manifest("fixture-server", "1.0.0"),
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
