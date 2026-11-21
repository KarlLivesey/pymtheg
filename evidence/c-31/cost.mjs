// SPDX-License-Identifier: MIT
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.PYM_SCRATCH;
const manifest = JSON.parse(readFileSync(join(root, "main.json"), "utf8"));
const crossbeam = process.argv.includes("--crossbeam");
const pins = crossbeam
  ? ["crossbeam-rs/crossbeam"]
  : ["cberner/redb", "fjall-rs/fjall"];
const runs = crossbeam
  ? ["main-a", "candidate-a", "main-b", "candidate-b"]
  : ["main-a", "candidate", "main-b"];
const out = [];
for (const id of pins) {
  const pin = manifest.repos.find((p) => p.id === id);
  const source = join(root, "main", pin.attempt, "checkout");
  for (const run of runs) {
    const dir = join(root, "cost-paired", id.split("/")[1], run);
    mkdirSync(dir, { recursive: true });
    const checkout = join(dir, "checkout");
    const entry = join(
      root,
      run.startsWith("candidate") ? "final-build" : "main-build",
      "dist/cli/main.js",
    );
    const env = { ...process.env, NODE_OPTIONS: "", GIT_TERMINAL_PROMPT: "0" };
    execFileSync(
      "git",
      [
        "-c",
        "core.hooksPath=/dev/null",
        "clone",
        "--quiet",
        "--shared",
        "--",
        source,
        checkout,
      ],
      { env, stdio: "pipe" },
    );
    const cwd = checkout;
    execFileSync(
      process.execPath,
      [entry, "init", ".", "--name", id, "--format", "json"],
      { cwd, env, stdio: "pipe" },
    );
    const report = JSON.parse(
      execFileSync(
        "/usr/bin/time",
        [
          "-f",
          "%e %U %S %M",
          "-o",
          join(dir, "stats"),
          process.execPath,
          entry,
          "graph",
          "index",
          "--json",
        ],
        { cwd, env, stdio: "pipe", maxBuffer: 10 * 1024 * 1024 },
      ),
    );
    if (
      !report.sync.report ||
      report.sync.report.analysisErrors.length ||
      report.sync.report.resolutionErrors.length
    )
      throw Error("Incomplete index " + id);
    const [wallSeconds, userSeconds, systemSeconds, peakRssKiB] = readFileSync(
      join(dir, "stats"),
      "utf8",
    )
      .trim()
      .split(/ +/)
      .map(Number);
    const row = {
      id,
      run,
      wallSeconds,
      userSeconds,
      systemSeconds,
      peakRssKiB,
    };
    out.push(row);
    console.log(JSON.stringify(row));
    writeFileSync(
      join(root, crossbeam ? "cost-crossbeam.json" : "cost-paired.json"),
      JSON.stringify(out, null, 2) + "\n",
    );
  }
}
