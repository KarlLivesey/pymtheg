import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { StudioService } from "../dist/studio/service.js";
const item = {
  id: "REQ-1",
  kind: "requirement",
  title: "Keep accepted writes",
  owner: "storage",
  status: "proposed",
  detail: "Keep user data",
  acceptance: "Read it after restart",
  evidence: "",
  evidenceRevision: "",
  links: [],
};
test("adding a document and refreshing a source preserve active native plans and unrelated sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-continuity-"));
  const app = new StudioService(root),
    signal = new AbortController().signal,
    source = { id: "folder:source", label: "Upstream design", kind: "folder" };
  try {
    let state = await app.importArchitecture(
      "Initial",
      [
        { path: "api.md", text: "v1" },
        { path: "removed.md", text: "old upstream" },
      ],
      signal,
      { source, mode: "refresh" },
    );
    state = await app.savePlanItem(state.id, item, "Add native plan", signal);
    state = await app.importArchitecture(
      "Meeting notes",
      [{ path: "meeting.md", text: "Meeting decisions" }],
      signal,
    );
    assert.ok(state.entities.some((e) => e.id === "plan:REQ-1"));
    assert.ok(state.documents.some((d) => d.path === "api.md"));
    state = await app.importArchitecture(
      "Refresh source",
      [{ path: "api.md", text: "v2" }],
      signal,
      { source, mode: "refresh" },
    );
    assert.ok(state.entities.some((e) => e.id === "plan:REQ-1"));
    assert.ok(state.documents.some((d) => d.path === "meeting.md"));
    assert.ok(!state.documents.some((d) => d.path === "removed.md"));
    assert.equal(
      (await app.architectureDocument(state.id, "api.md")).text,
      "v2",
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("CLI re-import refreshes its own folder while preserving the current native plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-cli-continuity-")),
    source = join(root, "upstream"),
    project = join(root, "project");
  await mkdir(source);
  await mkdir(project);
  let app;
  const run = () => {
    const p = spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "import-architecture",
        source,
        "--into",
        project,
        "--name",
        "Upstream",
      ],
      { encoding: "utf8" },
    );
    assert.ifError(p.error);
    assert.equal(p.status, 0, p.stderr + p.stdout);
    return JSON.parse(p.stdout);
  };
  try {
    await writeFile(join(source, "api.md"), "v1");
    run();
    app = new StudioService(project);
    let state = (await app.architectureOverview()).index;
    await app.savePlanItem(
      state.id,
      item,
      "Native requirement",
      new AbortController().signal,
    );
    await app.close();
    app = null;
    await writeFile(join(source, "api.md"), "v2");
    const refreshed = run();
    assert.ok(refreshed.changes.keptNative.includes("architecture/plan.json"));
    app = new StudioService(project);
    state = (await app.architectureOverview()).index;
    assert.ok(state.entities.some((e) => e.id === "plan:REQ-1"));
    assert.equal(
      (await app.architectureDocument(state.id, "api.md")).text,
      "v2",
    );
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("one duplicate planning ID keeps both definitions and every unrelated record visible", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-plan-conflicts-")),
    app = new StudioService(root),
    signal = new AbortController().signal;
  try {
    let state = await app.savePlanItem("", item, "First requirement", signal);
    const original = await app.architectureDocument(
      state.id,
      "architecture/plan.json",
    );
    state = await app.importArchitecture(
      "Imported duplicate",
      [{ path: "notes/copied-plan.json", text: original.text }],
      signal,
    );
    assert.equal(
      state.entities.filter((e) => e.conflictOf === "plan:REQ-1").length,
      2,
    );
    state = await app.savePlanItem(
      state.id,
      {
        ...item,
        id: "REQ-9",
        title: "Unrelated requirement",
        links: [],
      },
      "Add unrelated record",
      signal,
    );
    assert.equal(
      state.entities.filter((e) => e.conflictOf === "plan:REQ-1").length,
      2,
    );
    assert.ok(state.entities.some((e) => e.id === "plan:REQ-9"));
    await assert.rejects(
      app.savePlanItem(
        state.id,
        {
          ...item,
          id: "REQ-10",
          links: [{ kind: "depends-on", target: "plan:REQ-1" }],
        },
        "Invalid link",
        signal,
      ),
      /missing or ambiguous/,
    );
    const copy = state.entities.find(
      (e) =>
        e.conflictOf === "plan:REQ-1" &&
        e.document === "notes/copied-plan.json",
    );
    state = await app.savePlanItem(
      state.id,
      { ...item, id: "REQ-2", title: "Distinct requirement" },
      "Resolve copied ID",
      signal,
      { document: copy.document, originalId: "REQ-1" },
    );
    assert.ok(!state.entities.some((e) => e.conflictOf));
    assert.ok(state.entities.some((e) => e.id === "plan:REQ-1"));
    assert.ok(state.entities.some((e) => e.id === "plan:REQ-2"));
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("resolving the second duplicate within one planning file cannot edit the first definition", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-same-file-")),
    app = new StudioService(root),
    signal = new AbortController().signal;
  try {
    const second = {
      ...item,
      title: "Second definition",
      detail: "Different purpose",
    };
    const state = await app.importArchitecture(
      "Conflicting plan",
      [
        {
          path: "architecture/plan.json",
          text: JSON.stringify({
            schema: "pymtheg.plan/v1",
            items: [item, second],
          }),
        },
      ],
      signal,
    );
    await assert.rejects(
      app.savePlanItem(
        state.id,
        { ...second, id: "REQ-2" },
        "Ambiguous",
        signal,
        { document: "architecture/plan.json", originalId: "REQ-1" },
      ),
      /particular conflicting definition/,
    );
    const fixed = await app.savePlanItem(
      state.id,
      { ...second, id: "REQ-2" },
      "Resolve second",
      signal,
      { document: "architecture/plan.json", originalId: "REQ-1", itemIndex: 1 },
    );
    const data = JSON.parse(
      (await app.architectureDocument(fixed.id, "architecture/plan.json")).text,
    );
    assert.deepEqual(data.items, [item, { ...second, id: "REQ-2" }]);
    assert.ok(!fixed.entities.some((e) => e.conflictOf));
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
