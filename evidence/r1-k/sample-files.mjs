// R1-K round 4: seeded sample of definite macro-argument calls restricted to
// a list of files (one path per line), printed with the source line.
// Usage: node evidence/r1-k/sample-files.mjs <links.jsonl> <files.txt> <source-root> <seed> <n>
import { readFileSync } from "node:fs";
import { join } from "node:path";
const [jsonl, list, source, seedText, n] = process.argv.slice(2);
const files = new Set(readFileSync(list, "utf8").split("\n").filter(Boolean));
const rows = readFileSync(jsonl, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l))
  .filter((r) => r.macroArgument && r.state === "resolved" && files.has(r.file));
let a = Number(seedText) >>> 0;
const rnd = () => {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pool = [...rows],
  out = [];
while (out.length < Number(n) && pool.length)
  out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
console.log(`files ${files.size}, definite argument calls in them ${rows.length}, seed ${seedText}`);
out.forEach((r, i) => {
  const text = readFileSync(join(source, r.file), "utf8");
  const s = text.lastIndexOf("\n", r.start - 1) + 1,
    e = text.indexOf("\n", r.start);
  console.log(
    `${String(i + 1).padStart(3)}. ${r.file}:${text.slice(0, r.start).split("\n").length} ${r.name.replace(/\s+/g, "")}\n       -> ${r.targets.join(" ; ")}\n       | ${text.slice(s, e < 0 ? undefined : e).trim().slice(0, 160)}`,
  );
});
