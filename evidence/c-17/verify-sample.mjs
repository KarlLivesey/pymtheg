// SPDX-License-Identifier: MIT
// C-17 evidence: prints, for each hand-check sample link, the pinned source
// around it, the lines of the file that declare the receiver's root name
// (and fields of the next selector), the module's go directive, and `go doc`
// for the recorded owner and member (Go 1.27.4).
// Usage: node verify-sample.mjs --comparison site-comparison.json --scratch DIR --run cand-run.json
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    comparison: { type: "string" },
    scratch: { type: "string" },
    run: { type: "string" },
  },
});
const comparison = JSON.parse(readFileSync(values.comparison, "utf8"));
const attempts = new Map(
  JSON.parse(readFileSync(join(values.scratch, values.run), "utf8")).repos.map(
    (repo) => [repo.id, repo.attempt],
  ),
);
const doc = (args) => {
  try {
    return execFileSync("go", ["doc", ...args], { encoding: "utf8" }).trim();
  } catch (error) {
    return `go doc failed: ${String(error.stderr ?? error).trim()}`;
  }
};
comparison.sample.forEach((item, index) => {
  const checkout = join(values.scratch, attempts.get(item.repo), "checkout");
  const text = readFileSync(join(checkout, item.file), "utf8").split("\n");
  const parts = item.name.split(".");
  const root = parts[0].replace(/\(.*$/, "");
  const declares = text
    .map((line, number) => ({ line, number: number + 1 }))
    .filter(
      ({ line }) =>
        new RegExp(`\\b${root}\\b\\s*(,[^=]*)?(:=|\\s+\\*?[\\w.]+(\\s|$|,|\\))|=)`).test(line) &&
        /func|:=|var |\btype\b|^\s*\w+\s+\*?[\w.\[\]]+\s*$/.test(line),
    )
    .slice(0, 4);
  const symbol = item.library.symbol;
  const [owner] = symbol.split(".");
  const unexported = /^[a-z]/.test(owner);
  console.log(`### ${index + 1}. ${item.repo} ${item.file}:${item.line} ${item.name}`);
  console.log(`recorded: ${item.library.unit} ${symbol}`);
  for (let at = Math.max(1, item.line - 2); at <= Math.min(text.length, item.line); at++)
    console.log(`  ${at}: ${text[at - 1]}`);
  for (const found of declares) console.log(`  declares ${root} at ${found.number}: ${found.line.trim()}`);
  const imports = text.filter((line) => /^\s*(import\s+)?(\w+\s+)?"[^"]+"$/.test(line)).map((line) => line.trim());
  console.log(`  imports: ${imports.join(" ")}`);
  console.log(
    doc(
      item.library.unit === "builtin"
        ? ["builtin", owner]
        : [...(unexported ? ["-u"] : []), item.library.unit, symbol],
    )
      .split("\n")
      .slice(0, 4)
      .map((line) => `  doc: ${line}`)
      .join("\n"),
  );
  console.log("");
});
