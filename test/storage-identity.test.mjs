// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { localHistoryWriter } from "../dist/storage/writer.js";
import { sharedProjectPath } from "../dist/storage/paths.js";
import { StudioService } from "../dist/studio/service.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { compareRecordedChanges } from "../dist/storage/recorded-history.js";
import { openDatabase, storagePath } from "../dist/storage/local.js";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "pymtheg-identity-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function writer(machine, author = "Alice") {
  let time = "2040-01-01T00:00:00.000Z";
  return {
    origin: { machine, actor: `actor-${machine}`, author },
    now: () => time,
    setTime(value) {
      time = value;
    },
  };
}
function plan(title = "Requirement", linked = true) {
  return [
    {
      path: "design/plan.json",
      text: JSON.stringify({
        schema: "pymtheg.plan/v1",
        items: [
          {
            ...newPlanItem("R1"),
            title,
            links: linked ? [{ kind: "depends-on", target: "plan:D1" }] : [],
          },
          { ...newPlanItem("D1"), title: "Decision", kind: "decision" },
        ],
      }),
    },
  ];
}
const entity = (records, name) =>
  records.find(
    (r) =>
      r.kind === "entity" &&
      r.hash !== null &&
      JSON.parse(r.key)[1] === `plan:${name}`,
  );

test("two machines export globally distinct identities and deterministic change order despite tied/backward clocks", () =>
  fixture(async (root) => {
    const a = join(root, "a"),
      b = join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const wa = writer("machine-A"),
      wb = writer("machine-B", "Bob");
    const one = await ArchitectureStore.open(a, { writer: wa });
    const two = await ArchitectureStore.open(b, { writer: wb });
    try {
      one.save("A1", "local", plan());
      two.save("B1", "local", plan());
      wa.setTime("2000-01-01T00:00:00.000Z");
      wb.setTime("1990-01-01T00:00:00.000Z");
      one.save("A2", "local", plan("Changed A"));
      two.save("B2", "local", plan("Changed B"));
      const left = one.exportRecordedHistory(),
        right = two.exportRecordedHistory();
      assert.notEqual(
        entity(left.records, "R1").id,
        entity(right.records, "R1").id,
      );
      assert.notEqual(
        entity(left.records, "D1").id,
        entity(right.records, "D1").id,
      );
      assert.notEqual(
        left.records.find((r) => r.kind === "link").id,
        right.records.find((r) => r.kind === "link").id,
      );
      const allIds = [
        ...left.records,
        ...right.records,
        ...left.changes,
        ...right.changes,
      ].map((r) => r.id);
      assert.equal(new Set(allIds).size, allIds.length);
      // There is deliberately no production merge/sync API: combine exports in this test.
      const combined = [...left.changes, ...right.changes].sort(
        compareRecordedChanges,
      );
      assert.deepEqual(
        [...right.changes, ...left.changes].sort(compareRecordedChanges),
        combined,
      );
      assert.deepEqual(
        combined.map((e) => [e.sequence, e.origin.machine]),
        [
          [1, "machine-A"],
          [1, "machine-B"],
          [2, "machine-A"],
          [2, "machine-B"],
        ],
      );
      assert.deepEqual(
        combined.map((e) => e.origin.author),
        ["Alice", "Bob", "Alice", "Bob"],
      );
      assert.ok(Date.parse(combined[2].time) < Date.parse(combined[0].time));
      assert.deepEqual(combined[0].origin, wa.origin);
      assert.equal(
        one.read().entities.some((e) => e.id === "plan:R1"),
        true,
      );
      assert.equal(
        JSON.parse(one.document(one.read().id, "design/plan.json").text)
          .items[0].id,
        "R1",
      );
    } finally {
      one.close();
      two.close();
    }
  }));

