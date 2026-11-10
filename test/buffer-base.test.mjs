import test from "node:test";
import assert from "node:assert/strict";
import { SourceBufferBases } from "../dist/studio/buffer-base.js";
test("another window cannot move the save precondition of a clean or edited stale buffer", () => {
  for (const text of ["original", "original plus local edit"]) {
    const bases = new SourceBufferBases();
    bases.loaded("a.pym", "original-hash");
    assert.equal(
      bases.observed(
        { path: "a.pym", text: "other window", hash: "other-hash" },
        text,
      ),
      true,
    );
    assert.equal(bases.expected("a.pym", "other-hash"), "original-hash");
    // The server can now refuse against other-hash instead of silently replacing it.
    assert.notEqual(bases.expected("a.pym", null), "other-hash");
    bases.loaded("a.pym", "other-hash"); // explicit user adoption, not a disk event
    assert.equal(bases.expected("a.pym", null), "other-hash");
  }
});
test("owned saves advance the base without accepting later external changes or undoing a reload", () => {
  const bases = new SourceBufferBases();
  bases.loaded("a.pym", "old");
  bases.acknowledged("a.pym", "old", "saved");
  assert.equal(bases.expected("a.pym", null), "saved");
  assert.equal(
    bases.observed(
      { path: "a.pym", text: "external", hash: "external" },
      "saved plus newer typing",
    ),
    true,
  );
  assert.equal(bases.expected("a.pym", null), "saved");
  bases.loaded("a.pym", "reviewed");
  bases.acknowledged("a.pym", "old", "saved");
  assert.equal(bases.expected("a.pym", null), "reviewed");
});
test("identical content and new-file events can be acknowledged without fabricating a different baseline", () => {
  const bases = new SourceBufferBases();
  bases.loaded("new.pym", null);
  assert.equal(bases.expected("new.pym", "disk"), null);
  assert.equal(
    bases.observed(
      { path: "new.pym", text: "same", hash: "same-hash" },
      "same",
    ),
    false,
  );
  assert.equal(bases.expected("new.pym", null), "same-hash");
  assert.equal(
    bases.observed(
      { path: "unopened.pym", text: "read later", hash: "fresh" },
      undefined,
    ),
    false,
  );
  assert.equal(bases.expected("unopened.pym", null), "fresh");
});
