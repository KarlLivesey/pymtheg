// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
test("version search filters complete metadata before paging and preserves checkpoint order", async () => {
  const { versionCatalog } = await import("../dist/implementation/versions.js");
  const revisions = Array.from({ length: 10000 }, (_, i) => ({
    id: "v" + i,
    label: i === 9001 ? "Archive checkout target" : "Checkpoint " + i,
    created: i % 2 ? "2099-01-01" : "1970-01-01",
    source:
      i % 3 === 0
        ? "Code observation"
        : i % 3 === 1
          ? "Implementation link"
          : "Edited planning record",
  }));
  const page = versionCatalog(revisions, "v0", {
    query: "target",
    category: "all",
    offset: 0,
    limit: 10,
    selectedId: "v0",
  });
  assert.equal(page.total, 1);
  assert.equal(page.items[0].id, "v9001");
  assert.equal(page.selected.id, "v0");
  assert.equal(page.nextOffset, null);
  assert.equal(page.examined, 10000);
  const codes = versionCatalog(revisions, "v0", {
    category: "code",
    offset: 100,
    limit: 2,
  });
  assert.deepEqual(
    codes.items.map((v) => v.id),
    ["v300", "v303"],
  );
  assert.equal(codes.items[0].category, "code");
  const links = versionCatalog(revisions, "v0", {
    category: "links",
    offset: 0,
    limit: 2,
  });
  assert.deepEqual(
    links.items.map((v) => v.id),
    ["v1", "v4"],
  );
  assert.throws(() => versionCatalog(revisions, "v0", { limit: 101 }), /100/);
});

test("version pages reject a changed catalogue and keep a selected nonmatching checkpoint visible", async () => {
  const { versionCatalog } = await import("../dist/implementation/versions.js");
  const rows = [
    { id: "old", label: "Old design", source: "manual", created: "2040" },
    {
      id: "code",
      label: "Worker",
      source: "Code observation",
      created: "1900",
    },
  ];
  const first = versionCatalog(rows, "old", { limit: 1 });
  assert.equal(first.nextOffset, 1);
  const filtered = versionCatalog(rows, "old", {
    query: "Worker",
    category: "code",
    selectedId: "old",
    catalogHash: first.catalogHash,
  });
  assert.equal(filtered.selected.id, "old");
  assert.equal(filtered.items[0].id, "code");
  assert.throws(
    () =>
      versionCatalog(
        [...rows, { id: "new", label: "More", source: "manual", created: "0" }],
        "old",
        { offset: 1, catalogHash: first.catalogHash },
      ),
    /catalogue changed/,
  );
});

test("Studio and HTTP version search read metadata without changing retained history", async () => {
  const { mkdtemp, rm, readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { ArchitectureStore } = await import("../dist/architecture/store.js");
  const { startStudio } = await import("../dist/studio/server.js");
  const root = await mkdtemp(join(tmpdir(), "pym-version-search-"));
  let store, app;
  try {
    store = await ArchitectureStore.open(root);
    const wanted = store.save("Launch contract", "Edited planning record", [
      { path: "plan.md", text: "first" },
    ]).id;
    for (let i = 0; i < 60; i++)
      store.save(
        "Checkpoint " + i,
        i % 2 ? "Implementation link" : "Code observation",
        [{ path: "plan.md", text: "revision " + i }],
      );
    store.close();
    store = null;
    const path = join(root, ".pymtheg/shared/architecture.sqlite"),
      before = await readFile(path);
    app = await startStudio({ path: root });
    const res = await fetch(
      new URL(
        "/api/implementation/versions?query=Launch&category=design&limit=1&selectedId=" +
          encodeURIComponent(wanted),
        app.url,
      ),
      { headers: { Authorization: "Bearer " + app.token } },
    );
    assert.equal(res.status, 200);
    const page = await res.json();
    assert.equal(page.total, 1);
    assert.equal(page.items[0].id, wanted);
    assert.equal(page.repositoryTotal, 61);
    assert.equal(page.selected.id, wanted);
    assert.equal(page.items[0].category, "design");
    assert.deepEqual(await readFile(path), before);
  } finally {
    store?.close();
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate labels remain distinguishable even when their matches span pages", async () => {
  const { versionCatalog } = await import("../dist/implementation/versions.js");
  const rows = [
    { id: "older", label: "Code", source: "Code observation", created: "0" },
    { id: "newer", label: "Code", source: "Code observation", created: "1" },
  ];
  const result = versionCatalog(rows, "newer", {
    category: "code",
    limit: 1,
    selectedId: "newer",
  });
  assert.equal(result.items[0].labelCount, 2);
  assert.equal(result.selected.labelCount, 2);
});
