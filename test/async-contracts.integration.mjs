import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import ts from "typescript";
import { analyseFile } from "../dist/analysis/index.js";
import { scaffold } from "../dist/contracts/scaffold.js";
import { emitImplementationCheck } from "../dist/contracts/implementation-check.js";
import { runProcess } from "../dist/backends/process.js";
test("effectful TypeScript boundaries accept idiomatic async code and retain exact-input drift checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-async-contract-"));
  try {
    const file = join(root, "main.pym");
    const source =
      "op fetch(n: Nat) -> Bool effects(remote.Inventory); flow check(n: Nat) -> Bool effects(remote.Inventory) { call fetch(n) as answer; return answer; } rule local(n: Nat) -> Bool = n > 0;";
    await writeFile(file, source);
    const { ir } = analyseFile(file);
    const contracts = scaffold(ir, "typescript", "fail-fast", "contracts");
    assert.match(contracts.source, /fetch\(n: bigint\): Promise<boolean>/);
    assert.match(contracts.source, /check\(n: bigint\): Promise<boolean>/);
    assert.match(contracts.source, /local\(n: bigint\): boolean/);
    await writeFile(join(root, "contracts.ts"), contracts.source);
    await writeFile(
      join(root, "implementation.ts"),
      "export class Service { async fetch(n: bigint) { return n > 0n; } async check(n: bigint) { return this.fetch(n); } local(n: bigint) { return n > 0n; } }",
    );
    const check = emitImplementationCheck(contracts, {
      target: "typescript",
      contractsModule: "./contracts",
      implementationModule: "./implementation",
      implementationType: "Service",
    });
    await writeFile(join(root, "verify.ts"), check.source);
    const compile = () =>
      runProcess(
        process.execPath,
        [
          resolve("node_modules/typescript/bin/tsc"),
          "--strict",
          "--target",
          "ES2022",
          "--noEmit",
          "--skipLibCheck",
          "verify.ts",
        ],
        { cwd: root, timeoutMs: 30000, maxBytes: 50000 },
      );
    const good = await compile();
    assert.equal(good.kind, "exited");
    assert.equal(good.code, 0, good.stdout + good.stderr);
    const stubs = scaffold(ir).source;
    assert.match(stubs, /export async function fetch/);
    const js = ts.transpileModule(stubs, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    const generated = await import(
      "data:text/javascript;base64," + Buffer.from(js).toString("base64")
    );
    await assert.rejects(generated.fetch(1n), /Not implemented/);
    await writeFile(
      file,
      source.replace("op fetch(n: Nat)", "op fetch(n: Nat, key: String)"),
    );
    await writeFile(
      join(root, "contracts.ts"),
      scaffold(analyseFile(file).ir, "typescript", "fail-fast", "contracts")
        .source,
    );
    const stale = await compile();
    assert.equal(stale.kind, "exited");
    assert.notEqual(
      stale.code,
      0,
      "The real compiler must reject the stale async input list",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
