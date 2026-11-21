// SPDX-License-Identifier: MIT
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { finished } from "node:stream/promises";
import { createGzip } from "node:zlib";

const root = process.env.PYM_SCRATCH;
const output = join(root, "publish");
mkdirSync(output, { recursive: true });
const pins = JSON.parse(readFileSync(join(root, "main.json"))).repos;
if (pins.length !== 10 || pins.some((p) => p.outcome !== "finished"))
  throw Error("Ten completed main pins required");
const cells = new Map();
const samples = new Map();
const totals = {};
const followup = {
  associated: {},
  macroArgument: {},
  unresolvedCall: {},
  chain: {},
};
const asserts = /(?:^|::)(?:debug_)?assert(?:_eq|_ne)?!?$/;
const increment = (counts, key) => (counts[key] = (counts[key] ?? 0) + 1);
const escape = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim() || "-";
const tsv = (name, rows) =>
  writeFileSync(
    join(output, name),
    rows.map((r) => r.map(escape).join("\t")).join("\n") + "\n",
  );
const archive = createWriteStream(join(output, "diagnosis.jsonl.gz"));
const compressed = createGzip({ level: 9 });
compressed.pipe(archive);
const pinsByReason = [];
for (const pin of pins) {
  const stem = join(root, "diagnosis-" + pin.id.split("/")[1]);
  const report = JSON.parse(readFileSync(stem + "-counts.json"));
  const selected = JSON.parse(readFileSync(stem + "-sample.json"));
  pinsByReason.push([pin.id, report.total, report.primary, report.reasons]);
  for (const [cell, count] of Object.entries(report.cross)) {
    let byPin = cells.get(cell);
    if (!byPin) cells.set(cell, (byPin = new Map()));
    byPin.set(pin.id, count);
    const rows = samples.get(cell) ?? [];
    rows.push(...selected[cell]);
    samples.set(cell, rows);
  }
  const input = createInterface({
    input: createReadStream(stem + ".jsonl"),
    crlfDelay: Infinity,
  });
  for await (const line of input) {
    const r = JSON.parse(line);
    increment(totals, r.category);
    if (r.category === "no receiver recipe" && r.details.macroArgument)
      increment(totals, "no receiver recipe in macro arguments");
    if (r.lateTraits)
      increment(totals, "checkout trait name is only a later form");
    if (
      r.category === "associated path" &&
      r.target === "method owner unknown"
    ) {
      const counts = followup.associated;
      increment(counts, "links");
      if (r.spelling.lastIndexOf("::") > 0) increment(counts, "written prefix");
      const opaque = "opaque-item-may-shadow-name";
      if (r.storedReasons.includes(opaque)) {
        increment(counts, "opaque reason");
        const other = r.storedReasons.filter(
          (x) => x && x !== opaque && x !== "path-type-unverified",
        );
        if (!other.length) increment(counts, "opaque with no other reason");
        if (other.every((x) => x === "too-many-targets"))
          increment(counts, "opaque with no other blocker");
      }
    }
    if (r.category === "no receiver recipe") {
      const counts = followup.macroArgument;
      increment(counts, "links");
      if (r.details.macroArgument) increment(counts, "macro argument");
      if (r.details.macroHeads.some((head) => asserts.test(head)))
        increment(counts, "assert family spelling");
      if (r.details.macroTargets.some((head) => head && asserts.test(head)))
        increment(counts, "assert family sysroot target");
    }
    if (r.category === "unresolved call result") {
      const counts = followup.unresolvedCall;
      increment(counts, "links");
      if (r.recipe?.k === "p") {
        const name = r.recipe.p.split("::").at(-1);
        if (r.recipe.p.includes("::") && ["from", "default"].includes(name))
          increment(counts, name);
      }
    }
    if (r.category === "method chain") {
      const counts = followup.chain;
      increment(counts, "links");
      if (r.gap) increment(counts, "gap: " + r.gap);
      const stops = [...new Set(r.details.chainStops)];
      increment(
        counts,
        stops.length > 1
          ? "different placements"
          : (stops[0] ?? "no placement"),
      );
    }
    const record = [
      r.id,
      r.file,
      r.line,
      r.column,
      r.range.start,
      r.range.end,
      r.details.method ?? null,
      r.reason,
      r.reasons,
      r.category,
      r.target,
      r.gap ?? null,
      r.owners,
      r.producer,
      r.methods.map(({ file, range, kind, name, receiver }) => ({
        file,
        range,
        kind,
        name,
        receiver,
      })),
      r.storedReasons,
      {
        ...(r.category === "no receiver recipe"
          ? {
              macroHeads: r.details.macroHeads,
              macroTargets: r.details.macroTargets,
            }
          : {}),
        ...(r.category === "unresolved call result"
          ? {
              selfReturnSpelling: /::(from|default)$/.exec(
                r.recipe?.p ?? "",
              )?.[1],
            }
          : {}),
        ...(r.category === "associated path"
          ? { writtenPrefix: r.spelling.lastIndexOf("::") > 0 }
          : {}),
        ...(r.category === "method chain"
          ? { chainStops: r.details.chainStops }
          : {}),
      },
    ];
    if (!compressed.write(JSON.stringify(record) + "\n"))
      await once(compressed, "drain");
  }
}
compressed.end();
await finished(archive);
const table = [
  ["Receiver class", "Target evidence", "All pins", ...pins.map((p) => p.id)],
];
const review = [
  [
    "Rank",
    "Pin",
    "Commit",
    "File",
    "Line",
    "Column",
    "Method",
    "Receiver class",
    "Target evidence",
    "Gap",
    "Named type or owner",
    "Producer",
  ],
];
const richest = [...cells]
  .map(([key, values]) => ({
    key,
    values,
    total: [...values.values()].reduce((a, b) => a + b, 0),
  }))
  .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
for (const { key, values, total } of richest) {
  const [receiver, target] = key.split(" | ");
  table.push([
    receiver,
    target,
    total,
    ...pins.map((p) => values.get(p.id) ?? 0),
  ]);
  if (total < 400) continue;
  for (const r of samples
    .get(key)
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, 10))
    review.push([
      r.key,
      r.id,
      r.commit,
      r.file,
      r.line,
      r.column,
      r.details.method,
      receiver,
      target,
      r.gap,
      r.owners.join(", "),
      r.producer.join(", "),
    ]);
}
tsv("cross-table.tsv", table);
tsv("source-review.tsv", review);
writeFileSync(
  join(output, "diagnosis-followup.json"),
  JSON.stringify(followup, null, 2) + "\n",
);
writeFileSync(
  join(output, "diagnosis-counts.json"),
  JSON.stringify({ pinsByReason, totals }, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    pins: pins.length,
    rows: table.length - 1,
    reviewed: review.length - 1,
    totals,
  }),
);
