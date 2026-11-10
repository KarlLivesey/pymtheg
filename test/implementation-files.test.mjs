import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("candidate discovery is root-first, bounded, read-only and does not follow symlinks", async () => {
  const { discoverImplementationFiles } = await import(
    "../dist/implementation/files.js"
  );
  const root = await mkdtemp(join(tmpdir(), "pym-code-files-"));
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "main.ts"), Buffer.from([255]));
    await writeFile(join(root, "src", "worker.go"), "ignored");
    await writeFile(join(root, "src", "worker.tsx"), "not parsed by inventory");
    await writeFile(join(root, "node_modules", "library.js"), "ignored");
    await symlink(join(root, "main.ts"), join(root, "linked.ts"));
    const result = await discoverImplementationFiles(
      root,
      ".",
      new AbortController().signal,
    );
    assert.deepEqual(result.files, ["main.ts", "src/worker.tsx"]);
    assert.equal(result.ignoredSymlinks, 1);
    assert.equal(result.complete, false);
    assert.ok(
      result.warnings.some((warning) =>
        /symbolic link.*not followed/.test(warning),
      ),
    );
    const capped = await discoverImplementationFiles(
      root,
      ".",
      new AbortController().signal,
      { maxFiles: 1 },
    );
    assert.deepEqual(capped.files, ["main.ts"]);
    assert.equal(capped.complete, false);
    assert.ok(capped.warnings.some((warning) => /file limit/.test(warning)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("candidate discovery cancels through an observed directory boundary", async () => {
  const { discoverImplementationFiles } = await import(
    "../dist/implementation/files.js"
  );
  const root = await mkdtemp(join(tmpdir(), "pym-code-files-cancel-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "main.ts"), "");
    const controller = new AbortController();
    let completedDirectories = 0;
    await assert.rejects(
      discoverImplementationFiles(root, ".", controller.signal, {
        onDirectory: () => {
          completedDirectories++;
          controller.abort();
        },
      }),
      /abort/i,
    );
    assert.equal(completedDirectories, 1);
    await assert.rejects(
      discoverImplementationFiles(root, "../", new AbortController().signal),
      /project/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate pages stay pinned, search relative paths, and expire explicitly", async () => {
  const { ImplementationFileCatalog } = await import(
    "../dist/implementation/files.js"
  );
  const root = await mkdtemp(join(tmpdir(), "orders-project-"));
  try {
    await writeFile(join(root, "a.ts"), "a");
    await writeFile(join(root, "b.ts"), "b");
    const catalog = new ImplementationFileCatalog(root),
      signal = new AbortController().signal;
    const first = await catalog.page({ limit: 1 }, signal);
    assert.deepEqual(first.files, ["a.ts"]);
    assert.equal(first.total, 2);
    await writeFile(join(root, "c.ts"), "c");
    const next = await catalog.page(
      { inventoryId: first.inventoryId, offset: first.nextOffset, limit: 1 },
      signal,
    );
    assert.deepEqual(next.files, ["b.ts"]);
    assert.equal(next.total, 2);
    assert.equal(
      (
        await catalog.page(
          { inventoryId: first.inventoryId, query: "orders" },
          signal,
        )
      ).total,
      0,
    );
    assert.equal((await catalog.page({}, signal)).total, 3);
    await assert.rejects(
      catalog.page(
        { inventoryId: first.inventoryId, directory: "src" },
        signal,
      ),
      /another directory/,
    );
    for (const name of ["one", "two", "three"]) {
      await mkdir(join(root, name));
      await writeFile(join(root, name, "file.ts"), "");
      await catalog.page({ directory: name }, signal);
    }
    await assert.rejects(
      catalog.page({ inventoryId: first.inventoryId }, signal),
      /expired/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing discovery folders are actionable requests, not internal server failures", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const root = await mkdtemp(join(tmpdir(), "pym-missing-code-folder-"));
  const service = new StudioService(root);
  try {
    await assert.rejects(
      service.implementationFiles(
        { directory: "missing" },
        new AbortController().signal,
      ),
      (error) =>
        error.status === 400 && /could not be opened/.test(error.message),
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
