// dump.mjs DB OUT.gz : every stored file, context, symbol, link and candidate, sorted; prints counts and a digest
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
const [db, out] = process.argv.slice(2);
const d = new DatabaseSync(db, { readOnly: true });
const gz = createGzip(); const file = createWriteStream(out); gz.pipe(file);
const hash = createHash("sha256"); const counts = {};
const emit = (kind, line) => { const s = kind + "\t" + line + "\n"; hash.update(s); counts[kind] = (counts[kind] ?? 0) + 1; if (!gz.write(s)) return new Promise((r) => gz.once("drain", r)); };
const q = [
  ["F", "SELECT path,status,body FROM graph_files ORDER BY path"],
  ["P", "SELECT path,hash,module,version FROM graph_parse_failures ORDER BY path"],
  ["X", "SELECT path,body FROM graph_contexts ORDER BY path"],
  ["S", "SELECT id,file,name,kind,body FROM graph_symbols ORDER BY id"],
  ["L", "SELECT id,file,source,target,kind,module,origin,resolution,body FROM graph_links ORDER BY id"],
  ["C", "SELECT link,symbol,kind FROM graph_candidates ORDER BY link,symbol"],
];
for (const [k, sql] of q)
  for (const row of d.prepare(sql).iterate()) {
    const p = emit(k, JSON.stringify(Object.values(row)));
    if (p) await p;
  }
gz.end(); await new Promise((r) => file.on("finish", r));
console.log(JSON.stringify(counts), hash.digest("hex"));
