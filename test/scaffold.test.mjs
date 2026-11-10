import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { scaffold } from "../dist/contracts/scaffold.js";
test("scaffold contains real typed declarations and explicitly selected empty function bodies", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-scaffold-"));
  try {
    const file = join(root, "source.pym");
    await writeFile(
      file,
      "type Receipt = { id: String }; type Error = Declined; op pay(amount: Nat) -> Result<Receipt, Error> effects(remote.Payment); rule positive(n: Nat) -> Bool = n > 0;",
    );
    const { ir } = analyseFile(file);
    const result = scaffold(ir, "typescript", "empty");
    assert.deepEqual(result.omitted, []);
    const tree = ts.createSourceFile(
      "scaffold.ts",
      result.source,
      ts.ScriptTarget.Latest,
      true,
    );
    assert.equal(tree.parseDiagnostics.length, 0);
    const functions = tree.statements.filter(ts.isFunctionDeclaration);
    assert.equal(functions.length, 2);
    assert.ok(
      functions.every((fn) => fn.body && fn.body.statements.length === 0),
    );
    assert.match(result.source, /amount: bigint/);
    assert.match(result.source, /readonly "id": string/);
    assert.match(result.source, /Effects: remote.Payment/);
    assert.match(result.source, /intentionally left empty/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a missing body decision preserves a declared signature and its open obligation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-scaffold-"));
  try {
    const file = join(root, "source.pym");
    await writeFile(
      file,
      'flow missing() -> Unit { unknown "how does this work?"; } rule independent(n: Nat) -> Bool = n > 0;',
    );
    const { ir } = analyseFile(file);
    const result = scaffold(ir);
    assert.ok(!result.omitted.some((x) => x.name === "missing"));
    assert.match(result.source, /function missing/);
    assert.match(result.source, /Open decision:.*how does this work/);
    assert.match(result.source, /function independent/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an unresolved signature type is still omitted", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-unresolved-output-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, "flow broken(x: MissingType) -> Unit {}");
    const output = scaffold(analyseFile(file).ir);
    assert.ok(output.omitted.some((d) => d.name === "broken"));
    assert.doesNotMatch(output.source, /function broken/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const target of ["typescript", "rust", "go"]) {
  test(`${target} defaults to fail-fast for every callable and retains optional empty bodies`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pym-stubs-"));
    try {
      const file = join(root, "source.pym");
      await writeFile(file, "op flag() -> Bool; op finish() -> Unit;");
      const { ir } = analyseFile(file);
      const result = scaffold(ir, target);
      assert.equal(result.implementation, "fail-fast");
      assert.equal(
        result.source.match(
          /(?:throw new Error|todo!|panic)\("Not implemented"\)/g,
        )?.length,
        2,
      );
      const empty = scaffold(ir, target, "empty");
      assert.equal(empty.implementation, "empty");
      assert.doesNotMatch(empty.source, /(?:throw new Error|todo!|panic)\(/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("generated TypeScript fails immediately instead of returning a fabricated value or silently completing Unit", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-stub-runtime-"));
  try {
    const file = join(root, "source.pym");
    await writeFile(file, "op enabled() -> Bool; op finish() -> Unit;");
    const source = scaffold(analyseFile(file).ir).source;
    const js = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    const generated = await import(
      "data:text/javascript;base64," + Buffer.from(js).toString("base64")
    );
    assert.throws(() => generated.enabled(), /Not implemented/);
    assert.throws(() => generated.finish(), /Not implemented/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Rust parameter names use collision-safe snake case for stubs and traits", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-rust-params-"));
  try {
    const file = join(root, "source.pym");
    await writeFile(
      file,
      "op charge(orderId: String, order_id: String) -> Bool;",
    );
    const ir = analyseFile(file).ir;
    for (const mode of ["stubs", "contracts"]) {
      const output = scaffold(ir, "rust", "fail-fast", mode).source;
      assert.match(
        output,
        /order_id2: std::string::String, order_id: std::string::String/,
      );
      assert.doesNotMatch(output, /orderId:/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Rust names preserve existing spellings across normalization and stay idiomatic", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-rust-names-"));
  try {
    const file = join(root, "source.pym");
    await writeFile(
      file,
      "type Input = { orderId: String, order_id: String }; op takeOrder(orderId: String, order_id: String) -> Bool; op take_order(order_id: String) -> Bool;",
    );
    for (const mode of ["stubs", "contracts"]) {
      const output = scaffold(
        analyseFile(file).ir,
        "rust",
        "fail-fast",
        mode,
      ).source;
      assert.match(output, /fn take_order2\(/);
      assert.match(output, /fn take_order\(/);
      assert.match(
        output,
        /order_id2: std::string::String, order_id: std::string::String/,
      );
      assert.match(output, /pub order_id2: std::string::String/);
      assert.match(output, /pub order_id: std::string::String/);
      assert.doesNotMatch(output, /(?:pub |fn )orderId|fn takeOrder/);
    }
    await writeFile(
      file,
      "op send(class: String, classValue: String) -> Bool;",
    );
    const tsOutput = scaffold(analyseFile(file).ir, "typescript").source;
    assert.match(tsOutput, /classValue2: string, classValue: string/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
