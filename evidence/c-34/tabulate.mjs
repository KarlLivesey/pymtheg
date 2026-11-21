// SPDX-License-Identifier: MIT
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { join } from "node:path";
import { createGzip } from "node:zlib";

const scratch = process.env.PYM_SCRATCH;
const output = join(scratch, "publish");
mkdirSync(output, { recursive: true });
const pins = JSON.parse(readFileSync(join(scratch, "main.json"))).repos;
if (pins.length !== 10 || pins.some((p) => p.outcome !== "finished"))
  throw Error("Ten completed baseline pins are required");
const samples = new Map();
const originSamples = new Map();
const totals = {
  links: 0,
  primary: 0,
  sole: 0,
  classes: {},
  origins: {},
  namespaces: {},
  positions: {},
  causes: {},
};
const tallies = [];
const archive = createGzip();
const stream = createWriteStream(join(output, "diagnosis.jsonl.gz"));
archive.pipe(stream);
const load = (p) => JSON.parse(readFileSync(p, "utf8"));
const origins = new Map();
const sets = new Map();
function intern(dictionary, value) {
  const key = JSON.stringify(value);
  if (!dictionary.has(key)) dictionary.set(key, dictionary.size);
  return dictionary.get(key);
}
async function emit(row) {
  if (!archive.write(JSON.stringify(row) + "\n")) await once(archive, "drain");
}
await emit({ format: 1 });
for (const { id } of pins) {
  const base = join(scratch, "diagnosis-" + id.split("/")[1]);
  const { samples: pinSamples, ...counts } = load(base + ".json");
  counts.causes = {};
  tallies.push(counts);
  for (const field of ["links", "primary", "sole"])
    totals[field] += counts[field];
  for (const field of ["classes", "origins", "namespaces", "positions"])
    for (const [k, n] of Object.entries(counts[field]))
      totals[field][k] = (totals[field][k] ?? 0) + n;
  for (const [category, group] of Object.entries(pinSamples)) {
    const rows = samples.get(category) ?? [];
    rows.push(...group);
    samples.set(category, rows);
  }
  const lines = createInterface({
    input: createReadStream(base + ".jsonl"),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const { rank, ...row } = JSON.parse(line);
    const causes = new Set(
      row.origins
        .filter((origin) => !origin.boundedAway && origin.cause)
        .map((origin) => origin.cause),
    );
    for (const cause of causes) {
      const cell = JSON.stringify([cause, row.sole ? "sole" : "several"]);
      counts.causes[cell] = (counts.causes[cell] ?? 0) + 1;
      totals.causes[cell] = (totals.causes[cell] ?? 0) + 1;
    }
    for (const category of new Set(
      row.origins.filter((o) => !o.boundedAway).map((o) => o.category),
    )) {
      if (!originSamples.has(category)) originSamples.set(category, []);
      const group = originSamples.get(category);
      if (group.length === 10 && group.at(-1).rank <= rank) continue;
      group.push({ ...row, rank, reviewClass: category });
      group.sort((a, b) => a.rank.localeCompare(b.rank));
      if (group.length > 10) group.pop();
    }
    const reads = new Map();
    const { origins: traced, ...site } = row;
    for (const origin of traced) {
      const {
        namespace,
        relation,
        searched,
        boundedAway,
        couldBind,
        ...descriptor
      } = origin;
      const read = JSON.stringify([
        namespace,
        relation,
        searched,
        boundedAway,
        couldBind,
      ]);
      if (!reads.has(read)) reads.set(read, []);
      reads.get(read).push(intern(origins, [id, descriptor]));
    }
    await emit({
      ...site,
      reads: [...reads].map(([read, found]) => [
        ...JSON.parse(read),
        intern(
          sets,
          [...new Set(found)].sort((a, b) => a - b),
        ),
      ]),
    });
  }
}
for (const [value, index] of origins)
  await emit({ origin: index, value: JSON.parse(value) });
for (const [value, index] of sets)
  await emit({ set: index, value: JSON.parse(value) });
archive.end();
await finished(stream);
const table = [
  [
    "cohort",
    "reason anywhere",
    "any",
    totals.links,
    ...tallies.map((p) => p.links),
  ],
  [
    "cohort",
    "first reason",
    "any",
    totals.primary,
    ...tallies.map((p) => p.primary),
  ],
];
for (const field of ["classes", "origins", "namespaces", "positions", "causes"])
  for (const [cell, total] of Object.entries(totals[field]).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const [name, status] = JSON.parse(cell);
    table.push([
      field,
      name,
      status,
      total,
      ...tallies.map((p) => p[field][cell] ?? 0),
    ]);
  }
const tsv = (file, rows) =>
  writeFileSync(
    join(output, file),
    rows
      .map((row) =>
        row
          .map(
            (v) =>
              String(v ?? "")
                .replace(/\s+/g, " ")
                .trim() || "-",
          )
          .join("\t"),
      )
      .join("\n") + "\n",
  );
tsv("diagnosis-counts.tsv", [
  [
    "Dimension",
    "Class",
    "Other blockers",
    "All pins",
    ...pins.map((p) => p.id),
  ],
  ...table,
]);
const reviewed = [];
for (const [table, groups] of [
  [totals.origins, originSamples],
  [totals.classes, samples],
]) {
  for (const [category, rows] of groups) {
    if (table === totals.classes && originSamples.has(category)) continue;
    const count = ["sole", "several"].reduce(
      (n, s) => n + (table[JSON.stringify([category, s])] ?? 0),
      0,
    );
    if (count >= 200)
      reviewed.push(
        ...rows.sort((a, b) => a.rank.localeCompare(b.rank)).slice(0, 10),
      );
  }
}
writeFileSync(
  join(scratch, "diagnosis-samples.json"),
  JSON.stringify(reviewed, null, 2) + "\n",
);
tsv("source-review.tsv", [
  ["Rank", "Pin", "File", "Line", "Column", "Class", "Origin sites"],
  ...reviewed.map((r) => [
    r.rank,
    r.pin,
    r.file,
    r.line,
    r.column,
    r.reviewClass ?? r.category,
    [
      ...new Set(
        r.origins
          .filter((o) =>
            r.reviewClass
              ? o.category === r.reviewClass && !o.boundedAway
              : true,
          )
          .map((o) => o.file && `${o.file}:${o.line} ${o.name}`)
          .filter(Boolean),
      ),
    ].join(", "),
  ]),
]);
writeFileSync(
  join(output, "diagnosis-summary.json"),
  JSON.stringify({ totals, pins: tallies, sampled: reviewed.length }, null, 2) +
    "\n",
);
console.log(JSON.stringify({ totals, sampled: reviewed.length }));
