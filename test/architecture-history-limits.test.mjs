import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioService } from "../dist/studio/service.js";
import { validateHistory } from "../dist/architecture/history.js";
import { hash } from "../dist/shared/identity.js";
import { architectureLimits as limits } from "../dist/architecture/limits.js";
function archive(text, count) {
  const digest = hash(text),
    documents = Array.from({ length: count }, (_, i) => ({
      path: String(i).padStart(5, "0") + ".md",
      hash: digest,
    })),
    id = hash(JSON.stringify(documents.map((d) => [d.path, d.hash])));
  return {
    schema: "pymtheg.architecture-history/v1",
    active: id,
    revisions: [
      {
        id,
        label: "Fixture",
        created: "2026-11-08T00:00:00.000Z",
        source: "test",
        documents,
      },
    ],
    blobs: [{ hash: digest, text }],
    draft: null,
  };
}
test("archive preview enforces document UTF-8 bytes and expanded snapshot bytes before any commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-history-bounds-")),
    app = new StudioService(root),
    signal = new AbortController().signal;
  try {
    const current = await app.importArchitecture(
        "Existing",
        [{ path: "keep.md", text: "Keep existing work" }],
        signal,
      ),
      before = await app.exportArchitectureHistory();
    await assert.rejects(
      app.previewArchitectureHistory(
        archive("界".repeat(6 * 1024 * 1024), 1),
        signal,
      ),
      /document byte limit/,
    );
    assert.equal((await app.architectureOverview()).index.id, current.id);
    assert.deepEqual(await app.exportArchitectureHistory(), before);
    await assert.rejects(
      app.previewArchitectureHistory(archive("x".repeat(65536), 1025), signal),
      /logical snapshot byte limit/,
    );
    assert.equal((await app.architectureOverview()).index.id, current.id);
    assert.deepEqual(await app.exportArchitectureHistory(), before);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("exact document and expanded snapshot byte boundaries remain accepted", () => {
  assert.ok(validateHistory(archive("x".repeat(limits.documentBytes), 1)));
  assert.ok(validateHistory(archive("x".repeat(65536), 1024)));
});
