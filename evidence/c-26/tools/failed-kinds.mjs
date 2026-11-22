// failed-kinds.mjs REPORT : failed files of a `graph index --json` report
// grouped by kind (syntax error, compiler failure, would-not-return, other),
// with the non-returning files listed.
import { readFileSync } from "node:fs";
const text = readFileSync(process.argv[2], "utf8");
const report = JSON.parse(text.slice(text.indexOf("{")));
const kinds = new Map();
const looping = [];
for (const failed of report.failedFiles ?? []) {
  const reason = failed.reason;
  const kind = reason.startsWith("Syntax error")
    ? "syntax"
    : reason.includes("would not return")
      ? "would-not-return"
      : reason.startsWith("The TypeScript compiler failed")
        ? "compiler"
        : reason.slice(0, 80);
  if (kind === "would-not-return") looping.push(failed.path);
  kinds.set(`${failed.language} ${kind}`, (kinds.get(`${failed.language} ${kind}`) ?? 0) + 1);
}
for (const [kind, n] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(n, kind);
console.log(looping.join("\n"));
