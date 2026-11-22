// summary.mjs DIR... : for each measure.mjs output directory, one line per
// index step: CPU and wall seconds, peak MiB, TypeScript programs and files
// extracted, whether the scoped path ran, and why it was declined.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

for (const dir of process.argv.slice(2))
  for (const name of readdirSync(dir).filter(
    (file) => file.endsWith(".json") && !file.endsWith("summary.json"),
  )) {
    const r = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const ts = r.typescript ?? {};
    console.log(
      [
        name.replace(/\.json$/, ""),
        `cpu ${(r.cpuMs / 1000).toFixed(1)}`,
        `wall ${(r.wallMs / 1000).toFixed(1)}`,
        `rss ${Math.round(r.maxRssKiB / 1024)}`,
        `programs ${ts.programs ?? "-"}`,
        `extracted ${ts.extracted ?? "-"}`,
        `scoped ${ts.scoped ?? "-"}`,
        `surfaces ${ts.surfacePrograms ?? "-"}`,
        `changed ${r.counts?.["analyze.typescript.filesChanged"] ?? 0}`,
        `failed ${r.report?.failedCount ?? "-"}`,
        `declined ${JSON.stringify(ts.declined ?? {})}`,
      ].join("  "),
    );
  }
