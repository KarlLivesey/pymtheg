// SPDX-License-Identifier: MIT
// C-38A review 2: shows the new tests fail without their fixes. For each
// mutation, undoes one fix, builds, runs the named tests and prints whether
// they pass, then restores the sources. Run from the repository root on a
// scratch copy: `node evidence/c-38a/tools/mutations.mjs`.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const MUTATIONS = {
  "claim under C-53's condition (Rust race test)": {
    edits: {
      "src/graph/indexer.ts": [
        [
          "if ([...deferred].some(([, files]) => files.length))",
          "if (\n        [...deferred].some(\n          ([module, files]) => files.length && !reusing.has(module),\n        )\n      )",
        ],
      ],
    },
    test: "test/graph-index-runs.test.mjs",
    pattern: "Rust: A analyses",
  },
  "a module with no files reports a path": {
    edits: {
      "src/graph/indexer.ts": [
        [
          "...(module.reportsAnalysisPath &&\n            files.length > 0 && {",
          "...(module.reportsAnalysisPath && {",
        ],
      ],
    },
    test: "test/graph-typescript-analysis-path.test.mjs",
    pattern: "Go-only and Rust-only",
  },
  "a first index from per-file records (round 1)": {
    edits: {
      "src/graph/languages/typescript/index.ts": [
        [
          "const firstIndex = context.firstIndex === true;",
          "const firstIndex = files.every(\n        (file) =>\n          (file.result.data as { analyzer?: unknown } | undefined)?.analyzer ===\n          undefined,\n      );",
        ],
      ],
    },
    test: "test/graph-typescript-analysis-path.test.mjs",
    pattern: "stopped during analysis|one-file",
  },
  "the verified no-edit index reports no path (round 2)": {
    edits: {
      "src/graph/commands.ts": [
        ["...(reportedPaths.length && { analysisPaths: reportedPaths }),", ""],
      ],
    },
    test: "test/graph-typescript-analysis-path.test.mjs",
    pattern: "one-file",
  },
};

const build = () => {
  // Type errors still emit; the test runs what the mutation compiles to.
  spawnSync("npx", ["tsc", "-p", "."], { stdio: "ignore" });
};
for (const [name, { edits, test, pattern }] of Object.entries(MUTATIONS)) {
  const originals = new Map();
  try {
    for (const [file, pairs] of Object.entries(edits)) {
      let text = readFileSync(file, "utf8");
      originals.set(file, text);
      for (const [from, to] of pairs) {
        if (text.split(from).length !== 2)
          throw new Error(`${name}: anchor in ${file}`);
        text = text.replace(from, to);
      }
      writeFileSync(file, text);
    }
    build();
    const result = spawnSync(
      "node",
      ["--test", `--test-name-pattern=${pattern}`, test],
      { encoding: "utf8" },
    );
    const failure = result.stdout
      .split("\n")
      .find((line) => /AssertionError|Missing expected/.test(line));
    console.log(
      `## ${name}: ${result.status === 0 ? "PASSES" : "FAILS"}${failure ? `\n  ${failure.trim()}` : ""}`,
    );
  } finally {
    for (const [file, text] of originals) writeFileSync(file, text);
  }
}
build();
execFileSync("npx", ["tsc", "-p", "."], { stdio: "inherit" });
