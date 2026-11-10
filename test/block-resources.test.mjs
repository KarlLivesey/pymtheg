import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadProject } from "../dist/language/project.js";
import { typecheck } from "../dist/semantic/core.js";
import { describeBlocks } from "../dist/studio/block-model.js";
import {
  replaceBlockField,
  addCancellation,
  addResourceStep,
  createResourceStep,
} from "../dist/studio/block-document.js";
import { analyseFile } from "../dist/analysis/index.js";

const file = resolve("examples/mvp/files-fixed.pym");
const original = readFileSync(file, "utf8");
const model = (text) =>
  describeBlocks(
    typecheck(loadProject(file, { buffers: { [file]: text } })),
    file,
  );

test("resource cards expose the declared lifecycle and typed destination states", () => {
  const doc = model(original);
  const resource = doc.blocks.find((b) => b.kind === "resource");
  assert.deepEqual(resource.lifecycle, {
    states: ["Open", "Closed"],
    initial: "Open",
    terminal: ["Closed"],
    transitions: [
      { from: "Open", to: "Closed" },
      { from: "Closed", to: "Closed" },
    ],
    stateCount: 2,
    terminalCount: 1,
    transitionCount: 2,
  });
  const flow = doc.blocks.find((b) => b.title === "process");
  const transition = flow.sections[1].blocks[0];
  const destination = transition.fields.find(
    (f) => f.label === "Destination state",
  );
  assert.deepEqual(destination.choices, ["Open", "Closed"]);
  assert.equal(
    doc.text.slice(destination.span.start, destination.span.end),
    "Closed",
  );
});

test("changing cleanup edits only its token and the real checker catches the leak", () => {
  const text = original.replace(
    "on cancel { transition f -> Closed; }",
    "on cancel { transition // retained } note\n f -> Closed; }",
  );
  const doc = model(text),
    flow = doc.blocks.find((b) => b.title === "process");
  const destination = flow.sections[1].blocks[0].fields.find(
    (f) => f.label === "Destination state",
  );
  const changed = replaceBlockField(doc, destination, "Open");
  assert.equal(changed.text, text.replace("f -> Closed; }", "f -> Open; }"));
  const report = analyseFile(file, () => {}, {
    buffers: { [file]: changed.text },
  }).report;
  assert.ok(
    report.diagnostics.some(
      (d) =>
        d.code === "O004" &&
        /Cancellation may leave f unsettled in Open/.test(d.message),
    ),
  );
  assert.ok(report.diagnostics.some((d) => d.code === "R002"));
  assert.equal(model(changed.text).parsed, true);
});

test("resource actions use canonical scope, preserve exits and leave unresolved cleanup explicit", () => {
  let doc = model(
    original.replace(/ on cancel \{ transition f -> Closed; \}/, ""),
  );
  let flow = doc.blocks.find((b) => b.title === "process");
  assert.equal(flow.canAddCancellation, true);
  doc = model(addCancellation(doc, flow));
  flow = doc.blocks.find((b) => b.title === "process");
  assert.equal(flow.canAddCancellation, false);
  const cancel = flow.sections[1];
  assert.deepEqual(
    cancel.resources.map((r) => r.name),
    ["f"],
  );
  const changed = addResourceStep(doc, cancel, "f", "Closed");
  assert.match(changed, /unknown "How are resources settled if cancelled\?";/);
  assert.match(changed, /transition f -> Closed;/);
  assert.throws(
    () => addResourceStep(doc, cancel, "other", "Closed"),
    /current scope/,
  );
  assert.throws(
    () => addResourceStep(doc, cancel, "f", "Missing"),
    /current scope/,
  );
  assert.throws(() => addCancellation(doc, flow), /already has/);
  const created = createResourceStep(doc, flow.sections[0], "File");
  assert.match(created, /own ownedFile: File;/);
  assert.equal(model(created).parsed, true);
});

test("nested resource names do not leak into sibling block choices", () => {
  const text = `resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; }
flow main(yes: Bool) -> Unit { if yes { own inner: File; } else { return unit; } return unit; }`;
  const doc = model(text),
    flow = doc.blocks.at(-1),
    decision = flow.sections[0].blocks[0];
  assert.deepEqual(
    decision.sections[0].resources.map((r) => r.name),
    ["inner"],
  );
  assert.deepEqual(decision.sections[1].resources, []);
  assert.deepEqual(flow.sections[0].resources, []);
});

test("large resource scopes retain exact totals and bounded choices", () => {
  const states = Array.from({ length: 101 }, (_, i) => `S${i}`);
  const params = Array.from({ length: 101 }, (_, i) => `take f${i}: File`);
  const doc =
    model(`resource File { states ${states.join(", ")}; initial S0; terminal S100; S0 -> S100; }
flow main(${params.join(", ")}) -> Unit { transition f0 -> S100; return unit; }`);
  const scope = doc.blocks[1].sections[0];
  assert.equal(scope.resourceCount, 101);
  assert.equal(scope.resources.length, 100);
  assert.equal(scope.resources[0].stateCount, 101);
  assert.equal(scope.resources[0].states.length, 100);
  assert.equal(doc.blocks[0].lifecycle.stateCount, 101);
  assert.equal(doc.blocks[0].lifecycle.states.length, 40);
  assert.throws(
    () => addResourceStep(doc, scope, "f100", "S0"),
    /current scope/,
  );
});
