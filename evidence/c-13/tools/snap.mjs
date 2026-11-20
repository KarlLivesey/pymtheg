// snap.mjs FILE.heapsnapshot [depth] : self size grouped by shortest retaining path (BFS from root),
// plus self size by constructor. Paths are cut at `depth` edges; deeper nodes count towards their ancestor's path.
import { openSync, readSync, fstatSync, closeSync } from "node:fs";
const [file, depthArg] = process.argv.slice(2);
const depth = Number(depthArg ?? 7);
// Streaming-safe loader: the file can exceed V8's string limit.
const fd = openSync(file, "r"); const size = fstatSync(fd).size; const buf = Buffer.allocUnsafe(size);
for (let at = 0; at < size; ) at += readSync(fd, buf, at, Math.min(1 << 30, size - at), at);
closeSync(fd);
const find = (needle, from = 0) => { // chunked: Buffer.indexOf misbehaves past 2 GiB
  for (let at = from; at < buf.length; at += 1 << 29) { const i = buf.subarray(at, Math.min(buf.length, at + (1 << 29) + 64)).indexOf(needle); if (i >= 0) return at + i; }
  throw Error("missing " + needle); };
const metaStart = find('"snapshot":'); const nodesAt = find('"nodes":[');
const head = buf.subarray(0, nodesAt).toString("utf8").replace(/,\s*$/, "") + "}";
const snap = { snapshot: JSON.parse(head).snapshot };
const numbers = (start) => { let n = 0, v = 0, inNum = false; const out = []; let chunk = new Float64Array(1 << 20); let ci = 0;
  for (let i = start; ; i++) { const c = buf[i];
    if (c >= 48 && c <= 57) { v = v * 10 + (c - 48); inNum = true; }
    else { if (inNum) { if (ci === chunk.length) { out.push(chunk); chunk = new Float64Array(1 << 20); ci = 0; } chunk[ci++] = v; n++; v = 0; inNum = false; }
      if (c === 93) { out.push(chunk.subarray(0, ci)); const all = new Float64Array(n); let o = 0; for (const c2 of out) { all.set(c2, o); o += c2.length; } return all; } } } };
const nodes = numbers(nodesAt + 9);
const edges = numbers(find('"edges":[') + 9);
const strings = []; { let i = find('"strings":[', find('"edges":[')) + 11;
  for (;;) { while (buf[i] !== 34 && buf[i] !== 93) i++; if (buf[i] === 93) break; let j = i + 1; while (buf[j] !== 34) { if (buf[j] === 92) j++; j++; }
    strings.push(j - i > 2000 ? "<long string>" : JSON.parse(buf.toString("utf8", i, j + 1))); i = j + 1; } }
const m = snap.snapshot.meta;
const NF = m.node_fields.length, EF = m.edge_fields.length;
const nTypes = m.node_types[0], eTypes = m.edge_types[0];
const iType = m.node_fields.indexOf("type"), iName = m.node_fields.indexOf("name"),
  iSize = m.node_fields.indexOf("self_size"), iEc = m.node_fields.indexOf("edge_count");
const eType = m.edge_fields.indexOf("type"), eName = m.edge_fields.indexOf("name_or_index"), eTo = m.edge_fields.indexOf("to_node");
const count = nodes.length / NF;
const firstEdge = new Uint32Array(count + 1);
for (let i = 0, e = 0; i < count; i++) { firstEdge[i] = e; e += nodes[i * NF + iEc] * EF; firstEdge[i + 1] = e; }
const label = new Int32Array(count).fill(-1);
const labels = []; const labelIndex = new Map();
const intern = (s) => { let v = labelIndex.get(s); if (v === undefined) { v = labels.length; labels.push(s); labelIndex.set(s, v); } return v; };
const dep = new Uint8Array(count);
const nodeName = (n) => { const t = nTypes[nodes[n * NF + iType]]; const nm = strings[nodes[n * NF + iName]]; return t === "object" || t === "closure" ? nm.slice(0, 40) : `(${t})`; };
label[0] = intern("root");
let queue = [0];
while (queue.length) {
  const next = [];
  for (const n of queue) {
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e += EF) {
      const t = eTypes[edges[e + eType]];
      if (t === "weak" || t === "shortcut") continue;
      const to = edges[e + eTo] / NF;
      if (label[to] !== -1) continue;
      if (dep[n] >= depth) label[to] = label[n];
      else {
        const nm = t === "element" || t === "hidden" ? `[${t}]` : String(t === "property" || t === "context" || t === "internal" ? strings[edges[e + eName]] : edges[e + eName]).slice(0, 40);
        label[to] = intern(labels[label[n]] + " > " + nm + ":" + nodeName(to));
      }
      dep[to] = Math.min(255, dep[n] + 1);
      next.push(to);
    }
  }
  queue = next;
}
const byLabel = new Float64Array(labels.length); const byCtor = new Map(); let total = 0;
for (let i = 0; i < count; i++) {
  const s = nodes[i * NF + iSize]; total += s;
  if (label[i] >= 0) byLabel[label[i]] += s;
  const k = nTypes[nodes[i * NF + iType]] + ":" + (nTypes[nodes[i * NF + iType]] === "object" ? strings[nodes[i * NF + iName]].slice(0, 40) : "");
  byCtor.set(k, (byCtor.get(k) ?? 0) + s);
}
// roll up: total per label including all descendants' labels (prefix sums)
const roll = new Map();
labels.forEach((l, i) => { const parts = l.split(" > "); for (let k = 1; k <= parts.length; k++) { const p = parts.slice(0, k).join(" > "); roll.set(p, (roll.get(p) ?? 0) + byLabel[i]); } });
const mb = (x) => (x / 1048576).toFixed(1).padStart(8);
console.log("total MB", mb(total));
console.log("== by constructor"); [...byCtor].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(mb(v), k));
console.log("== by retaining path (rolled up, >= 1% of total)");
[...roll].filter(([, v]) => v >= total * 0.01).sort((a, b) => a[0] < b[0] ? -1 : 1).forEach(([k, v]) => console.log(mb(v), k.split(" > ").slice(-3).join(" > "), " #", k.split(" > ").length));
