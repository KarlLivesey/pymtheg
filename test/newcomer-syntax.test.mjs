import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../dist/language/parser.js";
import { analyseFile } from "../dist/analysis/index.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const cases = [
  [
    "await expression",
    "op g(n: Nat) -> Bool; flow f(n: Nat) -> Bool { let r = await g(n); return r; }",
    /call g\(.*as result/i,
  ],
  [
    "bare component call",
    "op g(n: Nat) -> Unit; flow f(n: Nat) -> Unit { g(n); }",
    /call g\(/i,
  ],
  ["optional result", "flow f() -> Nat? { return 1; }", /None.*Some\(Nat\)/],
  ["assignment", "flow f() -> Unit { let x = 1; x = 2; }", /immutable.*let/i],
];
for (const [name, source, hint] of cases)
  test(`newcomer ${name} keeps a source-spanned actionable explanation`, () => {
    const parsed = parse("first.pym", source);
    assert.ok(parsed.diagnostics.length > 0);
    assert.match(parsed.diagnostics.map((d) => d.message).join("\n"), hint);
    assert.ok(
      parsed.diagnostics.every(
        (d) => d.span.start >= 0 && d.span.end <= source.length,
      ),
    );
  });
test("an ordinary identifier named await remains valid in an expression", () => {
  assert.deepEqual(
    parse(
      "valid.pym",
      "rule await(input: Nat) -> Nat = input; rule invoke() -> Nat = await(1);",
    ).diagnostics,
    [],
  );
});

test("missing semicolons point at the insertion, including before comments and EOF", () => {
  for (const [before, after] of [
    ["flow f(n: Nat) -> Nat { let r = n", "\n return r; }"],
    ["flow f(n: Nat) -> Nat { return n", " }"],
    ["type T = { n: Nat }", " // keep this note\nflow g() -> Unit {}"],
    ["op g() -> Unit", "\n"],
    ['rule s() -> String = "hello 🌍"', "\r\n// note\r\nflow g() -> Unit {}"],
  ]) {
    const source = before + after;
    const parsed = parse("first.pym", source);
    const diagnostic = parsed.diagnostics[0];
    assert.equal(diagnostic.code, "P002");
    assert.match(diagnostic.message, /Expected ';'.*Add ';'/);
    assert.deepEqual(diagnostic.span, {
      file: "first.pym",
      start: before.length,
      end: before.length,
    });
    assert.deepEqual(parse("first.pym", before + ";" + after).diagnostics, []);
    if (after.includes("flow g"))
      assert.ok(parsed.declarations.some((d) => d.name === "g"));
  }
});

test("an ambiguous token does not get a speculative semicolon insertion", () => {
  const source = "flow f(n: Nat) -> Nat { let r = n as result; return r; }";
  const diagnostic = parse("first.pym", source).diagnostics[0];
  assert.match(diagnostic.message, /Expected ';', found 'as'/);
  assert.equal(source.slice(diagnostic.span.start, diagnostic.span.end), "as");
});

test("CLI missing-semicolon guidance preserves invalid source and incomplete evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-semicolon-"));
  try {
    const file = join(root, "first.pym");
    const before = "flow f(n: Nat) -> Nat { let r = n";
    const after = "\n return r; }\nflow valid() -> Unit {}\n";
    await writeFile(file, before + after);
    const broken = analyseFile(file).report;
    assert.ok(broken.results.some((r) => r.completion === "incomplete"));
    const run = spawnSync(
      process.execPath,
      ["dist/cli/main.js", "check", file],
      {
        encoding: "utf8",
      },
    );
    assert.ifError(run.error);
    assert.equal(run.status, 1);
    assert.ok(
      run.stdout.includes(`first.pym:1:${before.length + 1} error P002`),
    );
    assert.match(run.stdout, /Add ';' at the highlighted position/);
    assert.equal(await readFile(file, "utf8"), before + after);
    await writeFile(file, before + ";" + after);
    const corrected = analyseFile(file).report;
    assert.deepEqual(corrected.diagnostics, []);
    assert.ok(corrected.results.every((r) => r.completion !== "incomplete"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
