// SPDX-License-Identifier: MIT
// C-36: a short fixed-seed run of the differential fuzzer
// (scripts/reindex/fuzz-order.mjs). Generated workspaces with glob cycles,
// mutual `pub use`, macro-shadowed globs, `#[macro_use] extern crate`, serde
// helpers through aliases and cfg siblings are indexed cold in forward,
// reversed and shuffled decision order, then edited; after every edit the
// incremental store must equal a cold index of the tree, the two decided in
// different orders. Bounded by the edit count; the long runs are recorded in
// docs/changes/C-36.md.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fuzz, SHAPES } from "../scripts/reindex/fuzz-order.mjs";

test("Rust: 200 seeded edits in forward, reversed and shuffled decision order give the cold index's rows", async (t) => {
  const { counts, mismatches } = await fuzz({
    dist: new URL("../dist", import.meta.url).pathname,
    seed: 3601,
    edits: 200,
  });
  assert.deepEqual(
    mismatches.map((m) => ({ ...m, diff: m.diff.slice(0, 2) })),
    [],
  );
  assert.equal(counts.edits, 200);
  assert.equal(counts.comparisons, 200);
  // The run exercised what it is for: every shape, every order, and edits
  // that took the scoped path.
  for (const shape of SHAPES) assert.ok(counts.shapes[shape] > 0, shape);
  for (const order of ["forward", "reversed", "shuffled"])
    assert.ok(counts.orders[order] > 0, order);
  assert.ok(counts.permutedLoops > 0, JSON.stringify(counts));
  assert.ok(counts.scopedEdits > 0, JSON.stringify(counts));
  t.diagnostic(JSON.stringify(counts));
});
