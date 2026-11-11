import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StudioService } from "../dist/studio/service.js";
import { indexArchitecture } from "../dist/architecture/model.js";
import { openArchitectureWork } from "../dist/architecture/work.js";
import { linkComparisonBase } from "../dist/architecture/schema.js";

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
const issuesFor = (issues, id) =>
  issues
    .filter((i) => i.id === "plan:" + id)
    .map(({ kind, linkReview, target, message }) => ({
      kind,
      linkReview,
      target,
      message,
    }));
async function withService(run) {
  const root = await mkdtemp(join(tmpdir(), "pym-link-guards-")),
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
const save = async (app, revision, it, target) =>
  (await app.savePlanItem(revision, it, "w2h " + it.id, signal, target)).id;

test("a new link to a target absent from a stale base revision is refused, never left untrackable", async () =>
  withService(async (app) => {
    const r1 = await save(app, "", item("seed", "decision", "Seed"));
    const r2 = await save(app, r1, item("new-target", "decision", "Alpha"));
    await assert.rejects(
      save(
        app,
        r1,
        item("req", "requirement", "Uses alpha", ["plan:new-target"]),
      ),
      (error) =>
        error.status === 409 &&
        /not in the revision this edit started from/.test(error.message),
    );
    // Refreshed context: the base contains the target, so it is the baseline.
    const r3 = await save(
      app,
      r2,
      item("req", "requirement", "Uses alpha", ["plan:new-target"]),
    );
    assert.deepEqual((await record(app, r3, "req")).linkBaselines, {
      "plan:new-target": r2,
    });
    const r4 = await save(
      app,
      r3,
      item("new-target", "decision", "Beta"),
      edit("new-target"),
    );
    assert.deepEqual(
      issuesFor(await app.architectureWork(r4), "req").map((i) => [
        i.kind,
        i.linkReview,
      ]),
      [["retitled-target", "never-reviewed"]],
    );
  }));

test("a target that existed at the base and changed before the save is still reported", async () =>
  withService(async (app) => {
    const r1 = await save(app, "", item("dec", "decision", "Alpha"));
    const r2 = await save(
      app,
      r1,
      item("dec", "decision", "Beta"),
      edit("dec"),
    );
    // Stale base r1: the target existed there, so r1 is the conservative baseline.
    const r3 = await save(
      app,
      r1,
      item("req", "requirement", "Uses dec", ["plan:dec"]),
    );
    assert.deepEqual((await record(app, r3, "req")).linkBaselines, {
      "plan:dec": r1,
    });
    assert.ok(r2);
    assert.deepEqual(
      issuesFor(await app.architectureWork(r3), "req").map((i) => i.kind),
      ["retitled-target"],
    );
  }));

test("a review revision that does not contain the target reports comparison unavailable", async () =>
  withService(async (app) => {
    const r1 = await save(app, "", item("seed", "decision", "Seed"));
    const r2 = await save(app, r1, item("dec", "decision", "Alpha"));
    const r3 = await save(
      app,
      r2,
      item("req", "requirement", "Uses dec", ["plan:dec"]),
    );
    // An existing revision, but one where the target did not exist yet.
    const r4 = await save(
      app,
      r3,
      { ...(await record(app, r3, "req")), linkReviewRevision: r1 },
      edit("req"),
    );
    const issues = issuesFor(await app.architectureWork(r4), "req");
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, "unknown-link-review");
    assert.equal(issues[0].linkReview, "reviewed");
    assert.equal(issues[0].target, "plan:dec");
    assert.match(issues[0].message, /^Comparison unavailable/);
  }));

test("a baseline revision that does not contain the target reports comparison unavailable", () => {
  const plan = (items) => ({
    path: planPath,
    text: JSON.stringify({ schema: "pymtheg.plan/v1", items }),
  });
  const index = indexArchitecture([
    plan([
      item("dec", "decision", "Alpha"),
      item("req", "requirement", "Uses dec", ["plan:dec"], {
        linkBaselines: { "plan:dec": "older" },
      }),
    ]),
  ]);
  const history = new Map([["older", { id: "older", entities: [] }]]);
  const issues = issuesFor(openArchitectureWork(index, history), "req");
  assert.deepEqual(
    issues.map((i) => [i.kind, i.linkReview, i.target]),
    [["unknown-link-review", "never-reviewed", "plan:dec"]],
  );
  assert.match(issues[0].message, /^Comparison unavailable/);
  assert.match(issues[0].message, /never reviewed/);
});

