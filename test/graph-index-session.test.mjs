// SPDX-License-Identifier: MIT
// C-45: an index session keeps the language modules and each module's proved
// state between runs of one process. A module's kept value is returned only
// under the key it was kept with, and everything kept is dropped when the
// store's completion record is not the one the session's last completed run
// wrote, when the configuration (a module version) changes, or when a run
// does not complete. Every store equals a cold index row for row.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { executeGraph } from "../dist/graph/commands.js";
import {
  discoverLanguages,
  indexProject,
  IndexSession,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { graphWork, resetGraphWork } from "../dist/graph/work.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";
import { module as synthetic } from "./fixtures/graph-core/synthetic.mjs";
import { tableModule } from "./fixtures/graph-session/table-module.mjs";
import { initializeWorkspace } from "../dist/project/workspace.js";
import { trustFile } from "../dist/project/local-trust.js";

const graphAt = (root) => join(root, ".pymtheg/rebuildable/graph.sqlite");
function tree(files) {
  const base = mkdtempSync(join(tmpdir(), "c45-session-"));
  const root = join(base, "tree");
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  return { base, root, write };
}
/** Rows of the store against a cold index of the same tree, same project id. */
async function differencesFromCold(base, root, registry) {
  const rows = storeRows(graphAt(root));
  const path = join(base, `cold-${Math.random().toString(36).slice(2)}.sqlite`);
  const cold = new SqliteGraphStore(path, rows.project[0]);
  try {
    await indexProject(root, registry, cold, {
      excludeDirectories: [".pymtheg"],
    });
  } finally {
    cold.close();
  }
  return compareRows(rows, storeRows(path));
}
/**
 * The synthetic module, resolving through a name-to-symbol map it keeps
 * under a key of every symbol it is given. A stale map would resolve links
 * differently from a cold index.
 */
function keepingModule() {
  const state = { builds: 0, reuses: 0, poison: false };
  const module = {
    ...synthetic,
    id: "keeping",
    version: "1",
    resolve(context) {
      const key = createHash("sha256")
        .update(JSON.stringify(context.symbols.map((s) => [s.id, s.name])))
        .digest("hex");
      let named = context.kept?.get("names", key);
      if (named) state.reuses++;
      else {
        state.builds++;
        named = new Map(context.symbols.map((s) => [s.name, s.id]));
      }
      if (state.poison) {
        // A run that sets a wrong value and then fails must keep nothing.
        context.kept?.set("names", key, new Map());
        throw Error("resolver failed after keeping");
      }
      context.kept?.set("names", key, named);
      return {
        resolutions: context.links.map((link) => ({
          linkId: link.id,
          targetId: named.get(link.targetName) ?? null,
        })),
        links: [],
      };
    },
  };
  return { module, state };
}
const cold = (version = "1") => {
  const { module } = keepingModule();
  return new LanguageRegistry([{ ...module, version }]);
};
const index = (root, session) =>
  executeGraph({ command: "index", root }, { session });

test("a session reuses a module's kept value while its key holds, and every store equals a cold index", async () => {
  const files = Object.fromEntries(
    Array.from({ length: 6 }, (_, i) => [`${i}.syn`, `source ${i}`]),
  );
  const { base, root, write } = tree(files);
  try {
    const { module, state } = keepingModule();
    const session = new IndexSession({
      registry: new LanguageRegistry([module]),
    });
    assert.equal((await index(root, session)).sync.complete, true);
    assert.deepEqual(state, { builds: 1, reuses: 0, poison: false });
    // A content edit keeps every symbol: the kept map is valid and reused.
    write("2.syn", "edited source 2");
    assert.equal((await index(root, session)).sync.complete, true);
    assert.deepEqual(state, { builds: 1, reuses: 1, poison: false });
    assert.deepEqual(await differencesFromCold(base, root, cold()), []);
    // A new file adds symbols: the key differs and the map is rebuilt.
    write("6.syn", "source 6");
    assert.equal((await index(root, session)).sync.complete, true);
    assert.deepEqual(state, { builds: 2, reuses: 1, poison: false });
    assert.deepEqual(await differencesFromCold(base, root, cold()), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a module version change, a direct store write or a failed run drops what a session kept", async () => {
  const files = Object.fromEntries(
    Array.from({ length: 4 }, (_, i) => [`${i}.syn`, `source ${i}`]),
  );
  const { base, root, write } = tree(files);
  try {
    const { module, state } = keepingModule();
    const session = new IndexSession({
      registry: new LanguageRegistry([module]),
    });
    await index(root, session);
    write("1.syn", "edit a");
    await index(root, session);
    assert.deepEqual([state.builds, state.reuses], [1, 1]);
    // The module's version changes: its configuration differs.
    module.version = "2";
    write("1.syn", "edit b");
    assert.equal((await index(root, session)).sync.complete, true);
    assert.deepEqual([state.builds, state.reuses], [2, 1]);
    // Another connection writes the graph: the completion record is gone.
    const db = new DatabaseSync(graphAt(root));
    // A write that changes no value still fires the invalidation triggers.
    db.exec(
      "UPDATE graph_files SET status=status WHERE rowid IN (SELECT rowid FROM graph_files LIMIT 1)",
    );
    db.close();
    write("1.syn", "edit c");
    assert.equal((await index(root, session)).sync.complete, true);
    assert.deepEqual([state.builds, state.reuses], [3, 1]);
    assert.deepEqual(await differencesFromCold(base, root, cold("2")), []);
    // A run that keeps a wrong value and then fails keeps nothing.
    state.poison = true;
    write("1.syn", "edit d");
    const failed = await index(root, session);
    assert.equal(failed.sync.complete, false);
    state.poison = false;
    write("1.syn", "edit e");
    assert.equal((await index(root, session)).sync.complete, true);
    assert.deepEqual([state.builds, state.reuses], [4, 2]);
    assert.deepEqual(await differencesFromCold(base, root, cold("2")), []);
    assert.ok(session.counts.dropped >= 3, JSON.stringify(session.counts));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("in a session, an unchanged second index does counted near-zero work", async () => {
  const { base, root } = tree({
    "go.mod": "module example.com/m\n\ngo 1.22\n",
    "a/a.go": "package a\n\nfunc Hello() int { return 1 }\n",
    "b/b.go":
      'package b\n\nimport "example.com/m/a"\n\nfunc B() int { return a.Hello() }\n',
  });
  try {
    const session = new IndexSession();
    assert.equal((await index(root, session)).sync.complete, true);
    resetGraphWork();
    const again = await index(root, session);
    assert.equal(again.sync.complete, true);
    // Verified from the completion record: no index run, no parse, and a
    // fixed handful of statements; each source is hashed once.
    assert.equal(graphWork.stages["store.beginRun"], undefined);
    assert.equal(graphWork.counts["parse.go.files"] ?? 0, 0);
    assert.equal(graphWork.counts["inventory.filesHashed"], 3);
    assert.ok(graphWork.counts["store.sqlStatements"] <= 20);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("seeded edits through one production session each equal a cold index", async () => {
  const production = await discoverLanguages();
  const { base, root, write } = tree({
    "package.json": JSON.stringify({ name: "fixture", private: true }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true },
      include: ["src"],
    }),
    "src/a.ts": "export function a(): number {\n  return 1;\n}\n",
    "src/b.ts": 'import { a } from "./a";\n\nexport const b = a() + 1;\n',
    "go.mod": "module example.com/m\n\ngo 1.22\n",
    "p/p.go": "package p\n\nfunc P() int { return 1 }\n",
    "q/q.go":
      'package q\n\nimport "example.com/m/p"\n\nfunc Q() int { return p.P() }\n',
  });
  try {
    const session = new IndexSession();
    const edits = [
      ["src/a.ts", "export function a(): number {\n  return 2;\n}\n"],
      [
        "src/a.ts",
        "export function a(): number {\n  return 2;\n}\nexport const c = 3;\n",
      ],
      ["p/p.go", "package p\n\nfunc P() int { return 2 }\n"],
      ["p/p.go", "package p\n\nfunc P() int { return 2 }\n\nfunc R() {}\n"],
      [
        "src/b.ts",
        'import { a, c } from "./a";\n\nexport const b = a() + c;\n',
      ],
    ];
    assert.equal((await index(root, session)).sync.complete, true);
    for (const [path, text] of edits) {
      write(path, text);
      assert.equal((await index(root, session)).sync.complete, true);
      assert.deepEqual(
        await differencesFromCold(base, root, production),
        [],
        `after editing ${path}`,
      );
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

const child = new URL(
  "./fixtures/graph-session/index-child.mjs",
  import.meta.url,
).pathname;
/** The stored name of every `.k` file, by path. */
function storedNames(root) {
  const store = new SqliteGraphStore(graphAt(root), undefined, {
    readOnly: true,
  });
  try {
    return Object.fromEntries(
      store
        .files()
        .filter((file) => file.path.endsWith(".k"))
        .map((file) => [file.path, file.result.data?.name ?? null]),
    );
  } finally {
    store.close();
  }
}

test("another process's complete index between the session's completion read and its baseline drops what the session kept", async () => {
  const { base, root, write } = tree({ "a.k": "k=alpha", "b.k": "k=beta" });
  try {
    const registry = new LanguageRegistry([tableModule]);
    const session = new IndexSession({ registry });
    assert.equal((await index(root, session)).sync.complete, true);
    write("a.k", "k=ALPHA2");
    // The gate: the inventory event just before the run begins, after the
    // command read the completion record. The other process runs to
    // completion inside it (spawnSync returns when it has).
    let raced = 0;
    const raced_ = await executeGraph(
      { command: "index", root },
      {
        session,
        progress: (progress) => {
          if (progress.phase !== "inventory" || progress.done !== 0 || raced)
            return;
          raced++;
          const other = spawnSync(process.execPath, [child, root], {
            encoding: "utf8",
          });
          assert.equal(other.status, 0, other.stderr);
          assert.equal(JSON.parse(other.stdout).complete, true);
        },
      },
    );
    assert.equal(raced, 1);
    assert.equal(raced_.sync.complete, true);
    write("b.k", "k=beta2");
    assert.equal((await index(root, session)).sync.complete, true);
    assert.deepEqual(storedNames(root), { "a.k": "ALPHA2", "b.k": "beta2" });
    assert.deepEqual(await differencesFromCold(base, root, registry), []);
    assert.ok(session.counts.dropped >= 1, JSON.stringify(session.counts));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a kept value changed in place and not set again is not kept", async () => {
  const { base, root, write } = tree({ "a.k": "k=alpha", "b.k": "k=beta" });
  try {
    let vandal = false;
    const module = {
      ...tableModule,
      analyze(context) {
        if (vandal) {
          // Breaks the contract: edits the kept table and keeps nothing.
          const kept = context.kept?.get("table", "v1");
          if (kept) kept[0][1] = "vandalised";
          return context.files.map((file) => ({
            path: file.path,
            result: {
              status: "clean",
              diagnostics: [],
              symbols: [],
              links: [],
              data: { name: /k=(\S*)/.exec(file.text)?.[1] ?? null },
            },
          }));
        }
        return tableModule.analyze(context);
      },
    };
    const registry = new LanguageRegistry([module]);
    const session = new IndexSession({ registry });
    await index(root, session);
    vandal = true;
    write("b.k", "k=beta2");
    assert.equal((await index(root, session)).sync.complete, true);
    vandal = false;
    write("b.k", "k=beta3");
    assert.equal((await index(root, session)).sync.complete, true);
    assert.deepEqual(storedNames(root), { "a.k": "alpha", "b.k": "beta3" });
    assert.deepEqual(await differencesFromCold(base, root, registry), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a run that fails after reading what was kept leaves nothing kept", async () => {
  const { base, root, write } = tree({ "a.k": "k=alpha", "b.k": "k=beta" });
  try {
    let fail = false;
    let rebuilt = 0;
    const module = {
      ...tableModule,
      analyze(context) {
        if (!context.kept?.get("table", "v1")) rebuilt++;
        if (fail) {
          // Changes the value it read, then fails.
          const kept = context.kept?.get("table", "v1");
          if (kept) kept[0][1] = "broken";
          throw Error("analysis failed after reading kept state");
        }
        return tableModule.analyze(context);
      },
    };
    const registry = new LanguageRegistry([module]);
    const session = new IndexSession({ registry });
    await index(root, session);
    fail = true;
    write("b.k", "k=beta2");
    const dropped = session.counts.dropped;
    assert.equal((await index(root, session)).sync.complete, false);
    // The failed run is abandoned: the session forgets its scope and
    // completion as well (what it kept was already taken by the run).
    assert.equal(session.counts.dropped, dropped + 1);
    fail = false;
    const before = rebuilt;
    write("b.k", "k=beta3");
    assert.equal((await index(root, session)).sync.complete, true);
    assert.equal(rebuilt, before + 1, "the next run rebuilds");
    assert.deepEqual(storedNames(root), { "a.k": "alpha", "b.k": "beta3" });
    assert.deepEqual(await differencesFromCold(base, root, registry), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("each change of trust drops what the session kept: source-only, trusted, revoked", async () => {
  const { base, root, write } = tree({ "a.k": "k=alpha", "b.k": "k=beta" });
  try {
    let rebuilt = 0;
    const module = {
      ...tableModule,
      analyze(context) {
        if (!context.kept?.get("table", "v1")) rebuilt++;
        return tableModule.analyze(context);
      },
    };
    const registry = new LanguageRegistry([module]);
    const session = new IndexSession({ registry });
    await initializeWorkspace(root, undefined, { trust: "source-only" });
    const answer = async (trust) => {
      const file = trustFile();
      const answers = JSON.parse(readFileSync(file, "utf8"));
      answers.checkouts[realpathSync(root)].trust = trust;
      writeFileSync(file, JSON.stringify(answers));
    };
    let edits = 0;
    const step = async () => {
      write("b.k", `k=beta${++edits}`);
      assert.equal((await index(root, session)).sync.complete, true);
    };
    await step();
    await step();
    assert.equal(rebuilt, 1, "kept across a run with the same trust");
    await answer("trusted");
    await step();
    assert.equal(rebuilt, 2, "trusted: dropped");
    await step();
    assert.equal(rebuilt, 2);
    await answer("source-only");
    await step();
    assert.equal(rebuilt, 3, "revoked: dropped");
    assert.deepEqual(await differencesFromCold(base, root, registry), []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
