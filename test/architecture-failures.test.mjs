import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "pym-architecture-boundary-"));
  const first = new StudioService(root),
    second = new StudioService(root);
  try {
    await run(first, second);
  } finally {
    await first.close();
    await second.close();
    await rm(root, { recursive: true, force: true });
  }
}
const signal = () => new AbortController().signal;
test("cancelled or malformed architecture imports preserve the committed snapshot and release the job", () =>
  fixture(async (service) => {
    const first = await service.importArchitecture(
      "Initial",
      [{ path: "decision.md", text: "Accepted design" }],
      signal(),
      {
        source: { id: "test", label: "Test source", kind: "upload" },
        mode: "refresh",
      },
    );
    const cancellation = new AbortController();
    cancellation.abort();
    await assert.rejects(
      service.importArchitecture(
        "Cancelled",
        [{ path: "decision.md", text: "Must not be committed" }],
        cancellation.signal,
      ),
      /cancelled/i,
    );
    assert.equal((await service.architectureOverview()).index.id, first.id);
    await assert.rejects(
      service.importArchitecture(
        "Malformed",
        [{ path: "../outside.md", text: "Must not be committed" }],
        signal(),
      ),
      /relative document path/,
    );
    assert.equal((await service.architectureOverview()).index.id, first.id);
    const next = await service.importArchitecture(
      "Valid next",
      [{ path: "decision.md", text: "New accepted design" }],
      signal(),
      {
        source: { id: "test", label: "Test source", kind: "upload" },
        mode: "refresh",
      },
    );
    assert.notEqual(next.id, first.id);
    assert.equal(
      (await service.architectureDocument(first.id, "decision.md")).text,
      "Accepted design",
    );
  }));
test("a stale architecture editor cannot overwrite another session or corrupt its own baseline", () =>
  fixture(async (first, second) => {
    const baseline = await first.importArchitecture(
      "Initial",
      [{ path: "decision.md", text: "Original" }],
      signal(),
    );
    await second.architectureOverview();
    const current = await first.editArchitectureDocument(
      baseline.id,
      "decision.md",
      "First editor change",
      "First edit",
      signal(),
    );
    await assert.rejects(
      second.editArchitectureDocument(
        baseline.id,
        "decision.md",
        "Stale editor change",
        "Second edit",
        signal(),
      ),
      /document changed/,
    );
    assert.equal((await second.architectureOverview()).index.id, current.id);
    assert.equal(
      (await second.architectureDocument(current.id, "decision.md")).text,
      "First editor change",
    );
    assert.equal(
      (await second.architectureDocument(baseline.id, "decision.md")).text,
      "Original",
    );
  }));
test("invalid draft input preserves the saved recovery version and closed sessions refuse mutation", () =>
  fixture(async (service) => {
    const saved = await service.saveArchitectureDraft(0, {
      kind: "document",
      baseRevision: "",
      label: "Unfinished",
      document: { path: "notes.md", text: "The still-needed decision" },
    });
    await assert.rejects(
      service.saveArchitectureDraft(saved.version, { kind: "plan", item: {} }),
    );
    assert.deepEqual(await service.architectureDraft(), saved);
    const shutdown = service.close();
    assert.equal(
      service.close(),
      shutdown,
      "repeat close must await the same cleanup",
    );
    await shutdown;
    await assert.rejects(
      service.importArchitecture(
        "Too late",
        [{ path: "notes.md", text: "Closed" }],
        signal(),
      ),
      /closing/,
    );
    await assert.rejects(
      service.saveArchitectureDraft(saved.version, null),
      /closing/,
    );
  }));
