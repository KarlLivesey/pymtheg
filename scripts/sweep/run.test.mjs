// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { lineForOffset, linkShares, processFailure, selectSearchSample, summarizeIndex } from "./run.mjs";

test("groups released diagnostics while retaining counts and concrete samples", async () => {
  const fixture = JSON.parse(await readFile(new URL("fixtures/index.json", import.meta.url), "utf8"));
  const index = await summarizeIndex(fixture, async ({ range }) => range ? lineForOffset("01234567890\r\n😀123\nrest", range.start) : null);
  assert.deepEqual(index.fileCounts, { go: 3, rust: 1, typescript: 2 });
  assert.equal(index.failedFileCount, 5);
  assert.equal(index.partialFileCount, 1);
  assert.equal(index.complete, false);
  assert.deepEqual(index.failures[0], {
    language: "go", reason: "Syntax error: found `}`", count: 3, files: ["a.go", "b.go", "c.go"], examples: [
      { file: "a.go", line: 2, message: "syntax error in line 3: found `}`" },
      { file: "b.go", line: 3, message: "syntax error in lines 5–6: found `}`" },
    ],
  });
  assert.equal(index.failures.find(({ language }) => language === null).examples[0].line, null);
  assert.equal(index.failures.find(({ language }) => language === "typescript").reason, "Syntax error: Expression expected.");
  assert.deepEqual(index.errors.resolutionErrors, {
    count: 1, examples: [{ module: "rust", message: "budget exhausted" }],
  });
  assert.deepEqual(index.links.percentages, { resolved: 50, ambiguous: 12.5, unresolved: 37.5 });
  assert.equal(linkShares({ links: 0, ambiguous: 0, unresolved: 0 }).percentages, null);
  assert.throws(() => linkShares({ links: 1, ambiguous: 1, unresolved: 1 }), /Invalid/);
});

test("classifies timeouts and explicit memory errors without guessing the cause of SIGKILL", () => {
  assert.equal(processFailure({ code: 124 }, "").outcome, "wall-limit");
  assert.equal(processFailure({ code: 137 }, "timeout: sending signal KILL to command").outcome, "wall-limit");
  assert.equal(processFailure({ code: 137 }, "Killed").outcome, "crashed");
  assert.equal(processFailure({ code: 134 }, "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory").outcome, "killed-for-memory");
  assert.deepEqual(processFailure({ code: 3 }, "first\n2\n3\n4\n5\n6\n7\n", "Graph error"), {
    outcome: "crashed", code: 3, message: "Graph error", stderrTail: ["2", "3", "4", "5", "6", "7"],
  });
});

test("selects a language match with the released symbol reference", () => {
  const match = { file: "app.ts", id: `symbol:${"a".repeat(64)}` };
  assert.equal(selectSearchSample([{ ...match, file: "app.go" }, { ...match, id: "init" }, match], "typescript"), match);
  assert.equal(selectSearchSample([{ ...match, file: "app.go" }], "typescript"), undefined);
});
