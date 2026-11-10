import { relationshipText } from "../dist/architecture/headings.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { prepareHeadingIdentities } from "../dist/architecture/heading-identities.js";
import { indexArchitecture } from "../dist/architecture/model.js";
import {
  projectEvidenceSnapshot,
  openArchitectureWork,
} from "../dist/architecture/work.js";
import { proposeContractChange } from "../dist/architecture/planning.js";
const signal = new AbortController().signal;
test("retitled linked heading asks for review; explicit acknowledgement preserves original proposal provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-retitle-review-")),
    app = new StudioService(root);
  try {
    const baseline = await app.importArchitecture(
      "Original architecture",
      [
        {
          path: "decision.md",
          text: "## Write ahead log {#storage}\nUse WAL.",
        },
      ],
      signal,
    );
    const heading = baseline.entities.find((e) => e.kind === "heading");
    const proposal = {
      ...proposeContractChange("D1", heading, baseline.id),
      title: "Adopt WAL",
      status: "accepted",
    };
    const planned = await app.savePlanItem(
      baseline.id,
      proposal,
      "Accept WAL",
      signal,
    );
    assert.deepEqual(await app.architectureWork(planned.id), []);
    const changed = await app.editArchitectureDocument(
      planned.id,
      "decision.md",
      "## Separate journal {#storage}\nUse a separate journal.",
      "Change storage",
      signal,
    );
    const issues = await app.architectureWork(changed.id);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, "retitled-target");
    assert.equal(issues[0].target, heading.id);
    assert.match(issues[0].message, /Write ahead log/);
    assert.match(issues[0].message, /Separate journal/);
    const accepted = await app.savePlanItem(
      changed.id,
      { ...proposal, linkReviewRevision: changed.id },
      "Review linked title",
      signal,
      { document: "architecture/plan.json", originalId: "D1" },
    );
    assert.deepEqual(await app.architectureWork(accepted.id), []);
    const record = await app.architectureRecord(accepted.id, "plan:D1");
    assert.equal(record.data.originRevision, baseline.id);
    assert.equal(record.data.linkReviewRevision, changed.id);
    const newer = await app.editArchitectureDocument(
      accepted.id,
      "decision.md",
      "## Journal with fsync {#storage}\nUse a separate journal.",
      "Another rename",
      signal,
    );
    assert.ok(
      (await app.architectureWork(newer.id)).some(
        (i) => i.kind === "retitled-target",
      ),
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("unchanged heading titles still require relationship review after subsection content changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-content-link-review-")),
    app = new StudioService(root);
  try {
    const base = await app.importArchitecture(
      "Durability",
      [
        {
          path: "design.md",
          text: "## NFR-7 Durability\n### Acknowledgement\nfsync before ack",
        },
      ],
      signal,
    );
    const heading = base.entities.find(
      (e) => e.kind === "heading" && e.name.includes("NFR-7"),
    );
    const proposal = {
      ...proposeContractChange("D1", heading, base.id),
      status: "accepted",
      title: "Use durable writes",
    };
    const planned = await app.savePlanItem(
      base.id,
      proposal,
      "Accept durability",
      signal,
    );
    const changed = await app.editArchitectureDocument(
      planned.id,
      "design.md",
      "## NFR-7 Durability\n### Acknowledgement\nNO fsync",
      "Relax durability",
      signal,
    );
    const issues = await app.architectureWork(changed.id);
    assert.ok(
      issues.some(
        (i) => i.kind === "changed-target" && i.target === heading.id,
      ),
    );
    const reviewed = await app.savePlanItem(
      changed.id,
      { ...proposal, linkReviewRevision: changed.id },
      "Review relationship",
      signal,
      { document: "architecture/plan.json", originalId: "D1" },
    );
    assert.deepEqual(await app.architectureWork(reviewed.id), []);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a moved linked target retains the reviewed identity and reports its old and new paths", () => {
  const original = {
    path: "ops.md",
    text: "## Backups\nKeep daily backups.\n",
  };
  const baseline = indexArchitecture(prepareHeadingIdentities([], [original]));
  const target = baseline.entities.find((e) => e.kind === "heading");
  const plan = {
    path: "architecture/plan.json",
    text: JSON.stringify({
      schema: "pymtheg.plan/v1",
      items: [
        {
          ...proposeContractChange("D1", target, baseline.id),
          status: "accepted",
        },
      ],
    }),
  };
  const next = indexArchitecture(
    prepareHeadingIdentities(
      [original],
      [
        { ...original, path: "legacy/ops.md" },
        { path: "ops.md", text: "## Backups\nNo backups; rely on replicas.\n" },
        plan,
      ],
    ),
  );
  const issues = openArchitectureWork(
    next,
    new Map([
      [baseline.id, projectEvidenceSnapshot(baseline, new Set([target.id]))],
    ]),
  );
  const moved = issues.find((i) => i.kind === "moved-target");
  assert.ok(moved);
  assert.match(moved.message, /from ops.md to legacy\/ops.md/);
  assert.equal(
    issues.some((i) => i.kind === "changed-target"),
    false,
  );
});

