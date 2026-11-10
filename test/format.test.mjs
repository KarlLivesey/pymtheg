import test from "node:test";
import assert from "node:assert/strict";
import { formatSource } from "../dist/language/format.js";
import { lex } from "../dist/language/lexer.js";
import { readFileSync, readdirSync } from "node:fs";
test("format preserves every token and comment and is idempotent across the language examples", () => {
  for (const file of readdirSync("examples/mvp").filter((f) =>
    f.endsWith(".pym"),
  )) {
    const source = readFileSync("examples/mvp/" + file, "utf8"),
      formatted = formatSource(file, source);
    assert.equal(
      source,
      formatted,
      "Shipped example must already be formatter-canonical: " + file,
    );
    assert.equal(formatSource(file, formatted), formatted, file);
    assert.deepEqual(
      lex(file, formatted).tokens.map((t) => t.text),
      lex(file, source).tokens.map((t) => t.text),
      file,
    );
    assert.deepEqual(
      formatted.match(/\/\/[^\n]*/g),
      source.match(/\/\/[^\n]*/g),
    );
  }
  assert.throws(() => formatSource("bad.pym", "flow bad( {"), /syntax errors/);
});
test("strings containing braces and comment-like text do not change indentation state", () => {
  const source = 'flow main() -> String {\nreturn "} // example";\n}\n';
  assert.equal(
    formatSource("x.pym", source),
    'flow main() -> String {\n  return "} // example";\n}\n',
  );
});

test("multi-line outcome cases retain continuation indentation and comments", () => {
  const source =
    "type Failure =\n// provider outage\nUnavailable |\nDeclined(String);\n";
  const expected =
    "type Failure =\n  // provider outage\n  Unavailable |\n  Declined(String);\n";
  assert.equal(formatSource("choices.pym", source), expected);
  assert.equal(formatSource("choices.pym", expected), expected);
  assert.deepEqual(
    lex("choices.pym", source).tokens.map((t) => t.text),
    lex("choices.pym", expected).tokens.map((t) => t.text),
  );
});

test("blank runs collapse without changing tokens or comments, including CRLF indentation", () => {
  const source =
    "flow example() -> Unit {\r\n\r\n\r\n// Keep this note\r\n\r\n\r\nreturn unit;\r\n}\r\n";
  const formatted = formatSource("example.pym", source);
  assert.equal(
    formatted,
    "flow example() -> Unit {\n\n  // Keep this note\n\n  return unit;\n}\n",
  );
  assert.equal(formatSource("example.pym", formatted), formatted);
  assert.deepEqual(
    lex("example.pym", source).tokens.map((t) => t.text),
    lex("example.pym", formatted).tokens.map((t) => t.text),
  );
});
