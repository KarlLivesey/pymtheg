// SPDX-License-Identifier: MIT
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const [baseline, paired, attempts, output] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const exact = read(baseline).stats;
const { stats } = read(paired);
const installByPin = new Map(read(attempts).repos.map((row) => [row.id, row]));
if (
  exact.length !== 18 ||
  exact.some(
    (row) =>
      !row.after ||
      row.changedOutcomes ||
      row.addedSites ||
      row.lostSites ||
      row.symbolChanges,
  )
)
  throw Error("Bare link-for-link comparison is incomplete or changed");
const sum = (key) => stats.reduce((total, row) => total + row[key], 0);
const percent = (numerator, denominator) =>
  ((100 * numerator) / denominator).toFixed(2) + "%";
console.log("# Paired TypeScript dependency sweep\n");
console.log(
  "| Pin | Bare Level 2 | With installed declarations | Named delta | Install |\n| --- | ---: | ---: | ---: | --- |",
);
for (const row of stats) {
  const attempt = installByPin.get(row.pin);
  const detail = [
    attempt.install?.manager,
    attempt.install?.status,
    attempt.install?.reason,
    attempt.outcome !== "finished" && attempt.outcome,
  ]
    .filter(Boolean)
    .join(" / ");
  console.log(
    `| ${row.pin} | ${percent(row.beforeL2, row.before)} | ${percent(row.afterL2, row.after)} | ${row.afterL2 - row.beforeL2} | ${detail} |`,
  );
}
console.log(
  `| **All pins** | **${percent(sum("beforeL2"), sum("before"))}** | **${percent(sum("afterL2"), sum("after"))}** | **${sum("afterL2") - sum("beforeL2")}** | |\n`,
);
console.log(
  `Matched sites ${sum("shared")} · ${percent(sum("sharedBeforeL2"), sum("shared"))} → ${percent(sum("sharedAfterL2"), sum("shared"))}.\n`,
);
console.log(
  "| Row | New named links | New unit-only links | New candidate sets |\n| --- | ---: | ---: | ---: |",
);
for (const [row, label] of [
  ["ts-package", "Aliases and globals"],
  ["ts-runtime", "Standard and DOM"],
  ["ts-package-chain", "Return types and re-exports"],
]) {
  const counts = (key) =>
    stats.reduce((total, pin) => total + pin.rows[row][key], 0);
  console.log(
    `| ${label} | ${counts("recovered")} | ${counts("unit")} | ${counts("candidates")} |`,
  );
}

const category = ({ prior, updated }) => {
  if (!updated) return "site-removed";
  if (updated.resolution === "unresolved")
    return `unresolved/${updated.data?.reason ?? "no-reason"}`;
  if (updated.resolution === "ambiguous") return "candidate-set";
  if (updated.resolution === "resolved") return "checkout-declaration";
  const before = prior.libraries[0];
  const after = updated.libraries[0];
  if (
    before &&
    before.ecosystem === after.ecosystem &&
    before.unit === after.unit &&
    before.symbol === after.symbol
  )
    return "same-unit-and-symbol/updated-proof";
  return after.versionSource?.split("/").includes("node_modules")
    ? "installed-declaration"
    : "other-library-declaration";
};
const target = (link) =>
  link && {
    resolution: link.resolution,
    checkout: JSON.parse(link.target),
    libraries: link.libraries,
    reason: link.data?.reason,
  };
const changes = stats.flatMap((pin) =>
  pin.changedDefinite.map((change) => [
    pin.pin,
    change.file,
    change.range.start,
    change.range.end,
    change.name,
    category(change),
    target(change.prior),
    target(change.updated),
  ]),
);
const counts = new Map();
for (const [, , , , , kind] of changes)
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
console.log(
  `\nBare preservation checked all ${exact.reduce((total, row) => total + row.before, 0)} sites and ${exact.reduce((total, row) => total + row.symbols, 0)} symbol keys. The installed attempts added ${sum("addedSites")} sites and removed ${sum("lostSites")}.\n`,
);
console.log("| Change from a definite bare target | Links |\n| --- | ---: |");
for (const [kind, count] of [...counts].sort(([a], [b]) => a.localeCompare(b)))
  console.log(`| ${kind} | ${count} |`);
console.log(`| Total | ${changes.length} |`);
writeFileSync(
  output,
  gzipSync(
    JSON.stringify({
      columns: [
        "pin",
        "file",
        "start",
        "end",
        "name",
        "class",
        "bare",
        "installed",
      ],
      changes,
    }),
  ),
);
