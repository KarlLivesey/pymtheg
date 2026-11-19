// SPDX-License-Identifier: MIT
// Print pinned source and config context for the independent hand audit.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const [scratch, statsPath, mode] = process.argv.slice(2);
const read = (name) => JSON.parse(readFileSync(name, "utf8"));
const stats = read(statsPath);
const checkouts = new Map(
  read(join(scratch, "main-run.json")).repos.map(({ id, attempt }) => [
    id,
    join(scratch, attempt, "checkout"),
  ]),
);
const compareRank = (a, b) => a.rank.localeCompare(b.rank);
function select(pool) {
  const byPin = new Map();
  for (const site of pool.filter(({ outcome }) => outcome === "library")) {
    if (!byPin.has(site.pin)) byPin.set(site.pin, []);
    byPin.get(site.pin).push(site);
  }
  const groups = [...byPin.values()]
    .map((group) => group.sort(compareRank))
    .sort((a, b) => compareRank(a[0], b[0]));
  const draw = [];
  for (let i = 0; groups.some((group) => group[i]); i++) {
    for (const group of groups) if (group[i]) draw.push(group[i]);
    if (draw.length >= 20) break;
  }
  return draw.slice(0, 20);
}
function configTypes(root, path) {
  const visited = new Set();
  function visit(config) {
    if (visited.has(config) || !existsSync(config)) return [];
    visited.add(config);
    const name = relative(root, config);
    if (name.startsWith("..")) return [];
    const { config: contents } = ts.parseConfigFileTextToJson(
      name,
      readFileSync(config, "utf8"),
    );
    const parent = [contents?.extends]
      .flat()
      .filter((entry) => typeof entry === "string");
    const ancestors = parent.flatMap((entry) =>
      visit(
        resolve(
          dirname(config),
          entry.endsWith(".json") ? entry : entry + ".json",
        ),
      ),
    );
    const types = contents?.compilerOptions?.types;
    return [...ancestors, { config: name, ...(types && { types }) }];
  }
  return path ? visit(join(root, path)) : [];
}
const baseline = mode === "--misses";
for (const [item, pool] of Object.entries(
  baseline ? stats.misses : stats.additions,
)) {
  for (const site of baseline ? pool : select(pool)) {
    const root = checkouts.get(site.pin);
    const source = readFileSync(join(root, site.file), "utf8");
    const lines = source.split("\n");
    const configs = [site.config]
      .flat()
      .filter((value) => typeof value === "string");
    const units = (site.targets ?? []).map(({ unit }) => unit);
    const bindings = lines.flatMap((text, index) =>
      units.some(
        (unit) =>
          text.includes("'" + unit + "'") || text.includes('"' + unit + '"'),
      )
        ? [[index + 1, text.trim().slice(0, 180)]]
        : [],
    );
    console.log(
      JSON.stringify({
        item,
        ...site,
        configs: configs.flatMap((config) => configTypes(root, config)),
        bindings,
        source: lines
          .slice(Math.max(0, site.line - 4), site.line + 2)
          .map((line) => line.trim().slice(0, 200)),
      }),
    );
  }
}
