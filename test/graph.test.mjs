// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  checkLanguageConformance,
  contentHash,
  discoverLanguages,
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
  validateResult,
} from "../dist/graph/index.js";
import toy from "../dist/graph/languages/toy/index.js";

async function sandbox(run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-test-"));
  const root = join(scratch, "project");
  await mkdir(root);
  const database = join(scratch, "graph.sqlite");
  const store = new SqliteGraphStore(database, "test-project");
  try {
    await run({ scratch, root, database, store });
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
const fixtureRoot = new URL("./fixtures/graph/toy/", import.meta.url);
const byName = (store, name) => store.findSymbols({ name })[0];

test("convention discovery needs no language list or core edits", async () => {
  assert.equal(
    (await discoverLanguages()).claim("nested/example.toy"),
    undefined,
  );
  const registry = await discoverLanguages(undefined, {
    includeTestOnly: true,
  });
  assert.equal(registry.claim("nested/example.toy").id, "toy");
  const coreDirectory = new URL("../src/graph/", import.meta.url);
  for (const entry of await readdir(coreDirectory, { withFileTypes: true }))
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      const core = await readFile(new URL(entry.name, coreDirectory), "utf8");
      assert.doesNotMatch(core, /toy/, entry.name);
    }
  await sandbox(async ({ scratch }) => {
    const folder = join(scratch, "languages", "invented");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "index.js"),
      `export default { id: "invented", version: "1", extensions: [".new"], parse() {}, resolve() {} };`,
    );
    const added = await discoverLanguages(
      pathToFileURL(join(scratch, "languages") + "/"),
    );
    assert.equal(added.claim("anything.new").id, "invented");
  });
});

test("toy project indexes, queries, persists, skips, replaces and invalidates incoming links", async () => {
  await sandbox(async ({ root, store, database }) => {
    await cp(fixtureRoot, root, { recursive: true });
    const parsed = [];
    let replaced = 0;
    const registry = new LanguageRegistry([
      {
        ...toy,
        parse(source) {
          parsed.push(source.path);
          return toy.parse(source);
        },
      },
    ]);
    const original = store.replaceFile.bind(store);
    store.replaceFile = (file) => {
      replaced++;
      original(file);
    };
    const first = await indexProject(root, registry, store);
    assert.equal(first.indexed, 2);
    assert.equal(first.symbols, 4);
    assert.equal(first.links, 4);
    assert.deepEqual(first.unclaimed, ["readme.txt"]);
    assert.deepEqual(first.failed, []);
    assert.equal(first.unresolved, 1);
    const symbols = store.findSymbols();
    const main = byName(store, "main");
    const helper = byName(store, "helper");
    assert.equal(
      store.findSymbols({ kind: "function", file: "lib.toy" }).length,
      1,
    );
    assert.equal(store.findSymbols({ name: "absent" }).length, 0);
    assert.equal(store.outgoing(main.id, "calls").length, 2);
    assert.equal(store.incoming(helper.id, "calls").length, 2);
    assert.equal(
      store.incoming(byName(store, "lib.toy").id, "imports").length,
      1,
    );
    assert.equal(store.outgoing(main.id, "references").length, 0);
    assert.equal(store.unresolved()[0].targetName, "missing");
    assert.equal(store.unresolved()[0].resolution, "unresolved");
    assert.equal(store.unresolved()[0].targetId, null);
    assert.equal(store.neighbourhood(main.id, 0).symbols.length, 1);
    assert.equal(store.neighbourhood(main.id, 1, "calls").symbols.length, 2);
    assert.equal(store.neighbourhood(main.id, 2, "calls").links.length, 3);
    assert.deepEqual(store.neighbourhood("missing", 1), {
      symbols: [],
      links: [],
    });
    assert.throws(() => store.neighbourhood(main.id, -1), /Depth/);
    const before = await readFile(database);
    const second = await indexProject(root, registry, store);
    assert.equal(second.indexed, 0);
    assert.equal(second.unchanged, 2);
    assert.equal(replaced, 2);
    assert.equal(parsed.length, 2);
    assert.deepEqual(store.findSymbols(), symbols);
    // Inspect persisted bytes rather than asserting any elapsed-time property.
    assert.deepEqual(await readFile(database), before);
    const reopened = new SqliteGraphStore(database);
    try {
      assert.equal(reopened.projectId, "test-project");
      assert.deepEqual(reopened.findSymbols(), symbols);
      assert.equal(reopened.links().length, 4);
    } finally {
      reopened.close();
    }
    assert.throws(
      () => new SqliteGraphStore(database, "other-project"),
      /different project/,
    );
    await writeFile(join(root, "lib.toy"), "def helper\ncall main\n");
    const changed = await indexProject(root, registry, store);
    assert.equal(changed.indexed, 1);
    assert.equal(changed.unchanged, 1);
    assert.equal(replaced, 3);
    assert.deepEqual(parsed, ["lib.toy", "main.toy", "lib.toy"]);
    assert.equal(byName(store, "helper").id, helper.id);
    assert.equal(byName(store, "main").id, main.id);
    await writeFile(join(root, "lib.toy"), "def renamed\n");
    await indexProject(root, registry, store);
    assert.notEqual(byName(store, "renamed").id, helper.id);
    assert.equal(store.incoming(helper.id).length, 0);
    assert.ok(store.unresolved().some((link) => link.targetName === "helper"));
    await rm(join(root, "lib.toy"));
    const removed = await indexProject(root, registry, store);
    assert.equal(removed.removed, 1);
    assert.equal(store.findSymbols().length, 2);
    assert.equal(byName(store, "main").id, main.id);
  });
});

