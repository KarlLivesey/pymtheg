// SPDX-License-Identifier: MIT
// C-62 (Opus review): an older run's invalidation of the completion record
// removes it only while no newer run has claimed the store. Without that
// condition, an older run's late invalidation would remove the completion a
// newer run published. Two connections to one store, in turn; no timing.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SqliteGraphStore } from "../dist/graph/index.js";
import { module as synthetic } from "./fixtures/graph-core/synthetic.mjs";

const record = (path, text = `source of ${path}`) => ({
  path,
  text,
  hash: `hash:${path}:${text.length}`,
  module: "synthetic",
  version: "1",
  result: synthetic.parse({ path, text }),
});

test("an older run's invalidation leaves a newer run's completion; its own it removes", () => {
  const base = mkdtempSync(join(tmpdir(), "c62-generation-"));
  const path = join(base, "graph.sqlite");
  const older = new SqliteGraphStore(path, "c62");
  const newer = new SqliteGraphStore(path, "c62");
  try {
    // The older run claims, writes and finishes; then a newer run claims,
    // writes, finishes and publishes its completion.
    older.beginIndexRun();
    older.replaceFile(record("a.syn"));
    older.finishIndexRun();
    newer.beginIndexRun();
    newer.replaceFile(record("b.syn"));
    newer.finishIndexRun();
    assert.equal(newer.completeGraphCommandState({ run: "newer" }), true);
    // The older run, late, invalidates: the newer run's record stays.
    older.invalidateGraphCommandState();
    assert.deepEqual(newer.graphCommandState(), { run: "newer" });
    // The newer run's own invalidation removes it.
    newer.invalidateGraphCommandState();
    assert.equal(newer.graphCommandState(), null);
  } finally {
    older.close();
    newer.close();
    rmSync(base, { recursive: true, force: true });
  }
});
