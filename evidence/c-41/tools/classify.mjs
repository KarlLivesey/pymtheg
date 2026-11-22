// classify.mjs SCRATCH SWEEP.json OUT.json : counts the TypeScript links
// stored with reason `local` in each finished installed graph of a sweep run
// made with the C-41 diagnostic build, by the shape its `localShape` names
// (declaration kind | where the literal lives | member symbol or not), per
// pin and in total, with the share of all TypeScript links.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [scratch, sweepPath, out] = process.argv.slice(2);
const sweep = JSON.parse(readFileSync(sweepPath, "utf8"));
const totals = { links: 0, local: 0, kinds: {}, places: {}, shapes: {} };
const pins = {};
const add = (map, key, n = 1) => (map[key] = (map[key] ?? 0) + n);
for (const repo of sweep.repos) {
  if (!repo.attempt || !["ok", "incomplete"].includes(repo.cold?.status)) {
    pins[repo.id] = { skipped: repo.outcome };
    continue;
  }
  const db = new DatabaseSync(
    join(scratch, repo.attempt, "checkout", ".pymtheg", "rebuildable", "graph.sqlite"),
    { readOnly: true },
  );
  const pin = { links: 0, local: 0, kinds: {}, places: {}, symbols: 0 };
  pin.symbols = db.prepare("SELECT count(*) AS n FROM graph_symbols WHERE json_extract(body,'$.module')='typescript'").get().n;
  for (const row of db
    .prepare(
      "SELECT json_extract(body,'$.data.reason') AS reason, json_extract(body,'$.data.localShape') AS shape FROM graph_links WHERE module='typescript' AND json_extract(body,'$.kind') <> 'contains'",
    )
    .iterate()) {
    pin.links++;
    if (row.reason !== "local") continue;
    pin.local++;
    const [kind = "(no shape)", place = "", why = ""] = (row.shape ?? "(no shape)").split(" | ");
    add(pin.kinds, kind);
    add(totals.kinds, kind);
    if (place) {
      add(pin.places, `${kind} | ${place}`);
      add(totals.places, `${kind} | ${place}`);
      add(totals.shapes, `${kind} | ${place} | ${why}`);
    }
  }
  db.close();
  totals.links += pin.links;
  totals.local += pin.local;
  pins[repo.id] = pin;
}
const sorted = (map) =>
  Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1]));
writeFileSync(
  out,
  JSON.stringify(
    {
      totals: {
        ...totals,
        kinds: sorted(totals.kinds),
        places: sorted(totals.places),
        shapes: sorted(totals.shapes),
      },
      pins,
    },
    null,
    1,
  ),
);
console.log("links", totals.links, "local", totals.local);
for (const [k, v] of Object.entries(sorted(totals.kinds)))
  console.log(v, (v / totals.links * 100).toFixed(2) + " pp", k);
console.log("--");
for (const [k, v] of Object.entries(sorted(totals.shapes)))
  console.log(v, (v / totals.links * 100).toFixed(2) + " pp", k);
