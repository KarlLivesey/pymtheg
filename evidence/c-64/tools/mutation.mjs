// SPDX-License-Identifier: MIT
// C-64: shows the memory test fails without the fix. Puts back the closure
// made inside the extraction, builds, runs the test and prints its outcome
// and assertion, then restores the source. Run from the repository root on a
// scratch copy: `node evidence/c-64/tools/mutation.mjs`.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/graph/languages/typescript/extract.ts";
const FROM = "    const restorer = nameRestorer(context.fresh);";
const TO =
  "    const fresh = context.fresh;\n    const restorer = (text: string) => restoreNames(text, fresh);";
const original = readFileSync(FILE, "utf8");
if (original.split(FROM).length !== 2) throw Error("anchor");
const build = () => spawnSync("npx", ["tsc", "-p", "."], { stdio: "ignore" });
const run = () =>
  spawnSync(
    "node",
    [
      "--test",
      "--test-name-pattern=does not stay alive through what is stored",
      "test/graph-index-memory.test.mjs",
    ],
    { encoding: "utf8" },
  );
const report = (label, result) => {
  console.log(`## ${label}: ${result.status === 0 ? "PASSES" : "FAILS"}`);
  for (const line of result.stdout.split("\n"))
    if (/AssertionError|checker types alive|isNameRestorer|\.ts$/.test(line))
      console.log(`  ${line.trim()}`);
};
try {
  writeFileSync(FILE, original.replace(FROM, TO));
  build();
  report("closure made inside the extraction (main)", run());
} finally {
  writeFileSync(FILE, original);
  build();
}
report("module-level restorer (this branch)", run());
