// node heapown.mjs SNAPSHOT [TOP]: the self size of array nodes by the
// (holder name, property) edge that first reaches each, streamed.
import { openSync, readSync } from "node:fs";

const [path, topArg] = process.argv.slice(2);
const top = Number(topArg ?? 40);
const fd = openSync(path, "r");
const CHUNK = 1 << 24;
const buffer = Buffer.alloc(CHUNK);
let text = "";
let position = 0;
let at = 0;
const more = () => {
  const read = readSync(fd, buffer, 0, CHUNK, position);
  if (!read) return false;
  position += read;
  text = text.slice(at) + buffer.toString("latin1", 0, read);
  at = 0;
  return true;
};
function seek(marker) {
  for (;;) {
    const found = text.indexOf(marker, at);
    if (found >= 0) {
      at = found + marker.length;
      return;
    }
    at = Math.max(at, text.length - marker.length);
    if (!more()) throw Error("no " + marker);
  }
}
/** Calls `each(n)` for every integer until the closing bracket. */
function integers(each) {
  for (;;) {
    let i = at;
    let number = -1;
    for (; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 48 && c <= 57) number = (number < 0 ? 0 : number * 10) + (c - 48);
      else {
        if (number >= 0) {
          each(number);
          number = -1;
        }
        if (c === 93) {
          at = i + 1;
          return;
        }
      }
    }
    let back = text.length;
    while (back > at && text.charCodeAt(back - 1) >= 48 && text.charCodeAt(back - 1) <= 57)
      back--;
    if (number >= 0) {
      // Re-read the cut number next time.
    }
    at = back;
    if (!more()) return;
  }
}

more();
const head = text.slice(0, 1 << 20);
const list = (name) =>
  JSON.parse("[" + new RegExp(`"${name}":\\[([^\\]]*)\\]`).exec(head)[1] + "]");
const nodeFields = list("node_fields");
const edgeFields = list("edge_fields");
const nodeTypes = JSON.parse(
  "[" + /"node_types":\[\[([^\]]*)\]/.exec(head)[1] + "]",
);
const edgeTypes = JSON.parse(
  "[" + /"edge_types":\[\[([^\]]*)\]/.exec(head)[1] + "]",
);
const count = Number(/"node_count":(\d+)/.exec(head)[1]);
const F = nodeFields.length;
const E = edgeFields.length;
const type = new Uint8Array(count);
const name = new Int32Array(count);
const size = new Float64Array(count);
const edges = new Int32Array(count);
const T = nodeFields.indexOf("type");
const N = nodeFields.indexOf("name");
const S = nodeFields.indexOf("self_size");
const C = nodeFields.indexOf("edge_count");
const ARRAY = nodeTypes.indexOf("array");
const PROPERTY = edgeTypes.indexOf("property");
const INTERNAL = edgeTypes.indexOf("internal");
seek('"nodes":[');
let field = 0;
let node = 0;
integers((n) => {
  if (field === T) type[node] = n;
  else if (field === N) name[node] = n;
  else if (field === S) size[node] = n;
  else if (field === C) edges[node] = n;
  if (++field === F) {
    field = 0;
    node++;
  }
});
seek('"edges":[');
// Each node's first retainer through a property, element or internal edge.
const holderOf = new Int32Array(count).fill(-1);
const edgeName = new Int32Array(count).fill(-1);
const ELEMENT = edgeTypes.indexOf("element");
let from = 0;
let left = edges[0];
const edge = new Array(E);
field = 0;
integers((n) => {
  edge[field] = n;
  if (++field < E) return;
  field = 0;
  while (left === 0 && from < count - 1) left = edges[++from];
  left--;
  const to = edge[2] / F;
  if (holderOf[to] >= 0) return;
  if (edge[0] !== PROPERTY && edge[0] !== INTERNAL && edge[0] !== ELEMENT) return;
  holderOf[to] = from;
  edgeName[to] = edge[0] === ELEMENT ? -2 : edge[1];
});
// Short strings, by index.
seek('"strings":[');
const strings = [];
for (;;) {
  let start = text.indexOf('"', at);
  while (start < 0) {
    at = text.length;
    if (!more()) break;
    start = text.indexOf('"', at);
  }
  if (start < 0) break;
  let end = start + 1;
  let stop = false;
  for (;;) {
    if (end >= text.length) {
      const offset = end - at;
      const s0 = start - at;
      if (!more()) { stop = true; break; }
      end = at + offset;
      start = at + s0;
      continue;
    }
    const c = text.charCodeAt(end);
    if (c === 92) end += 2;
    else if (c === 34) break;
    else end++;
  }
  if (stop) break;
  strings.push(end - start < 120 ? text.slice(start + 1, end) : "<long>");
  at = end + 1;
  // The strings list ends with "]".
  let k = at;
  while (k < text.length && (text[k] === "," || text[k] === "\n" || text[k] === " ")) k++;
  if (text[k] === "]") break;
}
const generic = new Set(["Array", "Object", "Map", "Set", "", "(object elements)", "system / PropertyArray", "system / Context"]);
const owners = new Map();
for (let node = 0; node < count; node++) {
  if (process.env.TARGET ? strings[name[node]] !== process.env.TARGET : type[node] !== ARRAY) continue;
  const path = [];
  let cur = node;
  for (let k = 0; k < Number(process.env.DEPTH ?? 6); k++) {
    const holder = holderOf[cur];
    if (holder < 0) break;
    path.unshift(edgeName[cur] === -2 ? "[]" : strings[edgeName[cur]] ?? "?");
    cur = holder;
    if (!generic.has(strings[name[cur]] ?? "")) break;
  }
  const key = (strings[name[cur]] ?? "?") + "." + path.join(".");
  const entry = owners.get(key);
  if (entry) { entry[0]++; entry[1] += size[node]; } else owners.set(key, [1, size[node]]);
}
for (const [key, [n, bytes]] of [...owners].sort((x, y) => y[1][1] - x[1][1]).slice(0, top))
  console.log(`${(bytes / 2 ** 20).toFixed(1).padStart(8)} MiB ${String(n).padStart(9)} ${key.slice(0, 140)}`);
