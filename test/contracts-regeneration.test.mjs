import { controlledClock } from "./controlled-clock.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { scaffold } from "../dist/contracts/scaffold.js";
import { compareContractManifests } from "../dist/contracts/manifest.js";
import { initializeWorkspace } from "../dist/project/workspace.js";
test("initialized project contract IDs do not depend on the selected entry directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "pym-contract-root-"));
  try {
    await initializeWorkspace(root);
    mkdirSync(join(root, "design"));
    writeFileSync(join(root, "design", "pay.pym"), "op pay(n: Nat) -> Unit;");
    writeFileSync(join(root, "main.pym"), 'import "design/pay.pym";');
    const { spawnSync } = await import("node:child_process");
    const entry = new URL("../dist/cli/main.js", import.meta.url).pathname;
    const read = (file) => {
      const result = spawnSync(
        process.execPath,
        [entry, "scaffold", join(root, file), "--format", "json"],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.equal(output.symbols[0].symbolId, "design/pay.pym#pay");
      assert.equal(output.symbols[0].span.file, "design/pay.pym");
      return output.contractManifest;
    };
    const before = read("design/pay.pym"),
      after = read("main.pym");
    assert.equal(before.entries[0].id, "design/pay.pym#pay");
    const change = compareContractManifests(before, after);
    assert.deepEqual(change.moved, []);
    assert.equal(change.matches, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("contract change summaries name fields and inputs in source language", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-readable-contracts-"));
  try {
    const file = join(root, "design.pym");
    const manifest = (source) => {
      writeFileSync(file, source);
      return scaffold(analyseFile(file).ir).contractManifest;
    };
    const before = manifest(
      "type Order = { quantity: Nat }; op price(limit: Nat) -> Nat;",
    );
    const after = manifest(
      "type Order = { quantity: Int }; op price(limit: Nat, urgent: Bool) -> Int;",
    );
    const change = compareContractManifests(before, after);
    assert.ok(
      change.changed
        .find((e) => e.id.endsWith("#Order"))
        .details.includes("Field quantity type: Nat → Int"),
    );
    const price = change.changed.find((e) => e.id.endsWith("#price")).details;
    assert.ok(price.includes("Input 2: absent → urgent: Bool"));
    assert.ok(price.includes("Output type: Nat → Int"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("contracts output separates implementation and reports portable signature changes", () => {
  const root = mkdtempSync(join(tmpdir(), "pym-contracts-"));
  try {
    const read = (name, source) => {
      const file = join(root, name);
      writeFileSync(file, source);
      return analyseFile(file).ir;
    };
    const ir = read(
      "design.pym",
      "type Input = { name: String }; op decide(value: Input) -> Bool;",
    );
    const baseline = scaffold(ir, "typescript", "fail-fast", "contracts");
    assert.match(baseline.source, /export interface PymthegContracts/);
    assert.doesNotMatch(baseline.source, /throw new|export function/);
    assert.equal(baseline.implementation, "declarations");
    for (const [target, marker] of [
      ["rust", /pub trait PymthegContracts/],
      ["go", /type PymthegContracts interface/],
    ]) {
      const result = scaffold(ir, target, "fail-fast", "contracts");
      assert.match(result.source, marker);
      assert.doesNotMatch(result.source, /todo!|panic\(/);
    }
    const comment = scaffold(
      read(
        "design.pym",
        "// additional context\ntype Input = { name: String }; op decide(value: Input) -> Bool;",
      ),
    );
    assert.equal(
      compareContractManifests(
        baseline.contractManifest,
        comment.contractManifest,
      ).matches,
      true,
    );
    const changed = scaffold(
      read(
        "design.pym",
        "type Input = { name: String }; op decide(value: Input) -> String; op extra() -> Unit;",
      ),
    );
    const drift = compareContractManifests(
      baseline.contractManifest,
      changed.contractManifest,
    );
    assert.deepEqual(
      drift.changed.map((e) => e.id),
      ["design.pym#decide"],
    );
    assert.deepEqual(drift.added, ["design.pym#extra"]);
    assert.equal(drift.matches, false);
    const unfinished = scaffold(
      read(
        "body.pym",
        'flow work() -> Unit { unknown "implementation decision"; }',
      ),
    );
    const finished = scaffold(read("body.pym", "flow work() -> Unit {}"));
    assert.equal(
      compareContractManifests(
        unfinished.contractManifest,
        finished.contractManifest,
      ).matches,
      true,
      "implementation holes do not change a declared signature",
    );
    const movedRoot = mkdtempSync(join(tmpdir(), "pym-other-root-"));
    try {
      const file = join(movedRoot, "design.pym");
      writeFileSync(
        file,
        "type Input = { name: String }; op decide(value: Input) -> Bool;",
      );
      assert.equal(
        compareContractManifests(
          baseline.contractManifest,
          scaffold(analyseFile(file).ir).contractManifest,
        ).matches,
        true,
      );
    } finally {
      rmSync(movedRoot, { recursive: true, force: true });
    }
    assert.throws(
      () =>
        compareContractManifests(
          {
            ...baseline.contractManifest,
            entries: [{ id: "bad", contract: "{" }],
          },
          changed.contractManifest,
        ),
      /JSON object/,
    );
    assert.throws(
      () =>
        compareContractManifests(
          {
            ...baseline.contractManifest,
            entries: [
              ...baseline.contractManifest.entries,
              baseline.contractManifest.entries[0],
            ],
          },
          changed.contractManifest,
        ),
      /duplicate identities/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI saves a comparison baseline and detects drift without touching an implementation", async () => {
  const { spawnSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "pym-manifest-cli-"));
  try {
    const design = join(root, "design.pym"),
      baseline = join(root, "baseline.json"),
      impl = join(root, "implementation.ts");
    writeFileSync(design, "op decide() -> Bool;");
    writeFileSync(impl, "// hand written code\n");
    const cli = (...args) =>
      spawnSync(
        process.execPath,
        ["dist/cli/main.js", "scaffold", design, ...args],
        { encoding: "utf8" },
      );
    const initial = cli("--mode", "contracts", "--manifest", baseline);
    assert.equal(initial.status, 0, initial.stderr);
    assert.match(initial.stdout, /interface PymthegContracts/);
    assert.equal(cli("--check", baseline).status, 0);
    writeFileSync(design, "op decide() -> String;");
    const changed = cli("--check", baseline, "--format", "json");
    assert.equal(changed.status, 1, changed.stderr);
    assert.deepEqual(
      JSON.parse(changed.stdout).changed.map((e) => e.id),
      ["design.pym#decide"],
    );
    assert.equal(readFileSync(impl, "utf8"), "// hand written code\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("plugin contracts mode must be confirmed and the shipped plugin emits no function bodies", async () => {
  const { emitPlugin } = await import("../dist/contracts/plugins.js");
  const { contractDocument } = await import("../dist/contracts/document.js");
  const { resolve } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "pym-contract-plugin-"));
  try {
    const file = join(root, "design.pym");
    writeFileSync(file, "op decide() -> Bool;");
    const doc = {
      ...contractDocument(analyseFile(file).ir),
      outputMode: "contracts",
    };
    const result = await emitPlugin(
      doc,
      resolve("examples/plugins/javascript.mjs"),
      "javascript",
      new AbortController().signal,
      { clock: controlledClock() },
    );
    assert.equal(result.implementation, "declarations");
    assert.doesNotMatch(result.source, /export function|throw new/);
    assert.match(result.source, /PymthegContracts/);
    const legacy = join(root, "legacy.mjs");
    writeFileSync(
      legacy,
      'export const apiVersion="pymtheg.emitter/v1",target="legacy",extension=".l"; export function emit(d) {return {source:"",symbols:d.declarations.map(x=>({symbolId:x.symbolId,name:x.name})),notes:[],dependencies:[]};}',
    );
    await assert.rejects(
      emitPlugin(doc, legacy, "legacy", new AbortController().signal, {
        clock: controlledClock(),
      }),
      /does not confirm contracts-only/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("incomplete baseline coverage cannot turn unknown contracts into additions or a match", () => {
  const empty = {
    schema: "pymtheg.contract-manifest/v1",
    snapshotId: "old",
    entries: [],
    omitted: [{ name: "design.pym", reason: "Syntax recovery" }],
  };
  const complete = {
    ...empty,
    snapshotId: "new",
    entries: [{ id: "design.pym#work", contract: '{"name":"work"}' }],
    omitted: [],
  };
  const drift = compareContractManifests(empty, complete);
  assert.equal(drift.matches, false);
  assert.deepEqual(drift.added, []);
  assert.equal(drift.incomplete.length, 1);
  assert.match(drift.incomplete[0].reason, /baseline/i);
  const reverse = compareContractManifests(complete, empty);
  assert.deepEqual(reverse.removed, []);
  assert.equal(reverse.matches, false);
});

test("a broken design never silently replaces a saved contract baseline", async () => {
  const { spawnSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "pym-safe-baseline-"));
  try {
    const design = join(root, "design.pym"),
      baseline = join(root, "baseline.json");
    const cli = (...args) =>
      spawnSync(
        process.execPath,
        [
          "dist/cli/main.js",
          "scaffold",
          design,
          "--manifest",
          baseline,
          ...args,
        ],
        { encoding: "utf8" },
      );
    writeFileSync(design, "op decide() -> Bool;");
    assert.equal(cli().status, 0);
    const saved = readFileSync(baseline, "utf8");
    writeFileSync(design, "op decide(;");
    const broken = cli();
    assert.notEqual(broken.status, 0);
    assert.equal(readFileSync(baseline, "utf8"), saved);
    assert.match(broken.stderr, /baseline.*not saved|not saved.*baseline/i);
    assert.equal(cli("--allow-incomplete").status, 2);
    assert.ok(JSON.parse(readFileSync(baseline, "utf8")).omitted.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("manifest comparison follows unambiguous declaration moves and describes result changes", () => {
  const manifest = (file, result = "Bool") => ({
    schema: "pymtheg.contract-manifest/v1",
    snapshotId: file,
    omitted: [],
    entries: [
      {
        id: file + "#decide",
        contract: JSON.stringify({
          kind: "callable",
          symbolId: file + "#decide",
          name: "decide",
          parameters: [],
          result: { kind: "primitive", name: result },
        }),
      },
    ],
  });
  assert.equal(
    compareContractManifests(manifest("design.pym"), manifest("orders.pym"))
      .matches,
    true,
  );
  const changed = compareContractManifests(
    manifest("design.pym"),
    manifest("orders.pym", "String"),
  );
  assert.deepEqual(changed.added, []);
  assert.deepEqual(changed.removed, []);
  assert.equal(changed.changed.length, 1);
  assert.ok(
    changed.changed[0].details.some(
      (s) => s.includes("Bool") && s.includes("String"),
    ),
  );
  const ambiguous = manifest("design.pym");
  ambiguous.entries.push({ ...ambiguous.entries[0], id: "other.pym#decide" });
  assert.equal(
    compareContractManifests(ambiguous, manifest("orders.pym")).changed.length,
    0,
  );
  assert.equal(
    compareContractManifests(ambiguous, manifest("orders.pym")).added.length,
    1,
  );
});

test("CLI contract comparison keeps current design errors visible even when signatures match", async () => {
  const { spawnSync } = await import("node:child_process");
  const { readFileSync } = await import("node:fs");
  const root = mkdtempSync(join(tmpdir(), "pym-contract-errors-"));
  try {
    const file = join(root, "design.pym"),
      manifest = join(root, "contracts.json");
    const original =
      "op charge(n: Nat) -> Unit; flow caller() -> Unit { call charge(1); }";
    writeFileSync(file, original);
    const run = (...args) =>
      spawnSync(
        process.execPath,
        [
          new URL("../dist/cli/main.js", import.meta.url).pathname,
          "scaffold",
          file,
          ...args,
        ],
        { encoding: "utf8" },
      );
    assert.equal(run("--manifest", manifest).status, 0);
    const baseline = readFileSync(manifest, "utf8");
    writeFileSync(file, original.replace("charge(1)", "charge()"));
    const result = run("--check", manifest);
    assert.equal(result.status, 1, result.stderr + result.stdout);
    assert.match(result.stdout, /current design has errors/);
    assert.match(result.stdout, /T004/);
    assert.equal(readFileSync(manifest, "utf8"), baseline);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inserting a named input reports the addition without pretending following inputs were renamed", () => {
  const file = "/tmp/contract-insert-input.pym";
  const manifest = (source) =>
    scaffold(analyseFile(file, () => {}, { buffers: { [file]: source } }).ir)
      .contractManifest;
  const before = manifest("op book(patient: String, minutes: Nat) -> Unit;");
  const after = manifest(
    "op book(patient: String, clinic: String, minutes: Nat) -> Unit;",
  );
  const delta = compareContractManifests(before, after);
  assert.equal(delta.changed.length, 1);
  const changes = delta.changed[0].details.join("\n");
  assert.match(changes, /clinic/);
  assert.doesNotMatch(changes, /minutes.*clinic|name minutes/);
});
