// SPDX-License-Identifier: MIT
// C-40: a summary of a V8 heap snapshot: self size and count by node type
// and constructor name, the largest strings' starts, and, for the largest
// constructor groups, the names of what holds them (one edge up).
//   node --max-old-space-size=N scripts/memory/snapshot.mjs <file.heapsnapshot> [top]
import { readFileSync } from "node:fs";

const [file, topArg] = process.argv.slice(2);
const top = Number(topArg ?? 25);
const snapshot = JSON.parse(readFileSync(file, "utf8"));
const meta = snapshot.snapshot.meta;
const fields = meta.node_fields;
const width = fields.length;
const types = meta.node_types[0];
const edgeFields = meta.edge_fields;
const edgeWidth = edgeFields.length;
const edgeTypes = meta.edge_types[0];
const { nodes, edges, strings } = snapshot;
const at = (name) => fields.indexOf(name);
const [typeAt, nameAt, sizeAt, edgeCountAt] = [
  at("type"),
  at("name"),
  at("self_size"),
  at("edge_count"),
];
const groups = new Map();
const count = nodes.length / width;
const label = (index) => {
  const type = types[nodes[index * width + typeAt]];
  const name = strings[nodes[index * width + nameAt]];
  return type === "object" || type === "closure" ? `${type}:${name}` : type;
};
for (let i = 0; i < count; i++) {
  const key = label(i);
  const group = groups.get(key) ?? { size: 0, count: 0 };
  group.size += nodes[i * width + sizeAt];
  group.count++;
  groups.set(key, group);
}
const mib = (bytes) => (bytes / 1048576).toFixed(1);
const ranked = [...groups].sort((a, b) => b[1].size - a[1].size);
console.log("self size by type and constructor:");
for (const [key, group] of ranked.slice(0, top))
  console.log(`  ${mib(group.size)} MiB  ${group.count}  ${key}`);
// One edge up: which constructors hold the largest object groups.
const first = new Uint32Array(count + 1);
for (let i = 0, edge = 0; i < count; i++) {
  first[i] = edge;
  edge += nodes[i * width + edgeCountAt] * edgeWidth;
}
first[count] = edges.length;
const wanted = new Set(
  ranked
    .filter(([key]) => key.startsWith("object:"))
    .slice(0, 6)
    .map(([key]) => key),
);
const holders = new Map([...wanted].map((key) => [key, new Map()]));
const toAt = edgeFields.indexOf("to_node");
const edgeTypeAt = edgeFields.indexOf("type");
for (let i = 0; i < count; i++) {
  const holder = label(i);
  for (let e = first[i]; e < first[i + 1]; e += edgeWidth) {
    if (edgeTypes[edges[e + edgeTypeAt]] === "weak") continue;
    const target = edges[e + toAt] / width;
    const key = label(target);
    const map = holders.get(key);
    if (map) map.set(holder, (map.get(holder) ?? 0) + 1);
  }
}
for (const [key, map] of holders) {
  console.log(`held ${key} by:`);
  for (const [holder, n] of [...map].sort((a, b) => b[1] - a[1]).slice(0, 6))
    console.log(`    ${n}  ${holder}`);
}

// --path <label>: the shortest strong path from the GC roots to one node of
// that label (type:constructor as above), with each edge's name.
const pathAt = process.argv.indexOf("--path");
if (pathAt >= 0) {
  const target = process.argv[pathAt + 1];
  const nameOrIndexAt = edgeFields.indexOf("name_or_index");
  const parent = new Int32Array(count).fill(-1);
  const via = new Int32Array(count).fill(-1);
  const queue = new Uint32Array(count);
  let head = 0;
  let tail = 0;
  queue[tail++] = 0;
  parent[0] = 0;
  let found = -1;
  while (head < tail && found < 0) {
    const i = queue[head++];
    for (let e = first[i]; e < first[i + 1]; e += edgeWidth) {
      const type = edgeTypes[edges[e + edgeTypeAt]];
      if (type === "weak" || type === "shortcut") continue;
      // A WeakMap entry's value is held only through its key: skip the
      // table's key-value pair edges, so the path shows what holds the key.
      if (
        type === "internal" &&
        String(strings[edges[e + nameOrIndexAt]]).includes("part of key")
      )
        continue;
      const next = edges[e + toAt] / width;
      if (parent[next] >= 0) continue;
      parent[next] = i;
      via[next] = e;
      if (label(next) === target) {
        found = next;
        break;
      }
      queue[tail++] = next;
    }
  }
  if (found < 0) console.log(`no path to ${target}`);
  else {
    const chain = [];
    for (let i = found; i !== 0; i = parent[i]) {
      const e = via[i];
      const type = edgeTypes[edges[e + edgeTypeAt]];
      const name =
        type === "element" || type === "hidden"
          ? `[${edges[e + nameOrIndexAt]}]`
          : strings[edges[e + nameOrIndexAt]];
      chain.push(`${label(parent[i])} --${type}:${name}--> ${label(i)}`);
    }
    console.log(`path to ${target}:`);
    for (const step of chain.reverse()) console.log(`  ${step}`);
  }
}
