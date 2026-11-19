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
