#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Print sampled edges from a diff bucket with their source lines, for
// hand-checking. Reads OUT/repos/<id>/diff.json and the kept clone.
//
//   node scripts/compare/show.mjs --out DIR --repo ID --bucket NAME [--limit N] [--skip N] [--class call] [--context N]
//   node scripts/compare/show.mjs --out DIR --repo ID --list
//
// Each example prints the call site (file:line and the source text) and the
// target's declaration line, plus each tool's certainty and, for a tool that
// lacks the edge, what it has at that site.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const out = resolve(
  opt(
    "out",
    process.env.PYM_SCRATCH
      ? join(process.env.PYM_SCRATCH, "compare")
      : "compare-out",
  ),
);
const repo = opt("repo");
if (!repo) {
  process.stderr.write(
    "usage: show.mjs --out DIR --repo ID (--list | --bucket NAME [--limit N] [--class C])\n",
  );
  process.exit(64);
}
const d = JSON.parse(
  readFileSync(join(out, "repos", repo, "diff.json"), "utf8"),
);
if (args.includes("--list")) {
  for (const [k, v] of Object.entries(d.buckets))
    process.stdout.write(`${k}\t${v.total}\t${JSON.stringify(v.byClass)}\n`);
  process.exit(0);
}
const bucket = d.buckets[opt("bucket")];
if (!bucket) {
  process.stderr.write(`no bucket ${opt("bucket")}\n`);
  process.exit(1);
}
const src = join(out, "work", repo, "src");
const cache = new Map();
const lineOf = (file, line) => {
  if (!cache.has(file)) {
    const p = join(src, file);
    cache.set(file, existsSync(p) ? readFileSync(p, "utf8").split("\n") : []);
  }
  return (cache.get(file)[(line ?? 1) - 1] ?? "").trim().slice(0, 160);
};
const cls = opt("class");
const limit = Number(opt("limit", "25"));
const skip = Number(opt("skip", "0"));
const context = Number(opt("context", "0"));
const around = (file, line) => {
  lineOf(file, line);
  const all = cache.get(file);
  const lo = Math.max(1, line - context);
  const hi = Math.min(all.length, line + context);
  const rows = [];
  for (let i = lo; i <= hi; i++)
    rows.push(
      `   ${i === line ? ">" : " "}${String(i).padStart(5)}| ${all[i - 1].slice(0, 150)}`,
    );
  return rows.join("\n");
};
let n = 0;
for (const ex of bucket.sample.slice(skip)) {
  if (
    cls &&
    !Object.values(ex.kinds).some((k) =>
      k.split("|").some((x) => x.includes(cls)),
    )
  )
    continue;
  if (n++ >= limit) break;
  const from = `${ex.from.file}:${ex.from.line} ${ex.from.container ? `${ex.from.container}.` : ""}${ex.from.symbol || "(file)"}`;
  const to = `${ex.to.file}:${ex.to.line} ${ex.to.container ? `${ex.to.container}.` : ""}${ex.to.symbol}`;
  process.stdout.write(`#${n} ${from} -> ${to}\n`);
  process.stdout.write(
    context
      ? `${around(ex.from.file, ex.from.line)}\n`
      : `   site: ${lineOf(ex.from.file, ex.from.line)}\n`,
  );
  process.stdout.write(`   decl: ${lineOf(ex.to.file, ex.to.line)}\n`);
  process.stdout.write(
    `   kinds ${JSON.stringify(ex.kinds)} presence ${JSON.stringify(ex.presence)}${ex.absentState ? ` absent ${JSON.stringify(ex.absentState)}` : ""}\n`,
  );
}
