import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  readdir,
  readFile,
  writeFile,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  initializeWorkspace,
  readWorkspace,
} from "../dist/project/workspace.js";
import { loadConfig } from "../dist/project/config.js";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { RecoveryStore } from "../dist/studio/recovery.js";
import { layout, storagePath } from "../dist/storage/local.js";
import { openProjectGraph } from "../dist/storage/graph.js";
import { indexProject, LanguageRegistry } from "../dist/graph/index.js";
import toy from "../dist/graph/languages/toy/index.js";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "pymtheg-storage-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("initialization and all project stores use only .pymtheg", () =>
  fixture(async (root) => {
    const initialized = await initializeWorkspace(root, "Storage");
    assert.equal(initialized.created, true);
    assert.deepEqual(await readdir(root), [".pymtheg"]);
    assert.deepEqual(
      JSON.parse(JSON.stringify((await loadConfig(root)).config)),
      {
        version: 1,
        scenarios: {},
      },
    );
    assert.equal(
      (await initializeWorkspace(root)).workspace.id,
      initialized.workspace.id,
    );
    const planning = await ArchitectureStore.open(root);
    planning.close();
    const recovery = await RecoveryStore.openOrCreate(root);
    recovery.close();
    const graph = openProjectGraph(root, initialized.workspace.id);
    graph.close();
    assert.deepEqual(await readdir(root), [".pymtheg"]);
    for (const item of Object.keys(layout))
      await readFile(storagePath(root, item));
  }));

test("deleting rebuildable state preserves history, decisions, links, settings and unsaved drafts; the graph regenerates identically", () =>
  fixture(async (root) => {
    const { workspace } = await initializeWorkspace(root);
    await writeFile(join(root, "x.toy"), "def x\ncall x\n");
    const planning = await ArchitectureStore.open(root);
    const documents = [
      { path: "decisions.md", text: "# Decision\nKeep durable content." },
      {
        path: "requirements.md",
        text: "# R1\nPreserve [decision](decisions.md).",
      },
    ];
    planning.save("first", "project", documents);
    planning.save("second", "project", [
      ...documents,
      { path: "notes.md", text: "History" },
    ]);
    const history = planning.exportHistory();
    planning.close();
    const recovery = await RecoveryStore.openOrCreate(root);
    const draft = {
      drafts: [{ path: "unsaved.pym", text: "unsaved design", baseHash: null }],
      context: null,
    };
    recovery.save(0, draft);
    const saved = recovery.read();
    // A run-cache payload is deliberately disposable; it is never shared history.
    recovery.saveRun({ id: "cache", request: { buffers: {} } });
    recovery.close();
    const registry = new LanguageRegistry([toy]);
    let graph = openProjectGraph(root, workspace.id);
    await indexProject(root, registry, graph, {
      excludeDirectories: [".pymtheg"],
    });
    const facts = {
      files: graph.files(),
      symbols: graph.findSymbols(),
      links: graph.links(),
    };
    assert.deepEqual(
      facts.symbols
        .filter((symbol) => symbol.kind === "function")
        .map((symbol) => symbol.name),
      ["x"],
    );
    graph.close();
    const shared = {};
    for (const item of ["marker", "settings", "planning", "drafts"])
      shared[item] = await readFile(storagePath(root, item));
    await rm(join(root, ".pymtheg/rebuildable"), { recursive: true });
    for (const item of Object.keys(shared))
      assert.deepEqual(await readFile(storagePath(root, item)), shared[item]);
    const reopened = await ArchitectureStore.open(root, { readOnly: true });
    assert.deepEqual(reopened.exportHistory(), history);
    reopened.close();
    const restored = await RecoveryStore.openOrCreate(root);
    assert.deepEqual(restored.read(), saved);
    assert.deepEqual(restored.runs(), []);
    restored.close();
    assert.equal((await readWorkspace(root)).id, workspace.id);
    graph = openProjectGraph(root, workspace.id);
    try {
      await indexProject(root, registry, graph, {
        excludeDirectories: [".pymtheg"],
      });
      assert.deepEqual(
        {
          files: graph.files(),
          symbols: graph.findSymbols(),
          links: graph.links(),
        },
        facts,
      );
    } finally {
      graph.close();
    }
  }));

for (const old of [
  ".pymtheg.json",
  ".pymtheg-architecture",
  ".pymtheg-studio",
]) {
  test(`old layout ${old} is reported and preserved by every entry point`, () =>
    fixture(async (root) => {
      await writeFile(join(root, old), "important old bytes");
      for (const action of [
        () => initializeWorkspace(root),
        () => loadConfig(root),
        () => ArchitectureStore.open(root),
        () => RecoveryStore.openOrCreate(root),
        async () => openProjectGraph(root, "id"),
      ])
        await assert.rejects(
          action,
          /Old Pymtheg storage layout.*No migration/,
        );
      assert.equal(
        await readFile(join(root, old), "utf8"),
        "important old bytes",
      );
      assert.deepEqual(await readdir(root), [old]);
    }));
}

test("path reads create nothing and reject symlink directories and database sidecars", () =>
  fixture(async (root) => {
    storagePath(root, "planning");
    assert.deepEqual(await readdir(root), []);
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(root, ".pymtheg"));
    assert.throws(() => storagePath(root, "planning", true), /real directory/);
    await rm(join(root, ".pymtheg"));
    const file = storagePath(root, "planning", true);
    await symlink(join(root, "missing"), file + "-journal");
    assert.throws(() => storagePath(root, "planning"), /regular files/);
  }));

test("SQLite connection constructors and runtime imports stay inside the storage boundary", async () => {
  const src = resolve("src");
  const violations = [];
  async function scan(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (path !== join(src, "storage")) await scan(path);
      } else if (path.endsWith(".ts")) {
        const text = await readFile(path, "utf8");
        if (
          /new\s+DatabaseSync\s*\(|import\s*\(\s*["']node:sqlite|import\s+(?!type\b)[^;]*from\s*["']node:sqlite/.test(
            text,
          )
        )
          violations.push(path);
      }
    }
  }
  await scan(src);
  assert.deepEqual(violations, []);
});
