// SPDX-License-Identifier: MIT
// Deterministic cost proxies per pin: the number of compiler programs
// (distinct owning configs, each tied config counted) and file analyses
// (a tied file is analysed once per tied config), with cold CPU and peak.
// Usage: node programs.mjs SWEEP_SCRATCH RESULTS.json...
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
const [scratch, ...receipts] = process.argv.slice(2);
for (const receipt of receipts) {
  for (const repo of JSON.parse(readFileSync(receipt, "utf8")).repos) {
    if (repo.outcome !== "finished") continue;
    const db = new DatabaseSync(join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
    const programs = new Set();
    let analyses = 0;
    for (const { body } of db.prepare("SELECT body FROM graph_files WHERE json_extract(body,'$.module')='typescript'").iterate()) {
      const d = JSON.parse(body).result?.data ?? {};
      const configs = d.projects ?? (d.project !== undefined ? [d.project] : []);
      for (const c of configs) programs.add(c ?? "(inferred)");
      analyses += Math.max(configs.length, 1);
    }
    db.close();
    console.log([receipt.split("/").pop(), repo.id, programs.size, analyses, repo.cold.cpuSeconds.toFixed(1), Math.round(repo.cold.peakRssKiB / 1024)].join("\t"));
  }
}
