import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Parser } from "web-tree-sitter";
import { openDatabase } from "../dist/storage/local.js";
import {
  SqliteGraphStore,
  LanguageRegistry,
  indexProject,
  contentHash,
  validateResult,
  createTagsParser,
  tagsFromPackage,
} from "../dist/graph/index.js";

const clean = () => ({
  status: "clean",
  diagnostics: [],
  symbols: [],
  links: [],
});
const failed = (message = "syntax") => ({
  ...clean(),
  status: "failed",
  diagnostics: [{ message }],
});
async function project(run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-w2-m-hardening-"));
  const root = join(scratch, "project");
  await mkdir(root);
  const database = join(scratch, "graph.sqlite");
  let store = new SqliteGraphStore(database, "hardening");
  const reopen = () => {
    store.close();
    return (store = new SqliteGraphStore(database, "hardening"));
  };
  const sql = (action) => {
    const db = openDatabase(database);
    try {
      return action(db);
    } finally {
      db.close();
    }
  };
  try {
    await run({ root, store, reopen, sql });
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

test("failure provenance matches all three keys, and a stale marker cannot suppress changed-file parsing", async () => {
  await project(async ({ root, store, reopen, sql }) => {
    await writeFile(join(root, "b.go"), "bad");
    let parses = 0;
    const module = {
      id: "fake-go",
      version: "1",
      extensions: [".go"],
      parse() {
        parses++;
        return failed();
      },
    };
    const registry = new LanguageRegistry([module]);
    await indexProject(root, registry, store);
    const original = store.getFile("b.go");
    const marker = sql((db) =>
      db.prepare("SELECT * FROM graph_parse_failures WHERE path=?").get("b.go"),
    );
    assert.deepEqual(
      { ...marker },
      {
        path: "b.go",
        hash: original.hash,
        module: module.id,
        version: module.version,
      },
    );
    for (const key of ["hash", "module", "version"]) {
      // An old writer may update the canonical row and leave its marker behind.
      const changed = { ...original, [key]: `different-${key}` };
      sql((db) =>
        db
          .prepare("UPDATE graph_files SET body=? WHERE path=?")
          .run(JSON.stringify(changed), "b.go"),
      );
      assert.equal(store.isParseFailure("b.go"), false, `stale ${key}`);
      sql((db) =>
        db
          .prepare("UPDATE graph_files SET body=? WHERE path=?")
          .run(JSON.stringify(original), "b.go"),
      );
      assert.equal(store.isParseFailure("b.go"), true, `restored ${key}`);
    }
    await writeFile(join(root, "b.go"), "different broken content");
    const changed = {
      ...original,
      text: "different broken content",
      hash: contentHash("different broken content"),
    };
    // Direct replacement without the provenance argument must invalidate it too.
    store.replaceFile(changed);
    assert.equal(store.isParseFailure("b.go"), false);
    sql((db) =>
      db
        .prepare("INSERT INTO graph_parse_failures VALUES (?,?,?,?)")
        .run(marker.path, marker.hash, marker.module, marker.version),
    );
    store = reopen();
    assert.equal(store.isParseFailure("b.go"), false);
    const report = await indexProject(root, registry, store);
    assert.equal(parses, 2);
    assert.equal(report.indexed, 1);
    assert.equal(store.isParseFailure("b.go"), true);
    await indexProject(root, registry, store);
    assert.equal(parses, 2);
  });
});

test("legacy path-only failure markers upgrade as misses, then acquire verified provenance", async () => {
  await project(async ({ root, store, reopen, sql }) => {
    await writeFile(join(root, "a.x"), "bad");
    let parses = 0;
    const registry = new LanguageRegistry([
      {
        id: "x",
        version: "1",
        extensions: [".x"],
        parse() {
          parses++;
          return failed();
        },
      },
    ]);
    await indexProject(root, registry, store);
    sql((db) =>
      db.exec(
        "DROP TABLE graph_parse_failures; CREATE TABLE graph_parse_failures(path TEXT PRIMARY KEY REFERENCES graph_files(path) ON DELETE CASCADE); INSERT INTO graph_parse_failures VALUES ('a.x');",
      ),
    );
    store = reopen();
    assert.equal(store.isParseFailure("a.x"), false);
    assert.deepEqual(
      sql((db) =>
        db
          .prepare("PRAGMA table_info(graph_parse_failures)")
          .all()
          .map((row) => row.name),
      ),
      ["path", "hash", "module", "version"],
    );
    await indexProject(root, registry, store);
    assert.equal(parses, 2);
    store = reopen();
    assert.equal(store.isParseFailure("a.x"), true);
    await indexProject(root, registry, store);
    assert.equal(parses, 2);
  });
});

test("Tree-sitter no-tree result is transient and is never cached", async (t) => {
  const helper = await createTagsParser(
    await tagsFromPackage("tree-sitter-go", "tree-sitter-go.wasm"),
  );
  const noTree = t.mock.method(Parser.prototype, "parse", () => null);
  try {
    assert.deepEqual(helper.parse("anything"), {
      ...failed("Tree-sitter returned no tree"),
      failureKind: "transient",
    });
    await project(async ({ root, store }) => {
      await writeFile(join(root, "a.x"), "anything");
      const registry = new LanguageRegistry([
        {
          id: "x",
          version: "1",
          extensions: [".x"],
          parse: ({ text }) => helper.parse(text),
        },
      ]);
      await indexProject(root, registry, store);
      await indexProject(root, registry, store);
      assert.equal(noTree.mock.callCount(), 3);
      assert.equal(store.isParseFailure("a.x"), false);
    });
  } finally {
    noTree.mock.restore();
    helper.dispose();
  }
});

test("invalid failureKind is rejected rather than persisted as a content failure", async () => {
  const invalid = { ...failed(), failureKind: "Transient" };
  assert.throws(
    () => validateResult("bad", invalid),
    /Invalid parse failure kind/,
  );
  await project(async ({ root, store, reopen }) => {
    await writeFile(join(root, "a.x"), "bad");
    let parses = 0;
    const registry = new LanguageRegistry([
      {
        id: "x",
        version: "1",
        extensions: [".x"],
        parse() {
          return ++parses === 1 ? invalid : clean();
        },
      },
    ]);
    const first = await indexProject(root, registry, store);
    assert.match(first.errors[0].message, /Invalid parse failure kind/);
    assert.equal(store.isParseFailure("a.x"), false);
    store = reopen();
    assert.deepEqual((await indexProject(root, registry, store)).failed, []);
    assert.equal(parses, 2);
  });
});

test("transient analysis clears content provenance at both the coordinator and store boundaries", async (t) => {
  await project(async ({ root, store, reopen, sql }) => {
    await writeFile(join(root, "a.x"), "bad");
    const transient = {
      ...failed("analysis budget"),
      failureKind: "transient",
    };
    const writes = t.mock.method(store, "replaceFile");
    let parses = 0;
    const registry = new LanguageRegistry([
      {
        id: "x",
        version: "1",
        extensions: [".x"],
        parse() {
          parses++;
          return failed();
        },
        analyze({ files }) {
          return files.map((file) => ({ path: file.path, result: transient }));
        },
      },
    ]);
    await indexProject(root, registry, store);
    assert.equal(writes.mock.calls.length, 2);
    assert.equal(writes.mock.calls[0].arguments[1], true);
    assert.equal(
      writes.mock.calls[1].arguments[1],
      false,
      "indexer must not ask to cache transient analysis",
    );
    assert.equal(store.isParseFailure("a.x"), false);
    // Independently exercise the store guard, even if a caller mistakenly asks to cache it.
    store.replaceFile({ ...store.getFile("a.x"), result: transient }, true);
    assert.equal(
      store.isParseFailure("a.x"),
      false,
      "store must reject transient provenance",
    );
    assert.equal(
      sql(
        (db) =>
          db.prepare("SELECT count(*) AS n FROM graph_parse_failures").get().n,
      ),
      0,
      "transient results must not write a marker at all",
    );
    writes.mock.restore();
    store = reopen();
    await indexProject(root, registry, store);
    assert.equal(parses, 2);
    assert.equal(store.isParseFailure("a.x"), false);
  });
});

test("failedFiles excludes partial files beside a failed file, warm and reopened", async () => {
  await project(async ({ root, store, reopen }) => {
    await writeFile(join(root, "a.x"), "partial");
    await writeFile(join(root, "b.x"), "failed");
    const registry = new LanguageRegistry([
      {
        id: "x",
        version: "1",
        extensions: [".x"],
        parse({ text }) {
          return text === "partial"
            ? { ...failed("recovered syntax"), status: "partial" }
            : failed();
        },
      },
    ]);
    const report = await indexProject(root, registry, store);
    assert.deepEqual(report.partial, ["a.x"]);
    const expected = [{ path: "b.x", language: "x", reason: "syntax" }];
    assert.deepEqual(store.failedFiles(), expected);
    store = reopen();
    assert.deepEqual(store.failedFiles(), expected);
    await indexProject(root, registry, store);
    assert.deepEqual(store.failedFiles(), expected);
  });
});
