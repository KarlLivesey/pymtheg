// Compare main-* and branch-* lines of an identity.mjs JSONL file step by step.
// usage: node compare.mjs <file.jsonl>...
import { readFileSync } from "node:fs";
let identical = true;
for (const file of process.argv.slice(2)) {
  const runs = Object.fromEntries(
    readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const o = JSON.parse(line);
        return [o.label, o];
      }),
  );
  for (const step of ["cold", "warm", "changed", "reverted"]) {
    const a = runs[`main-${step}`],
      b = runs[`branch-${step}`];
    const same = (x) => JSON.stringify(x(a)) === JSON.stringify(x(b));
    const ok =
      same((o) => o.tables) && same((o) => o.api) && same((o) => o.report);
    identical &&= ok;
    console.log(
      `${file} ${step.padEnd(8)} identical=${ok} main ${(a.wallMs / 1000).toFixed(1)} s (load ${a.loadStart}, ${a.maxRssMB} MB) branch ${(b.wallMs / 1000).toFixed(1)} s (load ${b.loadStart}, ${b.maxRssMB} MB)`,
    );
  }
}
console.log(identical ? "ALL IDENTICAL" : "DIFFERENCES FOUND");
