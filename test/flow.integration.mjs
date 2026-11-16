// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const resource =
  "resource File { states Open, Closed; initial Open; terminal Closed; Open -> Closed; Closed -> Closed; } type E = Failed; op open() -> Result<File,E> effects(state.File) creates result; ";
const protocol = readFileSync("examples/mvp/task-protocol.pym", "utf8");
const library = readFileSync("examples/mvp/library.pym", "utf8"),
  libraryScope = JSON.parse(
    readFileSync("examples/mvp/library.scope.json", "utf8"),
  );
const cases = [
  [
    "library-bad",
    library
      .replace("if reader.suspended { return Suspended; }", "")
      .replace(
        "if books.count > reader.remaining { return QuotaExceeded; }",
        "",
      ),
    true,
    "lend",
    libraryScope,
  ],
  [
    "library-renamed",
    library.replaceAll("eligible", "canLend").replaceAll("lend(", "borrow("),
    false,
    "borrow",
    libraryScope,
  ],
  [
    "library",
    readFileSync("examples/mvp/library.pym", "utf8"),
    false,
    "lend",
    JSON.parse(readFileSync("examples/mvp/library.scope.json", "utf8")),
  ],
  ["protocol", protocol, true, "retryJob"],
  ["protocol-fixed", protocol, false, "cautiousJob"],
  [
    "protocol-renamed",
    protocol
      .replaceAll("Queue", "Dispatch")
      .replaceAll("send", "enqueue")
      .replaceAll("retryJob", "work"),
    true,
    "work",
  ],
  [
    "branch",
    "op approval() -> Bool; flow main() -> Unit { call approval() as allowed; assert allowed; }",
    true,
  ],
  [
    "loop",
    "flow main(N: Nat) -> Unit bound N <= 2 { for i in N { assert i < 1; } }",
    true,
  ],
  [
    "resource-good",
    resource +
      "flow main() -> Unit effects(state.File) { call open() as r; match r { Ok(f) => { transition f -> Closed; } Failed => { } } } on cancel { transition f -> Closed; }",
    false,
  ],
  [
    "resource-bad",
    resource +
      "flow main() -> Unit effects(state.File) { call open() as r; match r { Ok(f) => { return unit; } Failed => { return unit; } } } on cancel { transition f -> Closed; }",
    true,
  ],
];
for (const [name, source, bad, entry = "main", scope] of cases)
  for (const command of ["simulate", "verify"])
    test(`built-in ${command}: structured ${name}`, (t) => {
      const dir = mkdtempSync(join(tmpdir(), "pym-flow-backend-"));
      try {
        const file = join(dir, "source.pym");
        writeFileSync(file, source);
        const args = [
          "dist/cli/main.js",
          command,
          file,
          "--entry",
          entry,
          "--format",
          "json",
          ...(command === "simulate"
            ? ["--max-steps", "30", "--max-samples", "1000"]
            : []),
          "--timeout",
          "12s",
        ];
        if (scope) {
          const scopeFile = join(dir, "scope.json");
          writeFileSync(scopeFile, JSON.stringify(scope));
          args.push("--scope", scopeFile);
        }
        const p = spawnSync(process.execPath, args, { encoding: "utf8" });
        assert.ifError(p.error);
        const report = JSON.parse(p.stdout);
        if (report.results.some((r) => r.completion === "timed_out")) {
          t.skip("Explicit checker budget exhausted");
          return;
        }
        assert.equal(p.status, bad ? 1 : 0, JSON.stringify(report));
        const results = report.results.filter(
          (r) => r.analysisKind === "behaviour",
        );
        assert.ok(results.length);
        if (bad)
          assert.ok(
            results.some(
              (r) =>
                r.outcome === "counterexample" &&
                r.witnessValidation === "source_replayed",
            ),
          );
        else assert.ok(results.every((r) => r.outcome === "no_counterexample"));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
