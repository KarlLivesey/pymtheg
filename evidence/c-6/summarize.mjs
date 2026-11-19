// Markdown tables from the C-6 result files (JSON Lines, as copied into
// evidence/c-6/). usage: node summarize.mjs compare|evaluate|concurrency|large <file>
import { readFileSync } from "node:fs";
const [kind, file] = process.argv.slice(2);
const rows = readFileSync(file, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const pct = (part, whole) => `${Math.round((100 * part) / whole)}%`;
const table = (head, body) =>
  [head, head.map(() => "---"), ...body].map((r) => `| ${r.join(" | ")} |`).join("\n");
if (kind === "compare") {
  const by = new Map();
  for (const r of rows) {
    const list = by.get(r.label) ?? [];
    list.push(r);
    by.set(r.label, list);
  }
  const body = [];
  const identity = [];
  for (const [label, [m1, b, m2]] of by) {
    if (!b || !m2) continue;
    const cell = (r) => `${r.wallS} s (${pct(r.commitS, r.wallS)} / ${pct(r.txS, r.wallS)})`;
    body.push([
      label,
      cell(m1),
      cell(m2),
      cell(b),
      `${m1.maxRssMB} / ${m2.maxRssMB} → ${b.maxRssMB}`,
      `${m1.commits}`,
    ]);
    const same = (x, y) => JSON.stringify(x.rows) === JSON.stringify(y.rows);
    identity.push([
      label,
      same(m1, m2) ? "equal" : "DIFFERENT",
      same(m1, b) ? "equal" : "DIFFERENT",
      Object.entries(b.rows)
        .filter(([t]) => t !== "schema")
        .map(([t, v]) => `${t.replace("graph_", "")} ${v.split(":")[0]}`)
        .join(", "),
    ]);
  }
  console.log(
    table(
      [
        "Repository",
        "Main, run 1",
        "Main, run 2",
        "Branch",
        "Peak RSS MiB (main 1 / main 2 → branch)",
        "Commits",
      ],
      body,
    ),
  );
  console.log(
    "\nCells: cold wall time (share of it in COMMIT / inside store write transactions).\n",
  );
  console.log(
    table(["Repository", "Main 1 = main 2", "Main 1 = branch", "Rows (branch)"], identity),
  );
} else if (kind === "evaluate") {
  console.log(
    table(
      ["Repository", "Variant (main's build)", "Wall s", "In transactions s", "In COMMIT s", "Commits", "Sys CPU s"],
      rows.map((r) => [r.label, r.variant, r.wallS, r.txS, r.commitS, r.commits, r.sysS]),
    ),
  );
} else if (kind === "concurrency") {
  const body = rows.map((r) => {
    const by = {};
    for (const p of r.probes) {
      const b = (by[p.mode] ??= { tries: 0, failed: 0, slowest: 0 });
      b.tries++;
      if (!p.ok) b.failed++;
      b.slowest = Math.max(b.slowest, p.ms);
    }
    const cell = (m) =>
      by[m] ? `${by[m].failed}/${by[m].tries} (slowest ${(by[m].slowest / 1000).toFixed(1)} s)` : "–";
    return [r.label, `${Math.round(r.wallMs / 1000)} s`, r.writes, cell("status"), cell("search"), cell("open"), cell("write")];
  });
  console.log(
    table(
      ["Build", "Index wall", "Writes", "`status` failed", "`search --no-sync` failed", "Writable open failed", "Open + write failed"],
      body,
    ),
  );
} else if (kind === "large") {
  console.log(
    table(
      ["Repository", "Build", "Outcome", "Wall s", "In COMMIT s", "In transactions s", "Peak RSS MiB", "Stored: files / links (or file rows:digest)"],
      rows.map((r) =>
        r.exit === undefined
          ? [r.label, r.build, r.complete ? "complete" : "incomplete", r.wallS, r.commitS, r.txS, r.processPeakRssMB ?? r.maxRssMB, `${r.counts.files} / ${r.counts.links}`]
          : [r.label, r.build, r.exit === 124 ? "not finished in 60 min" : r.exit === 134 ? "JavaScript heap out of memory (exit 134)" : `exit ${r.exit}`, r.wallS, "–", "–", "–", r.storedFiles],
      ),
    ),
  );
}
