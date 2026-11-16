// SPDX-License-Identifier: MIT
import {
  decodeObservation,
  observationDocuments,
} from "../dist/implementation/storage.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeTypescript } from "../dist/implementation/typescript.js";
import {
  dependencyHashes,
  dependencyChanges,
} from "../dist/implementation/dependencies.js";
import { hash, json } from "../dist/shared/identity.js";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import {
  retainObservation,
  readImplementation,
  bindImplementation,
  compareImplementation,
} from "../dist/implementation/workspace.js";
import { compareImplementationLink } from "../dist/implementation/comparison.js";
const observe = (text) =>
  observeTypescript([{ path: "a.ts", text, hash: hash(text) }], {
    label: "Dependencies",
    gitCommit: null,
    dirty: true,
  });
const source =
  "const MAX_FEE=5000; const UNRELATED=1; function fee(){return MAX_FEE} export function run(){return fee()}";
test("captured lexical and transitive dependencies detect constants and callees without unrelated-file noise", () => {
  const a = observe(source),
    original = dependencyHashes(a).get("a.ts#function:run");
  for (const replacement of [
    source.replace("5000", "6000"),
    source.replace("return MAX_FEE", "return MAX_FEE+1"),
  ]) {
    const b = observe(replacement);
    assert.notEqual(dependencyHashes(b).get("a.ts#function:run"), original);
    const changes = dependencyChanges(a, b, "a.ts#function:run");
    assert.equal(changes.available, true);
    assert.equal(changes.total, 1);
    assert.ok(changes.items[0].before);
    assert.ok(changes.items[0].after);
  }
  const unrelated = observe(source.replace("UNRELATED=1", "UNRELATED=2"));
  assert.equal(dependencyHashes(unrelated).get("a.ts#function:run"), original);
  const legacy = structuredClone(a);
  delete legacy.dependencyModel;
  assert.equal(dependencyHashes(legacy).size, 0);
  assert.equal(
    dependencyChanges(legacy, a, "a.ts#function:run").available,
    false,
  );
});
test("cyclic observed dependencies are stable under declaration reordering and propagate a changed peer", () => {
  const a = "function a(){return b()} ",
    b = "function b(){return a()} ";
  const first = dependencyHashes(observe(a + b)),
    second = dependencyHashes(observe(b + a));
  assert.deepEqual(first, second);
  const changed = dependencyHashes(observe(a + b.replace("a()", "a()+1")));
  assert.notEqual(first.get("a.ts#function:a"), changed.get("a.ts#function:a"));
});
test("dependency drift persists, compares actual retained source and clears only on explicit link review", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-dependency-review-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const initial = store.save("Plan", "fixture", [
      {
        path: "plan.json",
        text: json({
          schema: "pymtheg.plan/v1",
          items: [{ ...newPlanItem("R1"), title: "Fee cap" }],
        }),
      },
    ]);
    await retainObservation(
      store,
      observe(source),
      initial.id,
      new AbortController().signal,
    );
    let state = await readImplementation(store),
      row = compareImplementation(state, state)[0];
    const link = () => ({
      revision: state.index.id,
      planId: row.id,
      planHash: row.planHash,
      nodeId: "a.ts#function:run",
      observationId: state.graph.snapshotId,
      note: "Cap fee",
    });
    await bindImplementation(store, link(), new AbortController().signal);
    state = await readImplementation(store);
    const baseline = state;
    await retainObservation(
      store,
      observe(source.replace("5000", "6000")),
      state.index.id,
      new AbortController().signal,
    );
    state = await readImplementation(store);
    row = compareImplementation(state, state)[0];
    assert.deepEqual(row.statuses, ["dependency-changed"]);
    const comparison = compareImplementationLink(
      state,
      state,
      baseline,
      {
        planId: row.id,
        nodeId: "a.ts#function:run",
        planRevision: state.index.id,
        codeRevision: state.index.id,
        offset: 0,
        limit: 20,
      },
      null,
    );
    assert.equal(comparison.source.equal, true);
    assert.equal(comparison.dependencies.total, 1);
    assert.match(comparison.dependencies.items[0].before, /5000/);
    assert.match(comparison.dependencies.items[0].after, /6000/);
    await bindImplementation(store, link(), new AbortController().signal);
    state = await readImplementation(store);
    assert.deepEqual(compareImplementation(state, state)[0].statuses, [
      "body-present",
    ]);
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("dependency excerpts stay bounded for many reachable changes", () => {
  const make = (value) =>
    observe(
      Array.from({ length: 120 }, (_, i) => `const X${i}=${value};`).join(
        "\n",
      ) +
        `export function run(){return [${Array.from({ length: 120 }, (_, i) => `X${i}`).join(",")}]}`,
    );
  const result = dependencyChanges(make(1), make(2), "a.ts#function:run");
  assert.equal(result.total, 120);
  assert.equal(result.items.length, 100);
  assert.equal(result.truncated, true);
});
test("repeated reads retain one dependency and anonymous locals are not module bindings", () => {
  const graph = observe(
    "const LIMIT=3; type Shape={n:number}; const values=[1].map(()=>{let local=LIMIT;return local}); export function run(x:Shape){return LIMIT+LIMIT+LIMIT+x.n}",
  );
  assert.equal(
    graph.nodes.some((n) => n.kind === "binding" && n.name === "local"),
    false,
  );
  assert.equal(
    graph.edges.filter(
      (e) =>
        e.kind === "references" &&
        e.from === "a.ts#function:run" &&
        e.to === "a.ts#binding:LIMIT",
    ).length,
    1,
  );
  assert.equal(
    graph.edges.filter(
      (e) => e.kind === "references" && e.to === "a.ts#type:Shape",
    ).length,
    0,
  );
  assert.ok(
    graph.edges.some(
      (e) => e.kind === "uses-type" && e.to === "a.ts#type:Shape",
    ),
  );
});

test("namespace calls track the called declaration rather than the whole imported file", () => {
  const make = (n) =>
    observeTypescript(
      [
        {
          path: "a.ts",
          text: `export const UNRELATED=${n}; export function go(){return 1}`,
          hash: hash(
            `export const UNRELATED=${n}; export function go(){return 1}`,
          ),
        },
        {
          path: "b.ts",
          text: 'import * as api from "./a.js"; export function run(){return api.go()}',
          hash: hash(
            'import * as api from "./a.js"; export function run(){return api.go()}',
          ),
        },
      ],
      { label: "Namespace", gitCommit: null, dirty: true },
    );
  assert.equal(
    dependencyHashes(make(1)).get("b.ts#function:run"),
    dependencyHashes(make(2)).get("b.ts#function:run"),
  );
});

test("namespace constants, enums and binding writers affect observed dependency fingerprints", () => {
  const make = (a, b) =>
    observeTypescript(
      [
        { path: "a.ts", text: a, hash: hash(a) },
        { path: "b.ts", text: b, hash: hash(b) },
      ],
      { label: "N25 dependencies", gitCommit: null, dirty: true },
    );
  for (const [before, after, consumer] of [
    [
      "export const MAX=10;",
      "export const MAX=99;",
      'import * as A from "./a.js";export function f(){return A.MAX}',
    ],
    [
      "export enum E{Max=10}",
      "export enum E{Max=99}",
      'import {E} from "./a.js";export function f(){return E.Max}',
    ],
    [
      "export let limit=10;export function setLimit(){limit=20}",
      "export let limit=10;export function setLimit(){limit=99}",
      'import {limit} from "./a.js";export function f(){return limit}',
    ],
    [
      "export let limit=10;limit=20;",
      "export let limit=10;limit=99;",
      'import {limit} from "./a.js";export function f(){return limit}',
    ],
    [
      "const smtp={send(){return 1}},queue={send(){return 2}};export let mailer=smtp;export function setMailer(){mailer=queue}",
      "const smtp={send(){return 1}},queue={send(){return 3}};export let mailer=smtp;export function setMailer(){mailer=queue}",
      'import {mailer} from "./a.js";export function f(){return mailer.send()}',
    ],
  ]) {
    const x = make(before, consumer),
      y = make(after, consumer);
    assert.notEqual(
      dependencyHashes(x).get("b.ts#function:f"),
      dependencyHashes(y).get("b.ts#function:f"),
      before,
    );
    const difference = dependencyChanges(x, y, "b.ts#function:f");
    assert.equal(difference.available, true);
    assert.ok(difference.total > 0, before);
    assert.deepEqual(
      dependencyHashes(decodeObservation(observationDocuments(y))),
      dependencyHashes(y),
    );
  }
});
