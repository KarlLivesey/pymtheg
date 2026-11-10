import test from "node:test";
import assert from "node:assert/strict";
import { loadProject } from "../dist/language/project.js";
import { typecheck } from "../dist/semantic/core.js";
import { describeBlocks } from "../dist/studio/block-model.js";
import {
  blockDocumentSchema,
  replaceBlockField,
} from "../dist/studio/block-document.js";
import {
  applyRangeDraft,
  beginRangeDraft,
  rangesIn,
  rangeDraftsSchema,
} from "../dist/studio/range-data.js";
import { RecoveryStore } from "../dist/studio/recovery.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const source = `machine Counter {
  // retain this range explanation
  state count: Int in - 2 // lower
    .. 002 // upper
    = 0;
  state other: Nat in 0..10 = 0;
  event inc when count < 2 { count = count + 1; }
  invariant bounded = count <= 2;
}\n`;
function model(text = source, file = "/tmp/range/main.pym") {
  return blockDocumentSchema.parse(
    describeBlocks(
      typecheck(loadProject(file, { buffers: { [file]: text } })),
      file,
    ),
  );
}
test("both parser-owned bounds change atomically, keeping comments and unchanged spelling", () => {
  const doc = model(),
    range = rangesIn(doc)[0];
  assert.equal(doc.text.slice(range.minSpan.start, range.minSpan.end), "- 2");
  const draft = { ...beginRangeDraft("main.pym", range), min: "-5", max: "8" };
  const edited = applyRangeDraft(doc, draft);
  assert.equal(
    edited,
    source.replace("- 2 // lower\n    .. 002", "-5 // lower\n    .. 8"),
  );
  assert.equal(model(edited).parsed, true);
  assert.equal(
    applyRangeDraft(doc, beginRangeDraft("main.pym", range)),
    source,
  );
  assert.equal(
    applyRangeDraft(doc, { ...draft, min: "-2" }),
    source.replace("002 // upper", "8 // upper"),
  );
});
test("invalid unfinished/backwards/negative Nat ranges never alter source", () => {
  const doc = model();
  for (const fields of [
    { min: "-" },
    { min: "" },
    { max: "1.5" },
    { min: "20" },
    { max: "1; unknown" },
  ])
    assert.throws(
      () =>
        applyRangeDraft(doc, {
          ...beginRangeDraft("main.pym", rangesIn(doc)[0]),
          ...fields,
        }),
      /whole-number|exceed/,
    );
  assert.throws(
    () =>
      applyRangeDraft(doc, {
        ...beginRangeDraft("main.pym", rangesIn(doc)[1]),
        min: "-1",
      }),
    /cannot be negative/,
  );
  assert.equal(doc.text, source);
});
test("draft identity survives project moves and unrelated edits, but not changed/renamed/deleted states", () => {
  const draft = {
    ...beginRangeDraft("main.pym", rangesIn(model())[0]),
    max: "9",
  };
  for (const text of [
    source,
    "// earlier note\n" + source,
    source.replace("other: Nat in 0..10", "other: Nat in 0..12"),
  ])
    assert.match(
      applyRangeDraft(model(text, "/tmp/moved/main.pym"), draft),
      /9 \/\/ upper/,
    );
  for (const text of [
    source.replace("count: Int", "renamed: Int"),
    source.replace("= 0;", "= 1;"),
    source.replace(/  state count[\s\S]*?= 0;\n/, ""),
  ])
    assert.throws(
      () => applyRangeDraft(model(text), draft),
      /changed|no longer/,
    );
  const changed = replaceBlockField(
    model(),
    model().blocks[0].children[0].fields[1],
    "1",
  );
  assert.throws(() => applyRangeDraft(changed, draft), /changed|no longer/);
  const duplicate = source + source;
  assert.throws(
    () => applyRangeDraft(model(duplicate), draft),
    /changed|no longer/,
  );
});
test("a comment embedded in a signed bound keeps its Text fallback", () => {
  assert.equal(
    rangesIn(model(source.replace("- 2", "- // important\n    2"))).length,
    1,
  );
});
test("unfinished range drafts round trip in durable recovery and reject oversized arrays", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-range-recovery-"));
  let store;
  try {
    const draft = {
      ...beginRangeDraft("main.pym", rangesIn(model())[0]),
      min: "-",
    };
    store = await RecoveryStore.openOrCreate(root);
    store.save(0, {
      drafts: [],
      context: {
        file: "main.pym",
        entry: "Counter",
        tab: "findings",
        settings: {
          seed: "1",
          maxSteps: 10,
          maxSamples: 10,
          timeoutMs: 1000,
          scope: "",
        },
        rangeDrafts: [draft],
      },
    });
    store.close();
    store = await RecoveryStore.openOrCreate(root);
    assert.deepEqual(store.read().context.rangeDrafts, [draft]);
    assert.throws(() => rangeDraftsSchema.parse(Array(33).fill(draft)));
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});