test("Edits and reopen keep IDs; re-added links get new linked IDs and immutable change receipts", () =>
  fixture(async (root) => {
    const w = writer("machine-A");
    let store = await ArchitectureStore.open(root, { writer: w });
    try {
      const first = store.save("first", "local", plan());
      const before = store.exportRecordedHistory();
      const requirement = entity(before.records, "R1");
      const link = before.records.find((r) => r.kind === "link");
      store.save("edited", "local", plan("Edited"));
      assert.equal(
        entity(store.exportRecordedHistory().records, "R1").id,
        requirement.id,
      );
      assert.equal(
        store.exportRecordedHistory().records.find((r) => r.kind === "link").id,
        link.id,
      );
      store.save("unlinked", "local", plan("Edited", false));
      assert.equal(
        store.exportRecordedHistory().records.find((r) => r.id === link.id)
          .hash,
        null,
      );
      store.close();
      store = await ArchitectureStore.open(root, {
        writer: writer("machine-B", "Bob"),
      });
      store.save("linked again", "local", plan());
      const after = store.exportRecordedHistory();
      assert.equal(entity(after.records, "R1").id, requirement.id);
      assert.equal(after.records.find((r) => r.id === link.id).hash, null);
      const readded = after.records.find(
        (r) => r.kind === "link" && r.hash !== null,
      );
      assert.notEqual(readded.id, link.id);
      assert.equal(readded.hash, link.hash);
      assert.equal(readded.previous, link.id);
      assert.deepEqual(after.changes[0], before.changes[0]);
      assert.equal(after.changes.at(-1).sequence, 4);
      assert.equal(after.changes.at(-1).origin.author, "Bob");
      assert.equal(after.changes[0].checkpoint, first.id);
      assert.ok(
        after.changes[1].changes.some(
          (d) =>
            d.record === requirement.id &&
            d.before === requirement.hash &&
            d.after !== requirement.hash,
        ),
      );
    } finally {
      store.close();
    }
  }));

test("failed saves and unchanged refreshes produce no orphan identities or recorded changes", () =>
  fixture(async (root) => {
    const store = await ArchitectureStore.open(root, {
      writer: writer("machine-A"),
    });
    try {
      store.save("first", "local", plan());
      const before = store.exportRecordedHistory(),
        revisions = store.revisions();
      store.save("unchanged refresh", "local", plan(), undefined, undefined, {
        skipUnchanged: true,
      });
      assert.deepEqual(store.exportRecordedHistory(), before);
      const db = openDatabase(storagePath(root, "planning"));
      db.exec(
        "CREATE TRIGGER reject_receipt BEFORE INSERT ON recorded_changes BEGIN SELECT RAISE(ABORT,'reject receipt'); END",
      );
      db.close();
      assert.throws(
        () => store.save("rejected", "local", plan("Must roll back")),
        /reject receipt/,
      );
      assert.deepEqual(store.exportRecordedHistory(), before);
      assert.deepEqual(store.revisions(), revisions);
    } finally {
      store.close();
    }
  }));

test("legacy shared records are read without migration or invented authors, and local IDs retain their meaning", () =>
  fixture(async (root) => {
    let store = await ArchitectureStore.open(root, {
      writer: writer("machine-A"),
    });
    const revision = store.save("legacy", "old source", plan());
    const legacyExport = store.exportHistory();
    store.close();
    const db = openDatabase(storagePath(root, "planning"));
    db.exec("DROP TABLE recorded_changes; DROP TABLE shared_record_ids");
    db.close();
    const before = await readFile(storagePath(root, "planning"));
    store = await ArchitectureStore.open(root, { readOnly: true });
    try {
      assert.deepEqual(store.exportRecordedHistory().changes, []);
      assert.deepEqual(store.exportHistory(), legacyExport);
      assert.equal(store.read().id, revision.id);
    } finally {
      store.close();
    }
    assert.deepEqual(await readFile(storagePath(root, "planning")), before);
    store = await ArchitectureStore.open(root, { writer: writer("machine-B") });
    try {
      assert.deepEqual(store.exportHistory(), legacyExport);
      assert.deepEqual(store.exportRecordedHistory().changes, []);
      store.save("new change", "local", plan("New title"));
      assert.equal(store.exportRecordedHistory().changes.length, 1);
      assert.equal(
        store.read().entities.some((e) => e.id === "plan:R1"),
        true,
      );
    } finally {
      store.close();
    }
  }));

