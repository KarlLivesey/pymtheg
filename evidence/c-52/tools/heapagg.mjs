// node heapagg.mjs SNAPSHOT [TOP]: self size by (node type, name) from a V8
// heap snapshot, streamed (the file is larger than a string can be).
import { openSync, readSync } from "node:fs";

const [path, topArg] = process.argv.slice(2);
const top = Number(topArg ?? 40);
const fd = openSync(path, "r");
const CHUNK = 1 << 24;
const buffer = Buffer.alloc(CHUNK);
let text = "";
let position = 0;
let done = false;
const more = () => {
  if (done) return false;
  const read = readSync(fd, buffer, 0, CHUNK, position);
  if (!read) {
    done = true;
    return false;
  }
  position += read;
  text += buffer.toString("latin1", 0, read);
  return true;
};
let at = 0;
/** Advance until `marker` is found; return the index just after it. */
function seek(marker) {
  for (;;) {
    const found = text.indexOf(marker, at);
    if (found >= 0) {
      at = found + marker.length;
      return true;
    }
    // Keep a tail in case the marker spans chunks.
    text = text.slice(Math.max(at, text.length - marker.length));
    at = 0;
    if (!more()) return false;
  }
}
const compact = () => {
  if (at > CHUNK) {
    text = text.slice(at);
    at = 0;
  }
};

more();
const meta = /"node_fields":\[([^\]]*)\][\s\S]*?"node_types":\[\[([^\]]*)\]/.exec(
  text.slice(0, 1 << 20),
);
const fields = meta[1].split(",").map((f) => JSON.parse(f));
const types = meta[2].split(",").map((f) => JSON.parse(f));
const F = fields.length;
const TYPE = fields.indexOf("type");
const NAME = fields.indexOf("name");
const SIZE = fields.indexOf("self_size");

// Nodes: integers until "]".
seek('"nodes":[');
const sizes = new Map(); // `${type}\0${name}` -> [count, bytes]
let field = 0;
let row = new Array(F).fill(0);
let nodes = 0;
for (;;) {
  compact();
  let i = at;
  let number = -1;
  let closed = false;
  for (; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 48 && c <= 57) number = (number < 0 ? 0 : number * 10) + (c - 48);
    else {
      if (number >= 0) {
        row[field++] = number;
        number = -1;
        if (field === F) {
          const key = `${row[TYPE]}\0${row[NAME]}`;
          const entry = sizes.get(key);
          if (entry) {
            entry[0]++;
            entry[1] += row[SIZE];
          } else sizes.set(key, [1, row[SIZE]]);
          field = 0;
          nodes++;
        }
      }
      if (c === 93) {
        closed = true;
        break;
      }
    }
  }
  if (closed) {
    at = i + 1;
    break;
  }
  // Back up over a number cut by the chunk end.
  let back = text.length;
  while (back > at && text.charCodeAt(back - 1) >= 48 && text.charCodeAt(back - 1) <= 57) back--;
  at = back;
  if (!more()) break;
}
const ranked = [...sizes].sort((a, b) => b[1][1] - a[1][1]).slice(0, top);
const wanted = new Map(ranked.map(([key]) => [Number(key.split("\0")[1]), ""]));

// Strings: only the wanted names, by index.
seek('"strings":[');
let index = 0;
const maxWanted = Math.max(...wanted.keys());
while (index <= maxWanted) {
  compact();
  let start = text.indexOf('"', at);
  while (start < 0) {
    if (!more()) break;
    start = text.indexOf('"', at);
  }
  if (start < 0) break;
  let end = start + 1;
  for (;;) {
    if (end >= text.length) {
      if (!more()) break;
      continue;
    }
    const c = text.charCodeAt(end);
    if (c === 92) end += 2;
    else if (c === 34) break;
    else end++;
  }
  if (wanted.has(index)) {
    let value = text.slice(start, end + 1);
    try {
      value = JSON.parse(value);
    } catch {}
    wanted.set(index, String(value).slice(0, 80));
  }
  index++;
  at = end + 1;
}
let total = 0;
for (const [, [, bytes]] of sizes) total += bytes;
console.log(`nodes ${nodes}, self size ${(total / 2 ** 20).toFixed(0)} MiB`);
for (const [key, [count, bytes]] of ranked) {
  const [type, name] = key.split("\0").map(Number);
  console.log(
    `${(bytes / 2 ** 20).toFixed(1).padStart(8)} MiB ${String(count).padStart(10)} ${types[type]} ${JSON.stringify(wanted.get(name))}`,
  );
}
