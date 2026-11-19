// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";

const { stats, misses } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const total = (values, field) =>
  values.reduce((sum, value) => sum + value[field], 0);
const number = (value) => value.toLocaleString("en-US");
const pct = (part, whole) => `${((100 * part) / whole).toFixed(2)}%`;
const counts = (values, keys) => keys.map((key) => total(values, key));
const match = stats.filter(({ before, after }) => before && after);
const keys = [
  "before",
  "after",
  "beforeL2",
  "afterL2",
  "shared",
  "sharedBeforeL2",
  "sharedAfterL2",
];
function coverageRow(pin, values) {
  const [a, b, x, y, shared, m, n] = values;
  return [
    pin,
    number(a),
    pct(x, a),
    pct(y, b),
    `${pct(m, shared)} → ${pct(n, shared)}`,
    number(y - x),
  ].join(" | ");
}
console.log(
  [
    "# Paired corpus comparison",
    "",
    "| Pin | Main sites | Main Level 2 | C-16 Level 2 | Matched sites | Additional Level 2 |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...match.map(
      (row) =>
        "| " +
        coverageRow(
          row.pin,
          keys.map((key) => row[key]),
        ) +
        " |",
    ),
    "| " + coverageRow("**Total**", counts(match, keys)) + " |",
  ].join("\n"),
);
console.log();
if (match.length !== stats.length)
  console.log(
    "Without a paired graph",
    stats.filter((row) => !match.includes(row)),
  );
console.log("| Preserved measure | Count |");
console.log("| --- | ---: |");
for (const [title, field] of [
  ["Stored links across modules", "allLinks"],
  ["Links on the candidate side", "allLinksAfter"],
  ["Baseline definite checkout and library destinations", "definite"],
  ["Changed definite destinations", "changedDefinite"],
  ["Same-unit refinements of existing definite unit links", "unitUpgrades"],
  ["Added sites", "addedSites"],
  ["Removed sites", "lostSites"],
  ["Symbol keys", "symbols"],
  ["Files with a changed symbol key inventory", "symbolChanges"],
  ["New synthetic Vitest bench targets", "vitestBench"],
]) {
  const values =
    field === "changedDefinite"
      ? match.map((row) => ({
          ...row,
          changedDefinite: row.changedDefinite.length,
        }))
      : match;
  console.log(`| ${title} | ${number(total(values, field))} |`);
}
console.log();
console.log(
  "| Row | Measured sites | Main Level 2 | C-16 Level 2 | Gained Level 2 | Gained unit only | New candidate sets | SW-3 reference sites at Level 2 |",
);
console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
for (const [id, name] of [
  ["ts-package", "Aliases and globals"],
  ["ts-runtime", "Standard, DOM and shared Node APIs"],
  ["ts-package-chain", "Return types and re-exports"],
]) {
  const rows = match.map((row) => row.rows[id]);
  const [
    size,
    before,
    after,
    gained,
    unit,
    candidates,
    ref,
    refBefore,
    refAfter,
  ] = counts(rows, [
    "sites",
    "level2Before",
    "level2After",
    "recovered",
    "unit",
    "candidates",
    "referenceSites",
    "referenceBefore",
    "referenceAfter",
  ]);
  console.log(
    `| ${name} | ${number(size)} | ${pct(before, size)} | ${pct(after, size)} | ${number(gained)} | ${number(unit)} | ${number(candidates)} | ${refBefore}/${ref} → ${refAfter}/${ref} |`,
  );
}
console.log();
console.log(
  "| Main diagnostic or outcome | Aliases and globals | Standard and DOM | Return types and re-exports |",
);
console.log("| --- | ---: | ---: | ---: |");
const reasons = new Set(
  Object.values(misses)
    .flat()
    .map(({ reason }) => reason),
);
for (const reason of [...reasons].sort())
  console.log(
    `| \`${reason}\` | ${Object.values(misses)
      .map((row) => row.filter((site) => site.reason === reason).length)
      .join(" | ")} |`,
  );
