// SPDX-License-Identifier: MIT
// C-22 cold-index cost, one run at a time, alternating builds: each run is a
// fresh process (cold-once.mjs) under GNU time, its store a new file in
// <store dir> (removed after the run), the source the pristine pin.
//   node scripts/reindex/cold-cost.mjs <store dir> <out.json> <rounds> <label[@cache-pages]=dist>... -- <pin dir>...
import "../isolated-home.mjs";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  compareRows,
  setPageCache,
  storeRows,
  withoutGoSurface,
  withRustVersion,
} from "./dump.mjs";

const args = process.argv.slice(2);
const compareGo = args.includes("--go-surface");
if (compareGo) args.splice(args.indexOf("--go-surface"), 1);
const exact = args.includes("--exact");
if (exact) args.splice(args.indexOf("--exact"), 1);
const option = (name) => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args.splice(at, 2)[1];
};
const cache = option("--cache-pages");
const save = option("--save-after");
// C-36: --rust-version NEW=OLD compares rows across a Rust version bump.
const rustVersion = option("--rust-version")?.split("=");
if (save) mkdirSync(save, { recursive: true });
const split = args.indexOf("--");
const [storeDir, out, rounds, ...builds] = args.slice(0, split);
const pins = args.slice(split + 1);
const here = new URL(".", import.meta.url).pathname;
const runs = [];
for (const pin of pins) {
  let baseline;
  for (let round = 0; round < Number(rounds); round++)
    for (const build of builds) {
      const [runLabel, dist] = build.split("=");
      const [label, cachePages = cache] = runLabel.split("@");
      const store = join(storeDir, `cold-cost-${process.pid}.sqlite`);
      if (cachePages !== undefined) setPageCache(store, Number(cachePages));
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
      if (child.status === 0 && save && label === "after") {
        const saved = join(save, `${basename(pin)}.sqlite`);
        copyFileSync(store, saved);
        if (cachePages !== undefined) setPageCache(saved, 0);
      }
      let equality;
      if (child.status === 0 && (compareGo || exact)) {
        const rawRows = storeRows(store);
        const goRows = compareGo ? withoutGoSurface(rawRows) : rawRows;
        const rows = rustVersion
          ? withRustVersion(goRows, rustVersion[0], rustVersion[1])
          : goRows;
        baseline ??= rows;
        equality = {
          rows: Object.fromEntries(
            Object.entries(rows).map(([table, records]) => [
              table,
              records.length,
            ]),
          ),
          differences: compareRows(baseline, rows),
        };
      }
      for (const suffix of ["", "-wal", "-shm"])
        if (existsSync(store + suffix)) rmSync(store + suffix);
      if (child.status !== 0) throw Error(stderr);
      const line = stderr.split("\n").find((l) => l.startsWith("C22TIME"));
      const time = line
        ? line.split(" ").slice(1).map(Number)
        : [NaN, NaN, NaN, NaN];
      const run = {
        pin: basename(pin),
        round,
        build: label,
        ...(cachePages === undefined ? {} : { cachePages: Number(cachePages) }),
        wallS: time[0],
        cpuS: Math.round((time[1] + time[2]) * 10) / 10,
        peakMiB: Math.round(time[3] / 1024),
        ...(equality ? { equality } : {}),
      };
      runs.push(run);
      console.log(JSON.stringify(run));
      writeFileSync(out, JSON.stringify(runs, null, 1));
      if (exact && equality.differences.length)
        throw Error(
          `${basename(pin)} ${label} differs from the first cold run`,
        );
    }
}
