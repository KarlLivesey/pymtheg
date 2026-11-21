// SPDX-License-Identifier: MIT
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

const [scratch, build, receipt, oldDraw, markedDraw] = process.argv.slice(2);
const read = (name) => JSON.parse(readFileSync(name, "utf8"));
const { entryBuildGuards } = await import(pathToFileURL(resolve(scratch, build,
  "dist/graph/languages/typescript/entry-build.js")));
const key = (row) => JSON.stringify([row.pin, row.file, row.site]);
const marked = new Map(read(markedDraw).filter((row) => row.assumed).map((row) => [key(row), row]));
const repos = new Map(read(receipt).repos.map((repo) => [repo.id, repo]));
const summary = [];
for (const [pin, rows] of Map.groupBy(read(oldDraw), (row) => row.pin)) {
  const repo = repos.get(pin);
  const db = new DatabaseSync(resolve(scratch, repo.attempt,
    "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const files = new Map();
  for (const table of ["graph_files", "graph_contexts"])
    for (const { path, body } of db.prepare(`SELECT path, body FROM ${table}`).iterate()) {
      const item = JSON.parse(body);
      if (item.text !== undefined && !item.dependency) files.set("/" + path, item.text);
    }
  db.close();
  function owner(file) {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      if (files.has(posix.join(dir, "package.json"))) return dir;
      if (dir === "/") return undefined;
    }
  }
  const guard = entryBuildGuards(files, owner);
  const groups = {};
  for (const row of rows) {
    const promoted = marked.get(key(row));
    const { output, source, config } = row.note;
    const root = owner("/" + output);
    const path = root && posix.join(root, "package.json");
    const json = path && JSON.parse(files.get(path).replace(/^\uFEFF/, ""));
    const reason = promoted
      ? (JSON.stringify(row.target) === JSON.stringify(promoted.target) ? "marked" : "marked-changed")
      : !/\.d\.[cm]?ts$/.test(output)
        ? "missing-js-entry"
        : (json && guard(root, { path: path.slice(1), json }, "/" + source, "/" + output))
          || "other";
    const id = JSON.stringify([reason, path?.slice(1), config, output]);
    const item = groups[id] ??= { reason, manifest: path?.slice(1), config, output, links: 0 };
    item.links++;
  }
  summary.push({ pin, original: rows.length, routes: Object.values(groups) });
}
console.log(JSON.stringify(summary, null, 2));
