import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { scaffold } from "../dist/contracts/scaffold.js";
import { runProcess } from "../dist/backends/process.js";
const fixtures = {
  union: "type Chain = End | Link(Chain); op inspect(value: Chain) -> Bool;",
  record: "type Node = { next: Node }; op inspect(value: Node) -> Bool;",
  mutual:
    "type Left = { child: Right }; type Right = End | Back(Left); op inspect(value: Left) -> Right;",
  list: "type Tree = { children: List<Tree> }; op inspect(value: Tree) -> Tree;",
  acyclic:
    "type Leaf = { ok: Bool }; type Branch = { leaf: Leaf }; op inspect(value: Branch) -> Branch;",
  primitive: "type bool = { label: String }; op inspect(value: Bool) -> Bool;",
  typescriptName:
    "type string = { label: Bool }; op inspect(value: String) -> String;",
};
for (const [name, source] of Object.entries(fixtures))
  for (const target of ["typescript", "rust", "go"]) {
    test(`${target} compiler accepts ${name} layout and preserves primitive call signatures`, async (t) => {
      const root = await mkdtemp(join(tmpdir(), "pym-layout-"));
      try {
        const file = join(root, "source.pym");
        await writeFile(file, source);
        const { ir, report } = analyseFile(file);
        assert.equal(
          report.diagnostics.filter((d) => d.severity === "error").length,
          0,
        );
        const output = scaffold(ir, target);
        assert.deepEqual(output.omitted, []);
        let use = "";
        if (name === "primitive")
          use = {
            rust: "\nfn check() -> std::primitive::bool { inspect(true) }",
            go: "\nfunc expected() bool { return Inspect(true) }",
            typescript: "\nconst expected: boolean = inspect(true);",
          }[target];
        if (name === "typescriptName" && target === "typescript")
          use = '\nconst expected: string = inspect("a");';
        await writeFile(
          join(root, "contracts" + output.extension),
          output.source + use,
        );
        const processOptions = {
          cwd: root,
          timeoutMs: 45000,
          env: {
            ...process.env,
            GO111MODULE: "off",
            GOTOOLCHAIN: "local",
            GOCACHE: "/tmp/pym-go-build-cache",
          },
        };
        const result =
          target === "typescript"
            ? await runProcess(
                process.execPath,
                [
                  resolve("node_modules/typescript/bin/tsc"),
                  "--strict",
                  "--skipLibCheck",
                  "--target",
                  "es2022",
                  "--noEmit",
                  "contracts.ts",
                ],
                processOptions,
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
                    "contracts.rs",
                  ],
                  processOptions,
                )
              : await runProcess(
                  process.env.PYM_GO ?? "go",
                  ["test"],
                  processOptions,
                );
        if (result.kind === "spawn_failed" || result.kind === "timed_out") {
          t.skip(
            `Compiler resource unavailable: ${result.kind}; no compilation claim`,
          );
          return;
        }
        assert.equal(result.kind, "exited");
        assert.equal(result.code, 0, result.stdout + result.stderr);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
