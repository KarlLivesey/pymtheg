import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { scaffold } from "../dist/contracts/scaffold.js";
import { runProcess } from "../dist/backends/process.js";

// A precise, truthful reason why a real compiler run gives no evidence, or
// undefined when the run produced a real compiler verdict.
function unavailableReason(target, result, timeoutMs) {
  const tool =
    target === "typescript" ? "tsc" : target === "rust" ? "cargo" : "go";
  if (result.kind === "spawn_failed")
    return `${tool} could not be started (${(result.stderr || "spawn failed").trim()})`;
  if (result.kind === "timed_out")
    return `${tool} exceeded its explicit ${timeoutMs} ms budget; unresolved`;
  if (target !== "rust") return undefined;
  const download = /failed to download `([^`]+)`/.exec(result.stderr);
  if (download)
    return `crate ${download[1]} pinned by test/fixtures/rust-rich/Cargo.lock is not in the offline cargo cache`;
  const missing = /no matching package named `([^`]+)` found/.exec(
    result.stderr,
  );
  if (missing)
    return `crate ${missing[1]} is not in the offline cargo registry index`;
  if (/attempting to make an HTTP request/.test(result.stderr))
    return `cargo needed network access in --offline mode: ${result.stderr.trim().split("\n")[0]}`;
  return undefined;
}
for (const target of ["typescript", "rust", "go"])
  test(`${target}: regeneration preserves user code and compiler rejects incompatible contracts`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pym-regenerate-"));
    try {
      const spec = join(root, "design.pym");
      await writeFile(spec, "op decide(value: String) -> Bool;");
      const output = scaffold(
        analyseFile(spec).ir,
        target,
        "fail-fast",
        "contracts",
      );
      const generated = join(root, "contracts" + output.extension);
      const impl =
        target === "typescript"
          ? 'import type {PymthegContracts,PymthegImplementation} from "./contracts"; export class Implementation implements PymthegContracts { decide(value: string): boolean {return true;} } export type ContractCheck = PymthegImplementation<Implementation>;'
          : target === "rust"
            ? "mod contracts; struct Implementation; impl contracts::PymthegContracts for Implementation { fn decide(&self, value: String) -> bool {true} }"
            : "package contracts\ntype Implementation struct {}\nfunc (Implementation) Decide(value string) bool { return true }\nvar _ PymthegContracts = Implementation{}\n";
      const userFile = join(
        root,
        target === "typescript"
          ? "implementation.ts"
          : target === "rust"
            ? "lib.rs"
            : "implementation.go",
      );
      await writeFile(userFile, impl);
      await writeFile(generated, output.source);
      const compiler = () =>
        target === "typescript"
          ? runProcess(
              process.execPath,
              [
                resolve("node_modules/typescript/bin/tsc"),
                "--strict",
                "--noEmit",
                "--target",
                "es2022",
                "--skipLibCheck",
                userFile,
              ],
              { cwd: root, timeoutMs: 45000 },
            )
          : target === "rust"
            ? runProcess(
                "rustc",
                [
                  "--edition",
                  "2021",
                  "--crate-type",
                  "lib",
                  "--emit",
                  "metadata",
                  userFile,
                ],
                { cwd: root, timeoutMs: 45000 },
              )
            : runProcess(process.env.PYM_GO ?? "go", ["test"], {
                cwd: root,
                timeoutMs: 45000,
                env: {
                  ...process.env,
                  GOTOOLCHAIN: "local",
                  GO111MODULE: "off",
                  GOCACHE: "/tmp/pym-go-build-cache",
                },
              });
      const before = await compiler();
      if (before.kind === "spawn_failed" || before.kind === "timed_out") {
        t.skip(
          unavailableReason(target, before, 45000) + "; conformance unresolved",
        );
        return;
      }
      assert.equal(before.kind, "exited");
      assert.equal(before.code, 0, before.stderr + before.stdout);
      await writeFile(spec, "op decide(value: String, key: String) -> Bool;");
      await writeFile(
        generated,
        scaffold(analyseFile(spec).ir, target, "fail-fast", "contracts").source,
      );
      const added = await compiler();
      if (added.kind === "timed_out") {
        t.skip("Compiler budget exhausted; added-input check unresolved");
        return;
      }
      assert.equal(added.kind, "exited");
      assert.notEqual(
        added.code,
        0,
        "An unchanged implementation must fail after an input is added",
      );
      assert.match(added.stdout + added.stderr, /decide|Decide/);
      await writeFile(spec, "op decide(value: String) -> String;");
      await writeFile(
        generated,
        scaffold(analyseFile(spec).ir, target, "fail-fast", "contracts").source,
      );
      assert.equal(
        await readFile(userFile, "utf8"),
        impl,
        "Regeneration cannot overwrite implementation",
      );
      const after = await compiler();
      if (after.kind === "timed_out") {
        t.skip(
          "Explicit compiler budget exhausted; negative conformance unresolved",
        );
        return;
      }
      assert.equal(after.kind, "exited");
      assert.notEqual(after.code, 0);
      assert.match(after.stdout + after.stderr, /decide|Decide/);
      console.log(
        target +
          ": matching implementation accepted; changed return rejected; implementation bytes retained.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

for (const target of ["typescript", "rust", "go"])
  test(`${target}: real rich contracts compile with recursive records, outcomes and arbitrary precision integers`, async (t) => {
    const { copyFile, mkdir } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), "pym-rich-contracts-"));
    try {
      const prefix =
        "type Input = { count: Nat, delta: Int, children: List<Input> }; type Failure = Missing | Rejected(Input); ";
      const spec = join(root, "design.pym");
      await writeFile(
        spec,
        prefix + "op decide(value: Input) -> Result<Input, Failure>;",
      );
      const initial = scaffold(
        analyseFile(spec).ir,
        target,
        "fail-fast",
        "contracts",
      );
      assert.deepEqual(initial.omitted, []);
      if (target === "rust") {
        await mkdir(join(root, "src"));
        for (const name of ["Cargo.toml", "Cargo.lock"])
          await copyFile(
            resolve("test/fixtures/rust-rich", name),
            join(root, name),
          );
      }
      const generated = join(
        root,
        target === "rust"
          ? "src/contracts.rs"
          : "contracts" + initial.extension,
      );
      const implementation =
        target === "typescript"
          ? 'import type * as c from "./contracts"; export class Implementation implements c.PymthegContracts { decide(value:c.Input): c.Result<c.Input,c.Failure> {throw new Error("Not implemented");} }'
          : target === "rust"
            ? "mod contracts; struct Implementation; impl contracts::PymthegContracts for Implementation { fn decide(&self, value: contracts::Input) -> Result<contracts::Input, contracts::Failure> {unimplemented!()} }"
            : 'package contracts\ntype Implementation struct {}\nfunc (Implementation) Decide(value Input) Result[Input, Failure] {panic("Not implemented")}\nvar _ PymthegContracts = Implementation{}\n';
      const userFile = join(
        root,
        target === "typescript"
          ? "implementation.ts"
          : target === "rust"
            ? "src/lib.rs"
            : "implementation.go",
      );
      await writeFile(userFile, implementation);
      await writeFile(generated, initial.source);
      const options = {
        cwd: root,
        timeoutMs: 45000,
        env: {
          ...process.env,
          ...(process.env.PYM_CARGO_HOME
            ? { CARGO_HOME: process.env.PYM_CARGO_HOME }
            : {}),
          GO111MODULE: "off",
          GOTOOLCHAIN: "local",
          GOCACHE: "/tmp/pym-go-build-cache",
        },
      };
      const compile = () =>
        target === "typescript"
          ? runProcess(
              process.execPath,
              [
                resolve("node_modules/typescript/bin/tsc"),
                "--strict",
                "--noEmit",
                "--target",
                "es2022",
                "--skipLibCheck",
                userFile,
              ],
              options,
            )
          : target === "rust"
            ? runProcess("cargo", ["check", "--offline", "--locked"], options)
            : runProcess(process.env.PYM_GO ?? "go", ["test"], options);
      const first = await compile();
      const unavailable = unavailableReason(target, first, options.timeoutMs);
      if (unavailable) {
        t.skip(unavailable + "; no conformance claim");
        return;
      }
      assert.equal(first.kind, "exited");
      assert.equal(first.code, 0, first.stderr + first.stdout);
      await writeFile(spec, prefix + "op decide(value: Input) -> String;");
      await writeFile(
        generated,
        scaffold(analyseFile(spec).ir, target, "fail-fast", "contracts").source,
      );
      const second = await compile();
      if (second.kind === "timed_out") {
        t.skip(
          "Explicit compiler budget exhausted; changed-signature rejection unresolved",
        );
        return;
      }
      assert.equal(second.kind, "exited");
      assert.notEqual(second.code, 0);
      assert.match(second.stderr + second.stdout, /decide|Decide/);
      assert.equal(await readFile(userFile, "utf8"), implementation);
      console.log(
        `${target}: recursive arbitrary-precision contract accepted; changed result rejected; implementation preserved.`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
