// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { captureImplementation } from "../dist/implementation/capture.js";
import { discoverImplementationFiles } from "../dist/implementation/files.js";
import {
  observationDocuments,
  decodeObservation,
} from "../dist/implementation/storage.js";
test("oversized code is named and omitted while good files retain exact source and coverage", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-code-oversize-"));
  const signal = new AbortController().signal;
  try {
    const good = "export function ready(){return true;}";
    await writeFile(join(root, "good.ts"), good);
    await writeFile(join(root, "vendor.js"), " ".repeat(2 * 1024 * 1024 + 1));
    const inventory = await discoverImplementationFiles(root, ".", signal);
    assert.ok(inventory.files.includes("vendor.js"));
    assert.match(inventory.warnings.join("\n"), /vendor.js.*2 MiB/);
    const graph = await captureImplementation(
      root,
      ["vendor.js", "good.ts"],
      "Partial",
      signal,
    );
    assert.equal(graph.coverage.declarations, "partial");
    assert.equal(graph.omittedFiles[0].path, "vendor.js");
    assert.ok(graph.scope.files.includes("vendor.js"));
    assert.equal(graph.files.length, 1);
    assert.equal(graph.files[0].text, good);
    assert.equal(graph.files[0].coverage.declarations, "complete");
    assert.deepEqual(decodeObservation(observationDocuments(graph)), graph);
    const overwrite = spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "observe",
        "vendor.js",
        "--root",
        root,
        "--out",
        join(root, "vendor.js"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(overwrite.status, 3);
    assert.match(overwrite.stderr, /Refusing to overwrite observed source/);
    assert.equal(
      (await readFile(join(root, "vendor.js"))).length,
      2 * 1024 * 1024 + 1,
    );
    await symlink("vendor.js", join(root, "alias.js"));
    const aliased = spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "observe",
        "vendor.js",
        "--root",
        root,
        "--out",
        join(root, "alias.js"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(aliased.status, 3);
    assert.match(aliased.stderr, /Refusing to overwrite observed source/);
    for (const files of [["vendor.js"], ["vendor.js", "good.ts"]]) {
      const run = spawnSync(
        process.execPath,
        [resolve("dist/cli/main.js"), "observe", ...files, "--root", root],
        { encoding: "utf8" },
      );
      assert.equal(run.status, 2, run.stderr);
      assert.match(run.stdout, /vendor.js.*2 MiB/);
      assert.equal(run.stderr, "");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
