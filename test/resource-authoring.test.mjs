import test from "node:test";
import assert from "node:assert/strict";
import { analyseFile } from "../dist/analysis/index.js";
import {
  describeResourceDefinition,
  rewriteResourceDefinition,
  resourceDefinitionSource,
} from "../dist/studio/resource-authoring.js";
import { formatSource } from "../dist/language/format.js";
const file = "/tmp/pym-lifecycle-edit.pym";
const source = `// Keep this purpose.
resource File {
  states Open, Closed;
  initial Open;
  terminal Closed;
  // Close before returning.
  Open -> Closed;
} // The file owns a cleanup obligation.
flow process(take file: File) -> Unit effects(state.File) {
  transition file -> Closed;
  return unit;
}
flow untouched() -> Unit { return unit; }
`;
const model = (text = source) =>
  analyseFile(file, () => {}, { buffers: { [file]: text } });
test("editing an existing lifecycle exposes real invalid callers and preserves unrelated source", () => {
  const original = model();
  assert.deepEqual(original.report.diagnostics, []);
  const resource = original.ir.declarations.find((d) => d.kind === "resource");
  const context = describeResourceDefinition(original.ir, resource.id);
  const unchanged = rewriteResourceDefinition(
    original.ir,
    resource.id,
    context.definition,
    context.sourceHash,
  );
  assert.equal(unchanged.text, source);
  assert.equal(unchanged.edits.length, 0);
  const preview = rewriteResourceDefinition(
    original.ir,
    resource.id,
    { ...context.definition, transitions: [] },
    context.sourceHash,
  );
  assert.ok(preview.affected.some((item) => item.name === "process"));
  assert.ok(
    preview.text.endsWith(source.slice(source.indexOf("flow process"))),
  );
  assert.ok(preview.text.startsWith("// Keep this purpose.\n"));
  assert.match(preview.text, /Previous File comment from line 6/);
  assert.match(preview.text, /The file owns a cleanup obligation/);
  assert.match(preview.notices.join("\n"), /comments retained/);
  const changed = model(preview.text);
  assert.ok(
    changed.report.diagnostics.some((d) => /transition/i.test(d.message)),
    JSON.stringify(changed.report.diagnostics),
  );
  const fixedContext = describeResourceDefinition(changed.ir, resource.id);
  const fixed = rewriteResourceDefinition(
    changed.ir,
    resource.id,
    context.definition,
    fixedContext.sourceHash,
  );
  assert.deepEqual(model(fixed.text).report.diagnostics, []);
  assert.equal(
    formatSource(
      file,
      resourceDefinitionSource({ ...context.definition, transitions: [] }),
    ),
    resourceDefinitionSource({
      ...context.definition,
      transitions: [],
    }),
  );
});
test("lifecycle editing rejects stale hashes, accidental renames and invalid state relationships", () => {
  const { ir } = model();
  const resource = ir.declarations.find((d) => d.kind === "resource");
  const context = describeResourceDefinition(ir, resource.id);
  const write = (definition) =>
    rewriteResourceDefinition(ir, resource.id, definition, context.sourceHash);
  assert.throws(
    () =>
      rewriteResourceDefinition(ir, resource.id, context.definition, "stale"),
    /source changed/,
  );
  assert.throws(
    () => write({ ...context.definition, name: "Other" }),
    /renaming/,
  );
  assert.throws(
    () => write({ ...context.definition, states: ["Open", "Open"] }),
    /different name/,
  );
  assert.throws(
    () => write({ ...context.definition, terminal: [] }),
    /cleanup-complete/,
  );
  assert.throws(
    () => write({ ...context.definition, initial: "Missing" }),
    /declared state/,
  );
  assert.throws(
    () =>
      write({
        ...context.definition,
        transitions: [{ from: "Missing", to: "Closed" }],
      }),
    /declared state/,
  );
  assert.throws(
    () =>
      write({
        ...context.definition,
        transitions: [
          ...context.definition.transitions,
          ...context.definition.transitions,
        ],
      }),
    /transition once/,
  );
});
test("large lifecycle definitions remain inspectable without silently trimming the form", () => {
  const states = Array.from({ length: 41 }, (_, i) => "S" + i);
  const { ir } = model(
    `resource File { states ${states.join(", ")}; initial S0; terminal S40; }`,
  );
  const resource = ir.declarations.find((d) => d.kind === "resource");
  const context = describeResourceDefinition(ir, resource.id);
  assert.equal(context.definition, null);
  assert.match(context.unsupported, /40-state/);
});

test("saved lifecycle edits retain their original identity and incomplete fields", async () => {
  const { declarationDraftSchema } = await import(
    "../dist/studio/declaration-data.js"
  );
  const { ir } = model();
  const declaration = ir.declarations.find((d) => d.kind === "resource");
  const context = describeResourceDefinition(ir, declaration.id);
  const draft = {
    file: "main.pym",
    declaration: { ...context.definition, states: ["Open", ""] },
    resourceEdit: {
      name: "File",
      baseline: context.definition,
      declarationHash: context.declarationHash,
    },
  };
  assert.equal(declarationDraftSchema.parse(draft).declaration.states[1], "");
  assert.throws(
    () =>
      declarationDraftSchema.parse({
        ...draft,
        declaration: { ...draft.declaration, name: "Other" },
      }),
    /identity/,
  );
});
