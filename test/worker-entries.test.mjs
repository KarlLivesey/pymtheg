// SPDX-License-Identifier: MIT
// C-50 review: a worker thread loads its own modules, so the filter of the
// two Node warnings Pymtheg relies on (src/shared/quiet-warnings.ts) must be
// the first import of every worker entry, as it is of the CLI entry. Without
// it, the CLI's graph worker printed "ExperimentalWarning: SQLite is an
// experimental feature" on Node 24.0.0, because node:sqlite loads there.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sources = (directory) =>
  readdirSync(join(root, directory), { withFileTypes: true }).flatMap(
    (entry) =>
      entry.isDirectory()
        ? sources(join(directory, entry.name))
        : entry.name.endsWith(".ts")
          ? [join(directory, entry.name)]
          : [],
  );

/** Every module a `new Worker(new URL("./x.js", import.meta.url))` starts. */
function workerEntries() {
  const entries = new Set();
  for (const file of sources("src")) {
    const text = readFileSync(join(root, file), "utf8");
    for (const match of text.matchAll(
      /new Worker\(\s*(?:[\w.]+ \?\?\s*)?new URL\(\s*"(\.\.?\/[^"]+)\.js"/g,
    ))
      entries.add(join(dirname(file), `${match[1]}.ts`));
  }
  return [...entries].sort();
}

test("every worker entry imports the warning filter before anything else", () => {
  const entries = workerEntries();
  // The entries this check found (a new worker is added here by itself).
  assert.ok(entries.length >= 10, entries.join(", "));
  const missing = [];
  for (const entry of entries) {
    const text = readFileSync(join(root, entry), "utf8");
    const first = text.match(/^import\b[^;]*;/m)?.[0] ?? "";
    if (
      !/^import "(?:\.\.?\/)+(?:shared\/|cli\/)?quiet-warnings\.js";$/.test(
        first,
      )
    )
      missing.push(
        `${relative(root, join(root, entry))}: ${first || "no import"}`,
      );
  }
  assert.deepEqual(missing, []);
});