test("new checkpoint provenance and architecture draft paths omit machine-local roots", () =>
  fixture(async (root) => {
    const store = await ArchitectureStore.open(root, {
      writer: writer("machine-A"),
    });
    try {
      const revision = store.save("relative", join(root, "docs"), plan());
      assert.equal(store.revisions()[0].source, "docs");
      store.save("external", join(root, "..", "external"), plan());
      assert.equal(
        store.revisions()[0].source,
        "External source (machine-local location omitted)",
      );
      const draft = {
        kind: "document",
        baseRevision: revision.id,
        label: "draft",
        document: { path: join(root, "design/draft.md"), text: "unfinished" },
      };
      store.saveDraft(0, draft);
      assert.equal(store.readDraft().draft.document.path, "design/draft.md");
      assert.throws(
        () =>
          store.saveDraft(1, {
            ...draft,
            document: { path: join(root, "..", "escape.md"), text: "no" },
          }),
        /Shared paths/,
      );
      assert.equal(store.readDraft().version, 1);
      const exported = store.exportRecordedHistory();
      assert.ok(exported.records.some((r) => r.kind === "architecture-draft"));
      assert.equal(JSON.stringify(exported).includes(root), false);
    } finally {
      store.close();
    }
  }));

test("acknowledgement creation and withdrawal are attributed recorded changes, preserving the acknowledgement's ID", () =>
  fixture(async (root) => {
    const a = join(root, "a"),
      b = join(root, "b");
    await mkdir(a);
    await mkdir(b);
    const wa = writer("machine-A"),
      wb = writer("machine-B", "Bob");
    const one = await ArchitectureStore.open(a, { writer: wa });
    const two = await ArchitectureStore.open(b, { writer: wb });
    try {
      one.save("base", "local", plan());
      two.importHistory(one.exportHistory());
      const local = one.save("local", "local", plan("Local"));
      const remote = two.save("remote", "local", plan("Remote"));
      one.importHistory(two.exportHistory());
      const before = one.exportRecordedHistory().changes.length;
      one.reviewBranch(remote.id, local.id, {
        reviewer: "Alice",
        reason: "inspected",
      });
      const acknowledged = one.exportRecordedHistory();
      const record = acknowledged.records.find(
        (r) => r.kind === "acknowledgement",
      );
      assert.ok(record);
      assert.equal(acknowledged.changes.length, before + 1);
      const localId = one.reviewHistory(remote.id).items[0].id;
      one.withdrawBranchReview(localId, local.id, {
        reviewer: "Alice",
        reason: "recheck",
      });
      const withdrawn = one.exportRecordedHistory();
      assert.equal(withdrawn.changes.length, before + 2);
      assert.equal(
        withdrawn.records.find((r) => r.kind === "acknowledgement").id,
        record.id,
      );
      assert.equal(withdrawn.changes.at(-1).changes[0].record, record.id);
      assert.equal(withdrawn.changes.at(-1).changes[0].before, record.hash);
      assert.equal(withdrawn.changes.at(-1).origin.author, "Alice");
    } finally {
      one.close();
      two.close();
    }
  }));

test("total-order ties use actor then globally unique event ID, never author labels or timestamps", () => {
  const base = {
    sequence: 1,
    time: "2040-01-01T00:00:00.000Z",
    checkpoint: null,
    changes: [],
    origin: { machine: "machine-A", actor: "actor-A", author: "Z" },
  };
  const a = { ...base, id: "a" },
    b = { ...base, id: "b", time: "1900-01-01T00:00:00.000Z" };
  const c = {
    ...base,
    id: "0",
    origin: { ...base.origin, actor: "actor-B", author: "A" },
  };
  assert.deepEqual([c, b, a].sort(compareRecordedChanges), [a, b, c]);
});

