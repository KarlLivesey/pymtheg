import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeGraph } from "../dist/graph/commands.js";
import { LanguageRegistry } from "../dist/graph/registry.js";
import { SqliteGraphStore } from "../dist/graph/store.js";
import { openDatabase } from "../dist/storage/local.js";

async function project(run) {
  const root = await mkdtemp(join(tmpdir(), "pymtheg-command-complete-"));
  await writeFile(join(root, "a.x"), "source");
  let parses = 0,
    resolves = 0,
    fail = false;
  const module = {
    id: "fixture",
    version: "1",
    extensions: [".x"],
    contextFiles: ["project.cfg"],
    parse() {
      parses++;
      return {
        status: "clean",
        diagnostics: [],
        symbols: [
          {
            key: "s",
            name: "s",
            identity: "s",
            kind: "function",
            range: { start: 0, end: 1 },
          },
        ],
        links: [
          {
            sourceKey: "s",
            kind: "calls",
            targetName: "s",
            range: { start: 0, end: 1 },
          },
        ],
      };
    },
    resolve({ symbols, links }) {
      resolves++;
      if (fail) throw Error("resolver unavailable");
      return links.map((link) => ({
        linkId: link.id,
        targetId: symbols[0].id,
      }));
    },
  };
  const request = (command = "symbol", extra = {}) =>
    executeGraph(
      { command, args: command === "symbol" ? ["s"] : [], root, ...extra },
      { registry: new LanguageRegistry([module]) },
    );
  const db = () =>
    new SqliteGraphStore(join(root, ".pymtheg/rebuildable/graph.sqlite"));
  try {
    await run({
      root,
      module,
      request,
      db,
      counts: () => ({ parses, resolves }),
      fail: (value) => {
        fail = value;
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("missing/interrupted checkpoint and failed resolver force a full sync, warm successful snapshots do not", async () => {
  await project(async ({ request, db, counts, fail }) => {
    await request("index");
    const first = counts();
    assert.equal((await request()).sync.mode, "unchanged");
    assert.deepEqual(counts(), first);
    let store = db();
    try {
      assert.ok(store.graphCommandState());
      store.invalidateGraphCommandState();
    } finally {
      store.close();
    }
    assert.equal((await request()).sync.mode, "updated");
    assert.equal(counts().resolves, first.resolves + 1);
    fail(true);
    const failed = await request("index");
    assert.equal(failed.sync.complete, false);
    assert.equal(failed.sync.report.resolutionErrors.length, 1);
    store = db();
    try {
      assert.equal(store.graphCommandState(), null);
    } finally {
      store.close();
    }
    fail(false);
    const restored = await request();
    assert.equal(restored.sync.mode, "updated");
    assert.equal(restored.sync.complete, true);
    assert.equal((await request()).sync.mode, "unchanged");
  });
});

test("replaced database cannot inherit a completion record, even if that old record is copied into it", async () => {
  await project(async ({ request, db, root, counts }) => {
    await request("index");
    let store = db();
    let state, files, oldId;
    try {
      state = store.graphCommandState();
      files = store.files();
      oldId = store.projectId;
    } finally {
      store.close();
    }
    await rm(join(root, ".pymtheg/rebuildable/graph.sqlite"));
    store = db();
    try {
      assert.notEqual(store.projectId, oldId);
      for (const file of files) store.replaceFile(file);
      store.completeGraphCommandState(state);
      assert.ok(store.graphCommandState());
    } finally {
      store.close();
    }
    const before = counts();
    const result = await request();
    assert.equal(result.sync.mode, "updated");
    assert.equal(result.sync.complete, true);
    assert.equal(counts().resolves, before.resolves + 1);
  });
});

test("module versions, declared context and invalid checkpoint data invalidate the fast path without clocks", async () => {
  await project(async ({ request, db, module, root, counts }) => {
    await request("index");
    module.version = "2";
    const version = await request();
    assert.equal(version.sync.mode, "updated");
    assert.equal(version.sync.report.indexed, 1);
    await writeFile(join(root, "project.cfg"), "new context");
    const context = await request();
    assert.equal(context.sync.mode, "updated");
    assert.equal(context.sync.report.indexed, 0);
    let store = db();
    try {
      store.completeGraphCommandState({
        schema: "wrong",
        fingerprint: "wrong",
      });
    } finally {
      store.close();
    }
    const disabled = await request("symbol", { noSync: true });
    assert.equal(disabled.sync.complete, false);
    assert.ok(disabled.warnings.some((w) => w.code === "index-incomplete"));
    const before = counts();
    assert.equal((await request()).sync.mode, "updated");
    assert.equal(counts().resolves, before.resolves + 1);
    const raw = openDatabase(join(root, ".pymtheg/rebuildable/graph.sqlite"));
    try {
      raw
        .prepare(
          "UPDATE graph_meta SET value='not JSON' WHERE key='command-complete'",
        )
        .run();
    } finally {
      raw.close();
    }
    assert.equal((await request()).sync.mode, "updated");
  });
});

test("direct graph API writes invalidate completion even when content hashes are unchanged", async () => {
  await project(async ({ request, db }) => {
    await request("index");
    const store = db();
    try {
      store.resolveLinks([]);
      assert.equal(store.graphCommandState(), null);
    } finally {
      store.close();
    }
    const result = await request();
    assert.equal(result.sync.mode, "updated");
    assert.equal(result.sync.complete, true);
    assert.equal(result.data.symbol.name, "s");
  });
});

test("cooperatively interrupted indexing leaves no checkpoint and the next query rebuilds", async () => {
  await project(async ({ root, module, request, db, counts }) => {
    const cancel = new AbortController();
    await assert.rejects(
      executeGraph(
        { command: "index", root },
        {
          registry: new LanguageRegistry([module]),
          signal: cancel.signal,
          progress: (progress) => {
            if (progress.phase === "parse") cancel.abort();
          },
        },
      ),
      { name: "AbortError" },
    );
    const store = db();
    try {
      assert.equal(store.graphCommandState(), null);
    } finally {
      store.close();
    }
    assert.equal(counts().parses, 1);
    const recovered = await request();
    assert.equal(recovered.sync.mode, "updated");
    assert.equal(recovered.sync.complete, true);
    assert.equal(counts().parses, 2);
  });
});

test("a corrupted checkpoint checksum is a cache miss and no-sync uses actual database metadata", async () => {
  await project(async ({ request, db }) => {
    await request("index");
    const store = db();
    try {
      const state = store.graphCommandState();
      state.counts.symbols = 99999;
      store.completeGraphCommandState(state);
    } finally {
      store.close();
    }
    const untrusted = await request("symbol", { noSync: true });
    assert.equal(untrusted.counts.symbols, 1);
    assert.equal(untrusted.sync.complete, false);
    assert.ok(untrusted.warnings.some((w) => w.code === "index-incomplete"));
    const rebuilt = await request();
    assert.equal(rebuilt.sync.mode, "updated");
    assert.equal(rebuilt.sync.complete, true);
  });
});

test("unchanged failed UTF-8 source/context captures remain named without inventing a content edit", async () => {
  await project(async ({ root, request }) => {
    await writeFile(join(root, "b.x"), Buffer.from([0xff]));
    await writeFile(join(root, "project.cfg"), Buffer.from([0xff]));
    await request("index");
    const status = await request("status");
    assert.deepEqual(status.staleFiles, []);
    assert.deepEqual(
      status.failedFiles.map((file) => file.path),
      ["b.x", "project.cfg"],
    );
    assert.equal(status.sync.complete, false);
    assert.ok(status.data.retryableFiles.includes("b.x"));
  });
});

test("interleaved database writers prevent completion publication without timing assumptions", async () => {
  await project(async ({ root, module, request, db }) => {
    let wrote = false;
    const result = await executeGraph(
      { command: "index", root },
      {
        registry: new LanguageRegistry([module]),
        progress: (progress) => {
          if (
            !wrote &&
            progress.phase === "resolve" &&
            progress.done === progress.total
          ) {
            wrote = true;
            const other = db();
            try {
              other.replaceFile(other.getFile("a.x"));
            } finally {
              other.close();
            }
          }
        },
      },
    );
    assert.equal(wrote, true);
    assert.equal(result.sync.complete, false);
    assert.equal(result.exitCode, 2);
    const recovered = await request();
    assert.equal(recovered.sync.complete, true);
    assert.equal(recovered.sync.mode, "updated");
    const first = db(),
      second = db();
    try {
      const state = first.graphCommandState();
      first.invalidateGraphCommandState();
      const version = first.commandDataVersion();
      second.replaceFile(second.getFile("a.x"));
      assert.equal(first.completeGraphCommandState(state, version), false);
      assert.equal(first.graphCommandState(), null);
    } finally {
      first.close();
      second.close();
    }
  });
});
