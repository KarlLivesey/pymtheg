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
import { join } from "node:path";
import { test } from "node:test";
import { DependencyInputs } from "../dist/graph/dependency-inputs.js";

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
