import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { branchReview } from "../dist/architecture/branches.js";
import { validateHistory } from "../dist/architecture/history.js";
test("branch acknowledgements survive restart and export without pretending a merge; new remote work needs review", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-branch-ack-"));
  let a, b, c;
  try {
    for (const path of ["a", "b", "c"]) await mkdir(join(root, path));
    a = await ArchitectureStore.open(join(root, "a"));
    b = await ArchitectureStore.open(join(root, "b"));
    c = await ArchitectureStore.open(join(root, "c"));
    a.save("Base", "test", [{ path: "design.md", text: "base" }]);
    b.importHistory(a.exportHistory());
    const local = a.save("Local", "test", [
      { path: "design.md", text: "local" },
    ]);
    const remote = b.save("Remote", "test", [
      { path: "design.md", text: "remote" },
    ]);
    a.importHistory(b.exportHistory());
    assert.equal(branchReview(a.revisions(), local.id)[0].reviewed, false);
    assert.throws(
      () => a.reviewBranch(remote.id, remote.id),
      /current version changed/,
    );
    a.reviewBranch(remote.id, local.id);
    assert.equal(a.read().id, local.id);
    a.close();
    a = await ArchitectureStore.open(join(root, "a"));
    assert.equal(branchReview(a.revisions(), local.id)[0].reviewed, true);
    const archive = a.exportHistory();
    c.importHistory(archive);
    assert.equal(branchReview(c.revisions(), local.id)[0].reviewed, true);
    const bad = structuredClone(archive);
    bad.revisions[0].reviewedAgainst = ["f".repeat(64)];
    assert.throws(() => validateHistory(bad), /missing revision/);
    const newer = b.save("Remote follow-up", "test", [
      { path: "design.md", text: "new remote work" },
    ]);
    a.importHistory(b.exportHistory());
    assert.equal(
      branchReview(a.revisions(), local.id).find((r) => r.id === newer.id)
        .reviewed,
      false,
    );
    assert.equal(a.read().id, local.id);
  } finally {
    a?.close();
    b?.close();
    c?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("branch review metadata and withdrawals survive restart and stale archive merges", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-ack-audit-"));
  let a, b, c;
  try {
    for (const name of ["a", "b", "c"]) await mkdir(join(root, name));
    a = await ArchitectureStore.open(join(root, "a"));
    b = await ArchitectureStore.open(join(root, "b"));
    c = await ArchitectureStore.open(join(root, "c"));
    a.save("base", "test", [{ path: "design.md", text: "base" }]);
    b.importHistory(a.exportHistory());
    const local = a.save("local", "test", [
        { path: "design.md", text: "local" },
      ]),
      remote = b.save("remote", "test", [
        { path: "design.md", text: "remote" },
      ]);
    a.importHistory(b.exportHistory());
    a.reviewBranch(remote.id, local.id, {
      reviewer: "Karl",
      reason: "Retain local durability requirement",
    });
    const archive = a.exportHistory();
    c.importHistory(archive);
    const record = c.revisions().find((r) => r.id === remote.id)
      .reviewRecords[0];
    assert.equal(record.reviewer, "Karl");
    assert.equal(record.reason, "Retain local durability requirement");
    c.withdrawBranchReview(record.id, local.id, {
      reviewer: "Reviewer",
      reason: "Provider contract changed",
    });
    c.importHistory(archive);
    assert.equal(
      branchReview(c.revisions(), local.id).find((r) => r.id === remote.id)
        .reviewed,
      false,
    );
    const legacy = structuredClone(archive);
    for (const r of legacy.revisions) delete r.reviewRecords;
    c.importHistory(legacy);
    assert.equal(
      branchReview(c.revisions(), local.id).find((r) => r.id === remote.id)
        .reviewed,
      false,
      "old pair-only archives cannot revive withdrawal",
    );
    c.close();
    c = await ArchitectureStore.open(join(root, "c"));
    assert.equal(
      c
        .revisions()
        .find((r) => r.id === remote.id)
        .reviewRecords.find((r) => r.id === record.id).withdrawal.reason,
      "Provider contract changed",
    );
    c.reviewBranch(remote.id, local.id, {
      reviewer: "Karl",
      reason: "Rechecked new provider terms",
    });
    assert.equal(
      branchReview(c.revisions(), local.id).find((r) => r.id === remote.id)
        .reviewed,
      true,
    );
    const corrupted = structuredClone(c.exportHistory());
    corrupted.revisions.find(
      (r) => r.id === remote.id,
    ).reviewRecords[0].against = "f".repeat(64);
    assert.throws(() => validateHistory(corrupted), /missing revision/);
  } finally {
    a?.close();
    b?.close();
    c?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent withdrawals merge both explanations without selecting a clock winner", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-withdrawals-"));
  let a, b, remote;
  try {
    for (const name of ["a", "b", "remote"]) await mkdir(join(root, name));
    a = await ArchitectureStore.open(join(root, "a"));
    b = await ArchitectureStore.open(join(root, "b"));
    remote = await ArchitectureStore.open(join(root, "remote"));
    a.save("base", "test", [{ path: "design.md", text: "base" }]);
    remote.importHistory(a.exportHistory());
    const local = a.save("local", "test", [
      { path: "design.md", text: "local" },
    ]);
    const other = remote.save("remote", "test", [
      { path: "design.md", text: "remote" },
    ]);
    a.importHistory(remote.exportHistory());
    a.reviewBranch(other.id, local.id, {
      reviewer: "Owner",
      reason: "reviewed",
    });
    b.importHistory(a.exportHistory());
    const id = a.revisions().find((r) => r.id === other.id).reviewRecords[0].id;
    a.withdrawBranchReview(id, local.id, {
      reviewer: "Alice",
      reason: "Durability changed",
    });
    b.withdrawBranchReview(id, local.id, {
      reviewer: "Bob",
      reason: "Availability changed",
    });
    const fromA = a.exportHistory(),
      fromB = b.exportHistory();
    a.importHistory(fromB);
    b.importHistory(fromA);
    const rows = a.withdrawalHistory(id, 0, 1);
    assert.equal(rows.total, 2);
    assert.equal(rows.items.length, 1);
    assert.equal(rows.nextOffset, 1);
    const all = a.withdrawalHistory(id, 0, 50).items;
    assert.deepEqual(all.map((w) => w.reason).sort(), [
      "Availability changed",
      "Durability changed",
    ]);
    assert.deepEqual(all, b.withdrawalHistory(id, 0, 50).items);
    a.importHistory(fromB);
    assert.deepEqual(a.withdrawalHistory(id, 0, 50).items, all);
    const summary = a
      .reviewHistory(other.id, 0, 20)
      .items.find((r) => r.id === id);
    assert.equal(summary.withdrawalCount, 2);
    assert.equal(summary.additionalWithdrawals, undefined);
    assert.equal(
      branchReview(a.revisions(), local.id).find((r) => r.id === other.id)
        .reviewed,
      false,
    );
    const invalid = structuredClone(a.exportHistory());
    const record = invalid.revisions
      .find((r) => r.id === other.id)
      .reviewRecords.find((r) => r.id === id);
    delete record.withdrawal;
    assert.throws(
      () => validateHistory(invalid),
      /require the first withdrawal/,
    );
  } finally {
    a?.close();
    b?.close();
    remote?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("newly imported withdrawal sets are canonical immediately and repeated import is unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-withdrawal-canonical-"));
  let source, peer, target;
  try {
    for (const name of ["source", "peer", "target"])
      await mkdir(join(root, name));
    source = await ArchitectureStore.open(join(root, "source"));
    peer = await ArchitectureStore.open(join(root, "peer"));
    target = await ArchitectureStore.open(join(root, "target"));
    source.save("base", "test", [{ path: "design.md", text: "base" }]);
    peer.importHistory(source.exportHistory());
    const local = source.save("local", "test", [
        { path: "design.md", text: "local" },
      ]),
      branch = peer.save("branch", "test", [
        { path: "design.md", text: "branch" },
      ]);
    source.importHistory(peer.exportHistory());
    source.reviewBranch(branch.id, local.id, {
      reviewer: "Owner",
      reason: "initial",
    });
    const archive = source.exportHistory(),
      record = archive.revisions.find((r) => r.id === branch.id)
        .reviewRecords[0];
    record.withdrawal = { reviewer: "Z", reason: "storage changed" };
    record.additionalWithdrawals = [
      { reviewer: "A", reason: "network changed" },
      { ...record.withdrawal },
    ];
    archive.revisions.find((r) => r.id === branch.id).reviewedAgainst = [];
    target.importHistory(archive);
    assert.equal(target.withdrawalHistory(record.id).total, 2);
    const first = target.exportHistory();
    target.importHistory(archive);
    assert.deepEqual(target.exportHistory(), first);
    assert.deepEqual(
      target.withdrawalHistory(record.id).items.map((w) => w.reviewer),
      ["A", "Z"],
    );
  } finally {
    source?.close();
    peer?.close();
    target?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("active reviews appear before old withdrawals regardless of IDs or wall clocks", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-active-review-page-"));
  let source, peer, target;
  try {
    for (const name of ["source", "peer", "target"])
      await mkdir(join(root, name));
    source = await ArchitectureStore.open(join(root, "source"));
    peer = await ArchitectureStore.open(join(root, "peer"));
    target = await ArchitectureStore.open(join(root, "target"));
    source.save("Base", "test", [{ path: "design.md", text: "base" }]);
    peer.importHistory(source.exportHistory());
    const current = source.save("Current", "test", [
      { path: "design.md", text: "local" },
    ]);
    const branch = peer.save("Remote", "test", [
      { path: "design.md", text: "remote" },
    ]);
    source.importHistory(peer.exportHistory());
    source.reviewBranch(branch.id, current.id);
    const archive = source.exportHistory(),
      record = archive.revisions.find((r) => r.id === branch.id);
    const active = {
      id: "f".repeat(64),
      against: current.id,
      reviewer: "Current reviewer",
      created: "1970-01-01T00:00:00.000Z",
    };
    record.reviewRecords = [
      ...Array.from({ length: 30 }, (_, i) => ({
        id: (i + 1).toString(16).padStart(64, "0"),
        against: current.id,
        reviewer: "Earlier reviewer",
        created: "2099-01-01T00:00:00.000Z",
        withdrawal: { reason: "replaced" },
      })),
      active,
    ];
    target.importHistory(archive);
    const first = target.reviewHistory(branch.id, 0, 20);
    assert.equal(first.items[0].id, active.id);
    assert.equal(first.items[0].withdrawal, undefined);
    assert.equal(first.nextOffset, 20);
    const second = target.reviewHistory(branch.id, first.nextOffset, 20);
    assert.equal(second.nextOffset, null);
    assert.equal(
      new Set([...first.items, ...second.items].map((r) => r.id)).size,
      31,
    );
  } finally {
    source?.close();
    peer?.close();
    target?.close();
    await rm(root, { recursive: true, force: true });
  }
});
