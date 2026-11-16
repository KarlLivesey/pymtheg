// SPDX-License-Identifier: MIT
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
  unlinkImplementation,
} from "../dist/implementation/workspace.js";
test("adding a second implementation declaration retains both links and the unfinished part", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-multiple-links-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const initial = store.save("Plan", "fixture", [
      {
        path: "plan.json",
        text: JSON.stringify({
          schema: "pymtheg.plan/v1",
          items: [
            {
              ...newPlanItem("P"),
              title: "Two-stage operation",
              acceptance: "Both stages work",
            },
          ],
        }),
      },
    ]);
    const text =
      'export function first(): boolean { return true; } export function second(): boolean { throw new Error("Not implemented"); }';
    const graph = observeTypescript(
      [{ path: "code.ts", text, hash: hash(text) }],
      { label: "Code", gitCommit: null, dirty: true },
    );
    await retainObservation(
      store,
      graph,
      initial.id,
      new AbortController().signal,
    );
    for (const name of ["first", "second"]) {
      const state = await readImplementation(store),
        row = compareImplementation(state, state)[0];
      await bindImplementation(
        store,
        {
          revision: state.index.id,
          planId: row.id,
          planHash: row.planHash,
          nodeId: graph.nodes.find((n) => n.name === name).id,
          observationId: graph.snapshotId,
          note: name,
        },
        new AbortController().signal,
      );
    }
    const final = await readImplementation(store);
    assert.equal(final.bindings.length, 2);
    const row = compareImplementation(final, final)[0];
    assert.equal(row.linkCount, 2);
    assert.equal(row.status, "fail-fast");
    assert.deepEqual(row.codeLinks.map((l) => l.name).sort(), [
      "first",
      "second",
    ]);
    await unlinkImplementation(
      store,
      {
        revision: final.index.id,
        planId: row.id,
        nodeId: graph.nodes.find((n) => n.name === "second").id,
      },
      new AbortController().signal,
    );
    const current = await readImplementation(store);
    assert.equal(current.bindings.length, 1);
    assert.equal(
      compareImplementation(current, current)[0].status,
      "body-present",
    );
    assert.equal(
      (await readImplementation(store, final.index.id)).bindings.length,
      2,
    );
    await assert.rejects(
      unlinkImplementation(
        store,
        {
          revision: final.index.id,
          planId: row.id,
          nodeId: current.bindings[0].nodeId,
        },
        new AbortController().signal,
      ),
      /Architecture changed/,
    );
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
