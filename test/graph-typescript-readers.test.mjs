// SPDX-License-Identifier: MIT
// C-38 review round 3: every place in the TypeScript module where producing
// one file's result reads other files other than through the checker is
// registered (scoped.ts PROGRAM_READERS) with what the scoped re-index
// compares for it. A new loop over a program's files, its resolved modules
// or type directives, or a cache keyed by program or checker, fails here
// until it carries a `// program-reader: <name>` marker naming an entry.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { PROGRAM_READERS } from "../dist/graph/languages/typescript/scoped.js";

const dir = join(import.meta.dirname, "../src/graph/languages/typescript");
const PATTERNS = [
  /getSourceFiles\(\)/,
  /forEachResolvedModule\(/,
  /forEachResolvedTypeReferenceDirective\(/,
  /getAutomaticTypeDirectiveResolutions\(\)/,
  /Map<\s*ts\.(Program|TypeChecker)\b/,
];

test("every program-wide reader of the TypeScript module is registered with its surface", () => {
  const unmarked = [];
  const used = new Set();
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts"))) {
    if (name === "scoped.ts") continue;
    const lines = readFileSync(join(dir, name), "utf8").split("\n");
    lines.forEach((line, index) => {
      const marker = /program-reader: ([\w-]+)/.exec(line);
      if (marker) used.add(marker[1]);
      // A multi-line `new WeakMap<` whose key type is on the next line.
      const keyed =
        /= new (Weak)?Map<\s*$/.test(line) &&
        /^\s*ts\.(Program|TypeChecker)\b/.test(lines[index + 1] ?? "");
      if (!keyed && !PATTERNS.some((pattern) => pattern.test(line))) return;
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
      const window = lines.slice(Math.max(0, index - 6), index).join("\n");
      const names = [...window.matchAll(/program-reader: ([\w-]+)/g)].map(
        (match) => match[1],
      );
      if (!names.some((reader) => reader in PROGRAM_READERS))
        unmarked.push(`${name}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(unmarked, [], "unregistered program-wide readers");
  // Every entry is a real reader, and says what covers it.
  assert.deepEqual(
    Object.keys(PROGRAM_READERS).filter((name) => !used.has(name)),
    [],
    "registered readers with no marked site",
  );
  const scoped = readFileSync(join(dir, "scoped.ts"), "utf8");
  for (const [name, reader] of Object.entries(PROGRAM_READERS)) {
    assert.ok(
      reader.surface?.length || reader.declines || reader.outside,
      `${name}: surface, declines or outside`,
    );
    for (const part of reader.surface ?? [])
      assert.ok(
        new RegExp(`add\\(\\s*"${part}"|"${part}"\\)|\`${part} `).test(
          scoped,
        ) ||
          (part === "inferred" && /describe\(/.test(scoped)) ||
          ((part === "shallow" || part === "all") &&
            /"all" : "shallow"/.test(scoped)),
        `${name}: surface part ${part} is emitted`,
      );
  }
});