test("a link review naming a revision the store does not have is refused", async () =>
  withService(async (app) => {
    const r1 = await save(app, "", item("dec", "decision", "Alpha"));
    await assert.rejects(
      save(
        app,
        r1,
        item("req", "requirement", "Uses dec", ["plan:dec"], {
          linkReviewRevision: "bogus",
        }),
      ),
      (error) => error.status === 409 && /does not have/.test(error.message),
    );
    const r2 = await save(
      app,
      r1,
      item("req", "requirement", "Uses dec", ["plan:dec"]),
    );
    await assert.rejects(
      save(
        app,
        r2,
        { ...(await record(app, r2, "req")), linkReviewRevision: "bogus" },
        edit("req"),
      ),
      (error) => error.status === 409,
    );
    const stored = await record(app, r2, "req");
    assert.equal(stored.linkReviewRevision, undefined);
  }));

test("dropping a review gives the links a baseline instead of leaving them untracked", async () =>
  withService(async (app) => {
    const r1 = await save(app, "", item("dec", "decision", "Alpha"));
    const r2 = await save(
      app,
      r1,
      item("req", "requirement", "Uses dec", ["plan:dec"], {
        linkReviewRevision: r1,
      }),
    );
    const reviewed = await record(app, r2, "req");
    assert.equal(reviewed.linkReviewRevision, r1);
    const { linkReviewRevision, ...dropped } = reviewed;
    assert.ok(linkReviewRevision);
    const r3 = await save(app, r2, dropped, edit("req"));
    const stored = await record(app, r3, "req");
    assert.equal(stored.linkReviewRevision, undefined);
    assert.deepEqual(stored.linkBaselines, { "plan:dec": r2 });
    const r4 = await save(
      app,
      r3,
      item("dec", "decision", "Beta"),
      edit("dec"),
    );
    assert.deepEqual(
      issuesFor(await app.architectureWork(r4), "req").map((i) => [
        i.kind,
        i.linkReview,
      ]),
      [["retitled-target", "never-reviewed"]],
    );
  }));

test("reviewing record Y does not make a link to Y report a change; a real change to Y does", async () =>
  withService(async (app) => {
    let rev = await save(app, "", item("z", "decision", "Zed"));
    rev = await save(app, rev, item("y", "decision", "Why", ["plan:z"]));
    rev = await save(app, rev, item("x", "requirement", "Ex", ["plan:y"]));
    assert.deepEqual(issuesFor(await app.architectureWork(rev), "x"), []);
    // Press "I reviewed these linked targets" on Y.
    const y = await record(app, rev, "y");
    assert.ok(y.linkBaselines);
    rev = await save(app, rev, { ...y, linkReviewRevision: rev }, edit("y"));
    const yReviewed = await record(app, rev, "y");
    assert.ok(yReviewed.linkReviewRevision);
    assert.equal(yReviewed.linkBaselines, undefined);
    assert.deepEqual(issuesFor(await app.architectureWork(rev), "x"), []);
    // A real change to Y (its text) is still reported to X.
    rev = await save(
      app,
      rev,
      { ...yReviewed, detail: "now different" },
      edit("y"),
    );
    assert.deepEqual(
      issuesFor(await app.architectureWork(rev), "x").map((i) => [
        i.kind,
        i.target,
      ]),
      [["changed-target", "plan:y"]],
    );
  }));

test("a status change to a linked record is still a change", async () =>
  withService(async (app) => {
    let rev = await save(app, "", item("y", "decision", "Why"));
    rev = await save(app, rev, item("x", "requirement", "Ex", ["plan:y"]));
    rev = await save(
      app,
      rev,
      item("y", "decision", "Why", [], { status: "superseded" }),
      edit("y"),
    );
    assert.deepEqual(
      issuesFor(await app.architectureWork(rev), "x").map((i) => i.kind),
      ["changed-target"],
    );
  }));

test("the editor compares each link with its baseline, review or origin and names it truthfully", () => {
  assert.deepEqual(
    linkComparisonBase({ linkBaselines: { "plan:a": "R1" } }, "plan:a"),
    {
      revision: "R1",
      state: "never-reviewed",
      label: "version when this link was added",
    },
  );
  assert.deepEqual(linkComparisonBase({ linkReviewRevision: "R2" }, "plan:a"), {
    revision: "R2",
    state: "reviewed",
    label: "reviewed version",
  });
  const mixed = {
    linkReviewRevision: "R2",
    originRevision: "R0",
    linkBaselines: { "plan:b": "R3" },
  };
  assert.equal(linkComparisonBase(mixed, "plan:a").revision, "R2");
  assert.equal(linkComparisonBase(mixed, "plan:a").label, "reviewed version");
  assert.equal(linkComparisonBase(mixed, "plan:b").revision, "R3");
  assert.equal(
    linkComparisonBase(mixed, "plan:b").label,
    "version when this link was added",
  );
  assert.deepEqual(linkComparisonBase({ originRevision: "R0" }, "plan:a"), {
    revision: "R0",
    state: "never-reviewed",
    label: "version when this link was added",
  });
  assert.deepEqual(linkComparisonBase({}, "plan:a"), {
    revision: undefined,
    state: "none",
    label: "earlier version",
  });
});
