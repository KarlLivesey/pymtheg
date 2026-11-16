// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mergeArchitectureImport } from "../dist/architecture/import-merge.js";
import { indexArchitecture } from "../dist/architecture/model.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import {
  openArchitectureWork,
  projectEvidenceSnapshot,
} from "../dist/architecture/work.js";
const source = {
  id: "payments",
  label: "Payment requirements",
  kind: "upload",
};
const incoming = (text) => [{ path: "payments.md", text }];
const initial = mergeArchitectureImport(
  [],
  incoming("# Payments\n\nRetry twice.\n"),
  source,
).documents;
const old = indexArchitecture(initial);
const local = initial.map((d) =>
  d.path === "payments.md" ? { ...d, text: "# Payments\n\nNever retry.\n" } : d,
);
const preview = mergeArchitectureImport(
  local,
  incoming("# Payments\n\nRetry three times.\n"),
  source,
  "refresh",
  { collectConflicts: true },
);
const conflict = preview.conflicts[0];
const both = mergeArchitectureImport(
  local,
  incoming("# Payments\n\nRetry three times.\n"),
  source,
  "refresh",
  {
    resolutions: [
      {
        path: conflict.path,
        localHash: conflict.localHash,
        incomingHash: conflict.incomingHash,
        choice: "keep-both",
      },
    ],
  },
).documents;
const fork = both.find((d) => d.path.startsWith("imports/"));
const heading = old.entities.find((e) => e.kind === "heading");
const target = heading?.id ?? "document:payments.md";
const plan = (review) => ({
  path: "architecture/plan.json",
  text: JSON.stringify({
    schema: "pymtheg.plan/v1",
    items: [
      {
        ...newPlanItem("R1"),
        title: "Never duplicate a charge",
        acceptance: "One charge",
        links: [{ kind: "depends-on", target }],
        linkReviewRevision: review,
      },
    ],
  }),
});

test("linked local forks disclose upstream changes without changing the chosen link", () => {
  const first = indexArchitecture([...both, plan(old.id)]);
  const issues = openArchitectureWork(first, new Map([[old.id, old]]), both);
  const warning = issues.find((w) => w.kind === "diverged-target");
  assert.ok(warning, JSON.stringify(issues));
  assert.equal(warning.id, "plan:R1");
  assert.equal(warning.target, "document:" + fork.path);
  assert.match(warning.message, /local copy.*payments.md/);
  assert.equal(first.edges.find((e) => e.from === "plan:R1").to, target);
  const reviewed = indexArchitecture([...both, plan(first.id)]);
  assert.equal(
    openArchitectureWork(reviewed, new Map([[first.id, first]]), both).filter(
      (w) => w.kind === "diverged-target",
    ).length,
    0,
  );
  const next = mergeArchitectureImport(
    both,
    incoming("# Payments\n\nRetry five times.\n"),
    source,
    "refresh",
  ).documents;
  const after = indexArchitecture([...next, plan(first.id)]);
  assert.ok(
    openArchitectureWork(after, new Map([[first.id, first]]), next).some(
      (w) => w.kind === "diverged-target",
    ),
  );
  assert.equal(
    next.find((d) => d.path === "payments.md").text,
    "# Payments\n\nNever retry.\n",
  );
  // Projection used by the service must retain the upstream evidence as well.
  const history = projectEvidenceSnapshot(
    first,
    new Set([target, "document:" + fork.path]),
  );
  assert.ok(
    openArchitectureWork(after, new Map([[first.id, history]]), next).some(
      (w) => w.kind === "diverged-target",
    ),
  );
  const removed = mergeArchitectureImport(
    next,
    [],
    source,
    "refresh",
  ).documents;
  const removedIndex = indexArchitecture([...removed, plan(first.id)]);
  assert.ok(
    openArchitectureWork(
      removedIndex,
      new Map([[first.id, first]]),
      removed,
    ).some((w) => w.kind === "diverged-target" && /removed/.test(w.message)),
  );
  const reviewedRemoval = indexArchitecture([
    ...removed,
    plan(removedIndex.id),
  ]);
  assert.equal(
    openArchitectureWork(
      reviewedRemoval,
      new Map([[removedIndex.id, removedIndex]]),
      removed,
    ).filter((w) => w.kind === "diverged-target").length,
    0,
  );
});

test("Studio retains upstream review evidence across saves, refresh and restart", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { StudioService } = await import("../dist/studio/service.js");
  const root = await mkdtemp(join(tmpdir(), "pym-fork-work-"));
  let service = new StudioService(root);
  const signal = new AbortController().signal;
  try {
    let saved = await service.importArchitecture(
      "Initial",
      incoming("# Payments\n\nRetry twice.\n"),
      signal,
      { source, mode: "add" },
    );
    saved = await service.editArchitectureDocument(
      saved.id,
      "payments.md",
      "# Payments\n\nNever retry.\n",
      "Local policy",
      signal,
    );
    const input = {
      documents: incoming("# Payments\n\nRetry three times.\n"),
      source,
      mode: "refresh",
    };
    const pending = await service.previewArchitectureImport(
      "Both copies",
      input,
      signal,
    );
    const conflict = pending.conflicts[0];
    const ready = await service.previewArchitectureImport(
      "Both copies",
      {
        ...input,
        resolutions: [
          {
            path: conflict.path,
            localHash: conflict.localHash,
            incomingHash: conflict.incomingHash,
            choice: "keep-both",
          },
        ],
      },
      signal,
    );
    saved = await service.commitPreparedArchitectureImport(ready.token, signal);
    saved = await service.savePlanItem(
      saved.id,
      {
        ...newPlanItem("R1"),
        title: "Use local payment policy",
        links: [{ kind: "depends-on", target }],
      },
      "Link local policy",
      signal,
    );
    // A newly saved link captures both copies as its review baseline.
    assert.equal(
      (await service.architectureWork(saved.id)).filter(
        (w) => w.kind === "diverged-target",
      ).length,
      0,
    );
    saved = await service.importArchitecture(
      "New upstream",
      incoming("# Payments\n\nRetry five times.\n"),
      signal,
      { source, mode: "refresh" },
    );
    assert.ok(
      (await service.architectureWork(saved.id)).some(
        (w) => w.kind === "diverged-target",
      ),
    );
    await service.close();
    service = new StudioService(root);
    assert.ok(
      (await service.architectureWork(saved.id)).some(
        (w) => w.kind === "diverged-target",
      ),
    );
    const record = await service.architectureRecord(saved.id, "plan:R1");
    saved = await service.savePlanItem(
      saved.id,
      { ...record.data, linkReviewRevision: saved.id },
      "Reviewed upstream; retain local policy",
      signal,
      { document: record.entity.document, originalId: "R1" },
    );
    assert.equal(
      (await service.architectureWork(saved.id)).filter(
        (w) => w.kind === "diverged-target",
      ).length,
      0,
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
