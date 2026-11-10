import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { newPlanItem } from "../dist/architecture/planning.js";
import { observeTypescript } from "../dist/implementation/typescript.js";
import { hash } from "../dist/shared/identity.js";
import {
  readImplementation,
  retainObservation,
  bindImplementation,
  compareImplementation,
} from "../dist/implementation/workspace.js";
test("administrative plan review updates preserve code intent while acceptance changes require review", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-plan-intent-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const item = {
      ...newPlanItem("P"),
      title: "Compute result",
      acceptance: "Return a positive number",
    };
    let saved = store.save("Plan", "fixture", [
      {
        path: "plan.json",
        text: JSON.stringify({ schema: "pymtheg.plan/v1", items: [item] }),
      },
    ]);
    const text = "export function result(): number { return 1; }",
      graph = observeTypescript([{ path: "code.ts", text, hash: hash(text) }], {
        label: "Code",
        gitCommit: null,
        dirty: true,
      });
    saved = await retainObservation(
      store,
      graph,
      saved.id,
      new AbortController().signal,
    );
    let state = await readImplementation(store),
      row = compareImplementation(state, state)[0];
    await bindImplementation(
      store,
      {
        revision: saved.id,
        planId: row.id,
        planHash: row.planHash,
        nodeId: graph.nodes.find((n) => n.name === "result").id,
        observationId: graph.snapshotId,
        note: "",
      },
      new AbortController().signal,
    );
    state = await readImplementation(store);
    const update = async (value) => {
      store.save(
        "Update",
        "fixture",
        state.documents.map((d) =>
          d.path === "plan.json"
            ? {
                ...d,
                text: JSON.stringify({
                  schema: "pymtheg.plan/v1",
                  items: [value],
                }),
              }
            : d,
        ),
        undefined,
        state.index.id,
      );
      state = await readImplementation(store);
    };
    await update({
      ...item,
      status: "implemented",
      evidence: "Compiler checked",
      evidenceRevision: state.index.id,
    });
    assert.equal(compareImplementation(state, state)[0].status, "body-present");
    await update({ ...item, acceptance: "Return a negative number" });
    assert.equal(compareImplementation(state, state)[0].status, "plan-changed");
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("source baseline representation and review notes do not change intent, but new semantic expectations do", async () => {
  const { implementationPlanHashes } = await import(
    "../dist/implementation/plan-hash.js"
  );
  const expected = "1".repeat(64),
    changed = "2".repeat(64);
  const original = {
    title: "Receive data",
    acceptance: "One accepted input",
    sourceExpectations: { "source:data.pym#Input": expected },
  };
  const entity = {
    planning: {},
    document: "plan.json",
    pointer: [],
    contentHash: "raw",
  };
  const digest = (value) =>
    implementationPlanHashes([
      { path: "plan.json", text: JSON.stringify(value) },
    ])(entity);
  const reviewed = {
    ...original,
    status: "reviewed",
    evidence: "The same source was inspected",
    sourceRoots: {
      "source:main.pym#run": {
        expectations: original.sourceExpectations,
        hashes: { file: "different bytes" },
        precise: true,
      },
    },
  };
  assert.equal(digest(original), digest(reviewed));
  assert.notEqual(
    digest(original),
    digest({
      ...reviewed,
      sourceRoots: {
        ...reviewed.sourceRoots,
        "source:other.pym#run": {
          expectations: { "source:data.pym#Input": changed },
          hashes: {},
          precise: true,
        },
      },
    }),
  );
  const exact = (text) =>
    implementationPlanHashes([{ path: "plan.json", text }])(entity);
  assert.notEqual(
    exact('{"title":"Limit","budget":9007199254740992}'),
    exact('{"title":"Limit","budget":9007199254740993}'),
  );
});
