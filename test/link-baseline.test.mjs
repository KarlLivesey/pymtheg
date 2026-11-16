// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { startStudio } from "../dist/studio/server.js";

const signal = new AbortController().signal;
const planPath = "architecture/plan.json";
const item = (id, kind, title, links = [], extra = {}) => ({
  id,
  kind,
  title,
  owner: "w2h",
  status: "accepted",
  detail: "",
  acceptance: kind === "requirement" ? "observable" : "",
  evidence: "",
  evidenceRevision: "",
  links: links.map((target) => ({ kind: "depends-on", target })),
  ...extra,
});
const edit = (id) => ({ document: planPath, originalId: id });
const linkIssues = (issues, id) =>
  issues
    .filter((i) => i.id === "plan:" + id)
    .map(({ kind, linkReview, target, message }) => ({
      kind,
      linkReview,
      target,
      message,
    }));
const neverReviewed = /since this link was added \(never reviewed\)/;
const reviewedText = /since this plan reviewed it/;

async function withService(run) {
  const root = await mkdtemp(join(tmpdir(), "pym-link-baseline-")),
    app = new StudioService(root);
  try {
    await run(app);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
}
const record = async (app, revision, id) =>
  (await app.architectureRecord(revision, "plan:" + id)).data;
const planning = async (app, revision, id) =>
  (await app.architectureRecord(revision, "plan:" + id)).entity.planning;

test("a new linked record saved without acknowledgement has a baseline, never a review", async () =>
  withService(async (app) => {
    const r1 = (
      await app.savePlanItem(
        "",
        item("dec-a", "decision", "Retain keys for 24h"),
        "target",
        signal,
      )
    ).id;
    const r2 = (
      await app.savePlanItem(
        r1,
        item("req-b", "requirement", "Duplicates rejected", ["plan:dec-a"]),
        "new linked record",
        signal,
      )
    ).id;
    const stored = await record(app, r2, "req-b");
    assert.equal(stored.linkReviewRevision, undefined);
    assert.deepEqual(stored.linkBaselines, { "plan:dec-a": r1 });
    const projected = await planning(app, r2, "req-b");
    assert.equal(projected.linkReviewRevision, undefined);
    assert.deepEqual(projected.linkBaselines, { "plan:dec-a": r1 });
    assert.deepEqual(linkIssues(await app.architectureWork(r2), "req-b"), []);

    // The target changes content only: reported as changed since the link was added.
    const r3 = (
      await app.savePlanItem(
        r2,
        item("dec-a", "decision", "Retain keys for 24h", [], {
          detail: "now per tenant",
        }),
        "change target",
        signal,
        edit("dec-a"),
      )
    ).id;
    const changed = linkIssues(await app.architectureWork(r3), "req-b");
    assert.equal(changed.length, 1);
    assert.equal(changed[0].kind, "changed-target");
    assert.equal(changed[0].linkReview, "never-reviewed");
    assert.match(changed[0].message, neverReviewed);
    assert.doesNotMatch(changed[0].message, /reviewed it/);

    // The target is retitled too.
    const r4 = (
      await app.savePlanItem(
        r3,
        item("dec-a", "decision", "Retain keys for 1h", [], {
          detail: "now per tenant",
        }),
        "retitle target",
        signal,
        edit("dec-a"),
      )
    ).id;
    const retitled = linkIssues(await app.architectureWork(r4), "req-b");
    assert.deepEqual(
      retitled.map((i) => [i.kind, i.linkReview]),
      [["retitled-target", "never-reviewed"]],
    );
    assert.match(retitled[0].message, neverReviewed);

    // A save without acknowledgement (title edit) keeps the original baseline.
    const r5 = (
      await app.savePlanItem(
        r4,
        { ...stored, title: "Duplicates are rejected" },
        "edit without review",
        signal,
        edit("req-b"),
      )
    ).id;
    const kept = await record(app, r5, "req-b");
    assert.equal(kept.linkReviewRevision, undefined);
    assert.deepEqual(kept.linkBaselines, { "plan:dec-a": r1 });
    assert.equal(
      linkIssues(await app.architectureWork(r5), "req-b")[0].linkReview,
      "never-reviewed",
    );

    // Pressing "I reviewed these linked targets" records a real review.
    const r6 = (
      await app.savePlanItem(
        r5,
        { ...kept, linkReviewRevision: r5 },
        "review links",
        signal,
        edit("req-b"),
      )
    ).id;
    const reviewed = await record(app, r6, "req-b");
    assert.equal(reviewed.linkReviewRevision, r5);
    assert.equal(reviewed.linkBaselines, undefined);
    assert.equal((await planning(app, r6, "req-b")).linkBaselines, undefined);
    assert.deepEqual(linkIssues(await app.architectureWork(r6), "req-b"), []);

    const r7 = (
      await app.savePlanItem(
        r6,
        item("dec-a", "decision", "Retain keys for 2h", [], {
          detail: "now per tenant",
        }),
        "retitle again",
        signal,
        edit("dec-a"),
      )
    ).id;
    const after = linkIssues(await app.architectureWork(r7), "req-b");
    assert.deepEqual(
      after.map((i) => [i.kind, i.linkReview]),
      [["retitled-target", "reviewed"]],
    );
    assert.match(after[0].message, reviewedText);
    assert.doesNotMatch(after[0].message, /never reviewed/);
  }));

test("a link added by editing an existing record gets a baseline and later target changes are reported", async () =>
  withService(async (app) => {
    const r1 = (
      await app.savePlanItem(
        "",
        item("dec-a", "decision", "Retain keys for 24h"),
        "target",
        signal,
      )
    ).id;
    const r2 = (
      await app.savePlanItem(
        r1,
        item("req-d", "requirement", "Dedup is per tenant"),
        "unlinked record",
        signal,
      )
    ).id;
    assert.equal((await record(app, r2, "req-d")).linkBaselines, undefined);
    const r3 = (
      await app.savePlanItem(
        r2,
        item("req-d", "requirement", "Dedup is per tenant", ["plan:dec-a"]),
        "add link by editing",
        signal,
        edit("req-d"),
      )
    ).id;
    const stored = await record(app, r3, "req-d");
    assert.equal(stored.linkReviewRevision, undefined);
    assert.deepEqual(stored.linkBaselines, { "plan:dec-a": r2 });
    const r4 = (
      await app.savePlanItem(
        r3,
        item("dec-a", "decision", "Retain keys for 1h"),
        "retitle target",
        signal,
        edit("dec-a"),
      )
    ).id;
    const issues = linkIssues(await app.architectureWork(r4), "req-d");
    assert.deepEqual(
      issues.map((i) => [i.kind, i.linkReview, i.target]),
      [["retitled-target", "never-reviewed", "plan:dec-a"]],
    );
    assert.match(issues[0].message, neverReviewed);
  }));

test("a link saved with no base revision gets a baseline at the current head", async () =>
  withService(async (app) => {
    const r1 = (
      await app.savePlanItem(
        "",
        item("dec-a", "decision", "Retain keys for 24h"),
        "target",
        signal,
      )
    ).id;
    const r2 = (
      await app.savePlanItem(
        "",
        item("req-c", "requirement", "Duplicates are counted", ["plan:dec-a"]),
        "no base revision",
        signal,
      )
    ).id;
    const stored = await record(app, r2, "req-c");
    assert.equal(stored.linkReviewRevision, undefined);
    assert.deepEqual(stored.linkBaselines, { "plan:dec-a": r1 });
    const r3 = (
      await app.savePlanItem(
        r2,
        item("dec-a", "decision", "Retain keys for 24h", [], {
          detail: "changed",
        }),
        "change target",
        signal,
        edit("dec-a"),
      )
    ).id;
    const issues = linkIssues(await app.architectureWork(r3), "req-c");
    assert.deepEqual(
      issues.map((i) => [i.kind, i.linkReview]),
      [["changed-target", "never-reviewed"]],
    );
  }));

test("a link added after a review is tracked separately from the reviewed links", async () =>
  withService(async (app) => {
    let rev = (
      await app.savePlanItem(
        "",
        item("dec-a", "decision", "Alpha"),
        "a",
        signal,
      )
    ).id;
    rev = (
      await app.savePlanItem(
        rev,
        item("dec-c", "decision", "Gamma"),
        "c",
        signal,
      )
    ).id;
    const reviewedAt = (
      await app.savePlanItem(
        rev,
        item("req-r", "requirement", "Reviewed", ["plan:dec-a"], {
          linkReviewRevision: rev,
        }),
        "explicitly reviewed record",
        signal,
      )
    ).id;
    const explicit = await record(app, reviewedAt, "req-r");
    assert.equal(explicit.linkReviewRevision, rev);
    assert.equal(explicit.linkBaselines, undefined);
    const added = (
      await app.savePlanItem(
        reviewedAt,
        {
          ...explicit,
          links: [
            ...explicit.links,
            { kind: "depends-on", target: "plan:dec-c" },
          ],
        },
        "add a second link",
        signal,
        edit("req-r"),
      )
    ).id;
    const stored = await record(app, added, "req-r");
    assert.equal(stored.linkReviewRevision, rev);
    assert.deepEqual(stored.linkBaselines, { "plan:dec-c": reviewedAt });
    rev = (
      await app.savePlanItem(
        added,
        item("dec-a", "decision", "Alpha 2"),
        "a2",
        signal,
        edit("dec-a"),
      )
    ).id;
    rev = (
      await app.savePlanItem(
        rev,
        item("dec-c", "decision", "Gamma 2"),
        "c2",
        signal,
        edit("dec-c"),
      )
    ).id;
    const issues = linkIssues(await app.architectureWork(rev), "req-r");
    assert.deepEqual(
      issues.map((i) => [i.kind, i.target, i.linkReview]).sort(),
      [
        ["retitled-target", "plan:dec-a", "reviewed"],
        ["retitled-target", "plan:dec-c", "never-reviewed"],
      ],
    );
  }));

test("Studio HTTP API stores a baseline, not a review, and source review stays strict", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pym-link-baseline-http-"));
  await writeFile(join(dir, "main.pym"), "op touch() -> Unit;\n");
  const studio = await startStudio({ path: dir, assets: dir });
  const base = new URL(studio.url).origin;
  const call = async (method, path, body) => {
    const r = await fetch(base + path, {
      method,
      headers: {
        authorization: "Bearer " + studio.token,
        "content-type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  };
  const save = async (revision, it, target) => {
    const r = await call("POST", "/api/architecture/plan", {
      revision,
      item: it,
      label: "w2h " + it.id,
      ...(target ? { target } : {}),
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.id;
  };
  const plan = async (rev) =>
    JSON.parse(
      (
        await call(
          "GET",
          `/api/architecture/document?revision=${rev}&path=${planPath}`,
        )
      ).body.text,
    ).items;
  try {
    const r1 = await save("", item("dec-a", "decision", "Retain keys for 24h"));
    const r2 = await save(
      r1,
      item("req-b", "requirement", "Duplicates rejected", ["plan:dec-a"]),
    );
    const reqB = (await plan(r2)).find((i) => i.id === "req-b");
    assert.equal(reqB.linkReviewRevision, undefined);
    assert.deepEqual(reqB.linkBaselines, { "plan:dec-a": r1 });
    const r3 = await save(
      r2,
      item("dec-a", "decision", "Retain keys for 1h"),
      edit("dec-a"),
    );
    const work = (await call("GET", `/api/architecture/work?revision=${r3}`))
      .body;
    const issues = linkIssues(work, "req-b");
    assert.deepEqual(
      issues.map((i) => [i.kind, i.linkReview]),
      [["retitled-target", "never-reviewed"]],
    );
    assert.match(issues[0].message, neverReviewed);

    // Source links: unchanged behaviour, and a forged review snapshot is refused.
    const page = (
      await call(
        "GET",
        "/api/architecture/source-contracts?q=&offset=0&limit=20",
      )
    ).body;
    const target = (
      JSON.stringify(page).match(/source:[^"]+#[A-Za-z_]\w*/g) ?? []
    ).find((i) => i.endsWith("#touch"));
    assert.ok(target, JSON.stringify(page).slice(0, 300));
    const r4 = await save(
      r3,
      item("req-s", "requirement", "Touch is called", [target]),
    );
    const reqS = (await plan(r4)).find((i) => i.id === "req-s");
    assert.equal(reqS.linkBaselines, undefined);
    assert.equal(reqS.linkReviewRevision, undefined);
    assert.ok(reqS.sourceRoots?.[target]);
    const forged = await call("POST", "/api/architecture/plan", {
      revision: r4,
      item: { ...reqS, sourceReviewSnapshot: "never-shown" },
      label: "forged",
      target: edit("req-s"),
    });
    assert.equal(forged.status, 409);
    assert.match(forged.body.error, /source choices expired/);
  } finally {
    await studio.close();
    await rm(dir, { recursive: true, force: true });
  }
});
