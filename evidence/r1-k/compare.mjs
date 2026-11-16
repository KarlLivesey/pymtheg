// R1-K before/after comparison of two measure.mjs runs on one corpus.
// Usage: node evidence/r1-k/compare.mjs <out-dir> <before-label> <after-label>
//          <source-root> <seed> <changed-sample> <new-sample> [<body-sample>]
// Prints outcome tables (written links and derived links apart), the reason
// table for unresolved written links, and two seeded random samples with the
// source line of each link, for reading by hand:
//  - written links present in both runs that went unresolved -> definite;
//  - new definite links (macro-argument calls and derived macro-body calls);
//  - optionally <body-sample> derived macro-body calls only (all if fewer).
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [dir, beforeLabel, afterLabel, source, seedText, changedN, newN, bodyN] =
  process.argv.slice(2);
const load = (label) =>
  readFileSync(join(dir, `${label}-links.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const before = load(beforeLabel),
  after = load(afterLabel);
const summary = (label) =>
  JSON.parse(readFileSync(join(dir, `${label}-summary.json`), "utf8"));
const key = (r) => `${r.file}|${r.start}|${r.end}|${r.kind}|${r.name}`;
const count = (rows, f) => {
  const m = {};
  for (const r of rows) {
    const k = f(r);
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
};
const table = (rows) => count(rows, (r) => r.state);
const written = (rows) => rows.filter((r) => !r.derived && r.kind !== "contains");
console.log("module", summary(beforeLabel).module, "->", summary(afterLabel).module);
console.log("seconds", summary(beforeLabel).seconds, "->", summary(afterLabel).seconds);
console.log("all links before", table(before), before.length);
console.log("all links after ", table(after), after.length);
console.log("written (non-contains) before", table(written(before)));
console.log("written (non-contains) after ", table(written(after)));
console.log(
  "  of which new macro-argument calls",
  table(after.filter((r) => r.macroArgument)),
);
console.log("derived macro-body calls", table(after.filter((r) => r.derived)));
const reasons = (rows) =>
  count(
    written(rows).filter((r) => r.state === "unresolved"),
    (r) => `${r.kind}|${r.reason}`,
  );
const rb = reasons(before),
  ra = reasons(after);
const keys = [...new Set([...Object.keys(rb), ...Object.keys(ra)])].sort(
  (a, b) => (rb[b] ?? 0) + (ra[b] ?? 0) - (rb[a] ?? 0) - (ra[a] ?? 0),
);
console.log("\nunresolved written links by kind|reason: before -> after");
for (const k of keys.slice(0, 40))
  console.log(`  ${String(rb[k] ?? 0).padStart(7)} -> ${String(ra[k] ?? 0).padStart(7)}  ${k}`);
const classes = (rows) =>
  count(
    written(rows).filter((r) => r.state === "unresolved"),
    (r) => r.class ?? "?",
  );
console.log("\nunresolved written links by target class: before", classes(before));
console.log("unresolved written links by target class: after ", classes(after));

const beforeByKey = new Map(before.map((r) => [key(r), r]));
const changes = count(
  after.filter((r) => !r.derived && beforeByKey.has(key(r))),
  (r) => `${beforeByKey.get(key(r)).state} -> ${r.state}`,
);
console.log("\nlinks present in both runs, outcome change", changes);
const gained = after.filter(
  (r) =>
    !r.derived &&
    r.state === "resolved" &&
    beforeByKey.get(key(r))?.state === "unresolved",
);
const lost = after.filter(
  (r) =>
    !r.derived &&
    r.state !== "resolved" &&
    beforeByKey.get(key(r))?.state === "resolved",
);
console.log("unresolved -> definite", gained.length, "| definite -> other", lost.length);
for (const r of lost.slice(0, 20))
  console.log("  LOST", r.file, r.start, r.kind, r.name, r.state, r.reason);
const fresh = after.filter(
  (r) => r.state === "resolved" && (r.derived || !beforeByKey.has(key(r))),
);
console.log("new definite links (argument calls + derived)", fresh.length);

// mulberry32: a small deterministic generator; the seed is printed.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seed = Number(seedText);
function sample(rows, n, rnd) {
  const pool = [...rows];
  const out = [];
  while (out.length < n && pool.length)
    out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}
const texts = new Map();
const lineOf = (file, offset) => {
  if (!texts.has(file)) texts.set(file, readFileSync(join(source, file), "utf8"));
  const text = texts.get(file);
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const end = text.indexOf("\n", offset);
  return {
    line: text.slice(0, offset).split("\n").length,
    text: text.slice(start, end < 0 ? undefined : end).trim().slice(0, 160),
  };
};
const show = (title, rows) => {
  console.log(`\n${title} (seed ${seed})`);
  rows.forEach((r, i) => {
    const at = lineOf(r.file, r.start);
    console.log(
      `${String(i + 1).padStart(3)}. ${r.file}:${at.line} ${r.kind} ${r.name.replace(/\s+/g, "")}${r.derived ? " [derived]" : r.macroArgument ? " [macro argument]" : ""}\n       -> ${r.targets.join(" ; ")}\n       | ${at.text}`,
    );
  });
};
const rnd = random(seed);
show("SAMPLE unresolved -> definite", sample(gained, Number(changedN), rnd));
show("SAMPLE new definite", sample(fresh, Number(newN), rnd));
if (bodyN)
  show(
    "SAMPLE derived macro-body calls",
    sample(
      fresh.filter((r) => r.derived),
      Number(bodyN),
      rnd,
    ),
  );
