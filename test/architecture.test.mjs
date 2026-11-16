// SPDX-License-Identifier: MIT
import { architectureIndexVersion } from "../dist/architecture/schema.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  indexArchitecture,
  compareArchitecture,
  affectedEntities,
  architectureDetail,
} from "../dist/architecture/model.js";
import { ArchitectureStore } from "../dist/architecture/store.js";
const source = (name = "save") => ({
  path: "contracts/catalogue.json",
  text: JSON.stringify({
    futureField: { must: "survive" },
    status: "specified_not_implemented",
    types: { Payload: { number: 1, owner: "data", future: "retained" } },
    functions: [
      {
        id: "data." + name,
        name,
        owner: "data",
        symbol: "F1",
        args: { value: "Payload" },
        returns: "Unit",
        status: "specified_not_implemented",
        edges: [],
      },
      {
        id: "app.run",
        name: "run",
        owner: "app",
        symbol: "F2",
        args: {},
        returns: "Unit",
        status: "specified_not_implemented",
        edges: [
          { callee: "data." + name, kind: "await", when: "after validation" },
        ],
      },
    ],
  }),
});
test("architecture import preserves original documents, unknown fields and unverified status", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-architecture-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const doc = source(),
      index = store.save("first", "source-root", [
        doc,
        { path: "decisions.md", text: "# Decisions\nUnresolved question." },
      ]);
    assert.equal(
      index.edges.find(
        (e) => e.from === "function:F2" && e.to === "function:F1",
      ).binding,
      "missing",
    );
    assert.equal(
      index.entities.find((e) => e.id === "function:F1").status,
      "specified_not_implemented",
    );
    store.close();
    store = await ArchitectureStore.open(root);
    assert.equal(store.document(index.id, doc.path).text, doc.text);
    assert.equal(
      architectureDetail(store.document(index.id, doc.path), []).futureField
        .must,
      "survive",
    );
    assert.equal(store.export(index.id).documents.length, 2);
    assert.equal(store.read().id, index.id);
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("stable external IDs survive rename and show transitive impact", () => {
  const before = indexArchitecture([source()]),
    after = indexArchitecture([source("write")]);
  assert.deepEqual(compareArchitecture(after, before).renamed, [
    { id: "function:F1", before: "data.save", after: "data.write" },
  ]);
  assert.deepEqual(compareArchitecture(after, before).removed, []);
  assert.deepEqual(affectedEntities(after, "function:F1"), ["function:F2"]);
});
test("thousands of contracts are indexed by visits, without all-pairs matching", () => {
  const functions = Array.from({ length: 5000 }, (_, i) => ({
    id: "part.f" + i,
    name: "f" + i,
    symbol: "F" + i,
    owner: "part",
    edges: i ? [{ callee: "part.f" + (i - 1) }] : [],
  }));
  const index = indexArchitecture([
    { path: "catalogue.json", text: JSON.stringify({ types: {}, functions }) },
  ]);
  assert.equal(index.entities.length, 5002);
  assert.equal(index.measurements.indexVisits, 59998);
  assert.equal(affectedEntities(index, "function:F0").length, 4999);
});

test("revision comparison includes deleted documents and incomplete binding maps", () => {
  const before = indexArchitecture([
    source(),
    { path: "removed.md", text: "Keep its deletion visible" },
  ]);
  const doc = source(),
    raw = JSON.parse(doc.text);
  raw.functions[1].edges[0].bindings = { unrelated: "value" };
  raw.functions.push({
    id: "app.empty",
    name: "empty",
    owner: "app",
    args: {},
    edges: [{ callee: "app.empty" }],
  });
  const after = indexArchitecture([{ ...doc, text: JSON.stringify(raw) }]);
  assert.equal(after.edges[0].binding, "partial");
  assert.equal(after.edges[1].binding, "not-applicable");
  assert.deepEqual(compareArchitecture(after, before).removedDocuments, [
    "removed.md",
  ]);
});

test("rolling revisions share unchanged content and preserve old snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-rolling-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const fixed = source();
    let first;
    for (let i = 0; i < 100; i++) {
      const index = store.save("revision " + i, "test", [
        fixed,
        { path: "notes.md", text: "Revision " + i },
      ]);
      first ??= index.id;
    }
    assert.equal(store.storageStats().revisions, 100);
    assert.equal(store.storageStats().uniqueDocuments, 101);
    assert.equal(store.document(first, "notes.md").text, "Revision 0");
    assert.equal(
      store.document(store.read().id, "notes.md").text,
      "Revision 99",
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("legacy storage migrates transactionally without dropping documents", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdir } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "pym-arch-legacy-"));
  let store;
  try {
    await mkdir(join(root, ".pymtheg/shared"), { recursive: true });
    const db = new DatabaseSync(
      join(root, ".pymtheg/shared/architecture.sqlite"),
    );
    const doc = source(),
      index = indexArchitecture([doc]);
    delete index.indexVersion;
    db.exec(
      "CREATE TABLE revisions(id TEXT PRIMARY KEY,label TEXT,created TEXT,source TEXT,index_json TEXT);CREATE TABLE documents(revision TEXT,path TEXT,hash TEXT,text TEXT,PRIMARY KEY(revision,path));CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);PRAGMA user_version=1;",
    );
    db.prepare("INSERT INTO revisions VALUES(?,?,?,?,?)").run(
      index.id,
      "legacy",
      "2026-01-01",
      "test",
      JSON.stringify(index),
    );
    db.prepare("INSERT INTO documents VALUES(?,?,?,?)").run(
      index.id,
      doc.path,
      index.documents[0].hash,
      doc.text,
    );
    db.prepare("INSERT INTO meta VALUES(?,?)").run("active", index.id);
    db.close();
    store = await ArchitectureStore.open(root);
    assert.equal(store.read().indexVersion, architectureIndexVersion);
    assert.equal(store.export(index.id).documents[0].text, doc.text);
    assert.equal(store.storageStats().uniqueDocuments, 1);
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("conflicting historical catalogues remain losslessly retained with explicit index warnings", () => {
  const current = source(),
    historical = { ...source("oldSave"), path: "archive/catalogue.json" };
  const index = indexArchitecture([current, historical]);
  assert.equal(index.documents.length, 2);
  assert.equal(index.entities.filter((e) => e.kind === "function").length, 4);
  assert.equal(
    index.entities.filter((e) => e.kind === "function" && e.conflictOf).length,
    4,
  );
  assert.ok(
    index.warnings.some(
      (w) => w.includes("Conflicting identity") && w.includes("visible"),
    ),
  );
});

test("incomplete architecture drafts survive restart and reject a competing writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-arch-draft-"));
  let first, second;
  try {
    first = await ArchitectureStore.open(root);
    second = await ArchitectureStore.open(root);
    const draft = {
      kind: "document",
      baseRevision: "",
      label: "Draft",
      document: { path: "", text: "An unfinished decision" },
    };
    assert.equal(first.saveDraft(0, draft).version, 1);
    assert.throws(
      () => second.saveDraft(0, { ...draft, label: "Competing" }),
      /another session/,
    );
    assert.equal(first.readDraft().draft.label, "Draft");
    first.close();
    first = await ArchitectureStore.open(root);
    assert.equal(
      first.readDraft().draft.document.text,
      "An unfinished decision",
    );
    assert.equal(first.saveDraft(1, null).draft, null);
  } finally {
    first?.close();
    second?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("foreign JSON numeric literals remain exact in structured views and original documents", () => {
  const doc = {
    path: "numeric.json",
    text: '{"types":{},"functions":[{"id":"service.use","name":"use","owner":"service","externalId":9223372036854775807,"ratio":0.10000000000000001,"negativeZero":-0,"unbounded":1e999}]}',
  };
  const index = indexArchitecture([doc]),
    record = architectureDetail(doc, ["functions", 0]);
  assert.deepEqual(record.externalId, { $exactNumber: "9223372036854775807" });
  assert.deepEqual(record.ratio, { $exactNumber: "0.10000000000000001" });
  assert.deepEqual(record.negativeZero, { $exactNumber: "-0" });
  assert.deepEqual(record.unbounded, { $exactNumber: "1e999" });
  assert.ok(index.warnings.some((w) => w.includes("4 numeric literals")));
  assert.ok(doc.text.includes("9223372036854775807"));
});

test("document search is case-insensitive for Unicode text as well as ASCII", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-unicode-search-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const index = store.save("Multilingual decision", "test", [
      { path: "decision.md", text: "CAFÉ policy: retain résumé fields." },
    ]);
    assert.equal(store.search(index.id, "café")[0]?.path, "decision.md");
    assert.equal(store.search(index.id, "RÉSUMÉ")[0]?.path, "decision.md");
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("retained UTF-8 text preserves its BOM and invalid byte sequences are rejected", async () => {
  const { decodeUtf8 } = await import("../dist/shared/text.js");
  const text =
    '\uFEFF{"types":{},"functions":[{"id":"service.run","name":"run","owner":"service"}]}';
  assert.equal(decodeUtf8(new TextEncoder().encode(text), "bom.json"), text);
  assert.throws(
    () => decodeUtf8(new Uint8Array([0xff, 0xfe]), "invalid.json"),
    /not valid UTF-8/,
  );
  const index = indexArchitecture([{ path: "bom.json", text }]);
  assert.ok(index.entities.some((e) => e.key === "service.run"));
  assert.equal(
    architectureDetail({ path: "bom.json", text }, ["functions", 0]).id,
    "service.run",
  );
});

test("architecture indexing limits are deterministic visits, not elapsed time", () => {
  const functions = Array.from({ length: 10 }, (_, i) => ({
    id: "f" + i,
    name: "f" + i,
    owner: "component",
    args: {},
    edges: [],
  }));
  const docs = [
    { path: "catalogue.json", text: JSON.stringify({ types: {}, functions }) },
  ];
  assert.throws(
    () => indexArchitecture(docs, { maxVisits: 5 }),
    /5 visit budget/,
  );
  assert.throws(
    () => indexArchitecture(docs, { maxVisits: 100 }),
    /100 visit budget/,
  );
  assert.equal(
    indexArchitecture(docs, { maxVisits: 101 }).measurements.indexVisits,
    101, // Records, explicit argument maps and decoded search values.
  );
});

test("architecture search excludes internal registry material before applying its result limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-search-internal-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const index = store.save("documents", "local", [
      {
        path: "visible.md",
        text: "## Contract\nSearchneedle means user design.",
      },
      ...Array.from({ length: 105 }, (_, i) => ({
        path: `.pymtheg-imported-${i}.json`,
        text: '{"searchneedle":"metadata"}',
      })),
    ]);
    const found = store.search(index.id, "searchneedle");
    assert.deepEqual(
      found.map((d) => d.path),
      ["visible.md"],
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid retained plans identify their item and failing field without changing documents", () => {
  const text = JSON.stringify({
    schema: "pymtheg.plan/v1",
    items: [
      {
        id: "BAD",
        title: "Invalid",
        kind: "task",
        status: "in_progress",
        owner: "review",
        detail: "",
        acceptance: "",
        evidence: "",
        evidenceRevision: "",
      },
    ],
  });
  const index = indexArchitecture([{ path: "plan.json", text }]);
  const message = index.warnings.join(" ");
  assert.match(message, /items\.0\.kind/);
  assert.match(message, /items\.0\.status/);
  assert.match(message, /items\.0\.links/);
  assert.equal(index.documents[0].bytes, Buffer.byteLength(text));
});