test("Studio persists shared recovery buffer/context paths relative to the project", () =>
  fixture(async (root) => {
    const service = new StudioService(root);
    await service.initializeRecovery();
    try {
      const input = {
        drafts: [
          {
            path: join(root, "unsaved.pym"),
            text: "unfinished",
            baseHash: null,
          },
        ],
        context: {
          file: join(root, "unsaved.pym"),
          entry: "main",
          tab: "source",
          settings: {
            seed: "42",
            maxSteps: 6,
            maxSamples: 10,
            timeoutMs: 12000,
            scope: "",
          },
        },
      };
      const saved = await service.saveRecovery(0, input);
      assert.equal(saved.drafts[0].path, "unsaved.pym");
      assert.equal(saved.context.file, "unsaved.pym");
      assert.equal(input.drafts[0].path, join(root, "unsaved.pym"));
      await assert.rejects(
        service.saveRecovery(1, {
          ...input,
          context: { ...input.context, file: join(root, "..", "escape.pym") },
        }),
        (error) => error.status === 400 && /Shared paths/.test(error.message),
      );
      assert.equal(service.readRecovery().revision, 1);
    } finally {
      await service.close();
    }
  }));

for (const [label, lookupValue, environment, expected] of [
  [
    "failed lookup prefers USER",
    null,
    { USER: " CI author ", LOGNAME: "Other" },
    "CI author",
  ],
  [
    "failed lookup uses LOGNAME",
    null,
    { USER: " ", LOGNAME: "Build bot" },
    "Build bot",
  ],
  ["empty lookup falls back", "", { USER: "Container user" }, "Container user"],
  ["missing passwd and environment", null, {}, "Unknown author"],
  ["empty names", " ", { USER: " ", LOGNAME: "" }, "Unknown author"],
  [
    "successful lookup wins",
    " Named author ",
    { USER: "Other" },
    "Named author",
  ],
]) {
  test(`local writer: ${label}; existing identity never repeats lookup`, () =>
    fixture(async (root) => {
      let calls = 0;
      const lookupAuthor = () => {
        calls++;
        if (lookupValue === null)
          throw Error("uv_os_get_passwd returned ENOENT");
        return lookupValue;
      };
      const first = localHistoryWriter(root, { lookupAuthor, environment });
      assert.equal(first.origin.author, expected);
      assert.equal(calls, 1);
      const file = join(root, ".pymtheg/local/writer.json");
      await writeFile(
        file,
        JSON.stringify({ ...first.origin, author: "Configured author" }),
      );
      const reopened = localHistoryWriter(root, { lookupAuthor, environment });
      assert.equal(calls, 1);
      assert.deepEqual(reopened.origin, {
        ...first.origin,
        author: "Configured author",
      });
    }));
}

test("a removed requirement key gets a new UUID with an unbroken previous chain; ordinary edits keep it", () =>
  fixture(async (root) => {
    const store = await ArchitectureStore.open(root, {
      writer: writer("machine-A"),
    });
    const requirement = (title) => [
      {
        path: "requirements.json",
        text: JSON.stringify({
          schema: "pymtheg.plan/v1",
          items: [{ ...newPlanItem("R3"), title }],
        }),
      },
    ];
    const empty = [
      {
        path: "requirements.json",
        text: JSON.stringify({ schema: "pymtheg.plan/v1", items: [] }),
      },
    ];
    try {
      store.save("first", "local", requirement("Encrypt backups"));
      const first = entity(store.exportRecordedHistory().records, "R3");
      store.save("removed", "local", empty);
      store.save(
        "unrelated",
        "local",
        requirement("Expose Prometheus metrics"),
      );
      const second = entity(store.exportRecordedHistory().records, "R3");
      assert.notEqual(second.id, first.id);
      assert.equal(second.previous, first.id);
      assert.equal(
        store.exportRecordedHistory().records.find((r) => r.id === first.id)
          .hash,
        null,
      );
      store.save("edited", "local", requirement("Expose more metrics"));
      assert.equal(
        entity(store.exportRecordedHistory().records, "R3").id,
        second.id,
      );
      store.save("removed again", "local", empty);
      store.save("third", "local", requirement("Another requirement"));
      const all = store.exportRecordedHistory().records;
      assert.equal(entity(all, "R3").previous, second.id);
      assert.equal(all.find((r) => r.id === second.id).previous, first.id);
      assert.equal(all.find((r) => r.id === second.id).hash, null);
      assert.equal(all.find((r) => r.id === first.id).hash, null);
    } finally {
      store.close();
    }
  }));

