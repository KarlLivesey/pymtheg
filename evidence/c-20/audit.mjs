// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const [scratch, comparisonFile] = process.argv.slice(2);
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const { additions } = read(comparisonFile);
const checkouts = new Map(
  read(join(scratch, "installed-run.json")).repos.map((repo) => [
    repo.id,
    join(scratch, repo.attempt, "checkout"),
  ]),
);
const pool = Object.values(additions)
  .flat()
  .filter(
    ({ outcome, targets }) =>
      outcome === "library" &&
      targets[0]?.versionSource?.split("/").includes("node_modules") &&
      targets[0].symbol,
  )
  .sort((a, b) => a.rank.localeCompare(b.rank));
const groups = new Map();
for (const site of pool) {
  if (!groups.has(site.pin)) groups.set(site.pin, []);
  groups.get(site.pin).push(site);
}
const buckets = [...groups.values()];
const draw = [];
for (
  let index = 0;
  draw.length < 60 && buckets.some((rows) => rows[index]);
  index++
)
  for (const bucket of buckets) {
    if (bucket[index]) draw.push(bucket[index]);
    if (draw.length === 60) break;
  }

const trees = new Map();
function declarations(root, files, target) {
  const parts = target.symbol.split(".").filter((part) => part !== "prototype");
  const name = parts.pop();
  const found = [];
  for (const { path } of files) {
    const absolute = join(root, path);
    let tree = trees.get(absolute);
    if (!tree) {
      const source = readFileSync(absolute, "utf8");
      tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      trees.set(absolute, tree);
    }
    function visit(node) {
      if (node.name && ts.isIdentifier(node.name) && node.name.text === name) {
        const owners = [];
        for (let parent = node.parent; parent; parent = parent.parent)
          if (parent.name && ts.isIdentifier(parent.name))
            owners.unshift(parent.name.text);
        if (
          parts.every(
            (part, index) =>
              part === owners[owners.length - parts.length + index],
          )
        ) {
          const at = node.getStart(tree);
          const line = tree.getLineAndCharacterOfPosition(at).line + 1;
          found.push({
            path,
            line,
            declaration: tree.text
              .slice(at, Math.min(at + 160, node.end))
              .replace(/\s+/g, " "),
          });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  return found;
}

const byPackage = new Map();
for (const site of draw) {
  const root = checkouts.get(site.pin);
  const [target] = site.targets;
  const directory = dirname(target.versionSource);
  const key = site.pin + "\0" + directory;
  let files = byPackage.get(key);
  if (!files) {
    const db = new DatabaseSync(
      join(root, ".pymtheg/rebuildable/graph.sqlite"),
      { readOnly: true },
    );
    try {
      files = db
        .prepare(
          "SELECT path FROM graph_contexts WHERE json_extract(body,'$.hash') != '' AND substr(path,1,?) = ?",
        )
        .all(directory.length + 1, directory + "/")
        .filter(({ path }) => /\.d\.(?:ts|mts|cts)$/.test(path));
      byPackage.set(key, files);
    } finally {
      db.close();
    }
  }
  console.log(
    JSON.stringify({
      ...site,
      declarations: declarations(root, files, target),
    }),
  );
}