test("surplus prose separators do not demand relationship review; code and words remain sensitive", () => {
  const source = "## Policy\nKeep backups.\n\nReview restores.\n";
  const baseline = indexArchitecture([{ path: "ops.md", text: source }]);
  const target = baseline.entities.find((e) => e.kind === "heading");
  const plan = {
    path: "plan.json",
    text: JSON.stringify({
      schema: "pymtheg.plan/v1",
      items: [
        {
          ...proposeContractChange("D1", target, baseline.id),
          status: "accepted",
        },
      ],
    }),
  };
  const history = new Map([
    [baseline.id, projectEvidenceSnapshot(baseline, new Set([target.id]))],
  ]);
  const spaced = indexArchitecture(
    prepareHeadingIdentities(
      [{ path: "ops.md", text: source }],
      [{ path: "ops.md", text: source.replace("\n\n", "\n\n\n") }, plan],
    ),
  );
  assert.equal(
    openArchitectureWork(spaced, history).some(
      (i) => i.kind === "changed-target",
    ),
    false,
  );
  const changed = indexArchitecture(
    prepareHeadingIdentities(
      [{ path: "ops.md", text: source }],
      [
        {
          path: "ops.md",
          text: source.replace("Keep backups.", "Do not keep backups."),
        },
        plan,
      ],
    ),
  );
  assert.equal(
    openArchitectureWork(changed, history).some(
      (i) => i.kind === "changed-target",
    ),
    true,
  );
});

test("relationship separator normalization retains code and HTML whitespace exactly", () => {
  for (const text of [
    "```\nleft\n\n\nright\n```",
    "<pre>\nleft\n\n\nright\n</pre>",
    "    code\n\n\n    value",
  ])
    assert.equal(relationshipText(text), text);
});

test("relationship review ignores prose line endings, trailing spaces and soft wraps but preserves code structure", () => {
  const original = "# Backups\n\nKeep nightly full backups for thirty days.\n";
  for (const formatted of [
    original.replaceAll("\n", "\r\n"),
    original.replace("days.", "days. ") + "\n",
    original.replace("full backups", "full\nbackups"),
  ])
    assert.equal(relationshipText(formatted), relationshipText(original));
  assert.notEqual(
    relationshipText("# Data\n\n```yaml\na:\n  b: 1\n```"),
    relationshipText("# Data\n\n```yaml\na:\nb: 1\n```"),
  );
});

test("target comparison shows changed lines and bounds retained text", async () => {
  const { textChange } = await import("../dist/architecture/text-change.js");
  assert.deepEqual(
    textChange("# Backups\nkeep 30 days\nend", "# Backups\nkeep 60 days\nend"),
    {
      line: 2,
      removed: ["keep 30 days"],
      added: ["keep 60 days"],
      truncated: false,
    },
  );
  assert.equal(
    textChange("x".repeat(13000), "y".repeat(13000)).truncated,
    true,
  );
});

test("mixed line-ending and code edits highlight only the changed code line", async () => {
  const { linkedTextChange } = await import(
    "../dist/architecture/text-change.js"
  );
  const before = "## Requests\n```yaml\nretries: 3\n```\n";
  const after = before
    .replace("retries: 3", "retries: 0")
    .replaceAll("\n", "\r\n");
  assert.deepEqual(linkedTextChange(before, after), {
    line: 3,
    removed: ["retries: 3"],
    added: ["retries: 0"],
    truncated: false,
    lineEndingsNormalized: true,
  });
});
