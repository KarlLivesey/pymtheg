// SPDX-License-Identifier: MIT
// Summarises a V8 .cpuprofile: self time by function and inclusive time of
// selected functions (main thread only; worker threads are not in it).
//   node scripts/reindex/profile.mjs <file.cpuprofile> [top N]
import { readFileSync } from "node:fs";

const [file, topArg] = process.argv.slice(2);
const top = Number(topArg ?? 30);
const profile = JSON.parse(readFileSync(file, "utf8"));
const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const parent = new Map();
for (const node of profile.nodes)
  for (const child of node.children ?? []) parent.set(child, node.id);
const self = new Map();
const deltas = profile.timeDeltas;
for (let i = 0; i < profile.samples.length; i++)
  self.set(
    profile.samples[i],
    (self.get(profile.samples[i]) ?? 0) + (deltas[i] ?? 0),
  );
const label = (node) => {
  const frame = node.callFrame;
  const url = frame.url
    .replace(/^.*\/(dist|node_modules|scripts)\//, "$1/")
    .replace(/^file:\/\/.*\//, "");
  return `${frame.functionName || "(anonymous)"} ${url}:${frame.lineNumber + 1}`;
};
const bySelf = new Map();
const inclusive = new Map();
let total = 0;
for (const [id, time] of self) {
  total += time;
  const name = label(nodes.get(id));
  bySelf.set(name, (bySelf.get(name) ?? 0) + time);
  // Each distinct function once per sample stack.
  const seen = new Set();
  for (let at = id; at !== undefined; at = parent.get(at)) {
    const key = label(nodes.get(at));
    if (seen.has(key)) continue;
    seen.add(key);
    inclusive.set(key, (inclusive.get(key) ?? 0) + time);
  }
}
const ms = (us) => (us / 1000).toFixed(0);
console.log(`total sampled ${ms(total)} ms\n\nself time:`);
for (const [name, time] of [...bySelf]
  .sort((a, b) => b[1] - a[1])
  .slice(0, top))
  console.log(`${ms(time).padStart(7)}  ${name}`);
console.log(`\ninclusive time:`);
for (const [name, time] of [...inclusive]
  .sort((a, b) => b[1] - a[1])
  .slice(0, top * 2))
  console.log(`${ms(time).padStart(7)}  ${name}`);
