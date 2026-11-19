// SPDX-License-Identifier: MIT
// Parse every .rs file under each root with two grammar builds and compare the
// complete trees: every node, named or anonymous, with its type, field name and
// byte range (a cursor walk, so nothing the S-expression omits is skipped).
//   node tree-compare.mjs --old <a.wasm> --new <b.wasm> --out <file.json> <root>...
// A file "fails" when its tree has an ERROR or MISSING node (the Rust module's
// whole-file rule). Output: per-root counts and every file whose status or tree
// differs, with the first error position under each grammar.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const opt = (name) => argv[argv.indexOf(name) + 1];
const roots = argv.filter(
  (a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"),
);
await Parser.init({
  locateFile: () => require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
});
const parsers = await Promise.all(
  [opt("--old"), opt("--new")].map(async (wasm) => {
    const parser = new Parser();
    parser.setLanguage(await Language.load(wasm));
    return parser;
  }),
);

function* files(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === ".git") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (e.isFile() && e.name.endsWith(".rs")) yield p;
  }
}

function read(parser, text) {
  const tree = parser.parse(text);
  const hash = createHash("sha256");
  let firstError = null;
  const c = tree.walk();
  for (;;) {
    const n = c.currentNode;
    hash.update(
      `${c.currentFieldName ?? ""}:${n.type}:${n.isNamed ? 1 : 0}:${n.startIndex}:${n.endIndex};`,
    );
    if (
      (n.type === "ERROR" || n.isMissing) &&
      (!firstError || n.startIndex < firstError.byte)
    ) {
      const lines = text.slice(0, n.startIndex).split(/\r\n|[\r\n]/);
      firstError = {
        byte: n.startIndex,
        line: lines.length,
        column: lines.at(-1).length + 1,
        text: n.isMissing
          ? `missing ${n.type}`
          : n.text.trim().slice(0, 40).replace(/\s+/g, " "),
      };
    }
    if (c.gotoFirstChild()) continue;
    while (!c.gotoNextSibling()) {
      if (!c.gotoParent()) {
        c.delete();
        tree.delete();
        return { failed: firstError !== null, firstError, digest: hash.digest("hex") };
      }
    }
  }
}

const report = { old: opt("--old"), new: opt("--new"), roots: [] };
for (const root of roots) {
  const r = {
    root,
    files: 0,
    parsedBoth: 0,
    identical: 0,
    treeChanged: [],
    newlyParsing: [],
    newlyFailing: [],
    failedBoth: [],
  };
  for (const path of files(root)) {
    const text = readFileSync(path, "utf8");
    const [a, b] = parsers.map((p) => read(p, text));
    const file = relative(root, path);
    r.files++;
    if (!a.failed && !b.failed) {
      r.parsedBoth++;
      if (a.digest === b.digest) r.identical++;
      else r.treeChanged.push(file);
    } else if (a.failed && !b.failed)
      r.newlyParsing.push({ file, oldError: a.firstError });
    else if (!a.failed && b.failed)
      r.newlyFailing.push({ file, newError: b.firstError });
    else r.failedBoth.push({ file, oldError: a.firstError, newError: b.firstError });
  }
  console.log(
    `${root}: ${r.files} files, ${r.identical}/${r.parsedBoth} identical, ` +
      `${r.treeChanged.length} changed, +${r.newlyParsing.length} parse, ` +
      `-${r.newlyFailing.length} fail, ${r.failedBoth.length} fail both`,
  );
  report.roots.push(r);
}
writeFileSync(opt("--out"), `${JSON.stringify(report, null, 2)}\n`);
