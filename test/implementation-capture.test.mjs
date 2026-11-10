import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { captureImplementation } from "../dist/implementation/capture.js";

test("observation CLI captures real code without executing it or modifying the source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-observed-cli-"));
  try {
    const a = "export function value(): number { return 1; }";
    const b =
      'import { value } from "./a.js"; export function run(): number { return value(); }';
    await writeFile(join(root, "a.ts"), a);
    await writeFile(join(root, "b.ts"), b);
    const cli = (...args) =>
      spawnSync(
        process.execPath,
        [
          resolve("dist/cli/main.js"),
          "observe",
          "a.ts",
          "b.ts",
          "--root",
          root,
          "--format",
          "json",
          ...args,
        ],
        { encoding: "utf8" },
      );
    const initial = cli("--label", "Initial code");
    assert.equal(initial.status, 0, initial.stderr + initial.stdout);
    const graph = JSON.parse(initial.stdout);
    assert.equal(graph.version.label, "Initial code");
    assert.ok(
      graph.edges.some(
        (edge) => edge.kind === "calls" && edge.to === "a.ts#function:value",
      ),
    );
    assert.equal(graph.files.find((file) => file.path === "b.ts").text, b);
    assert.equal(await readFile(join(root, "b.ts"), "utf8"), b);
    const unchanged = JSON.parse(cli("--label", "Named version").stdout);
    assert.equal(unchanged.snapshotId, graph.snapshotId);
    await writeFile(join(root, "b.ts"), "export function broken( {");
    const partial = cli();
    assert.equal(partial.status, 2, partial.stderr);
    assert.equal(JSON.parse(partial.stdout).coverage.declarations, "partial");
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(
      captureImplementation(root, ["a.ts"], "Cancelled", cancelled.signal),
      /abort/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("observe --list discovers candidates without parsing source or retaining metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-list-code-"));
  try {
    await writeFile(join(root, "bad.ts"), Buffer.from([255]));
    const listed = spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "observe",
        "--root",
        root,
        "--list",
        "--format",
        "json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout).files, ["bad.ts"]);
    const invalid = spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "observe",
        "--root",
        root,
        "--list",
        "--retain",
      ],
      { encoding: "utf8" },
    );
    assert.equal(invalid.status, 3);
    assert.match(invalid.stderr, /omit files, --retain/);
    await assert.rejects(
      readFile(join(root, ".pymtheg-architecture", "architecture.sqlite")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("observing a directory explains how to browse its files first", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-observe-folder-"));
  try {
    await assert.rejects(
      captureImplementation(
        root,
        ["."],
        "Folder",
        new AbortController().signal,
      ),
      /Choose source files.*observe --list --directory/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
