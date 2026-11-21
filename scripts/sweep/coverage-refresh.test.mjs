// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { auditRange, combineLabels, firstBlocker, itemRange, missColumns, overlayInstalled, pairedRepos, proportionalQuotas, score, storedReasons } from "./coverage-refresh-data.mjs";

test("multiple stored reasons count the first blocker and preserve secondary reasons", () => {
  const fixture = JSON.parse(readFileSync(new URL("fixtures/protobuf-open-call.json", import.meta.url), "utf8"));
  const goReasons = storedReasons(fixture.data);
  assert.deepEqual(goReasons, ["external-implementers-possible", "structural-match-unverified"]);
  assert.equal(firstBlocker(goReasons, fixture.outcome), "external-implementers-possible");
  const reasons = storedReasons({ reason: "incomplete-config", uncertainty: "missing-type; missing-binding",
    reasonWithoutConfig: "missing-binding", open: { reason: "open", reasons: ["open", "other"] } });
  assert.deepEqual(reasons, ["incomplete-config", "open", "other", "missing-type", "missing-binding"]);
  assert.equal(firstBlocker(reasons, "unresolved"), "incomplete-config");
  assert.equal(firstBlocker([], "library"), "(unit only)");
  assert.equal(firstBlocker([], "unresolved"), "(no reason)");
});

test("a proportional sample uses exact quotas and stable ties", () => {
  assert.deepEqual([...proportionalQuotas([{ reason: "z", count: 3 }, { reason: "a", count: 3 },
    { reason: "b", count: 14 }], 10)], [["a", 2], ["z", 1], ["b", 7]]);
  assert.deepEqual([...proportionalQuotas([], 150)], []);
});

test("installed mode uses scored installs and retains bare observations across languages", () => {
  const bare = [{ id: "ts/one", language: "typescript", counts: { go: { links: 2, level2: 1, assumed: 0 } } },
    { id: "go/one", language: "go", counts: { go: { links: 4, level2: 3, assumed: 1 } } },
    { id: "ts/two", language: "typescript", counts: { go: { links: 5, level2: 4, assumed: 1 } } }];
  const installed = [{ id: "ts/one", language: "typescript", install: { status: "installed" },
    counts: { go: { links: 2, level2: 2, assumed: 0 } } }, { id: "ts/two", install: { status: "failed" } }];
  const paired = pairedRepos(bare, installed, "installed");
  assert.deepEqual(score(paired, "go"), { links: 11, level2: 9, assumed: 2 });
  assert.deepEqual(score(paired, "go", true), { links: 4, level2: 3, assumed: 1 });
  assert.equal(paired[2], bare[2]);
});

test("an installed replay replaces only its pinned receipt and keeps both build identities", () => {
  const commit = "a".repeat(40);
  const old = { id: "ts/one", language: "typescript", commit, outcome: "install-unavailable" };
  const other = { ...old, id: "ts/two", outcome: "finished" };
  const original = { sha256: "b".repeat(64), node: "v24.10.0" };
  const release = { sha256: "c".repeat(64), node: "v24.21.0" };
  const modes = { bare: { release: original }, installed: { release: original, repos: [old, other] } };
  const rerun = { ...old, outcome: "finished", install: { status: "installed" } };
  const replay = { mode: "installed", missColumns, release, repos: [rerun] };
  const measuredCommit = "d".repeat(40);
  assert.deepEqual(overlayInstalled(modes, replay, measuredCommit), {
    ...modes, installed: { release: original, repos: [{ ...rerun, measuredCommit, build: release }, other] },
  });
  assert.throws(() => overlayInstalled(modes, { ...replay, repos: [{ ...rerun, commit: measuredCommit }] }, measuredCommit),
    /Unexpected installed replay attempt/);
});

test("missing review labels cannot be treated as reviewed samples", () => {
  const samples = [{ rank: "one" }, { rank: "two" }];
  assert.throws(() => combineLabels(samples, new Map([["one", { itemAnswer: "yes" }]])), /label every drawn link/);
  const full = combineLabels(samples, new Map([["one", { itemAnswer: "yes" }], ["two", { itemAnswer: "unknown" }]]));
  assert.deepEqual(itemRange(2, full), [1, 2]);
  assert.deepEqual(itemRange(2, []), [0, 2]);
});

test("ceiling bounds retain unread or unrepresented observations", () => {
  const samples = [{ reasons: ["one"], outcome: "unresolved", staticAnswer: "none" },
    { reasons: ["one"], outcome: "unresolved", staticAnswer: "unknown" }];
  const result = auditRange([{ reason: "one", count: 2 }, { reason: "two", count: 2 }], samples, ["none"]);
  assert.deepEqual(result.interval, [0.25, 1]);
  assert.deepEqual(result.observed, [0.25, 1]);
});
