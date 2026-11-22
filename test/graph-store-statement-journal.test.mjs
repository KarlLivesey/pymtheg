// SPDX-License-Identifier: MIT
// C-35: a cold index keeps SQLite's statement journals out of temporary
// files. The completion-invalidation triggers write, so every graph write
// statement in a transaction keeps a statement journal; SQLite spilled it to
// a temporary file, which cost hundreds of microseconds per row and most of
// a cold index. Not a timing: after every statement the test lists the
// process's open files for SQLite's temporary files (named etilqs_*, open
// and already unlinked), so the result does not depend on machine speed.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readlinkSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sqlite from "node:sqlite";
import { test } from "node:test";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";
import { module as synthetic } from "./fixtures/graph-core/synthetic.mjs";

const procFds = "/proc/self/fd";
const temporaryFiles = () =>
  readdirSync(procFds).filter((fd) => {
    try {
      return /\/etilqs_/.test(readlinkSync(join(procFds, fd)));
    } catch {
      return false;
    }
  }).length;

test(
  "A cold index writes its rows without SQLite temporary files",
  { skip: !existsSync(procFds) && "needs /proc/self/fd" },
  async () => {
    const base = await mkdtemp(join(tmpdir(), "c35-journal-"));
    const root = join(base, "tree");
    await mkdir(root);
    for (let i = 0; i < 20; i++)
      await writeFile(join(root, `${i}.syn`), "source ".repeat(400));
    const registry = new LanguageRegistry([synthetic]);
    const proto = sqlite.StatementSync.prototype;
    const run = proto.run;
    let statements = 0;
    let opened = 0;
    proto.run = function (...args) {
      try {
        return run.apply(this, args);
      } finally {
        statements++;
        opened = Math.max(opened, temporaryFiles());
      }
    };
    const path = join(base, "graph.sqlite");
    let store;
    try {
      store = new SqliteGraphStore(path, "c35");
      await indexProject(root, registry, store);
    } finally {
      proto.run = run;
      store?.close();
    }
    try {
      assert.ok(statements > 300, `${statements} statements observed`);
      assert.equal(opened, 0);
      // The same rows as a cold index observed without the probe.
      const again = join(base, "again.sqlite");
      const cold = new SqliteGraphStore(again, "c35");
      try {
        await indexProject(root, registry, cold);
      } finally {
        cold.close();
      }
      assert.deepEqual(compareRows(storeRows(path), storeRows(again)), []);
      assert.equal(storeRows(path).graph_links.length, 20 * 30);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  },
);
