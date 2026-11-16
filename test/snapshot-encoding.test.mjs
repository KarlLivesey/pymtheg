// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadProject, staleFiles } from "../dist/language/project.js";
test("invalid UTF-8 edits cannot compare equal to an earlier valid replacement character", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-snapshot-bytes-"));
  try {
    const file = join(root, "main.pym"),
      suffix = "\nflow main() -> Unit { return unit; }\n";
    await writeFile(file, "// \uFFFD" + suffix, "utf8");
    const snapshot = loadProject(file);
    assert.deepEqual(staleFiles(snapshot), []);
    await writeFile(
      file,
      Buffer.concat([
        Buffer.from("// "),
        Buffer.from([0xff]),
        Buffer.from(suffix),
      ]),
    );
    assert.deepEqual(staleFiles(snapshot), [file]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asynchronous freshness retains UTF-8 checks and bounds changed files", async () => {
  const { staleSourcesAsync } = await import("../dist/language/project.js");
  const root = await mkdtemp(join(tmpdir(), "pym-stale-async-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, "flow main() -> Unit {}");
    const snapshot = loadProject(file),
      signal = new AbortController().signal;
    assert.deepEqual(await staleSourcesAsync(snapshot.sources, signal), []);
    await writeFile(file, Buffer.from([0xff]));
    assert.deepEqual(await staleSourcesAsync(snapshot.sources, signal), [file]);
    await writeFile(file, Buffer.alloc(2 * 1024 * 1024 + 1));
    assert.deepEqual(await staleSourcesAsync(snapshot.sources, signal), [file]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("freshness cancellation is observed across an asynchronous file boundary", async () => {
  const { staleSourcesAsync } = await import("../dist/language/project.js");
  const root = await mkdtemp(join(tmpdir(), "pym-stale-cancel-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, "flow main() -> Unit {}");
    const snapshot = loadProject(file),
      abort = new AbortController();
    const pending = staleSourcesAsync(snapshot.sources, abort.signal);
    queueMicrotask(() => abort.abort());
    await assert.rejects(pending, /abort/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a source replaced by a FIFO is stale without waiting for a writer", async () => {
  const { staleSourcesAsync } = await import("../dist/language/project.js");
  const { spawnSync } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "pym-stale-fifo-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, "flow main() -> Unit {}");
    const snapshot = loadProject(file);
    await rm(file);
    const made = spawnSync("mkfifo", [file], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    assert.deepEqual(
      await staleSourcesAsync(snapshot.sources, new AbortController().signal),
      [file],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initial and lazy loading reject nonregular and oversized sources with the same byte limit", async () => {
  const { sourceFileByteLimit } = await import("../dist/language/project.js");
  const { readSourceBytesSync, readSourceBytes } = await import(
    "../dist/shared/source-read.js"
  );
  const { StudioService } = await import("../dist/studio/service.js");
  const { spawnSync } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "pym-initial-reader-"));
  const file = join(root, "main.pym"),
    service = new StudioService(root);
  try {
    const exact = "//" + "x".repeat(sourceFileByteLimit - 2);
    await writeFile(file, exact);
    assert.equal(readSourceBytesSync(file).length, sourceFileByteLimit);
    assert.equal(
      (await readSourceBytes(file, new AbortController().signal)).length,
      sourceFileByteLimit,
    );
    await writeFile(file, exact + "x");
    assert.throws(() => readSourceBytesSync(file), /2 MiB/);
    await assert.rejects(
      service.sourceFile("main.pym"),
      (error) => error.status === 413,
    );
    await rm(file);
    const made = spawnSync("mkfifo", [file], { encoding: "utf8" });
    assert.equal(made.status, 0, made.stderr);
    assert.throws(() => loadProject(file), /regular file/);
    await assert.rejects(
      service.sourceFile("main.pym"),
      (error) => error.status === 400 && /regular file/.test(error.message),
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