test("failed and partial parses are recorded and reported, including unchanged partials", async () => {
  await sandbox(async ({ root, store }) => {
    await writeFile(join(root, "bad.toy"), "def bad\n");
    await writeFile(
      join(root, "partial.toy"),
      "def retained\ninvalid line\ncall unknown\n",
    );
    await writeFile(join(root, "unknown.md"), "unclaimed");
    const registry = new LanguageRegistry([
      {
        ...toy,
        parse(source) {
          if (source.path === "bad.toy")
            return {
              status: "failed",
              diagnostics: [{ message: "intentional content failure" }],
              symbols: [],
              links: [],
            };
          return toy.parse(source);
        },
      },
    ]);
    const report = await indexProject(root, registry, store);
    assert.deepEqual(report.failed, ["bad.toy"]);
    assert.deepEqual(report.partial, ["partial.toy"]);
    assert.deepEqual(report.unclaimed, ["unknown.md"]);
    assert.equal(store.getFile("bad.toy").result.status, "failed");
    assert.match(
      store.getFile("bad.toy").result.diagnostics[0].message,
      /intentional/,
    );
    assert.equal(store.getFile("partial.toy").result.status, "partial");
    assert.equal(store.unresolved().length, 1);
    assert.ok(byName(store, "retained"));
    const again = await indexProject(root, registry, store);
    assert.deepEqual(again.partial, ["partial.toy"]);
    assert.deepEqual(again.failed, ["bad.toy"]);
    assert.equal(again.unchanged, 2);
    assert.equal(again.indexed, 0);
  });
});

test("resolution failures stay unresolved and retry without reparsing; foreign/duplicate targets are rejected", async () => {
  await sandbox(async ({ root, store }) => {
    await writeFile(join(root, "x.toy"), "def x\ncall x\n");
    let fail = true;
    let parses = 0;
    const registry = new LanguageRegistry([
      {
        ...toy,
        parse(source) {
          parses++;
          return toy.parse(source);
        },
        resolve(context) {
          if (fail) throw Error("resolver failed");
          return toy.resolve(context);
        },
      },
    ]);
    const first = await indexProject(root, registry, store);
    assert.equal(first.resolutionErrors.length, 1);
    assert.equal(store.unresolved().length, 1);
    fail = false;
    const next = await indexProject(root, registry, store);
    assert.deepEqual(next.resolutionErrors, []);
    assert.equal(next.indexed, 0);
    assert.equal(parses, 1);
    assert.equal(store.unresolved().length, 0);
    const links = store.links();
    assert.throws(
      () => store.resolveLinks([{ linkId: links[0].id, targetId: "invented" }]),
      /Invalid/,
    );
    assert.deepEqual(store.links(), links, "invalid resolution must be atomic");
    const invalid = new LanguageRegistry([
      {
        ...toy,
        resolve(context) {
          const item = toy.resolve(context)[0];
          return [item, item];
        },
      },
    ]);
    const report = await indexProject(root, invalid, store);
    assert.equal(report.resolutionErrors.length, 1);
    assert.equal(store.unresolved().length, 1);
  });
});

