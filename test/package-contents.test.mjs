// SPDX-License-Identifier: MIT
// R1-H: the npm package ships user documentation only, and no shipped file
// carries a personal home path, the owner's name or a private project name
// (the names come from the owner's git-ignored private-names.local).
// Reads the real pack list (`npm pack --dry-run --json`); nothing is written.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const pack = spawnSync(
  "npm",
  ["pack", "--dry-run", "--json", "--ignore-scripts"],
  {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  },
);
const files = () => {
  assert.equal(pack.status, 0, pack.stderr);
  return JSON.parse(pack.stdout)[0].files.map((f) => f.path);
};
const userDocs = [
  "docs/agent-workflow.md",
  "docs/code-guide.md",
  "docs/grammar.md",
  "docs/journeys.md",
  "docs/licences.md",
  "docs/mcp.md",
  "docs/output-plugins.md",
  "docs/project-init.md",
  "docs/report.schema.json",
  "docs/studio.md",
  "docs/support.md",
];
test("the package ships only user documentation from docs/", () => {
  const shipped = files()
    .filter((f) => f.startsWith("docs/"))
    .sort();
  assert.deepEqual(shipped, userDocs);
  for (const internal of [
    "docs/build-plan.md",
    "docs/decisions.md",
    "docs/trial-start.md",
    "docs/progress.md",
    "docs/runtime-map.md",
  ])
    assert.ok(!files().includes(internal), `${internal} must not ship`);
  assert.ok(
    !files().some((f) => f.startsWith("docs/changes/")),
    "docs/changes must not ship",
  );
  // Pymtheg's own licence ships (npm always packs LICENSE).
  assert.ok(files().includes("LICENSE"), "LICENSE must ship");
  // The product reads these at run time.
  for (const needed of [
    "docs/agent-workflow.md",
    "docs/code-guide.md",
    "docs/grammar.md",
    "docs/report.schema.json",
  ])
    assert.ok(files().includes(needed), needed);
});
/**
 * Private network details: RFC 1918 IPv4 addresses (10/8, 172.16/12,
 * 192.168/16) and host names ending .internal, .local or .lan, or the bare
 * name devserver. Loopback, 0.0.0.0 and documentation ranges (192.0.2.x,
 * 198.51.100.x, 203.0.113.x) are allowed. The address and devserver rules
 * apply to every line of every shipped file. The host-suffix rule:
 * - text files (Markdown, JSON, HTML, LICENSE, notices): every line;
 * - first-party compiled output (`dist/`, not minified): the whole text of
 *   every string literal, template piece (no-substitution, head, middle,
 *   tail) and comment (leading and trailing), read with the TypeScript
 *   compiler's parser, so `${...}` interpolations are not text and a quote in
 *   a regular-expression literal cannot throw the reading off; one precise
 *   exception, in comments only, skips the code span `data.local` (a symbol
 *   field named in the Go extractor's doc comments);
 * - the minified third-party bundle (`dist-web/assets/`): only right after a
 *   quote, backtick, `//` or `@`, or on a comment line (with backtick code
 *   spans skipped), because member accesses such as `this.local` and
 *   `data.local` code spans have the same shape as host names; an "anywhere in
 *   a string" rule gives about eight false hits there.
 * No shipped file is exempted.
 */
const octet = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
// A whole dotted quad: not part of a longer number or version string.
const privateIPv4 = new RegExp(
  `(?<![\\d.])(?:10\\.${octet}\\.${octet}|172\\.(?:1[6-9]|2\\d|3[01])\\.${octet}|192\\.168\\.${octet})\\.${octet}(?!\\d|\\.\\d)`,
);
const label = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const hostSuffix = `${label}(?:\\.${label})*\\.(?:internal|local|lan)(?![\\w-])`;
const textHost = new RegExp(`(?<![\\w.-])${hostSuffix}`, "i");
const codeHost = new RegExp(`(?<=["'\`@]|//)${hostSuffix}`, "i");
const devserver = /(?<![\w-])devserver(?![\w-])/i;
/**
 * The owner's private project names are not written in this repository. On
 * the owner's machine they live in `private-names.local` at the repository
 * root (git-ignored): one JavaScript regular expression source per line,
 * optionally followed by `/flags` (so a literal slash in a pattern is written
 * `\\/`); blank lines and lines starting with `#` are ignored. When the file
 * is absent this rule has no patterns and the other rules still run. A file
 * that exists but cannot be read, or holds an invalid pattern, throws.
 * Findings name the pattern by its line number in the file, never the text.
 */
