// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { DraftWriter } from "../dist/architecture/draft-writer.js";
const draft = (text) => ({
  kind: "document",
  baseRevision: "base",
  label: "Decision",
  document: { path: "decision.md", text },
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
test("draft writes coalesce to the latest value using acknowledgement ordering", async () => {
  const started = [deferred(), deferred()];
  const pending = [],
    writer = new DraftWriter(7, null, (version, value) => {
      const result = deferred();
      pending.push({ version, value, ...result });
      started[pending.length - 1].resolve();
      return result.promise;
    });
  writer.persist(draft("first"));
  await started[0].promise;
  writer.persist(draft("second"));
  writer.persist(draft("latest"));
  assert.equal(pending.length, 1);
  assert.equal(pending[0].version, 7);
  pending[0].resolve({ version: 8, draft: pending[0].value });
  await started[1].promise;
  assert.equal(pending.length, 2);
  assert.equal(pending[1].version, 8);
  assert.equal(pending[1].value.document.text, "latest");
  pending[1].resolve({ version: 9, draft: pending[1].value });
  await writer.flush();
  assert.equal(writer.pending, false);
  assert.equal(writer.value.document.text, "latest");
});
test("a conflicting writer preserves later local edits even when discard is attempted", async () => {
  const result = deferred(),
    started = deferred();
  let writes = 0;
  const writer = new DraftWriter(0, null, () => {
    writes++;
    started.resolve();
    return result.promise;
  });
  writer.persist(draft("before conflict"));
  await started.promise;
  result.reject(Error("Another session changed this draft"));
  await writer.flush();
  writer.persist(draft("local work after conflict"));
  await assert.rejects(writer.clear(), /local content is still available/);
  assert.equal(writer.value.document.text, "local work after conflict");
  assert.equal(writer.blocked, true);
  assert.equal(writes, 1);
});
test("a failed clear preserves the local draft and never claims that a record was saved", async () => {
  const result = deferred(),
    started = deferred(),
    writer = new DraftWriter(4, draft("keep this"), () => {
      started.resolve();
      return result.promise;
    });
  const clearing = writer.clear();
  await started.promise;
  result.reject(Error("Disk unavailable"));
  await assert.rejects(clearing, /could not be cleared/);
  assert.equal(writer.value.document.text, "keep this");
  assert.equal(writer.blocked, true);
});

test("a synchronously failing persistence adapter still reaches a settled blocked state", async () => {
  const writer = new DraftWriter(0, null, () => {
    throw Error("Persistence unavailable");
  });
  writer.persist(draft("still local"));
  await writer.flush();
  assert.equal(writer.pending, false);
  assert.equal(writer.blocked, true);
  assert.equal(writer.value.document.text, "still local");
});