test("unchanged draft writes and repeated empty clears append no receipt, and receipt failure rolls the draft back", () =>
  fixture(async (root) => {
    const store = await ArchitectureStore.open(root, {
      writer: writer("machine-A"),
    });
    const draft = {
      kind: "document",
      baseRevision: "",
      label: "draft",
      document: { path: "draft.md", text: "unfinished" },
    };
    try {
      store.saveDraft(0, null);
      assert.equal(store.exportRecordedHistory().changes.length, 0);
      store.saveDraft(1, draft);
      const before = store.exportRecordedHistory();
      store.saveDraft(2, draft);
      assert.deepEqual(store.exportRecordedHistory(), before);
      const db = openDatabase(storagePath(root, "planning"));
      db.exec(
        "CREATE TRIGGER reject_draft_receipt BEFORE INSERT ON recorded_changes BEGIN SELECT RAISE(ABORT,'reject draft receipt'); END",
      );
      db.close();
      assert.throws(
        () => store.saveDraft(3, { ...draft, label: "Changed" }),
        /reject draft receipt/,
      );
      assert.equal(store.readDraft().version, 3);
      assert.deepEqual(store.readDraft().draft, draft);
      assert.deepEqual(store.exportRecordedHistory(), before);
      const cleanup = openDatabase(storagePath(root, "planning"));
      cleanup.exec("DROP TRIGGER reject_draft_receipt");
      cleanup.close();
      store.saveDraft(3, null);
      const cleared = store.exportRecordedHistory();
      assert.equal(cleared.changes.length, before.changes.length + 1);
      store.saveDraft(4, null);
      assert.deepEqual(store.exportRecordedHistory(), cleared);
    } finally {
      store.close();
    }
  }));

test("project root is not a shared file path, while an explicitly unanswered path remains empty", () =>
  fixture(async (root) => {
    assert.throws(() => sharedProjectPath(root, root), /Shared paths/);
    assert.throws(() => sharedProjectPath(root, "."), /Shared paths/);
    assert.equal(sharedProjectPath(root, ""), "");
  }));

test("unchanged legacy drafts do not invent registrations or receipts", () =>
  fixture(async (root) => {
    for (const draft of [
      null,
      {
        kind: "document",
        baseRevision: "",
        label: "legacy",
        document: { path: "draft.md", text: "unfinished" },
      },
    ]) {
      const directory = join(root, draft ? "populated" : "empty");
      await mkdir(directory);
      let store = await ArchitectureStore.open(directory, {
        writer: writer("machine-A"),
      });
      store.saveDraft(0, draft);
      store.close();
      const db = openDatabase(storagePath(directory, "planning"));
      db.exec(
        "DELETE FROM recorded_changes; DELETE FROM shared_record_ids; DELETE FROM shared_record_lineage",
      );
      if (draft === null)
        db.prepare("INSERT INTO shared_record_ids VALUES(?,?,?,?)").run(
          "architecture-draft",
          "active",
          "00000000-0000-4000-8000-000000000001",
          createHash("sha256").update("null").digest("hex"),
        );
      db.close();
      store = await ArchitectureStore.open(directory, {
        writer: writer("machine-B"),
      });
      try {
        const before = store.exportRecordedHistory();
        store.saveDraft(1, draft);
        assert.deepEqual(store.exportRecordedHistory(), before);
        assert.equal(store.readDraft().version, 2);
        assert.deepEqual(store.readDraft().draft, draft);
      } finally {
        store.close();
      }
    }
  }));