const privateNamesFile = fileURLToPath(
  new URL("../private-names.local", import.meta.url),
);
function loadPrivatePatterns(patternFile) {
  let text;
  try {
    text = readFileSync(patternFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw new Error(
      `${basename(patternFile)} exists but cannot be read (${error?.code ?? "error"})`,
    );
  }
  const patterns = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return;
    const withFlags = /^(.*)\/([a-zA-Z]*)$/.exec(line);
    const [source, flags] = withFlags
      ? [withFlags[1], withFlags[2]]
      : [line, ""];
    try {
      if (source === "") throw new Error("empty");
      patterns.push({ line: i + 1, pattern: new RegExp(source, flags) });
    } catch {
      // The engine's message repeats the pattern text, so it is not shown.
      throw new Error(
        `${basename(patternFile)} line ${i + 1} is not a valid regular expression with valid flags`,
      );
    }
  });
  return patterns;
}
/** One offence per file and pattern: the first matching line, as below. */
function privateNameFindings(patternFile, shipped) {
  const patterns = loadPrivatePatterns(patternFile);
  const found = [];
  for (const { path, text } of shipped) {
    const lines = text.split("\n");
    for (const { line: n, pattern } of patterns) {
      const hit = lines.findIndex((l) => {
        pattern.lastIndex = 0;
        return pattern.test(l);
      });
      if (hit >= 0)
        found.push(
          `${path}:${hit + 1}: private name (${basename(patternFile)} line ${n})`,
        );
    }
  }
  return found;
}
test("the private-name patterns load from a file given by path and fire as written", () => {
  const dir = mkdtempSync(join(tmpdir(), "pym-private-names-"));
  try {
    const file = join(dir, "names.local");
    writeFileSync(
      file,
      [
        "# made-up names for this test",
        "",
        "\\bZorblat\\b",
        "   ",
        "quuxfold/i",
        "# \\bplain\\b would match every file if it were not a comment",
      ].join("\n"),
    );
    const scan = (text) =>
      privateNameFindings(file, [{ path: "README.md", text }]);
    // A hit fails and names the file, its line and the pattern's line only.
    assert.deepEqual(scan("intro\nthe Zorblat engine\n"), [
      "README.md:2: private name (names.local line 3)",
    ]);
    assert.deepEqual(scan("a QuuxFold schema"), [
      "README.md:1: private name (names.local line 5)",
    ]);
    for (const offence of scan("Zorblat and quuxfold"))
      assert.doesNotMatch(offence, /Zorblat|quuxfold/i);
    // A miss passes; the capitalised, word-bounded pattern ignores the
    // ordinary lower-case word and longer words.
    assert.deepEqual(scan("nothing private here"), []);
    assert.deepEqual(scan("a zorblat pricing plan, unZorblated"), []);
    // Comments and blank lines are not patterns.
    assert.deepEqual(scan("a plain word"), []);
    assert.deepEqual(
      loadPrivatePatterns(file).map((p) => p.line),
      [3, 5],
    );
    // An invalid pattern or flag fails loudly, naming the line, not the text.
    writeFileSync(file, "# ok\n\\bZorblat\\b\n(quuxfold\n");
    assert.throws(
      () => scan("x"),
      /^Error: names\.local line 3 is not a valid/,
    );
    writeFileSync(file, "quuxfold/q\n");
    assert.throws(
      () => scan("x"),
      (error) =>
        /names\.local line 1 is not a valid/.test(error.message) &&
        !/quuxfold/.test(error.message),
    );
    // An unreadable file fails loudly; only a missing file means no patterns.
    assert.throws(
      () => privateNameFindings(dir, [{ path: "README.md", text: "x" }]),
      /cannot be read/,
    );
    assert.deepEqual(
      privateNameFindings(join(dir, "absent.local"), [
        { path: "README.md", text: "Zorblat" },
      ]),
      [],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
/** String literals, template literals and comments (trailing ones included). */
/**
 * The text of every string literal, template piece (no-substitution, head,
 * middle, tail) and comment (leading and trailing trivia of every token) in a
 * JavaScript or declaration file, read with the TypeScript compiler's own
 * parser, so regular-expression literals, nested templates and quotes inside
 * them cannot throw the reading off. Template interpolations are code and are
 * not part of any piece's text.
 */
function textsOf(path, text) {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".d.ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
  const out = [];
  const seen = new Set();
  const comments = (ranges) => {
    for (const r of ranges ?? [])
      if (!seen.has(r.pos)) {
        seen.add(r.pos);
        out.push({ pos: r.pos, text: text.slice(r.pos, r.end), comment: true });
      }
  };
  const literal = new Set([
    ts.SyntaxKind.StringLiteral,
    ts.SyntaxKind.NoSubstitutionTemplateLiteral,
    ts.SyntaxKind.TemplateHead,
    ts.SyntaxKind.TemplateMiddle,
    ts.SyntaxKind.TemplateTail,
  ]);
  const visit = (node) => {
    if (literal.has(node.kind))
      out.push({ pos: node.getStart(source), text: node.text, comment: false });
    if (
      node.kind < ts.SyntaxKind.FirstNode ||
      node.getChildCount(source) === 0
    ) {
      comments(ts.getLeadingCommentRanges(text, node.pos));
      comments(ts.getTrailingCommentRanges(text, node.end));
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  comments(ts.getLeadingCommentRanges(text, source.endOfFileToken.pos));
  return out.map((t) => ({
    ...t,
    line: source.getLineAndCharacterOfPosition(t.pos).line + 1,
  }));
}
function networkFindings(path, text) {
  const code = /\.(m?js|d\.ts|css)$/.test(path);
  const found = [];
  // First-party compiled output (dist/, not minified): the whole text of every
  // string literal, template piece and comment, read by the TypeScript parser.
  // One precise exception, in comments only: the code span `data.local` in the
  // Go extractor's doc comments names the symbol field `data.local`, not a host.
  const firstParty = /\.(m?js|d\.ts)$/.test(path) && path.startsWith("dist/");
  if (firstParty)
    for (const t of textsOf(path, text)) {
      const content = t.comment
        ? t.text.replaceAll("`data.local`", " ")
        : t.text;
      if (textHost.test(content))
        found.push(`${path}:${t.line}: private host name`);
    }
  text.split("\n").forEach((line, i) => {
    const comment = /^\s*(\/\/|\/?\*)/.test(line);
    if (privateIPv4.test(line))
      found.push(`${path}:${i + 1}: private IPv4 address`);
    const host = firstParty
      ? false
      : code
        ? comment
          ? textHost.test(line.replace(/`[^`]*`/g, " "))
          : codeHost.test(line)
        : textHost.test(line);
    if (host) found.push(`${path}:${i + 1}: private host name`);
    if (devserver.test(line))
      found.push(`${path}:${i + 1}: devserver host name`);
  });
  return found;
}
test("no shipped file carries a private network address or host name", () => {
  const offences = [];
  for (const path of files()) {
    if (/\.(wasm|png|ico)$/.test(path) || !existsSync(path)) continue;
    offences.push(...networkFindings(path, readFileSync(path, "utf8")));
  }
  assert.deepEqual(offences, []);
});
test("the private network rules fire on each private form and allow public, loopback and documentation forms", () => {
  const fires = (path, text) => networkFindings(path, text).length > 0;
  for (const text of [
    "server at 10.0.0.1",
    "server at 10.255.12.34:8080",
    "server at 172.16.0.1",
    "server at 172.31.255.254",
    "server at 192.168.88.47",
    "see private-box.internal",
    "see nas.local for files",
    "ssh build.lan",
    "ssh devserver",
    "ssh DevServer -p 22",
    "code spans are scanned in docs: `nas.local`",
  ])
    assert.ok(fires("README.md", text), text);
  for (const text of [
    'fetch("http://192.168.1.10/api")',
    "const url = `https://private-box.internal/x`;",
    'const host = "nas.local";',
    "ssh git@build.lan",
    "// connect to devserver",
    "// see private-box.internal for logs",
    " * reachable at nas.local only",
  ])
    assert.ok(fires("dist-web/assets/x.js", text), text);
  for (const text of [
    "listen on 127.0.0.1 or 0.0.0.0",
    "example 192.0.2.10, 198.51.100.7 and 203.0.113.5",
    "public 8.8.8.8 and 172.32.0.1 and 172.15.0.1 and 192.169.0.1",
    "version 10.2.3 of the tool",
    "build 110.0.0.1 is not private",
    "the dev server runs builds",
    "localhost and example.com",
    "internal.example.com",
    "the local cache",
  ])
    assert.ok(!fires("README.md", text), text);
  // Sol round 3: ordinary help/error strings and trailing comments in first-party dist/.
  for (const text of [
    'throw Error("Connect to private-box.internal for logs");',
    'const hint = "ssh build.lan";',
    'log("Contact nas.local");',
    "throw Error(`Cannot reach ${user} on box.internal`);",
    'help("use the NAS (nas.local) for logs");',
    "connect(); // was nas.local",
    // Sol round 4: a quote inside a regex literal must not throw the reading off.
    'const quotes = /"/; console.log("ssh build.lan");',
    "const q = /'`/g; const msg = `Contact nas.local`;",
    // Sol round 4: the data.local exception is for comments only.
    'log("Connect to `data.local` for logs");',
    "const s = `Reach ${host} or \\`data.local\\` directly`;",
  ])
    assert.ok(fires("dist/cli/x.js", text), text);
  // In first-party dist/, interpolations and the `data.local` code span are code.
  for (const text of [
    "const key = `${place.file}|${place.local}`;",
    "/** symbol's name and identity, `data.local`); package-level types */",
  ])
    assert.ok(!fires("dist/graph/x.js", text), text);
  for (const text of [
    "this.local = initial;",
    "const found = this.local(name);",
    "symbol.data?.local)",
    "names.local[occurrence.name]",
    "if(e.local)return",
    " * symbol's name and identity, `data.local`); package-level types",
  ])
    assert.ok(!fires("dist-web/assets/x.js", text), text);
});
const ownerName = /\bKarl\b/;
/**
 * The one line of package.json allowed to name the owner, or -1. Allowed only
 * when all of these hold: the file parses as JSON; its top-level `author` is a
 * string; exactly one line of the raw text names the owner, and that line is
 * `  "author": <that string>` (optionally followed by a comma); exactly one
 * line has the top-level `"author":` shape, so a duplicated key cannot hide a
 * second value; and no other key or string anywhere in the parsed object names
 * the owner.
 */
function allowedAuthorLine(lines, text) {
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return -1;
  }
  if (!pkg || typeof pkg !== "object" || typeof pkg.author !== "string")
    return -1;
  const naming = lines.flatMap((l, i) => (ownerName.test(l) ? [i] : []));
  if (naming.length !== 1) return -1;
  const expected = `  "author": ${JSON.stringify(pkg.author)}`;
  const line = lines[naming[0]];
  if (line !== expected && line !== expected + ",") return -1;
  if (lines.filter((l) => /^ {2}"author"\s*:/.test(l)).length !== 1) return -1;
  const elsewhere = (value, top) => {
    if (typeof value === "string") return ownerName.test(value);
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(
      ([key, v]) =>
        ownerName.test(key) || (!(top && key === "author") && elsewhere(v)),
    );
  };
  return elsewhere(pkg, true) ? -1 : naming[0];
}
/**
 * Home paths and the owner's name in one shipped file. The owner's name is
 * public in the licence texts and, in package.json, only as the value of the
 * single top-level `author` key (see allowedAuthorLine). Any other mention
 * fails, at its first line.
 */
function personalFindings(path, text) {
  const found = [];
  const lines = text.split("\n");
  const home = lines.findIndex((l) => /\/home\/[a-z_][a-z0-9_.-]*\//i.test(l));
  if (home >= 0) found.push(`${path}:${home + 1}: personal path`);
  const licenceText = [
    "LICENSE",
    "THIRD-PARTY-NOTICES",
    "docs/licences.md",
  ].includes(path);
  if (!licenceText) {
    const allowed =
      path === "package.json" ? allowedAuthorLine(lines, text) : -1;
    const line = lines.findIndex((l, i) => ownerName.test(l) && i !== allowed);
    if (line >= 0) found.push(`${path}:${line + 1}: owner's name`);
  }
  return found;
}
test("the owner's name is allowed only in licence texts and package.json's top-level author", () => {
  const pkg = (body) => `{\n  "name": "x",\n${body}\n}\n`;
  for (const ok of [
    pkg('  "author": "Karl Livesey",\n  "license": "MIT"'),
    pkg('  "author": "Karl Livesey"'),
  ])
    assert.deepEqual(personalFindings("package.json", ok), [], ok);
  assert.deepEqual(personalFindings("LICENSE", "Copyright Karl Livesey"), []);
  for (const [path, text] of [
    // duplicated top-level author: both lines, or a later value overriding it
    [
      "package.json",
      pkg('  "author": "Karl Livesey",\n  "author": "Karl Livesey"'),
    ],
    ["package.json", pkg('  "author": "Karl Livesey",\n  "author": "x"')],
    ["package.json", pkg('  "author": "x",\n  "author": "Karl Livesey"')],
    // nested author, as an object or as a two-space-indented line
    [
      "package.json",
      pkg('  "author": "x",\n  "maintainer": {\n    "author": "Karl"\n  }'),
    ],
    ["package.json", pkg('  "maintainer": {\n  "author": "Karl Livesey"\n  }')],
    ["package.json", pkg('  "author": { "name": "Karl Livesey" }')],
    // the name anywhere else
    [
      "package.json",
      pkg('  "description": "by Karl",\n  "author": "Karl Livesey"'),
    ],
    [
      "package.json",
      pkg('  "author": "Karl Livesey",\n  "contributors": ["Karl"]'),
    ],
    ["package.json", pkg('  "author": "Karl Livesey", "description": "Karl"')],
    ["package.json", '{\n  "author": "Karl Livesey",\n'],
    ["README.md", '  "author": "Karl Livesey",'],
    ["dist/cli/main.js", "// Karl"],
  ])
    assert.equal(personalFindings(path, text).length, 1, `${path}: ${text}`);
  assert.deepEqual(
    personalFindings("package.json", '  "x": "/home/someone/y",'),
    ["package.json:1: personal path"],
  );
});
test("no shipped file carries a personal path, the owner's name or a private project name", () => {
  const offences = [];
  const shipped = [];
  for (const path of files()) {
    if (/\.(wasm|png|ico)$/.test(path) || !existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    shipped.push({ path, text });
    offences.push(...personalFindings(path, text));
  }
  offences.push(...privateNameFindings(privateNamesFile, shipped));
  assert.deepEqual(offences, []);
});
