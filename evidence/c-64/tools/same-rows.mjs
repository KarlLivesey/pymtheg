// SPDX-License-Identifier: MIT
// C-64 (copied from C-52) same-rows.mjs BEFORE_DIST AFTER_DIST STORES OUT.json CHECKOUT... :
// each checkout indexed cold with both builds (scripts/reindex/cold-once.mjs)
// into stores with the same project id, and the two compared row for row
// (scripts/reindex/dump.mjs). The stores are removed after each comparison.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compareRows, storeRows } from "../../../scripts/reindex/dump.mjs";

const [beforeDist, afterDist, stores, out, ...checkouts] = process.argv.slice(2);
const here = new URL(".", import.meta.url).pathname;
const once = join(here, "../../../scripts/reindex/cold-once.mjs");
mkdirSync(stores, { recursive: true });
const result = {};
for (const checkout of checkouts) {
  // .../work/<owner>/<repo>/<commit>/<attempt>/checkout
  const parts = checkout.split("/");
  const name = parts.slice(-5, -3).join("/");
  const paths = [join(stores, "before.sqlite"), join(stores, "after.sqlite")];
  for (const path of paths) rmSync(path, { force: true });
  execFileSync(process.execPath, [once, beforeDist, checkout, paths[0], "c52-same-rows"], { stdio: "ignore" });
  execFileSync(process.execPath, [once, afterDist, checkout, paths[1], "c52-same-rows"], { stdio: "ignore" });
  const differences = compareRows(storeRows(paths[0]), storeRows(paths[1]));
  result[name] = { differences };
  console.log(name, differences.length);
  for (const path of paths) rmSync(path, { force: true });
}
writeFileSync(out, JSON.stringify(result, null, 1) + "\n");
