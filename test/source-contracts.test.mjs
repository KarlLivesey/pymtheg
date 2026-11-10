import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import {
  sourceCatalogue,
  affectedSourceContracts,
} from "../dist/architecture/source-contracts.js";

test("source planning identities and hashes follow semantics rather than positions", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-source-links-"));
  try {
    const file = join(root, "pay.pym");
    const source =
      "type Order = { amount: Nat }; flow pay(order: Order) -> Bool { return order.amount > 0; } flow unrelated() -> Bool { return true; }";
    const capture = (text) => {
      writeFileSync(file, text);
      return sourceCatalogue(analyseFile(file, () => {}, { root }).ir, root);
    };
    const before = capture(source);
    assert.equal(
      before.entries.find((e) => e.name === "pay").id,
      "source:pay.pym#pay",
    );
    const formatted = capture(
      "// Comment changes do not change the design\n" +
        source.replaceAll(";", ";\n"),
    );
    assert.deepEqual([...affectedSourceContracts(before, formatted)], []);
    const changed = capture(source.replace("amount: Nat", "amount: Int"));
    const affected = affectedSourceContracts(before, changed);
    assert.ok(affected.has("source:pay.pym#Order"));
    assert.ok(affected.has("source:pay.pym#pay"));
    assert.ok(!affected.has("source:pay.pym#unrelated"));
    const body = capture(
      source.replace("order.amount > 0", "order.amount > 1"),
    );
    assert.ok(affectedSourceContracts(before, body).has("source:pay.pym#pay"));
    const broken = capture("flow pay( {");
    assert.deepEqual(broken.incompleteFiles, ["pay.pym"]);
    assert.ok(broken.diagnostics.some((d) => d.code === "P002"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source catalogue pages are read-only snapshots that remain stable across source edits", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { access } = await import("node:fs/promises");
  const root = mkdtempSync(join(tmpdir(), "pym-source-pages-"));
  const service = new StudioService(root);
  try {
    const file = join(root, "source.pym");
    writeFileSync(
      file,
      Array.from({ length: 60 }, (_, i) => `op work${i}(n: Nat) -> Unit;`).join(
        "\n",
      ),
    );
    const first = await service.sourceContractPage(
      { limit: 20 },
      new AbortController().signal,
    );
    assert.equal(first.total, 60);
    assert.equal(first.items.length, 20);
    assert.equal(first.nextOffset, 20);
    assert.equal(first.items[0].file, "source.pym");
    writeFileSync(file, "op replacement() -> Unit;");
    const page = await service.sourceContractPage(
      { snapshotId: first.snapshotId, offset: 20, limit: 20 },
      new AbortController().signal,
    );
    assert.equal(page.total, 60);
    assert.ok(page.items.every((e) => e.name !== "replacement"));
    const fresh = await service.sourceContractPage(
      {},
      new AbortController().signal,
    );
    assert.equal(fresh.total, 1);
    assert.equal(fresh.items[0].name, "replacement");
    assert.notEqual(first.snapshotId, fresh.snapshotId);
    await assert.rejects(access(join(root, ".pymtheg-architecture")));
    await assert.rejects(
      service.sourceContractPage({ offset: 20 }, new AbortController().signal),
      /snapshotId/,
    );
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("saving a source-linked plan retains its real source identity and snapshot atomically", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = mkdtempSync(join(tmpdir(), "pym-source-plan-"));
  let service = new StudioService(root);
  try {
    const file = join(root, "pay.pym");
    writeFileSync(
      file,
      "type Order = { amount: Nat }; flow charge(order: Order) -> Bool { return order.amount > 0; }",
    );
    const saved = await service.savePlanItem(
      "",
      {
        ...newPlanItem("R1"),
        title: "Charge each order once",
        links: [{ kind: "depends-on", target: "source:pay.pym#charge" }],
      },
      "Link source",
      new AbortController().signal,
    );
    const record = await service.architectureRecord(saved.id, "plan:R1");
    assert.ok(record.data.sourceExpectations["source:pay.pym#charge"]);
    assert.ok(record.data.sourceExpectations["source:pay.pym#Order"]);
    assert.ok(
      saved.entities.some(
        (e) => e.id === "source:pay.pym#charge" && e.kind === "function",
      ),
    );
    assert.ok(
      saved.edges.some(
        (e) =>
          e.from === "plan:R1" &&
          e.to === "source:pay.pym#charge" &&
          !e.unresolved,
      ),
    );
    const source = await service.architectureRecord(
      saved.id,
      "source:pay.pym#charge",
    );
    assert.equal(source.data.symbolId, "pay.pym#charge");
    assert.match(source.data.source, /flow charge/);
    await service.close();
    service = new StudioService(root);
    assert.equal(
      (await service.architectureRecord(saved.id, "plan:R1")).data
        .sourceExpectations["source:pay.pym#charge"],
      record.data.sourceExpectations["source:pay.pym#charge"],
    );
    const { readFile } = await import("node:fs/promises");
    const database = join(root, ".pymtheg-architecture", "architecture.sqlite");
    const bytes = await readFile(database);
    writeFileSync(
      file,
      "type Order = { amount: Nat }; flow charge(order: Order) -> Bool { return order.amount > 0; } flow unrelated() -> Bool { return false; }",
    );
    assert.ok(
      !(await service.architectureWork(saved.id)).some(
        (w) => w.id === "plan:R1" && w.kind === "changed-target",
      ),
    );
    writeFileSync(
      file,
      "type Order = { amount: Int }; flow charge(order: Order) -> Bool { return order.amount > 0; }",
    );
    assert.ok(
      (await service.architectureWork(saved.id)).some(
        (w) =>
          w.id === "plan:R1" &&
          w.kind === "changed-target" &&
          w.target === "source:pay.pym#Order",
      ),
    );
    assert.deepEqual(
      await readFile(database),
      bytes,
      "Live source review is read-only",
    );
    const fresh = await service.captureSourceContracts(
      new AbortController().signal,
    );
    const reviewed = await service.savePlanItem(
      saved.id,
      { ...record.data, sourceReviewSnapshot: fresh.snapshotId },
      "Accept source change",
      new AbortController().signal,
      { document: record.entity.document, originalId: "R1" },
    );
    assert.ok(
      !(await service.architectureWork(reviewed.id)).some(
        (w) => w.id === "plan:R1" && w.kind === "changed-target",
      ),
    );
    writeFileSync(file, "flow charge( {");
    assert.ok(
      (await service.architectureWork(reviewed.id)).some(
        (w) => w.id === "plan:R1" && w.kind === "unknown-link-review",
      ),
    );
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("source choices reject stale saves and one plan cannot acknowledge another plan's source", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = mkdtempSync(join(tmpdir(), "pym-source-independent-"));
  const service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    const file = join(root, "pay.pym");
    const original = "flow charge(amount: Nat) -> Bool { return amount > 0; }";
    writeFileSync(file, original);
    const first = await service.sourceContractPage({}, signal);
    const plan = (id) => ({
      ...newPlanItem(id),
      title: id,
      links: [{ kind: "depends-on", target: "source:pay.pym#charge" }],
    });
    let saved = await service.savePlanItem(
      "",
      { ...plan("A"), sourceSelectionSnapshot: first.snapshotId },
      "A",
      signal,
    );
    saved = await service.savePlanItem(saved.id, plan("B"), "B", signal);
    const a = await service.architectureRecord(saved.id, "plan:A");
    writeFileSync(file, original.replace("> 0", "> 1"));
    await assert.rejects(
      service.savePlanItem(
        saved.id,
        { ...plan("C"), sourceSelectionSnapshot: first.snapshotId },
        "stale",
        signal,
      ),
      /Source changed/,
    );
    const changed = await service.sourceContractPage({}, signal);
    saved = await service.savePlanItem(
      saved.id,
      { ...a.data, sourceReviewSnapshot: changed.snapshotId },
      "review A",
      signal,
      { document: a.entity.document, originalId: "A" },
    );
    const work = await service.architectureWork(saved.id);
    assert.ok(
      !work.some((w) => w.id === "plan:A" && w.kind === "changed-target"),
    );
    assert.ok(
      work.some((w) => w.id === "plan:B" && w.kind === "changed-target"),
    );
    const b = await service.architectureRecord(saved.id, "plan:B");
    const detail = await service.sourceContractDetail(
      {
        id: "source:pay.pym#charge",
        snapshotId: changed.snapshotId,
        revision: saved.id,
        expectations: b.data.sourceExpectations,
      },
      signal,
    );
    assert.equal(detail.recorded.source, original);
    assert.equal(detail.current.source, original.replace("> 0", "> 1"));
    assert.deepEqual(detail.changedDependencies, ["source:pay.pym#charge"]);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("large projects review explicitly selected source instead of the first inventory file", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = mkdtempSync(join(tmpdir(), "pym-large-source-plan-"));
  const service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    for (let i = 0; i < 2050; i++)
      writeFileSync(join(root, `noise${i}.pym`), `flow noise${i}() -> Unit {}`);
    const file = join(root, "selected.pym");
    const original = "flow chosen(n: Nat) -> Bool { return n > 0; }";
    writeFileSync(file, original);
    const page = await service.sourceContractPage(
      { file: "selected.pym" },
      signal,
    );
    assert.deepEqual(
      page.items.map((e) => e.name),
      ["chosen"],
    );
    const saved = await service.savePlanItem(
      "",
      {
        ...newPlanItem("Selected"),
        title: "Selected source",
        sourceSelectionSnapshot: page.snapshotId,
        links: [{ kind: "depends-on", target: "source:selected.pym#chosen" }],
      },
      "Select outside default slice",
      signal,
    );
    assert.ok(
      !(await service.architectureWork(saved.id)).some(
        (w) => w.kind === "broken-link" || w.kind === "changed-target",
      ),
    );
    writeFileSync(file, original.replace("> 0", "> 1"));
    assert.ok(
      (await service.architectureWork(saved.id)).some(
        (w) =>
          w.kind === "changed-target" &&
          w.target === "source:selected.pym#chosen",
      ),
    );
    const current = await service.sourceContractPage(
      { targets: ["source:selected.pym#chosen"] },
      signal,
    );
    assert.deepEqual(
      current.items.map((e) => e.name),
      ["chosen"],
    );
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("empty source catalogue remains page-readable and aborted reads do not publish plans", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const root = mkdtempSync(join(tmpdir(), "pym-empty-source-plan-"));
  const service = new StudioService(root);
  try {
    const page = await service.sourceContractPage(
      {},
      new AbortController().signal,
    );
    assert.equal(page.total, 0);
    assert.equal(
      (
        await service.sourceContractPage(
          { snapshotId: page.snapshotId, query: "x" },
          new AbortController().signal,
        )
      ).total,
      0,
    );
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      service.captureSourceContracts(abort.signal),
      /abort/i,
    );
    assert.ok(
      !existsSync(join(root, ".pymtheg-architecture", "architecture.sqlite")),
    );
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an explicitly chosen source beyond the browsing cap can still be linked and reviewed", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = mkdtempSync(join(tmpdir(), "pym-source-beyond-inventory-"));
  const service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    for (let i = 0; i < 10001; i++)
      writeFileSync(join(root, `a${String(i).padStart(5, "0")}.pym`), "");
    writeFileSync(
      join(root, "z-chosen.pym"),
      "flow chosen() -> Bool { return true; }",
    );
    const page = await service.sourceContractPage(
      { file: "z-chosen.pym" },
      signal,
    );
    assert.equal(page.items[0].id, "source:z-chosen.pym#chosen");
    const saved = await service.savePlanItem(
      "",
      {
        ...newPlanItem("R-cap"),
        title: "Explicit source remains usable",
        sourceSelectionSnapshot: page.snapshotId,
        links: [{ kind: "depends-on", target: page.items[0].id }],
      },
      "Choose source beyond browser list",
      signal,
    );
    assert.ok(
      !(await service.architectureWork(saved.id)).some(
        (w) => w.kind === "broken-link",
      ),
    );
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("reviewed source bytes survive a formatting-only recapture for another plan", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = mkdtempSync(join(tmpdir(), "pym-source-review-bytes-"));
  const service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    const file = join(root, "source.pym"),
      original = "flow decide() -> Bool { return true; }";
    writeFileSync(file, original);
    const item = (id) => ({
      ...newPlanItem(id),
      title: id,
      links: [{ kind: "depends-on", target: "source:source.pym#decide" }],
    });
    let saved = await service.savePlanItem(
      "",
      item("A"),
      "First review",
      signal,
    );
    const a = await service.architectureRecord(saved.id, "plan:A");
    writeFileSync(file, "flow decide() -> Bool {\n  return true;\n}");
    saved = await service.savePlanItem(
      saved.id,
      item("B"),
      "Second review",
      signal,
    );
    const current = await service.sourceContractPage({}, signal);
    const detail = await service.sourceContractDetail(
      {
        id: "source:source.pym#decide",
        snapshotId: current.snapshotId,
        revision: saved.id,
        expectations: a.data.sourceExpectations,
        sourceHashes: a.data.sourceHashes,
      },
      signal,
    );
    assert.equal(detail.recordedAtReview, true);
    assert.equal(detail.recorded.source, original);
    assert.deepEqual(detail.changedDependencies, []);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a displayed review cannot capture different source bytes even when semantics match", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = mkdtempSync(join(tmpdir(), "pym-source-displayed-review-"));
  const service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    const file = join(root, "source.pym");
    writeFileSync(file, "flow decide() -> Bool { return true; }");
    const viewed = await service.sourceContractPage({}, signal);
    writeFileSync(file, "flow decide() -> Bool {\n  return true;\n}");
    await assert.rejects(
      service.savePlanItem(
        "",
        {
          ...newPlanItem("Reviewed"),
          title: "Reviewed source",
          links: [{ kind: "depends-on", target: "source:source.pym#decide" }],
          sourceSelectionSnapshot: viewed.snapshotId,
        },
        "Save displayed source",
        signal,
      ),
      /Source changed since review/,
    );
    assert.equal((await service.architectureOverview()).index, null);
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unrelated declaration edit does not invalidate the displayed component", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = mkdtempSync(join(tmpdir(), "pym-source-selected-scope-"));
  const service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    const file = join(root, "source.pym");
    const source =
      "flow decide() -> Bool { return true; }\nflow other() -> Bool { return false; }";
    writeFileSync(file, source);
    const viewed = await service.sourceContractPage({}, signal);
    writeFileSync(
      file,
      source.replace(
        "other() -> Bool { return false;",
        "other() -> Bool { return true;",
      ),
    );
    const saved = await service.savePlanItem(
      "",
      {
        ...newPlanItem("Selected"),
        title: "Only the selected component",
        links: [{ kind: "depends-on", target: "source:source.pym#decide" }],
        sourceSelectionSnapshot: viewed.snapshotId,
      },
      "Save independent component",
      signal,
    );
    assert.ok(saved.entities.some((e) => e.id === "plan:Selected"));
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("one linked root may depend on more than 32 imported source files", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = mkdtempSync(join(tmpdir(), "pym-source-import-roots-"));
  const service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    for (let i = 0; i < 2050; i++)
      writeFileSync(join(root, `noise${i}.pym`), "");
    const imports = [],
      fields = [];
    for (let i = 0; i < 33; i++) {
      writeFileSync(
        join(root, `part${i}.pym`),
        `type Part${i} = { value: Nat };`,
      );
      imports.push(`import "part${i}.pym";`);
      fields.push(`p${i}: Part${i}`);
    }
    writeFileSync(
      join(root, "root.pym"),
      `${imports.join("\n")}\ntype Data = { ${fields.join(", ")} }; flow inspect(data: Data) -> Bool { return data.p0.value > 0; }`,
    );
    const saved = await service.savePlanItem(
      "",
      {
        ...newPlanItem("Imports"),
        title: "Review one imported design",
        links: [{ kind: "depends-on", target: "source:root.pym#inspect" }],
      },
      "Linked import closure",
      signal,
    );
    const issues = await service.architectureWork(saved.id);
    assert.ok(
      !issues.some((w) =>
        ["unknown-link-review", "broken-link", "changed-target"].includes(
          w.kind,
        ),
      ),
      JSON.stringify(issues),
    );
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("repeated references do not expand into an unbounded argument list", async () => {
  const { sourceExpectations } = await import(
    "../dist/architecture/source-contracts.js"
  );
  const root = mkdtempSync(join(tmpdir(), "pym-source-reference-count-"));
  try {
    const file = join(root, "source.pym");
    writeFileSync(
      file,
      "op leaf() -> Unit; flow root() -> Unit { call leaf(); }",
    );
    const catalogue = sourceCatalogue(
      analyseFile(file, () => {}, { root }).ir,
      root,
    );
    catalogue.dependencies = Array.from({ length: 150000 }, () => ({
      from: "source:source.pym#root",
      to: "source:source.pym#leaf",
      kind: "call",
    }));
    assert.deepEqual(
      Object.keys(
        sourceExpectations(catalogue, ["source:source.pym#root"]),
      ).sort(),
      ["source:source.pym#leaf", "source:source.pym#root"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source detail limits changes to the selected component and its dependencies", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { newPlanItem } = await import("../dist/architecture/planning.js");
  const root = mkdtempSync(join(tmpdir(), "pym-source-detail-scope-"));
  const service = new StudioService(root),
    signal = new AbortController().signal;
  try {
    const file = join(root, "source.pym");
    const source =
      "flow stable() -> Bool { return true; }\nflow changed() -> Bool { return false; }";
    writeFileSync(file, source);
    const saved = await service.savePlanItem(
      "",
      {
        ...newPlanItem("Both"),
        title: "Two independent components",
        links: ["stable", "changed"].map((name) => ({
          kind: "depends-on",
          target: "source:source.pym#" + name,
        })),
      },
      "Link both",
      signal,
    );
    const plan = await service.architectureRecord(saved.id, "plan:Both");
    writeFileSync(
      file,
      source.replace(
        "changed() -> Bool { return false;",
        "changed() -> Bool { return true;",
      ),
    );
    const fresh = await service.sourceContractPage({}, signal);
    const detail = async (name) =>
      service.sourceContractDetail(
        {
          id: "source:source.pym#" + name,
          snapshotId: fresh.snapshotId,
          revision: saved.id,
          expectations: plan.data.sourceExpectations,
          sourceHashes: plan.data.sourceHashes,
        },
        signal,
      );
    assert.deepEqual((await detail("stable")).changedDependencies, []);
    assert.deepEqual((await detail("changed")).changedDependencies, [
      "source:source.pym#changed",
    ]);
    assert.ok(
      (await service.architectureWork(saved.id)).some(
        (w) => w.id === "plan:Both" && w.kind === "changed-target",
      ),
    );
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
