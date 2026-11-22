// SPDX-License-Identifier: MIT
// C-48: which stored rows a one-file edit changes. Indexes a fresh copy of
// <pin dir> through the command, applies the <edit> of cases.json, indexes
// again, and lists per file whether its stored file record, symbols and
// links changed, and how: the fields of the changed link records.
//   node scripts/resident/edit-diff.mjs <dist> <scratch> <repo id> <edit>
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const [distArg, scratch, id, edit] = process.argv.slice(2);
const dist = resolve(distArg);
const { executeGraph } = await import(
  pathToFileURL(join(dist, "graph/commands.js")).href
);
const { graphWork, resetGraphWork } = await import(
  pathToFileURL(join(dist, "graph/work.js")).href
);
const here = new URL(".", import.meta.url).pathname;
const cases = JSON.parse(
  readFileSync(join(here, "../reindex/cases.json"), "utf8"),
);
const pin = cases.pins.find((item) => item.id === id);
const name = id.replace(/[^A-Za-z0-9._-]/g, "_");
const root = join(scratch, "edit-diff", `${name}-${edit}`);
cpSync(join(scratch, "pins", name), root, { recursive: true });
mkdirSync(join(root, ".pymtheg"), { recursive: true });
const graph = join(root, ".pymtheg/rebuildable/graph.sqlite");
const snapshot = () => {
  const db = new DatabaseSync(graph, { readOnly: true });
  try {
    const byFile = new Map();
    const add = (file, kind, key, value) => {
      const entry = byFile.get(file) ?? {
        record: null,
        symbols: new Map(),
        links: new Map(),
      };
      if (kind === "record") entry.record = value;
      else entry[kind].set(key, value);
      byFile.set(file, entry);
    };
    for (const row of db.prepare("SELECT path, body FROM graph_files").all())
      add(row.path, "record", null, row.body);
    for (const row of db
      .prepare("SELECT id, file, body FROM graph_symbols")
      .all())
      add(row.file, "symbols", row.id, row.body);
    for (const row of db
      .prepare("SELECT id, file, target, resolution, body FROM graph_links")
      .all())
      add(
        row.file,
        "links",
        row.id,
        JSON.stringify([row.target, row.resolution, row.body]),
      );
    return byFile;
  } finally {
    db.close();
  }
};
await executeGraph({ command: "index", root });
const before = snapshot();
const file = join(root, pin.file);
const original = readFileSync(file, "utf8");
const at = original.indexOf(pin.anchor) + pin.anchor.length;
writeFileSync(
  file,
  edit === "body"
    ? original.slice(0, at) + pin.body + original.slice(at)
    : original + pin.export,
);
resetGraphWork();
const answer = await executeGraph({ command: "index", root });
const after = snapshot();
const changed = [];
const fieldsOf = (a, b) => {
  const [, , left] = JSON.parse(a);
  const [, , right] = JSON.parse(b);
  const l = JSON.parse(left);
  const r = JSON.parse(right);
  const keys = new Set([...Object.keys(l), ...Object.keys(r)]);
  const out = [];
  for (const key of keys)
    if (JSON.stringify(l[key]) !== JSON.stringify(r[key])) out.push(key);
  if (JSON.parse(a)[0] !== JSON.parse(b)[0]) out.push("target");
  return out;
};
for (const [path, now] of after) {
  const was = before.get(path);
  const recordChanged = was?.record !== now.record;
  const symbols =
    [...now.symbols].filter(([k, v]) => was?.symbols.get(k) !== v).length +
    [...(was?.symbols.keys() ?? [])].filter((k) => !now.symbols.has(k)).length;
  const linkFields = new Map();
  let links = 0;
  for (const [k, v] of now.links) {
    const old = was?.links.get(k);
    if (old !== v) {
      links++;
      if (old)
        for (const f of fieldsOf(old, v))
          linkFields.set(f, (linkFields.get(f) ?? 0) + 1);
    }
  }
  if (recordChanged || symbols || links)
    changed.push({
      path,
      recordChanged,
      symbols,
      links,
      linkFields: Object.fromEntries(linkFields),
    });
}
console.log(
  JSON.stringify(
    {
      id,
      edit,
      complete: answer.sync.complete,
      filesWritten: graphWork.counts["store.filesWritten"],
      analyzedFilesChanged: Object.fromEntries(
        Object.entries(graphWork.counts).filter(([k]) =>
          k.endsWith(".filesChanged"),
        ),
      ),
      sqlStatements: graphWork.counts["store.sqlStatements"],
      filesWithChangedRows: changed.length,
      changed,
    },
    null,
    1,
  ),
);
