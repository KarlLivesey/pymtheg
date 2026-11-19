// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("paired Rust comparison reports lost assumption marks on unchanged targets", () => {
  const scratch = mkdtempSync(join(tmpdir(), "pymtheg-mark-compare-"));
  const marks = ["rust-external-macro-name"];
  for (const [attempt, assumes] of [
    ["base", marks],
    ["candidate", []],
  ]) {
    const store = join(scratch, attempt, "checkout/.pymtheg/rebuildable");
    mkdirSync(store, { recursive: true });
    const db = new DatabaseSync(join(store, "graph.sqlite"));
    try {
      db.exec(`
        CREATE TABLE graph_symbols(id, file, kind, body);
        CREATE TABLE graph_links(id, file, kind, origin, body, target, resolution, module);
        CREATE TABLE graph_candidates(link, symbol);
        CREATE TABLE graph_library_targets(link, role, ecosystem, unit, symbol, version, version_source, evidence);
        CREATE TABLE graph_files(path, body);
      `);
      db.prepare(
        "INSERT INTO graph_symbols VALUES ('target', 'src/lib.rs', 'function', ?)",
      ).run(
        JSON.stringify({
          module: "rust",
          key: "item:0",
          ordinal: 0,
          identity: "target",
        }),
      );
      const insert = db.prepare(
        "INSERT INTO graph_links VALUES (?, 'src/lib.rs', 'calls', 'parse', ?, 'target', 'resolved', 'rust')",
      );
      for (const start of [10, 20])
        insert.run(
          `link:${start}`,
          JSON.stringify({
            range: { start, end: start + 6 },
            targetName: "target",
            sourceKey: "item:6",
            data: { assumes },
          }),
        );
    } finally {
      db.close();
    }
    writeFileSync(
      join(scratch, `${attempt}.json`),
      JSON.stringify({
        repos: [
          { id: "fixture", commit: "same", outcome: "finished", attempt },
        ],
      }),
    );
  }
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL("../evidence/c-12/compare.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        PYM_SCRATCH: scratch,
        C12_BASELINE_RUN: "base.json",
        C12_CANDIDATE_RUN: "candidate.json",
      },
    },
  );
  const [repo] = JSON.parse(
    readFileSync(join(scratch, "compare.json"), "utf8"),
  ).results;
  assert.equal(repo.counters.existingDefinite, 2);
  assert.equal(repo.counters.existingDefiniteMarkChanges, 2);
  assert.equal(repo.changed.length, 2);
  for (const { before, after } of repo.changed) {
    assert.equal(before[1], after[1]);
    assert.deepEqual(JSON.parse(before[3]), marks);
    assert.deepEqual(JSON.parse(after[3]), []);
  }
});
