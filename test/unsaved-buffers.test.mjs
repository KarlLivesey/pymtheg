import test from "node:test";
import assert from "node:assert/strict";
import { unsavedBuffers } from "../dist/studio/unsaved-buffers.js";

test("cached unchanged source stays on disk while edited, recovered, new and deleted sources retain their buffers", () => {
  const buffers = {
    "same.pym": "same",
    "edited.pym": "changed",
    "unloaded.pym": "recovered",
    "new.pym": "",
    "deleted.pym": "old",
  };
  const files = [
    { path: "same.pym", text: "same" },
    { path: "edited.pym", text: "old" },
    { path: "unloaded.pym", text: "", loaded: false },
    { path: "deleted.pym", text: "old", exists: false },
  ];
  assert.deepEqual(unsavedBuffers(buffers, files), {
    "edited.pym": "changed",
    "unloaded.pym": "recovered",
    "new.pym": "",
    "deleted.pym": "old",
  });
});

test("matching ten thousand cached sources does one path-index pass, independent of computer speed", () => {
  let pathReads = 0;
  const files = Array.from({ length: 10000 }, (_, i) => ({
    get path() {
      pathReads++;
      return `${i}.pym`;
    },
    text: String(i),
  }));
  const buffers = Object.fromEntries(
    Array.from({ length: 10000 }, (_, i) => [`${i}.pym`, String(i)]),
  );
  assert.deepEqual(unsavedBuffers(buffers, files), {});
  assert.equal(pathReads, 10000);
});
