// SPDX-License-Identifier: MIT
// C-22 cold-index cost, one run at a time, alternating builds: each run is a
// fresh process (cold-once.mjs) under GNU time, its store a new file in
// <store dir> (removed after the run), the source the pristine pin.
//   node scripts/reindex/cold-cost.mjs <store dir> <out.json> <rounds> <label=dist>... -- <pin dir>...
import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const args = process.argv.slice(2);
const split = args.indexOf("--");
const [storeDir, out, rounds, ...builds] = args.slice(0, split);
const pins = args.slice(split + 1);
const here = new URL(".", import.meta.url).pathname;
const runs = [];
for (const pin of pins)
  for (let round = 0; round < Number(rounds); round++)
    for (const build of builds) {
      const [label, dist] = build.split("=");
      const store = join(storeDir, `cold-cost-${process.pid}.sqlite`);
      const child = spawnSync(
        "/usr/bin/time",
        [
          "-f",
          "C22TIME %e %U %S %M",
          process.execPath,
          join(here, "cold-once.mjs"),
          dist,
          pin,
          store,
          "c22-cold-cost",
        ],
        { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
      );
      const stderr = child.stderr ?? "";
      for (const suffix of ["", "-wal", "-shm"])
        if (existsSync(store + suffix)) rmSync(store + suffix);
      const line = stderr.split("\n").find((l) => l.startsWith("C22TIME"));
      const time = line
        ? line.split(" ").slice(1).map(Number)
        : [NaN, NaN, NaN, NaN];
      const run = {
        pin: basename(pin),
        round,
        build: label,
        wallS: time[0],
        cpuS: Math.round((time[1] + time[2]) * 10) / 10,
        peakMiB: Math.round(time[3] / 1024),
      };
      runs.push(run);
      console.log(JSON.stringify(run));
    }
writeFileSync(out, JSON.stringify(runs, null, 1));