test("module revision invalidates cache, malformed facts fail explicitly, store rejects invalid replacements atomically", async () => {
  await sandbox(async ({ root, store }) => {
    await writeFile(join(root, "x.toy"), "def x\n");
    await indexProject(root, new LanguageRegistry([toy]), store);
    const symbols = store.findSymbols();
    const file = store.getFile("x.toy");
    assert.throws(
      () => store.replaceFile({ ...file, path: "../escape" }),
      /relative/,
    );
    assert.throws(
      () =>
        store.replaceFile({
          ...file,
          result: {
            ...file.result,
            symbols: [...file.result.symbols, ...file.result.symbols],
          },
        }),
      /Duplicate/,
    );
    assert.deepEqual(store.findSymbols(), symbols);
    const broken = {
      ...toy,
      version: "3",
      parse() {
        return {
          status: "clean",
          diagnostics: [],
          symbols: [
            {
              key: "x",
              name: "x",
              kind: "function",
              range: { start: 0, end: 1000 },
            },
          ],
          links: [],
        };
      },
    };
    const report = await indexProject(
      root,
      new LanguageRegistry([broken]),
      store,
    );
    assert.deepEqual(report.failed, ["x.toy"]);
    assert.match(report.errors[0].message, /range/);
    assert.equal(store.findSymbols().length, 0);
    const contentFailure = {
      ...toy,
      version: "4",
      parse() {
        return {
          status: "failed",
          diagnostics: [{ message: "content failure" }],
          symbols: [],
          links: [],
        };
      },
    };
    await indexProject(root, new LanguageRegistry([contentFailure]), store);
    const sameVersion = await indexProject(
      root,
      new LanguageRegistry([{ ...toy, version: "4" }]),
      store,
    );
    assert.equal(sameVersion.indexed, 0);
    assert.deepEqual(sameVersion.failed, ["x.toy"]);
    const recovered = await indexProject(
      root,
      new LanguageRegistry([{ ...toy, version: "5" }]),
      store,
    );
    assert.equal(recovered.indexed, 1);
    assert.deepEqual(store.findSymbols(), symbols);
    for (const data of [NaN, undefined, new Date(), () => {}])
      assert.throws(
        () =>
          validateResult("", {
            status: "clean",
            diagnostics: [],
            symbols: [],
            links: [],
            data,
          }),
        /Non-JSON/,
      );
    assert.equal(contentHash("x"), contentHash("x"));
  });
});

test("claim validation, ambiguity and symlink/exclusion boundaries", async () => {
  assert.throws(() => new LanguageRegistry([toy, toy]), /duplicate/);
  assert.throws(
    () => new LanguageRegistry([{ ...toy, extensions: ["bad"] }]),
    /claim/,
  );
  assert.throws(
    () => new LanguageRegistry([{ ...toy, extensions: [], filenames: [] }]),
    /claims no files/,
  );
  const special = new LanguageRegistry([
    { ...toy, extensions: [], filenames: ["Toyfile"] },
  ]);
  assert.equal(special.claim("nested/Toyfile").id, "toy");
  const ambiguous = new LanguageRegistry([toy, { ...toy, id: "second" }]);
  assert.throws(() => ambiguous.claim("x.toy"), /Ambiguous/);
  await sandbox(async ({ root, store, scratch }) => {
    await writeFile(join(root, "x.toy"), "def x\n");
    await writeFile(join(scratch, "outside.toy"), "def outside\n");
    await symlink(join(scratch, "outside.toy"), join(root, "link.toy"));
    for (const dir of [".codegraph", "node_modules", ".git", "excluded"]) {
      await mkdir(join(root, dir));
      await writeFile(join(root, dir, "hidden.toy"), "def hidden\n");
    }
    const report = await indexProject(
      root,
      new LanguageRegistry([toy]),
      store,
      { excludeDirectories: ["excluded"] },
    );
    assert.equal(report.indexed, 1);
    assert.deepEqual(report.ignoredSymlinks, ["link.toy"]);
    const conflicts = await indexProject(root, ambiguous, store);
    assert.deepEqual(conflicts.failed, ["excluded/hidden.toy", "x.toy"]);
    assert.ok(
      conflicts.errors.every((error) => /Ambiguous/.test(error.message)),
    );
  });
});

