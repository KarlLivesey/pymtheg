// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { scaffold } from "../dist/contracts/scaffold.js";
import { emitImplementationCheck } from "../dist/contracts/implementation-check.js";
import { runProcess } from "../dist/backends/process.js";
for (const target of ["typescript", "rust", "go"])
  test(`${target} generated check accepts matching implementations and rejects an ignored added input`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pym-implementation-check-"));
    try {
      const design = join(root, "design.pym");
      const extension = { typescript: ".ts", rust: ".rs", go: ".go" }[target];
      const generate = async (changed) => {
        await writeFile(
          design,
          `op pay(id: String${changed ? ", key: String" : ""}) -> Bool;`,
        );
        const output = scaffold(
          analyseFile(design).ir,
          target,
          "fail-fast",
          "contracts",
        );
        await writeFile(join(root, "contracts" + extension), output.source);
        const check = emitImplementationCheck(output, {
          target,
          ...(target !== "go"
            ? {
                contractsModule:
                  target === "rust" ? "crate::contracts" : "./contracts",
              }
            : {}),
          ...(target === "typescript"
            ? { implementationModule: "./implementation" }
            : {}),
          implementationType:
            target === "rust"
              ? "crate::Service"
              : target === "go"
                ? "*Service"
                : "Service",
        });
        await writeFile(
          join(root, "implementation" + check.extension),
          check.source,
        );
      };
      await generate(false);
      if (target === "typescript")
        await writeFile(
          join(root, "implementation.ts"),
          'export class Service { pay(id: string): boolean { throw Error("Not implemented"); } }',
        );
      if (target === "go")
        await writeFile(
          join(root, "implementation.go"),
          'package contracts\ntype Service struct{}\nfunc (*Service) Pay(id string) bool { panic("Not implemented") }',
        );
      if (target === "rust")
        await writeFile(
          join(root, "lib.rs"),
          'mod contracts; mod implementation_check; pub struct Service; impl contracts::PymthegContracts for Service { fn pay(&self,id: String)->bool { todo!("Not implemented") } }',
        );
      const compile = () =>
        target === "typescript"
          ? runProcess(
              process.execPath,
              [
                resolve("node_modules/typescript/bin/tsc"),
                "--strict",
                "--noEmit",
                "--skipLibCheck",
                "implementation.check.ts",
              ],
              { cwd: root, timeoutMs: 45000 },
            )
          : target === "rust"
            ? runProcess(
                "rustc",
                ["--edition", "2021", "--crate-type", "lib", "lib.rs"],
                { cwd: root, timeoutMs: 45000 },
              )
            : runProcess(process.env.PYM_GO ?? "go", ["test"], {
                cwd: root,
                timeoutMs: 120000,
                env: {
                  ...process.env,
                  GO111MODULE: "off",
                  GOTOOLCHAIN: "local",
                  GOCACHE: "/tmp/pym-go-build-cache",
                },
              });
      const before = await compile();
      assert.equal(before.kind, "exited", JSON.stringify(before));
      assert.equal(before.code, 0, before.stderr + before.stdout);
      await generate(true);
      const after = await compile();
      assert.equal(after.kind, "exited", JSON.stringify(after));
      assert.notEqual(
        after.code,
        0,
        "The old one-argument implementation must fail the generated check",
      );
      assert.match(
        after.stderr + after.stdout,
        target === "typescript"
          ? /constraint|never|assignable/
          : target === "rust"
            ? /parameter/
            : /wrong type|want/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
