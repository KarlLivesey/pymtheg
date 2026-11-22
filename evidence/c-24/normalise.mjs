// SPDX-License-Identifier: MIT
// C-24: a normalised, order-free dump of everything a graph store holds for
// its files: symbols, links (outcome, target, reason, stored data), candidate
// sets and library rows. Store ids are replaced by the keys they stand for,
// so two stores of the same snapshot compare line by line.
// Usage as a script: node normalise.mjs graph.sqlite > dump.txt
import { DatabaseSync } from "node:sqlite";

const LINK_SITE = ["range", "span", "start", "end", "name", "text", "path"];

export function dump(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  const symbolKey = new Map();
  const symbols = db
    .prepare("SELECT id,file,name,kind,body FROM graph_symbols")
    .all();
  for (const s of symbols) {
    const b = JSON.parse(s.body);
    symbolKey.set(
      s.id,
      JSON.stringify([s.file, s.kind, b.module, b.key, b.ordinal ?? null]),
    );
  }
  const links = db
    .prepare(
      "SELECT id,file,source,target,kind,body,module,origin,resolution FROM graph_links",
    )
    .all();
  const linkKey = new Map();
  for (const l of links) {
    const b = JSON.parse(l.body);
    const site = {};
    for (const k of LINK_SITE) if (k in b) site[k] = b[k];
    linkKey.set(
      l.id,
      JSON.stringify([l.file, l.module, l.kind, l.origin, site, b.key ?? null]),
    );
  }
  const map = (value) => {
    if (typeof value === "string")
      return symbolKey.has(value)
        ? "S" + symbolKey.get(value)
        : linkKey.has(value)
          ? "L" + linkKey.get(value)
          : value;
    if (Array.isArray(value)) {
      const out = value.map(map);
      // Arrays of ids are sets in the store; order them by their keys.
      return value.every((v) => symbolKey.has(v) || linkKey.has(v))
        ? out.sort()
        : out;
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const k of Object.keys(value).sort())
        if (k !== "id") out[k] = map(value[k]);
      return out;
    }
    return value;
  };
  const lines = [];
  for (const s of symbols)
    lines.push(
      ["S", symbolKey.get(s.id), s.name, JSON.stringify(map(JSON.parse(s.body)))].join("\t"),
    );
  for (const l of links)
    lines.push(
      [
        "L",
        linkKey.get(l.id),
        l.resolution,
        l.source ? symbolKey.get(l.source) : "",
        l.target ? symbolKey.get(l.target) : "",
        JSON.stringify(map(JSON.parse(l.body))),
      ].join("\t"),
    );
  for (const c of db.prepare("SELECT link,symbol,kind FROM graph_candidates").all())
    lines.push(["C", linkKey.get(c.link), symbolKey.get(c.symbol), c.kind].join("\t"));
  for (const t of db
    .prepare(
      "SELECT link,id,role,kind,ecosystem,unit,symbol,version,version_source,evidence FROM graph_library_targets",
    )
    .all())
    lines.push(
      [
        "T",
        linkKey.get(t.link),
        t.id,
        t.role,
        t.kind,
        t.ecosystem,
        t.unit,
        t.symbol,
        t.version,
        t.version_source,
        t.evidence,
      ].join("\t"),
    );
  db.close();
  return lines.sort();
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.stdout.write(dump(process.argv[2]).join("\n") + "\n");
