// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash, json } from "../dist/shared/identity.js";
import {
  retainObservation,
  readImplementation,
  bindImplementation,
  compareImplementation,
  bindingsPath,
} from "../dist/implementation/workspace.js";
import { queryImplementationComparison } from "../dist/implementation/query-runner.js";
import { compareImplementationLink } from "../dist/implementation/comparison.js";
import { startStudio } from "../dist/studio/server.js";
const graph = (text) =>
  observeTypescript([{ path: "main.ts", text, hash: hash(text) }], {
    label: "Code",
    gitCommit: null,
    dirty: true,
  });
const before =
  "function close() {}\nfunction send() {}\nexport function run() { send(); close(); }\nexport function other() {}";
const after =
  "function close() {}\nfunction send() {}\nexport function run() { send(); send(); }\nexport function other() { send(); }";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pym-code-review-"));
  const store = await ArchitectureStore.open(root);
  const plan = store.save("Plan", "fixture", [
    {
      path: "plan.json",
      text: json({
        schema: "pymtheg.plan/v1",
        items: [
          {
            ...newPlanItem("R1"),
            title: "Send and clean up",
            acceptance: "one send and one close",
          },
        ],
      }),
    },
  ]);
  const code = await retainObservation(
    store,
    graph(before),
    plan.id,
    new AbortController().signal,
  );
  for (const name of ["run", "other"]) {
    const state = await readImplementation(store),
      row = compareImplementation(state, state)[0];
    await bindImplementation(
      store,
      {
        revision: state.index.id,
        planId: row.id,
        planHash: row.planHash,
        nodeId: state.graph.nodes.find((n) => n.name === name).id,
        observationId: state.graph.snapshotId,
        note: "Keep " + name,
      },
      new AbortController().signal,
    );
  }
  const linked = await readImplementation(store);
  await retainObservation(
    store,
    graph(after),
    linked.index.id,
    new AbortController().signal,
  );
  const state = await readImplementation(store);
  const query = {
    planRevision: state.index.id,
    codeRevision: state.index.id,
    planId: "plan:R1",
    nodeId: state.graph.nodes.find((n) => n.name === "run").id,
    offset: 0,
    limit: 20,
  };
  return { root, store, state, query, code };
}
test("compares exact retained source and repeated call sites; one review preserves the other warning", async () => {
  const f = await fixture();
  try {
    const baseline = await readImplementation(
      f.store,
      f.state.bindings[0].reviewedRevision,
    );
    const result = compareImplementationLink(
      f.state,
      f.state,
      baseline,
      f.query,
      null,
    );
    assert.match(
      result.source.entries
        .filter((e) => e.kind === "removed")
        .map((e) => e.text)
        .join("\n"),
      /close\(\)/,
    );
    assert.deepEqual(
      result.relationships.items.map((i) => [
        i.target,
        i.beforeCount,
        i.afterCount,
      ]),
      [
        ["close", 1, 0],
        ["send", 1, 2],
      ],
    );
    assert.equal(result.before.sourceHash, hash(before));
    assert.equal(result.after.sourceHash, hash(after));
    assert.equal(result.before.fileHash, result.before.sourceHash);
    assert.equal(result.after.fileHash, result.after.sourceHash);
    assert.equal(result.note, "Keep run");
    await bindImplementation(
      f.store,
      {
        revision: f.state.index.id,
        planId: f.query.planId,
        nodeId: f.query.nodeId,
        planHash: result.planHash,
        observationId: result.after.observationId,
        note: result.note,
      },
      new AbortController().signal,
    );
    const accepted = await readImplementation(f.store);
    const row = compareImplementation(accepted, accepted)[0];
    assert.equal(row.status, "code-changed");
    assert.equal(
      row.codeLinks.find((c) => c.nodeId === f.query.nodeId).status,
      "body-present",
    );
    assert.equal(
      row.codeLinks.find((c) => c.nodeId !== f.query.nodeId).status,
      "code-changed",
    );
    assert.equal(
      accepted.bindings.find((b) => b.nodeId === f.query.nodeId).note,
      "Keep run",
    );
    await assert.rejects(
      bindImplementation(
        f.store,
        {
          revision: f.state.index.id,
          planId: f.query.planId,
          nodeId: f.query.nodeId,
          planHash: result.planHash,
          observationId: result.after.observationId,
          note: result.note,
        },
        new AbortController().signal,
      ),
      /Architecture changed/,
    );
  } finally {
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
test("legacy, absent, inconsistent and stale baselines never report unchanged", async () => {
  const f = await fixture();
  try {
    for (const reason of [
      "Legacy link has no review checkpoint.",
      "Retained checkpoint is unavailable.",
    ]) {
      const result = compareImplementationLink(
        f.state,
        f.state,
        null,
        f.query,
        reason,
      );
      assert.equal(result.source, null);
      assert.equal(result.relationships, null);
      assert.equal(result.before.available, false);
      assert.equal(result.before.reason, reason);
      assert.equal(result.after.available, true);
    }
    const mismatched = compareImplementationLink(
      f.state,
      f.state,
      f.state,
      f.query,
      null,
    );
    assert.equal(mismatched.source, null);
    assert.match(mismatched.before.reason, /does not match/);
    const stale = {
      ...f.state,
      graph: { ...f.state.graph, staleFiles: ["main.ts"] },
    };
    assert.equal(
      compareImplementationLink(f.state, stale, null, f.query, "Unavailable")
        .after.available,
      false,
    );
    const missing = { ...f.state, graph: graph("export function moved() {}") };
    assert.match(
      compareImplementationLink(f.state, missing, null, f.query, "Unavailable")
        .after.reason,
      /absent/,
    );
  } finally {
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});
test("comparison HTTP is read-only and retains explicit legacy limits", async () => {
  const f = await fixture();
  let app;
  try {
    const documents = f.state.documents.map((d) =>
      d.path === bindingsPath
        ? {
            ...d,
            text: json({
              schema: "pymtheg.implementation-links/v1",
              bindings: f.state.bindings.map(
                ({ reviewedRevision, ...binding }) => binding,
              ),
            }),
          }
        : d,
    );
    const legacy = f.store.save("Legacy links", "fixture", documents);
    f.store.close();
    const db = join(f.root, ".pymtheg/shared/architecture.sqlite");
    const old = await readFile(db);
    app = await startStudio({ path: f.root });
    const query = {
      ...f.query,
      planRevision: legacy.id,
      codeRevision: legacy.id,
    };
    const response = await fetch(
      new URL("/api/implementation/compare", app.url),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + app.token,
        },
        body: JSON.stringify(query),
      },
    );
    // Use the same session token transport as the browser.
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.equal(result.reviewAllowed, true);
    assert.equal(result.source, null);
    assert.match(result.before.reason, /legacy/i);
    assert.deepEqual(await readFile(db), old);
  } finally {
    await app?.close();
    try {
      f.store.close();
    } catch {}
    await rm(f.root, { recursive: true, force: true });
  }
});
test("comparison uses cancellable worker and rejects malformed worker evidence", async () => {
  const f = await fixture();
  try {
    const baseline = await readImplementation(
      f.store,
      f.state.bindings[0].reviewedRevision,
    );
    const snapshot = (s) => ({ index: s.index, documents: s.documents });
    const result = await queryImplementationComparison(
      snapshot(f.state),
      snapshot(f.state),
      snapshot(baseline),
      f.query,
      null,
      f.state.index.id,
      new AbortController().signal,
    );
    assert.equal(result.source.complete, true);
    const controller = new AbortController();
    const workerURL = new URL(
      "data:text/javascript," +
        encodeURIComponent(
          'import {parentPort} from "node:worker_threads";parentPort.postMessage({kind:"ready"});while(true){}',
        ),
    );
    await assert.rejects(
      queryImplementationComparison(
        snapshot(f.state),
        null,
        null,
        f.query,
        null,
        f.state.index.id,
        controller.signal,
        { workerURL, onReady: () => controller.abort() },
      ),
      /cancelled/,
    );
    const bad = new URL(
      "data:text/javascript," +
        encodeURIComponent(
          'import {parentPort} from "node:worker_threads";parentPort.postMessage({result:{source:{equal:true}}});',
        ),
    );
    await assert.rejects(
      queryImplementationComparison(
        snapshot(f.state),
        null,
        null,
        f.query,
        null,
        f.state.index.id,
        new AbortController().signal,
        { workerURL: bad },
      ),
      /invalid|expected/i,
    );
  } finally {
    f.store.close();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("bounded comparison working graph preserves cycles, fingerprints and complete comparison output", async () => {
  const { comparisonWorkingGraph } = await import(
    "../dist/implementation/comparison.js"
  );
  const { dependencyHashes, dependencyChanges } = await import(
    "../dist/implementation/dependencies.js"
  );
  const texts = [
    "const MAX=7;function a(){return b()}function b(){return a()+MAX}export function run(){return a()}function unrelated(){return 99}",
    "const MAX=8;function a(){return b()}function b(){return a()+MAX}export function run(){return a()}function unrelated(){return 99}",
  ];
  const [old, current] = texts.map(graph);
  for (const original of [old, current]) {
    const expected = dependencyHashes(original);
    for (const node of original.nodes) {
      const working = comparisonWorkingGraph(original, node.id);
      assert.equal(
        dependencyHashes(working).get(node.id),
        expected.get(node.id),
      );
      assert.deepEqual(
        working.edges.filter((e) => e.from === node.id),
        original.edges.filter((e) => e.from === node.id),
      );
    }
  }
  const id = current.nodes.find((n) => n.name === "run").id;
  assert.deepEqual(
    dependencyChanges(
      comparisonWorkingGraph(old, id),
      comparisonWorkingGraph(current, id),
      id,
    ),
    dependencyChanges(old, current, id),
  );
  const f = await fixture();
  try {
    const baseline = await readImplementation(
      f.store,
      f.state.bindings[0].reviewedRevision,
    );
    const whole = compareImplementationLink(
      f.state,
      f.state,
      baseline,
      f.query,
      null,
    );
    const code = {
      ...f.state,
      graph: comparisonWorkingGraph(f.state.graph, f.query.nodeId),
    };
    const before = {
      ...baseline,
      graph: comparisonWorkingGraph(baseline.graph, f.query.nodeId),
    };
    assert.deepEqual(
      compareImplementationLink(f.state, code, before, f.query, null),
      whole,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("comparison worker reuses exact documents, validates distinct same-ID inputs, and cannot raise the memory cap", async () => {
  const f = await fixture();
  try {
    const { readImplementationDocuments } = await import(
      "../dist/implementation/workspace.js"
    );
    const code = await readImplementationDocuments(f.store);
    const samples = [];
    await queryImplementationComparison(
      code,
      code,
      structuredClone(code),
      f.query,
      null,
      code.index.id,
      new AbortController().signal,
      { onWorkingSet: (s) => samples.push(s), memoryLimitMb: 256 },
    );
    assert.equal(samples.at(-1).decodedGraphs, 1);
    const baseline = await readImplementationDocuments(
      f.store,
      f.state.bindings[0].reviewedRevision,
    );
    baseline.index = code.index; // Deliberately equal IDs, different valid observations.
    const distinctSamples = [];
    const distinct = await queryImplementationComparison(
      code,
      code,
      baseline,
      f.query,
      null,
      code.index.id,
      new AbortController().signal,
      { onWorkingSet: (s) => distinctSamples.push(s) },
    );
    assert.equal(distinctSamples.at(-1).decodedGraphs, 2);
    assert.equal(distinct.source.equal, false);
    // Equal catalogue/revision IDs alone must not conceal a corrupted part.
    const corrupt = structuredClone(code);
    const part = corrupt.documents.find((d) =>
      d.path.startsWith(".pymtheg-code-parts/"),
    );
    part.text += " ";
    await assert.rejects(
      queryImplementationComparison(
        code,
        code,
        corrupt,
        f.query,
        null,
        code.index.id,
        new AbortController().signal,
      ),
      /does not match/,
    );
    assert.throws(
      () =>
        queryImplementationComparison(
          code,
          code,
          code,
          f.query,
          null,
          code.index.id,
          new AbortController().signal,
          { memoryLimitMb: 513 },
        ),
      /64 and 512/,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
