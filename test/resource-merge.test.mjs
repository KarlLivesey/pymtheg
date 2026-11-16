// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeResourceDefinitions,
  resourceChanges,
} from "../dist/studio/resource-merge.js";
import { resourceDefinitionSource } from "../dist/studio/resource-authoring.js";
import { analyseFile } from "../dist/analysis/index.js";
const base = {
  kind: "resource",
  name: "File",
  states: ["Open", "Closed"],
  initial: "Open",
  terminal: ["Closed"],
  transitions: [{ from: "Open", to: "Closed" }],
};

test("independent lifecycle rules combine without dropping either version and the real checker accepts them", () => {
  const local = structuredClone(base),
    current = structuredClone(base);
  local.transitions.push({ from: "Closed", to: "Closed" });
  current.transitions.push({ from: "Open", to: "Open" });
  const before = JSON.stringify([base, local, current]);
  const merged = mergeResourceDefinitions(base, local, current);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.definition.transitions.length, 3);
  assert.equal(JSON.stringify([base, local, current]), before);
  const file = "/tmp/resource-merge.pym";
  const text =
    resourceDefinitionSource(merged.definition) +
    "flow finish(take file: File) -> Unit effects(state.File) { transition file -> Closed; } on cancel { transition file -> Closed; }";
  assert.deepEqual(
    analyseFile(file, () => {}, { buffers: { [file]: text } }).report
      .diagnostics,
    [],
  );
  assert.deepEqual(resourceChanges(base, local), [
    "Add transition Closed→Closed",
  ]);
});

test("independent state additions combine while preserving both new states and rules", () => {
  const local = structuredClone(base),
    current = structuredClone(base);
  local.states.push("Failed");
  local.transitions.push({ from: "Open", to: "Failed" });
  current.states.push("Archived");
  current.transitions.push({ from: "Closed", to: "Archived" });
  const result = mergeResourceDefinitions(base, local, current);
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.definition.states, [
    "Open",
    "Closed",
    "Archived",
    "Failed",
  ]);
  assert.equal(result.definition.transitions.length, 3);
});

test("combined dangling transitions still require explicit resolution", () => {
  const local = structuredClone(base),
    current = structuredClone(base);
  current.states = ["Closed"];
  current.initial = "Closed";
  current.transitions = [];
  local.transitions.push({ from: "Open", to: "Open" });
  assert.equal(mergeResourceDefinitions(base, local, current).definition, null);
  assert.match(
    mergeResourceDefinitions(base, local, current).conflicts.join(" "),
    /declared state/,
  );
});

test("one-sided removals and independent additions stay explicit", () => {
  const local = structuredClone(base),
    current = structuredClone(base);
  local.transitions = [];
  current.transitions.push({ from: "Closed", to: "Closed" });
  const merged = mergeResourceDefinitions(base, local, current);
  assert.deepEqual(merged.definition.transitions, [
    { from: "Closed", to: "Closed" },
  ]);
  assert.deepEqual(resourceChanges(base, merged.definition), [
    "Add transition Closed→Closed",
    "Remove transition Open→Closed",
  ]);
});

test("combining cannot silently normalize an invalid edited lifecycle", () => {
  const local = structuredClone(base);
  local.transitions.push({ ...local.transitions[0] });
  const merged = mergeResourceDefinitions(base, local, base);
  assert.equal(merged.definition, null);
  assert.match(
    merged.conflicts.join(" "),
    /Your edited lifecycle needs correction/,
  );
});