test("toy passes the reusable language conformance kit", async () => {
  await checkLanguageConformance(
    toy,
    [
      {
        path: "main.toy",
        text: await readFile(new URL("main.toy", fixtureRoot), "utf8"),
      },
      {
        path: "lib.toy",
        text: await readFile(new URL("lib.toy", fixtureRoot), "utf8"),
      },
    ],
    {
      symbols: [
        {
          file: "main.toy",
          name: "main.toy",
          kind: "file",
          identity: "main.toy",
          at: "import lib.toy\ndef main\ncall helper\ncall missing\n",
        },
        {
          file: "lib.toy",
          name: "lib.toy",
          kind: "file",
          identity: "lib.toy",
          at: "def helper\ncall helper\n",
        },
        {
          file: "main.toy",
          name: "main",
          kind: "function",
          identity: "main",
          at: "def main",
        },
        {
          file: "lib.toy",
          name: "helper",
          kind: "function",
          identity: "helper",
          at: "def helper",
        },
      ],
      links: [
        {
          file: "main.toy",
          kind: "imports",
          at: "import lib.toy",
          source: null,
          targetName: "lib.toy",
          target: { file: "lib.toy", name: "lib.toy", kind: "file" },
        },
        {
          file: "main.toy",
          kind: "calls",
          at: "call helper",
          source: { name: "main", kind: "function" },
          targetName: "helper",
          target: { file: "lib.toy", name: "helper", kind: "function" },
        },
        {
          file: "main.toy",
          kind: "calls",
          source: { name: "main", kind: "function" },
          targetName: "missing",
          at: "call missing",
          target: null,
        },
        {
          file: "lib.toy",
          kind: "calls",
          at: "call helper",
          source: { name: "helper", kind: "function" },
          targetName: "helper",
          target: { file: "lib.toy", name: "helper", kind: "function" },
        },
      ],
    },
  );
});

test("stable IDs exclude position and local keys; include project, path, kind and scoped identity", async () => {
  await sandbox(async ({ store }) => {
    const text = "def x\n";
    const file = {
      path: "x.toy",
      text,
      hash: contentHash(text),
      module: "toy",
      version: "1",
      result: toy.parse({ path: "x.toy", text }),
    };
    store.replaceFile(file);
    const id = byName(store, "x").id;
    const revised = structuredClone(file);
    revised.result.symbols[1].key = "new-local-key";
    revised.result.symbols[1].range.end--;
    revised.result.symbols[1].range.start++;
    store.replaceFile(revised);
    assert.equal(byName(store, "x").id, id);
    const replica = new SqliteGraphStore(":memory:", store.projectId);
    const other = new SqliteGraphStore(":memory:");
    try {
      replica.replaceFile(file);
      other.replaceFile(file);
      assert.equal(byName(replica, "x").id, id);
      assert.notEqual(byName(other, "x").id, id);
    } finally {
      replica.close();
      other.close();
    }
    for (const attribute of ["identity", "kind", "path"]) {
      const changed = structuredClone(file);
      if (attribute === "path") changed.path = "renamed.toy";
      else if (attribute === "start") changed.result.symbols[1].range.start++;
      else changed.result.symbols[1][attribute] += "changed";
      store.replaceFile(changed);
      const symbol = store
        .findSymbols({ file: changed.path })
        .find((item) => item.key === "def:0");
      assert.notEqual(symbol.id, id, attribute);
    }
  });
});

test("a partial target remains linkable and its status is visible", async () => {
  await sandbox(async ({ root, store }) => {
    await cp(fixtureRoot, root, { recursive: true });
    const registry = new LanguageRegistry([toy]);
    await indexProject(root, registry, store);
    const main = byName(store, "main");
    const helper = byName(store, "helper");
    assert.ok(store.incoming(helper.id).length);
    await writeFile(join(root, "lib.toy"), "def helper\ninvalid\n");
    const report = await indexProject(root, registry, store);
    assert.equal(report.indexed, 1);
    assert.deepEqual(report.partial, ["lib.toy"]);
    assert.equal(byName(store, "main").id, main.id);
    assert.equal(byName(store, "helper").id, helper.id);
    assert.equal(store.incoming(helper.id).length, 1);
    assert.equal(byName(store, "helper").status, "partial");
    assert.equal(
      store
        .outgoing(main.id, "calls")
        .find((link) => link.targetName === "helper").resolution,
      "resolved",
    );
    assert.equal(store.incoming(helper.id)[0].targetStatus, "partial");
  });
});

test("indexer awaits an asynchronous implementation of the storage boundary", async () => {
  await sandbox(async ({ root, store }) => {
    await cp(fixtureRoot, root, { recursive: true });
    const backend = new Proxy(store, {
      get(target, key) {
        const value = Reflect.get(target, key);
        return typeof value === "function"
          ? async (...args) => value.apply(target, args)
          : value;
      },
    });
    const registry = new LanguageRegistry([toy]);
    const first = await indexProject(root, registry, backend);
    assert.equal(first.indexed, 2);
    assert.equal(first.unclaimedCount, 1);
    assert.equal(first.failedCount, 0);
    assert.equal(first.partialCount, 0);
    const again = await indexProject(root, registry, backend);
    assert.equal(again.unchanged, 2);
    assert.equal(again.indexed, 0);
    await rm(join(root, "lib.toy"));
    assert.equal((await indexProject(root, registry, backend)).removed, 1);
  });
});
