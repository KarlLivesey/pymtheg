// SPDX-License-Identifier: MIT
import "./isolated-config.mjs";
// C-43 review B2: since C-44 only this machine's trust answer turns a
// toolchain route on, and a committed setting can only turn one off. Each of
// the sweep's toolchain modes runs end to end (scripts/sweep/run.mjs
// runRepository) on a small fixture in a local git repository with the
// built CLI: init answers --trust in the isolated configuration folder, and
// the route is used. Needs the real tool on PATH; skipped otherwise.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gitEnvironment, runRepository } from "../scripts/sweep/run.mjs";

// The fixture repository is local: allow the file transport in this test only.
gitEnvironment.GIT_ALLOW_PROTOCOL = "https:file";

const onPath = (name) =>
  (process.env.PATH ?? "")
    .split(delimiter)
    .some((dir) => dir && existsSync(join(dir, name)));

const GO = {
  "go.mod": "module example.com/fixture\n\ngo 1.22\n",
  "a.go": "package fixture\n\nfunc A() int { return B() }\n",
  "b.go": "package fixture\n\nfunc B() int { return 1 }\n",
};
const RUST = fileURLToPath(
  new URL("./fixtures/graph-rust-toolchain/basic", import.meta.url),
);

for (const [mode, tool] of [
  ["go", "go"],
  ["rust", "rust-analyzer"],
])
  test(
    `C-43 review: the sweep's ${mode} toolchain mode turns the route on through this machine's trust answer`,
    onPath(tool) ? {} : { skip: `no ${tool} on PATH` },
    async () => {
      const scratch = await mkdtemp(join(tmpdir(), "pym-sweep-mode-"));
      try {
        const source = join(scratch, "source");
        if (mode === "go")
          for (const [path, text] of Object.entries(GO)) {
            mkdirSync(dirname(join(source, path)), { recursive: true });
            writeFileSync(join(source, path), text);
          }
        else cpSync(RUST, source, { recursive: true });
        const git = (...args) =>
          execFileSync(
            "git",
            [
              "-c",
              "user.name=fixture",
              "-c",
              "user.email=fixture@example.invalid",
              "-c",
              "core.hooksPath=/dev/null",
              ...args,
            ],
            { cwd: source },
          )
            .toString()
            .trim();
        git("init", "--quiet");
        git("add", "-A");
        git("commit", "--quiet", "-m", "fixture");
        const commit = git("rev-parse", "HEAD");
        const record = await runRepository(
          { id: `fixture/${mode}`, url: source, commit, language: mode },
          {
            entry: fileURLToPath(
              new URL("../dist/cli/main.js", import.meta.url),
            ),
          },
          scratch,
          1800,
          false,
          mode,
        );
        assert.equal(
          record.outcome,
          "finished",
          JSON.stringify(record.failure ?? record.outcome),
        );
        assert.equal(
          record.toolchain?.state,
          "used",
          JSON.stringify(record.toolchain),
        );
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  );
