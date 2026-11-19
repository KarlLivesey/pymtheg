// SPDX-License-Identifier: MIT
// Compare outcome or library identity changes at the same captured sites.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { sampleKey } from "../../scripts/sweep/coverage-rules.mjs";

const scratch = process.env.PYM_SCRATCH;
const [beforeName = "previous", afterName = "candidate"] =
  process.argv.slice(2);
const pins = (name) =>
  JSON.parse(readFileSync(join(scratch, `${name}-run.json`))).repos;
const after = new Map(pins(afterName).map((pin) => [pin.id, pin]));
const database = (pin) =>
  new DatabaseSync(
    join(scratch, pin.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );

const hasBundle = (link) =>
  link.libraries.some(([kind]) => kind === "typescript-lib" || kind === "dom");
const globalReason = (link) =>
  link.data?.reason === "missing-global-types" ||
  link.data?.tiedReasons?.includes("missing-global-types");
const bundled = (link) => hasBundle(link) || globalReason(link);
const openGlobal = (link) =>
  globalReason(link) ||
  (hasBundle(link) && link.libraries.some(([kind]) => kind === "node"));
const packageLink = (link) =>
  link.libraries.some(([kind]) => kind === "npm" || kind === "jsr") ||
  link.data?.specifier !== undefined;
const identity = (link) => JSON.stringify([link.outcome, link.libraries]);
const summaries = {};
const globalScope = { before: {}, after: {}, transitions: {} };
function count(summary, before, after) {
  for (const [histogram, outcome] of [
    [summary.before, before.outcome],
    [summary.after, after.outcome],
  ])
    histogram[outcome] = (histogram[outcome] ?? 0) + 1;
  const transition = `${before.outcome} -> ${after.outcome}`;
  summary.transitions[transition] = (summary.transitions[transition] ?? 0) + 1;
}
for (const pin of pins(beforeName)) {
  const next = after.get(pin.id);
  if (
    pin.outcome !== "finished" ||
    next?.outcome !== "finished" ||
    pin.commit !== next.commit
  )
    throw Error(`Missing comparison pin ${pin.id}`);
  const old = database(pin);
  const revised = database(next);
  const files = (db) =>
    db
      .prepare(
        "SELECT path FROM graph_files WHERE json_extract(body,'$.module')='typescript'",
      )
      .all()
      .map(({ path }) => path);
  const rows = (db) =>
    db.prepare(
      `SELECT l.body,l.kind,l.module,l.resolution AS outcome,
     (SELECT json_group_array(json_array(t.ecosystem,t.unit,t.symbol,t.version,t.version_source))
      FROM graph_library_targets t WHERE t.link=l.id) AS targets
     FROM graph_links l INDEXED BY graph_link_file
     WHERE l.file=? AND l.module='typescript'`,
    );
  const source = old.prepare(
    "SELECT json_extract(body,'$.text') AS text FROM graph_files WHERE path=?",
  );
  const group = (statement, path) => {
    const grouped = new Map();
    for (const { body, targets, ...columns } of statement.all(path)) {
      const link = {
        ...JSON.parse(body),
        ...columns,
        libraries: JSON.parse(targets).sort(),
      };
      const key = sampleKey(pin, link);
      const at = grouped.get(key) ?? [];
      at.push(link);
      grouped.set(key, at);
    }
    return grouped;
  };
  const oldRows = rows(old);
  const newRows = rows(revised);
  try {
    for (const path of new Set([...files(old), ...files(revised)])) {
      const prior = group(oldRows, path);
      const current = group(newRows, path);
      for (const [site, previous] of prior) {
        const present = current.get(site) ?? [];
        if (present.length !== previous.length)
          throw Error(`Changed site count in ${pin.id}/${path}`);
        const changed = [];
        for (const link of previous) {
          const match = present.findIndex(
            (row) => identity(row) === identity(link),
          );
          if (match >= 0) {
            const [current] = present.splice(match, 1);
            if (openGlobal(link) || openGlobal(current))
              count(globalScope, link, current);
          } else changed.push(link);
        }
        for (const [i, before] of changed.entries()) {
          const after = present[i];
          const category =
            bundled(before) || bundled(after)
              ? "global-types"
              : packageLink(before) || packageLink(after)
                ? "package-routes"
                : "other";
          const summary = (summaries[category] ??= {
            before: {},
            after: {},
            transitions: {},
            examples: [],
            reopened: [],
          });
          count(summary, before, after);
          if (category === "global-types") count(globalScope, before, after);
          const reopened =
            before.outcome === "library" && after.outcome === "unresolved";
          if (
            summary.examples.length < 5 ||
            (reopened && summary.reopened.length < 5)
          ) {
            const example = {
              repo: pin.id,
              path,
              line: source
                .get(path)
                .text.slice(0, before.range.start)
                .split("\n").length,
              target: before.targetName,
              before: identity(before),
              after: identity(after),
              reason: after.data?.reason,
            };
            if (summary.examples.length < 5) summary.examples.push(example);
            if (reopened && summary.reopened.length < 5)
              summary.reopened.push(example);
          }
        }
        current.delete(site);
      }
      if (current.size) throw Error(`New sites in ${pin.id}/${path}`);
    }
  } finally {
    old.close();
    revised.close();
  }
}
console.log(JSON.stringify({ globalScope, ...summaries }, null, 2));
