import test from "node:test";
import assert from "node:assert/strict";
import { EmissionStore } from "../dist/mcp/emissions.js";
import { hash } from "../dist/shared/identity.js";
const output = (source) => ({
  source,
  format: "typescript",
  extension: ".ts",
  snapshotId: "frozen-snapshot",
  implementation: "declarations",
  assurance: "builtin_scaffold",
  symbols: [],
  notes: ["Retained output"],
  dependencies: [],
  omitted: [],
  contractManifest: {
    schema: "pymtheg.contract-manifest/v1",
    snapshotId: "frozen-snapshot",
    entries: [],
    omitted: [],
  },
});
test("emission pages retain exact text and do not split Unicode characters", () => {
  const store = new EmissionStore(),
    text = "A😀é\nB",
    saved = store.put("run", output(text));
  let next = 0,
    reconstructed = "";
  do {
    const page = store.read(saved.emissionId, "source", next, 1);
    assert.equal(page.contentHash, hash(text));
    assert.ok(page.text.length);
    assert.equal(page.text.includes("\ufffd"), false);
    reconstructed += page.text;
    next = page.nextOffset;
  } while (next !== null);
  assert.equal(reconstructed, text);
  assert.throws(
    () => store.read(saved.emissionId, "source", 2, 1),
    /splits a Unicode/,
  );
  const manifest = store.read(saved.emissionId, "manifest");
  assert.equal(JSON.parse(manifest.text).snapshotId, "frozen-snapshot");
  assert.equal(
    store.read(saved.emissionId, "source", text.length).nextOffset,
    null,
  );
});
test("emission retention evicts complete artifacts and shutdown releases retained text", () => {
  const store = new EmissionStore({ records: 2, bytes: 10000 });
  const first = store.put("one", output("first"));
  const second = store.put("two", output("second"));
  store.put("three", output("third"));
  assert.equal(store.size, 2);
  assert.throws(() => store.read(first.emissionId, "source"), /expired/);
  assert.equal(store.read(second.emissionId, "source").text, "second");
  assert.throws(
    () => store.put("large", output("x".repeat(20000))),
    /retention budget/,
  );
  assert.equal(store.size, 2);
  assert.throws(
    () => store.put("invalid", output("\ud800")),
    /invalid Unicode/,
  );
  store.clear();
  assert.equal(store.size, 0);
  assert.equal(store.bytes, 0);
});
