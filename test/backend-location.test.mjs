import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { locateQuint } from "../dist/backends/adapter.js";
test("installed Pymtheg locates a hoisted optional Quint dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-hoisted-"));
  try {
    const backend = join(root, "node_modules/pymtheg/dist/backends/adapter.js"),
      quint = join(root, "node_modules/@informalsystems/quint/dist/src/cli.js");
    await mkdir(join(root, "node_modules/pymtheg/dist/backends"), {
      recursive: true,
    });
    await mkdir(join(root, "node_modules/@informalsystems/quint/dist/src"), {
      recursive: true,
    });
    await writeFile(quint, "#!/usr/bin/env node\n");
    assert.equal(locateQuint(pathToFileURL(backend).href), quint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
