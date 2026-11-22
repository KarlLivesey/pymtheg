// SPDX-License-Identifier: MIT
// C-35: a readable summary of one or more measure.mjs results: totals, the
// largest tables and indexes, the costliest statements, the store stages,
// and main-thread CPU profile self time by source file (V8 samples).
//   node scripts/store-cost/summary.mjs <result.json>... [--top N]
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";

const args = process.argv.slice(2);
const topAt = args.indexOf("--top");
const top = topAt < 0 ? 12 : Number(args[topAt + 1]);
const files = args.filter((arg, i) => arg.endsWith(".json") && i !== topAt + 1);
const mib = (n) => (Number(n) / 1048576).toFixed(1);
for (const file of files) {
  const r = JSON.parse(readFileSync(file, "utf8"));
  console.log(`\n## ${basename(file)} (${r.variant})`);
  console.log(
    `wall ${(r.wallMs / 1000).toFixed(1)} s, cpu ${(r.cpuMs / 1000).toFixed(1)} s, late indexes ${(r.lateIndexMs / 1000).toFixed(1)} s, peak ${mib(r.maxRssKiB * 1024)} MiB, database ${mib(r.databaseBytes)} MiB, files ${r.report.claimed}, symbols ${r.report.symbols}, links ${r.report.links}`,
  );
  const sqlMs = r.statements.reduce((sum, s) => sum + s.wallMs, 0);
  console.log(`SQL wall (outermost statements) ${(sqlMs / 1000).toFixed(1)} s`);
  const prepareMs = r.statements.reduce(
    (sum, s) => sum + (s.prepareMs ?? 0),
    0,
  );
  const prepares = r.statements.reduce((sum, s) => sum + (s.prepares ?? 0), 0);
  console.log(
    `SQL prepare ${(prepareMs / 1000).toFixed(1)} s over ${prepares} prepares`,
  );
  console.log(
    `graph_files.body ${mib(r.fileBody.body)} MiB: text ${mib(r.fileBody.text)}, result ${mib(r.fileBody.result)} (symbols ${mib(r.fileBody.symbols)}, links ${mib(r.fileBody.links)})`,
  );
  console.log("objects (MiB, rows):");
  for (const o of r.objects.slice(0, top))
    console.log(
      `  ${o.name} ${o.type ?? ""} ${mib(o.bytes)} payload ${mib(o.payload)}${r.tables[o.name] === undefined ? "" : ` rows ${r.tables[o.name]}`}`,
    );
  console.log("statements (wall s, calls, changes, MiB bound):");
  for (const s of r.statements.slice(0, top))
    console.log(
      `  ${(s.wallMs / 1000).toFixed(1)} ${s.calls} ${s.changes} ${mib(s.bytes)} prep ${((s.prepareMs ?? 0) / 1000).toFixed(1)}/${s.prepares ?? 0}  ${s.sql.slice(0, 100)}`,
    );
  console.log("stages (cpu s):");
  for (const [name, t] of Object.entries(r.stages)
    .filter(([, t]) => t.cpuMs > 500)
    .sort((a, b) => b[1].cpuMs - a[1].cpuMs))
    console.log(`  ${name} ${(t.cpuMs / 1000).toFixed(1)} (${t.calls})`);
  const dir = join(dirname(file), `profiles-${basename(file, ".json")}`);
  let profiles = [];
  try {
    profiles = readdirSync(dir).filter((name) => name.endsWith(".cpuprofile"));
  } catch {
    // No profile.
  }
  for (const name of profiles) {
    const profile = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const byFile = new Map();
    let total = 0;
    for (let i = 0; i < profile.samples.length; i++) {
      const node = nodes.get(profile.samples[i]);
      const url = node.callFrame.url;
      const label = url
        ? url
            .replace(/^.*\/(dist|node_modules)\//, "$1/")
            .replace(/^file:\/\/.*\//, "")
        : node.callFrame.functionName || "(native)";
      const time = profile.timeDeltas[i] ?? 0;
      total += time;
      byFile.set(label, (byFile.get(label) ?? 0) + time);
    }
    console.log(
      `profile ${name}: ${(total / 1e6).toFixed(1)} s sampled; self time by file:`,
    );
    for (const [label, time] of [...byFile]
      .sort((a, b) => b[1] - a[1])
      .slice(0, top))
      console.log(
        `  ${((100 * time) / total).toFixed(1)}% ${(time / 1e6).toFixed(1)} s ${label}`,
      );
  }
}
