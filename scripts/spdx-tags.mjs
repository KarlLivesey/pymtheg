#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Adds the one-line `SPDX-License-Identifier: MIT` tag to first-party source
// files (LIC-2). Idempotent: a file that already carries the tag in its place
// is left alone, so running this twice changes nothing.
//
//   node scripts/spdx-tags.mjs          tag every file in scope
//   node scripts/spdx-tags.mjs --check  list untagged files; exit 1 if any
//
// The scope and exclusions are documented in docs/changes/LIC-2.md and
// enforced independently by test/licence-tags.test.mjs.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAG = "SPDX-License-Identifier: MIT";
const LINE = {
  slash: `// ${TAG}`,
  block: `/* ${TAG} */`,
  html: `<!-- ${TAG} -->`,
  hash: `# ${TAG}`,
};
const STYLE = {
  ".ts": "slash",
  ".tsx": "slash",
  ".mts": "slash",
  ".js": "slash",
  ".mjs": "slash",
  ".cjs": "slash",
  ".go": "slash",
  ".rs": "slash",
  ".css": "block",
  ".html": "html",
  ".sh": "hash",
};
const ROOTS = ["src", "web/src", "scripts", "test"];
const FILES = [
  "grammars/build.mjs",
  "web/vite.config.ts",
  "web/index.html",
  "pymtheg",
];
const SKIP_DIRS = new Set(["node_modules", "dist", "dist-web", ".git"]);
const EXCLUDED = ["web/src/generated/", "test/fixtures/"];

function style(path, text) {
  const s = STYLE[extname(path)];
  if (s) return s;
  return text.startsWith("#!") ? "hash" : undefined;
}

function candidates() {
  const out = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (EXCLUDED.some((x) => `${rel}/`.startsWith(x))) continue;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(rel);
      } else if (e.isFile()) out.add(rel);
    }
  };
  for (const r of ROOTS) walk(r);
  for (const f of FILES) out.add(f);
  for (const e of readdirSync(root, { withFileTypes: true }))
    if (e.isFile() && STYLE[extname(e.name)]) out.add(e.name);
  return [...out].sort();
}

/** Where the tag belongs: after a shebang or an HTML doctype, else first. */
function split(text, kind) {
  if (text.startsWith("#!")) {
    const nl = text.indexOf("\n");
    return [text.slice(0, nl + 1), text.slice(nl + 1)];
  }
  if (kind === "html") {
    const m = /^<!doctype html>\n?/i.exec(text);
    if (m) return [`${m[0].replace(/\n$/, "")}\n`, text.slice(m[0].length)];
  }
  return ["", text];
}

function tagged(text, kind) {
  const [, rest] = split(text, kind);
  return rest.startsWith(`${LINE[kind]}\n`);
}

function tag(text, kind, path) {
  const [head, rest] = split(text, kind);
  // Go: a blank line keeps the tag out of the package doc comment.
  const gap = extname(path) === ".go" ? "\n" : "";
  return `${head}${LINE[kind]}\n${gap}${rest}`;
}

const check = process.argv.includes("--check");
const missing = [];
let changed = 0;
for (const path of candidates()) {
  const text = readFileSync(join(root, path), "utf8");
  const kind = style(path, text);
  if (!kind || tagged(text, kind)) continue;
  if (check) missing.push(path);
  else {
    writeFileSync(join(root, path), tag(text, kind, path));
    changed++;
  }
}
if (check) {
  for (const p of missing) console.log(relative(".", join(root, p)));
  process.exitCode = missing.length ? 1 : 0;
} else console.log(`tagged ${changed} file(s)`);
