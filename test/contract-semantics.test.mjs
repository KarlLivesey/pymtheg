import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { contractDocument } from "../dist/contracts/document.js";
import {
  contractManifest,
  compareContractManifests,
} from "../dist/contracts/manifest.js";
const cases = [
  [
    "cost quality",
    "op fetch() -> Unit cost remote_calls exact 1;",
    "op fetch() -> Unit cost remote_calls upper 1;",
    false,
  ],
  [
    "stability promise",
    "op fetch() -> Unit;",
    "op fetch() -> Unit stable;",
    false,
  ],
  [
    "atomicity promise",
    "op fetch() -> Unit;",
    "op fetch() -> Unit atomic;",
    false,
  ],
  [
    "resource transition",
    "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; }",
    "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; Closed -> Closed; }",
    false,
  ],
  [
    "precondition formatting",
    "op fetch(n: Nat) -> Unit requires n > 0;",
    "op fetch(n: Nat) -> Unit requires (n>0);",
    true,
  ],
  [
    "precondition comment",
    "op fetch(n: Nat) -> Unit requires n > 0;",
    "op fetch(n: Nat) -> Unit requires n // context\n > 0;",
    true,
  ],
  [
    "changed condition",
    "op fetch(n: Nat) -> Unit requires n > 0;",
    "op fetch(n: Nat) -> Unit requires n > 1;",
    false,
  ],
  [
    "string contents",
    'op fetch(s: String) -> Unit requires s == "two words";',
    'op fetch(s: String) -> Unit requires s == "two  words";',
    false,
  ],
  [
    "cost formatting",
    "op fetch(n: Nat) -> Unit cost remote_calls upper n + 1;",
    "op fetch(n: Nat) -> Unit cost remote_calls upper (n+1);",
    true,
  ],
];
for (const [name, before, after, matches] of cases)
  test(`contract semantic drift: ${name}`, () => {
    const root = mkdtempSync(join(tmpdir(), "pym-contract-semantic-"));
    try {
      const file = join(root, "design.pym");
      const make = (source) => {
        writeFileSync(file, source);
        const { ir, report } = analyseFile(file);
        assert.deepEqual(
          report.diagnostics.filter((d) => d.severity === "error"),
          [],
        );
        return contractManifest(contractDocument(ir));
      };
      const previous = make(before),
        current = make(after);
      const drift = compareContractManifests(previous, current);
      assert.equal(drift.matches, matches, JSON.stringify(drift));
      if (!matches) assert.equal(drift.changed.length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
