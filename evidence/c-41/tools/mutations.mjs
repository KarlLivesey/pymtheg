// SPDX-License-Identifier: MIT
// C-41 review 3: shows that the review-3 test fails without each fix. For each
// mutation, undoes one fix in receiver-arms.ts, builds, runs the test and
// prints which cases changed, then restores the file. Run from the
// repository root on a scratch copy: `node evidence/c-41/tools/mutations.mjs`.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/graph/languages/typescript/receiver-arms.ts";
const TEST = "test/graph-typescript-literal-members.test.mjs";
const PATTERN = "review 3:";

const MUTATIONS = {
  "1: escapes by getSymbolAtLocation only (round 2)": [
    [
      `let symbol = ts.isExportSpecifier(parent)
          ? checker.getExportSpecifierLocalTargetSymbol(parent)
          : ts.isShorthandPropertyAssignment(parent) && parent.name === node
            ? checker.getShorthandAssignmentValueSymbol(parent)
            : checker.getSymbolAtLocation(node);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol);`,
      `let symbol = checker.getSymbolAtLocation(node);`,
    ],
  ],
  "2a: a shorthand member is never instantiated (round 2)": [
    [`return !!(member.flags & ts.SymbolFlags.Transient);`, `return false;`],
  ],
  "2b: no open type parameter backstop": [
    [
      `!arm.generic &&
          !own.has(arm.type) &&`,
      `false &&`,
    ],
  ],
  "2: both": [
    [`return !!(member.flags & ts.SymbolFlags.Transient);`, `return false;`],
    [
      `!arm.generic &&
          !own.has(arm.type) &&`,
      `false &&`,
    ],
  ],
  "3: accessor pairs as written (round 2)": [
    [
      `if (getter) return declarationArms(getter);
    if (declarations.some(ts.isSetAccessorDeclaration)) return undefined;`,
      ``,
    ],
    [`if (ts.isSetAccessorDeclaration(property)) {`, `if (false) {`],
  ],
  "4: logical assignment as the checker's type (round 2)": [
    [
      ` ||
        operator === ts.SyntaxKind.QuestionQuestionEqualsToken ||
        operator === ts.SyntaxKind.BarBarEqualsToken`,
      ``,
    ],
    [
      `
        operator === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||`,
      ``,
    ],
    [
      `return typeAt(node).flags & PRIMITIVE_FLAGS ? leaf(node) : undefined;`,
      `return leaf(node);`,
    ],
  ],
};

const original = readFileSync(FILE, "utf8");
const run = () =>
  spawnSync("node", ["--test", `--test-name-pattern=${PATTERN}`, TEST], {
    encoding: "utf8",
  });
// The assertion diff, without the stack.
const changed = (output) => {
  const lines = output.split("\n");
  const start = lines.findIndex((line) => line.includes("Expected values"));
  const end = lines.findIndex(
    (line, index) => index > start && /^\s+(at |code:)/.test(line),
  );
  return lines.slice(start, end).join("\n");
};

try {
  for (const [name, edits] of Object.entries(MUTATIONS)) {
    let text = original;
    for (const [from, to] of edits) {
      if (text.split(from).length !== 2) throw new Error(`${name}: anchor`);
      text = text.replace(from, to);
    }
    writeFileSync(FILE, text);
    execFileSync("npx", ["tsc", "-p", "."], { stdio: "inherit" });
    const result = run();
    console.log(`## ${name}: test ${result.status === 0 ? "PASSES" : "FAILS"}`);
    if (result.status !== 0) console.log(changed(result.stdout));
  }
} finally {
  writeFileSync(FILE, original);
  execFileSync("npx", ["tsc", "-p", "."], { stdio: "inherit" });
}
const control = run();
console.log(
  `## no mutation: test ${control.status === 0 ? "PASSES" : "FAILS"}`,
);
