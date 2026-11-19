// SPDX-License-Identifier: MIT
// C-22: an installed declaration that is present stays present for the whole
// run when only its inode metadata changes after the run first looked at it.
// Another install sharing a pnpm store hard-links the same inodes, which
// changes their ctime but not their bytes; a warm re-index during a parallel
// sweep then lost every `expect-type` declaration and stored a graph unlike
// a cold index. A mode change alters the same stamp deterministically.
import assert from "node:assert/strict";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import {
  changedDependencyInputs,
  DependencyInputs,
} from "../dist/graph/dependency-inputs.js";
import {
  discoverLanguages,
  indexProject,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import { compareRows, storeRows } from "../scripts/reindex/dump.mjs";

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "c22-dependency-"));
  mkdirSync(join(root, "node_modules/kit"), { recursive: true });
  writeFileSync(
    join(root, "node_modules/kit/index.d.ts"),
    "export declare function kit(): string;\n",
  );
  return root;
};
const path = "node_modules/kit/index.d.ts";

test("a declaration whose metadata changes after it was found is still read", () => {
  const root = fixture();
  try {
    const inputs = new DependencyInputs(root, "typescript");
    assert.equal(inputs.fileExists(path), true);
    const before = inputs.records().find((record) => record.path === path);
    const found = before.dependency.stamp;
    // Same bytes, new metadata: what a second hard link or a chmod does.
    chmodSync(join(root, path), 0o600);
    linkSync(join(root, path), join(root, "store-link.d.ts"));
    assert.equal(inputs.read(path), "export declare function kit(): string;\n");
    // The record names the bytes actually read, so the next run compares
    // against them.
    const record = inputs.records().find((item) => item.path === path);
    assert.notEqual(record.dependency.stamp, found);
    assert.equal(record.dependency.module, "typescript");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a declaration whose content changes after it was found is read as it now is", () => {
  const root = fixture();
  try {
    const inputs = new DependencyInputs(root, "typescript");
    assert.equal(inputs.fileExists(path), true);
    writeFileSync(join(root, path), "export declare const changed: 1;\n");
    assert.equal(inputs.read(path), "export declare const changed: 1;\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a declaration that is not installed is not read", () => {
  const root = fixture();
  try {
    const inputs = new DependencyInputs(root, "typescript");
    assert.equal(inputs.fileExists("node_modules/kit/missing.d.ts"), false);
    assert.equal(inputs.read("node_modules/kit/missing.d.ts"), undefined);
    // Outside node_modules nothing is read through this route.
    writeFileSync(join(root, "local.d.ts"), "export {};\n");
    assert.equal(inputs.read("local.d.ts"), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The review's reproduction: two programs (two tsconfig files) use one
// installed declaration. Its metadata changes before the run's first read
// and its bytes after it. Every read in the run must return the same bytes,
// and the run must leave a record that makes the next re-index look again,
// so that one more re-index equals a cold index of the tree as it now is.
test("two programs in one run see the same installed bytes, and the next run catches up", async () => {
  const root = mkdtempSync(join(tmpdir(), "c22-two-programs-"));
  const original = DependencyInputs.prototype.read;
  const kit = "node_modules/kit/index.d.ts";
  try {
    const files = {
      "package.json": JSON.stringify({
        name: "fixture",
        private: true,
        dependencies: { kit: "1.0.0" },
      }),
      "node_modules/kit/package.json": JSON.stringify({
        name: "kit",
        version: "1.0.0",
        types: "index.d.ts",
      }),
      [kit]:
        "export declare class Page {\n  locate(): string;\n}\nexport declare function open(): Page;\n",
      "packages/a/tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["."],
      }),
      "packages/a/a.ts": 'import { open } from "kit";\n\nopen().locate();\n',
      "packages/b/tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true },
        include: ["."],
      }),
      "packages/b/b.ts": 'import { open } from "kit";\n\nopen().locate();\n',
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    const registry = await discoverLanguages();
    const incremental = new SqliteGraphStore(
      join(root, "..", `${basename(root)}.sqlite`),
    );
    const seen = [];
    let reads = 0;
    DependencyInputs.prototype.read = function (path) {
      const first = path === kit && reads++ === 0;
      if (first) chmodSync(join(root, kit), 0o600);
      const text = original.call(this, path);
      if (path === kit) seen.push(text);
      if (first)
        writeFileSync(
          join(root, kit),
          "export declare class View {\n  locate(): number;\n}\nexport declare function open(): View;\n",
        );
      return text;
    };
    try {
      await indexProject(root, registry, incremental);
    } finally {
      DependencyInputs.prototype.read = original;
    }
    assert.ok(seen.length >= 2, "both programs read the declaration");
    assert.equal(new Set(seen).size, 1, "one run, one text");
    // One normal re-index, no edit: equal to a cold index of the tree now.
    await indexProject(root, registry, incremental);
    const coldPath = join(root, "..", `${basename(root)}-cold.sqlite`);
    const cold = new SqliteGraphStore(coldPath, incremental.projectId);
    try {
      await indexProject(root, registry, cold);
    } finally {
      cold.close();
    }
    const incrementalPath = join(root, "..", `${basename(root)}.sqlite`);
    incremental.close();
    assert.deepEqual(
      compareRows(storeRows(incrementalPath), storeRows(coldPath)),
      [],
    );
    for (const path of [incrementalPath, coldPath])
      for (const suffix of ["", "-wal", "-shm"])
        rmSync(path + suffix, { force: true });
  } finally {
    DependencyInputs.prototype.read = original;
    rmSync(root, { recursive: true, force: true });
  }
});

// The second review: a hard link added and removed between the read and the
// handle's last fstat, on both attempts, must not drop an unchanged file.
// Metadata moves on every read here (a mode change stands for the link);
// the bytes never do.
test("metadata that moves during every read of a file does not make it absent", () => {
  const root = fixture();
  const readFileSync = fs.readFileSync;
  let moves = 0;
  try {
    const inputs = new DependencyInputs(root, "typescript");
    assert.equal(inputs.fileExists(path), true);
    fs.readFileSync = function (target, ...rest) {
      const bytes = readFileSync.call(this, target, ...rest);
      // Reading through a handle: move the inode's metadata before its fstat.
      if (typeof target === "number")
        chmodSync(join(root, path), moves++ % 2 ? 0o644 : 0o600);
      return bytes;
    };
    syncBuiltinESMExports();
    assert.equal(inputs.read(path), "export declare function kit(): string;\n");
    fs.readFileSync = readFileSync;
    syncBuiltinESMExports();
    assert.ok(moves >= 1);
    // The bytes on disk are the bytes used: recorded as usable, not stale,
    // and a later metadata-only change is no change for the next run.
    const records = inputs.records();
    assert.deepEqual(changedDependencyInputs(root, records), []);
    chmodSync(join(root, path), 0o640);
    assert.deepEqual(changedDependencyInputs(root, records), []);
    // A content change is.
    writeFileSync(join(root, path), "export declare const other: 2;\n");
    assert.deepEqual(changedDependencyInputs(root, records), [path]);
  } finally {
    fs.readFileSync = readFileSync;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file whose bytes change during every read is treated as absent", () => {
  const root = fixture();
  const readFileSync = fs.readFileSync;
  let writes = 0;
  try {
    const inputs = new DependencyInputs(root, "typescript");
    assert.equal(inputs.fileExists(path), true);
    fs.readFileSync = function (target, ...rest) {
      const bytes = readFileSync.call(this, target, ...rest);
      if (typeof target === "number")
        fs.writeFileSync(
          join(root, path),
          `export declare const v${writes++}: 1;\n`,
        );
      return bytes;
    };
    syncBuiltinESMExports();
    assert.equal(inputs.read(path), undefined);
  } finally {
    fs.readFileSync = readFileSync;
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});
