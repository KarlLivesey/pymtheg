import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { scaffold } from "../dist/contracts/scaffold.js";
import { runProcess } from "../dist/backends/process.js";
const fixture =
  "type Item = { count: Nat, title: String }; type Failure = Missing | Rejected(String); resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; } op process(take file: File, items: List<Item>) -> Result<Item, Failure> effects(io.Files);";

test("Rust reserved callable names compile without warnings and preserve existing snake-case names", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pym-rust-names-"));
  try {
    const file = join(root, "design.pym");
    await writeFile(
      file,
      "rule loop() -> Bool = true; rule loop_contract() -> Bool = false;",
    );
    const output = scaffold(analyseFile(file).ir, "rust");
    const generated = join(root, "lib.rs");
    await writeFile(generated, output.source);
    const result = await runProcess(
      "rustc",
      [
        "--edition",
        "2021",
        "--crate-type",
        "lib",
        "--deny",
        "warnings",
        generated,
        "-o",
        join(root, "lib.rlib"),
      ],
      { cwd: root, timeoutMs: 45000 },
    );
    if (result.kind === "spawn_failed" || result.kind === "timed_out") {
      t.skip(
        "Rust compiler unavailable or explicit budget exhausted; no compiler evidence",
      );
      return;
    }
    assert.equal(result.kind, "exited");
    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(output.source, /pub fn loop_contract\(/);
    assert.match(output.source, /pub fn loop_contract2\(/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
for (const target of ["rust", "go"])
  test(`real ${target} parser accepts generated types and empty signatures`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pym-target-"));
    try {
      const file = join(root, "design.pym");
      await writeFile(file, fixture);
      const { ir, report } = analyseFile(file);
      assert.equal(
        report.diagnostics.filter((d) => d.severity === "error").length,
        0,
        JSON.stringify(report.diagnostics),
      );
      const out = scaffold(ir, target, "empty");
      assert.deepEqual(out.omitted, []);
      const generated = join(root, "contracts" + out.extension);
      await writeFile(generated, out.source);
      const result =
        target === "rust"
          ? await runProcess(
              "rustfmt",
              ["--emit", "stdout", "--edition", "2021", generated],
              { cwd: root, timeoutMs: 45000 },
            )
          : await runProcess(
              process.env.PYM_GO ?? "go",
              ["run", resolve("scripts/inspect-go.go"), "--", generated],
              {
                cwd: root,
                timeoutMs: 120000,
                env: {
                  ...process.env,
                  GOCACHE: "/tmp/pym-go-build-cache",
                  GOTOOLCHAIN: "local",
                  GO111MODULE: "off",
                },
              },
            );
      if (result.kind === "spawn_failed") {
        t.skip(`Required ${target} parser is unavailable; no syntax evidence`);
        return;
      }
      if (result.kind === "timed_out") {
        t.skip(
          "Explicit parser resource budget exhausted; syntax evidence unresolved",
        );
        return;
      }
      assert.equal(result.kind, "exited");
      assert.equal(result.code, 0, result.stderr + result.stdout);
      if (target === "go")
        assert.equal(JSON.parse(result.stdout).emptyFunctions, 5);
      else assert.match(result.stdout, /pub fn process/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

for (const target of ["typescript", "rust", "go"])
  test(`real ${target} compiler accepts fail-fast stubs returning records, outcomes, booleans and Unit`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pym-compile-"));
    try {
      const file = join(root, "design.pym");
      await writeFile(
        file,
        `type Input = { enabled: Bool, name: String${target === "go" ? ", count: Nat" : ""} }; type Failure = Missing | Rejected(Input); op use(input: Input) -> Unit; op record(input: Input) -> Input; op result(input: Input) -> Result<Input, Failure>; op flag() -> Bool;`,
      );
      const { ir, report } = analyseFile(file);
      assert.equal(
        report.diagnostics.filter((d) => d.severity === "error").length,
        0,
      );
      const generated = join(
        root,
        "contracts" + { typescript: ".ts", rust: ".rs", go: ".go" }[target],
      );
      await writeFile(generated, scaffold(ir, target).source);
      const result =
        target === "typescript"
          ? await runProcess(
              process.execPath,
              [
                resolve("node_modules/typescript/bin/tsc"),
                "--strict",
                "--target",
                "es2022",
                "--skipLibCheck",
                "--noEmit",
                generated,
              ],
              { cwd: root, timeoutMs: 45000 },
            )
          : target === "rust"
            ? await runProcess(
                "rustc",
                [
                  "--edition",
                  "2021",
                  "--crate-type",
                  "lib",
                  "--emit",
                  "metadata",
                  generated,
                ],
                { cwd: root, timeoutMs: 45000 },
              )
            : await runProcess(process.env.PYM_GO ?? "go", ["test"], {
                cwd: root,
                timeoutMs: 120000,
                env: {
                  ...process.env,
                  GOCACHE: "/tmp/pym-go-build-cache",
                  GOTOOLCHAIN: "local",
                  GO111MODULE: "off",
                },
              });
      if (result.kind === "spawn_failed") {
        t.skip("Native compiler unavailable; type validation unresolved");
        return;
      }
      if (result.kind === "timed_out") {
        t.skip(
          "Explicit compiler budget exhausted; type validation unresolved",
        );
        return;
      }
      assert.equal(result.kind, "exited");
      assert.equal(result.code, 0, result.stderr);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test("real Rust compiler accepts normalized names without snake-case warnings", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-rust-exact-names-"));
  try {
    const file = join(root, "design.pym");
    await writeFile(
      file,
      "type Input = { orderId: String, order_id: String }; op takeOrder(orderId: String, order_id: String) -> Bool; op take_order(order_id: String) -> Bool;",
    );
    const { ir, report } = analyseFile(file);
    assert.equal(
      report.diagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    for (const mode of ["stubs", "contracts"]) {
      const generated = join(root, mode + ".rs");
      await writeFile(
        generated,
        scaffold(ir, "rust", "fail-fast", mode).source,
      );
      const result = await runProcess(
        "rustc",
        [
          "--edition",
          "2021",
          "--crate-type",
          "lib",
          "--emit",
          "metadata",
          "-D",
          "non_snake_case",
          generated,
        ],
        { cwd: root, timeoutMs: 45000 },
      );
      assert.equal(result.kind, "exited", JSON.stringify(result));
      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.stderr, "");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
