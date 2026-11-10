import { newPlanItem } from "../dist/architecture/planning.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash, json } from "../dist/shared/identity.js";
import {
  retainObservation,
  readImplementation,
  bindImplementation,
  compareImplementation,
  implementationPage,
} from "../dist/implementation/workspace.js";
const graph = (text, label = "Code v1") =>
  observeTypescript([{ path: "main.ts", text, hash: hash(text) }], {
    label,
    gitCommit: null,
    dirty: true,
  });
const source =
  'export function send(n: number): boolean { throw new Error("Not implemented"); }';
test("versioned observations and explicit links survive restart and preserve earlier gaps", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-gap-store-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const plan = store.save("Plan v1", "test", [
      {
        path: "plan.json",
        text: json({
          schema: "pymtheg.plan/v1",
          items: [
            {
              ...newPlanItem("Send once"),
              id: "REQ-1",
              kind: "requirement",
              title: "Send once",
              status: "proposed",
              owner: "service",
              description: "Send one request",
              acceptance: "one call",
              links: [],
            },
          ],
        }),
      },
    ]);
    const first = await retainObservation(
      store,
      graph(source),
      plan.id,
      new AbortController().signal,
    );
    let state = await readImplementation(store),
      row = compareImplementation(state, state).find(
        (r) => r.name === "Send once",
      );
    assert.equal(row.status, "unlinked");
    const node = state.graph.nodes.find((n) => n.name === "send");
    await bindImplementation(
      store,
      {
        revision: first.id,
        planId: row.id,
        planHash: row.planHash,
        nodeId: node.id,
        observationId: state.graph.snapshotId,
        note: "Only the signature exists",
      },
      new AbortController().signal,
    );
    state = await readImplementation(store);
    assert.equal(compareImplementation(state, state)[0].status, "fail-fast");
    const linkedRevision = state.index.id;
    await retainObservation(
      store,
      graph(
        source.replace('throw new Error("Not implemented");', "return n > 0;"),
        "Code v2",
      ),
      linkedRevision,
      new AbortController().signal,
    );
    const current = await readImplementation(store);
    assert.equal(
      compareImplementation(current, current)[0].status,
      "code-changed",
    );
    assert.equal(
      compareImplementation(
        await readImplementation(store, linkedRevision),
        await readImplementation(store, linkedRevision),
      )[0].status,
      "fail-fast",
    );
    store.close();
    store = await ArchitectureStore.open(root);
    const reopened = await readImplementation(store);
    assert.equal(reopened.graph.version.label, "Code v2");
    assert.equal(
      compareImplementation(reopened, reopened)[0].status,
      "code-changed",
    );
    assert.equal(
      implementationPage(reopened, reopened, {
        mode: "existing",
        query: "send",
        offset: 0,
        limit: 1,
      }).items[0].name,
      "send",
    );
    await assert.rejects(
      retainObservation(
        store,
        graph(source),
        "stale",
        new AbortController().signal,
      ),
      /Architecture changed/,
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("missing declarations, uninspected files and stale observations remain distinct", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-gap-scope-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const plan = store.save("Intent", "fixture", [
      {
        path: "plan.json",
        text: json({
          schema: "pymtheg.plan/v1",
          items: [
            {
              ...newPlanItem("A"),
              id: "A",
              title: "A",
              status: "implemented",
              acceptance: "actually send once",
            },
          ],
        }),
      },
    ]);
    const first = await retainObservation(
      store,
      graph(source),
      plan.id,
      new AbortController().signal,
    );
    let state = await readImplementation(store);
    assert.equal(compareImplementation(state, state)[0].status, "unlinked");
    const row = compareImplementation(state, state)[0],
      node = state.graph.nodes.find((n) => n.name === "send");
    await bindImplementation(
      store,
      {
        revision: first.id,
        planId: row.id,
        planHash: row.planHash,
        nodeId: node.id,
        observationId: state.graph.snapshotId,
        note: "",
      },
      new AbortController().signal,
    );
    state = await readImplementation(store);
    const removed = {
      ...state,
      graph: graph("export function replacement() {}"),
    };
    assert.equal(compareImplementation(state, removed)[0].status, "missing");
    const outside = {
      ...removed,
      graph: {
        ...removed.graph,
        scope: { ...removed.graph.scope, files: ["elsewhere.ts"] },
      },
    };
    assert.equal(compareImplementation(state, outside)[0].status, "unknown");
    const stale = {
      ...state,
      graph: { ...state.graph, staleFiles: ["main.ts"] },
    };
    assert.equal(compareImplementation(state, stale)[0].status, "unknown");
    const changed = {
      ...state,
      documents: state.documents.map((d) =>
        d.path === "plan.json"
          ? { ...d, text: d.text.replace("actually send once", "send twice") }
          : d,
      ),
      index: {
        ...state.index,
        entities: state.index.entities.map((e) => ({
          ...e,
          contentHash: "changed",
        })),
      },
    };
    assert.equal(
      compareImplementation(changed, state)[0].status,
      "plan-changed",
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("graph pages cover ten thousand planned records without timing assumptions or hidden omissions", () => {
  const count = 10000;
  const state = {
    index: {
      id: "large",
      entities: Array.from({ length: count }, (_, i) => ({
        id: `plan:${i}`,
        name: `Component ${i}`,
        kind: "component",
        contentHash: "x",
      })),
      edges: [],
    },
    documents: [],
    graph: null,
    bindings: [],
  };
  const first = implementationPage(state, null, {
    mode: "gaps",
    query: "",
    offset: 0,
    limit: 100,
  });
  const last = implementationPage(state, null, {
    mode: "gaps",
    query: "",
    offset: 9900,
    limit: 100,
  });
  assert.equal(first.total, count);
  assert.equal(first.nextOffset, 100);
  assert.equal(first.counts.unlinked, count);
  assert.equal(last.items.length, 100);
  assert.equal(last.nextOffset, null);
  assert.equal(last.items.at(-1).id, "plan:9999");
});

test("new links retain their exact reviewed checkpoint without creating no-op history", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-reviewed-code-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const plan = store.save("Intent", "fixture", [
      {
        path: "plan.json",
        text: json({
          schema: "pymtheg.plan/v1",
          items: [{ ...newPlanItem("R1"), title: "Send" }],
        }),
      },
    ]);
    const observed = await retainObservation(
      store,
      graph(source),
      plan.id,
      new AbortController().signal,
    );
    let state = await readImplementation(store);
    const row = compareImplementation(state, state)[0];
    const request = {
      revision: observed.id,
      planId: row.id,
      planHash: row.planHash,
      nodeId: state.graph.nodes.find((n) => n.name === "send").id,
      observationId: state.graph.snapshotId,
      note: "Reviewed signature",
    };
    const linked = await bindImplementation(
      store,
      request,
      new AbortController().signal,
    );
    state = await readImplementation(store);
    assert.equal(state.bindings[0].reviewedRevision, observed.id);
    const noChange = await bindImplementation(
      store,
      { ...request, revision: linked.id },
      new AbortController().signal,
    );
    assert.equal(noChange.id, linked.id);
    const changed = await retainObservation(
      store,
      graph(
        source.replace('throw new Error("Not implemented");', "return n > 0;"),
        "Code v2",
      ),
      linked.id,
      new AbortController().signal,
    );
    state = await readImplementation(store);
    assert.equal(state.bindings[0].reviewedRevision, observed.id);
    await bindImplementation(
      store,
      {
        ...request,
        revision: changed.id,
        observationId: state.graph.snapshotId,
      },
      new AbortController().signal,
    );
    const reviewed = await readImplementation(store);
    assert.equal(reviewed.bindings[0].reviewedRevision, changed.id);
    const baseline = await readImplementation(store, observed.id);
    assert.equal(
      baseline.graph.nodes.find((n) => n.name === "send").body,
      "fail-fast",
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("existing-code counts describe observed bodies independently of unrelated plans", () => {
  const code = {
    index: { id: "code" },
    documents: [],
    bindings: [],
    graph: graph(source + "\nexport function ready() { return true; }"),
  };
  const plan = {
    index: { id: "plan", entities: [], edges: [] },
    documents: [],
    bindings: [],
    graph: null,
  };
  const page = implementationPage(plan, code, {
    mode: "existing",
    query: "",
    offset: 0,
    limit: 10,
  });
  assert.equal(page.counts["fail-fast"], 1);
  assert.equal(page.counts.present, 1);
  assert.equal(page.counts.unlinked, undefined);
});
