// SPDX-License-Identifier: MIT
// C-8 evidence: indexes a fresh copy of each project with a base build and a
// candidate build (source only) and compares every Go link and symbol. A link
// site is (file, kind, range, target name); a symbol is (file, kind, identity).
// Lists every link that was definite with the base build and is not definite
// to the same target with the candidate, every symbol missing, and counts of
// newly definite links by kind.
// Usage: node compare-builds.mjs --base DIR --candidate DIR --work DIR PROJECT...
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  options: {
    base: { type: "string" },
    candidate: { type: "string" },
    work: { type: "string" },
  },
  allowPositionals: true,
});
mkdirSync(values.work, { recursive: true });

function index(build, project, label) {
  const root = join(values.work, `${basename(project)}-${label}`);
  cpSync(project, root, { recursive: true, filter: (path) => !/\/\.git(\/|$)/.test(path) });
  execFileSync("chmod", ["-R", "u+w", root]);
  const cli = (...args) =>
    execFileSync(process.execPath, [join(build, "dist/cli/main.js"), ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
  cli("init", ".", "--name", "compare", "--format", "json");
  try {
    cli("graph", "index", "--root", ".", "--json");
  } catch (error) {
    if (error.status !== 2) throw error; // 2: incomplete, graph kept
  }
  const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const names = new Map();
  const symbols = new Set();
  for (const row of db.prepare("SELECT id, file, kind, body FROM graph_symbols").iterate()) {
    const body = JSON.parse(row.body);
    const name = `${row.file}:${row.kind}:${body.identity}`;
    names.set(row.id, name);
    if (body.module === "go") symbols.add(name);
  }
  const links = new Map();
  for (const row of db.prepare("SELECT file, kind, target, resolution, body FROM graph_links WHERE module='go'").iterate()) {
    const body = JSON.parse(row.body);
    links.set(`${row.file}\u0000${row.kind}\u0000${body.range.start}\u0000${body.range.end}\u0000${body.targetName}`, {
      file: row.file,
      kind: row.kind,
      start: body.range.start,
      name: body.targetName,
      resolution: row.resolution,
      target: row.target ? names.get(row.target) : null,
      reason: body.data?.open?.reason ?? body.data?.reason ?? null,
    });
  }
  db.close();
  return { root, links, symbols };
}

const lineOf = (root, file, offset) => {
  const text = readFileSync(join(root, file), "utf8");
  const line = text.slice(0, offset).split("\n").length;
  return { line, source: text.split("\n")[line - 1].trim().slice(0, 160) };
};

const out = [];
for (const project of positionals) {
  const before = index(values.base, project, "base");
  const after = index(values.candidate, project, "candidate");
  const row = {
    project: basename(project),
    links: [before.links.size, after.links.size],
    definite: [0, 0],
    newlyDefinite: {},
    sitesAdded: 0,
    sitesRemoved: 0,
    symbols: [before.symbols.size, after.symbols.size],
    symbolsMissing: [...before.symbols].filter((key) => !after.symbols.has(key)),
    changed: [],
  };
  for (const link of before.links.values()) if (link.target) row.definite[0]++;
  for (const [key, link] of after.links) {
    if (link.target) row.definite[1]++;
    const old = before.links.get(key);
    if (!old) row.sitesAdded++;
    if (link.target && !old?.target) row.newlyDefinite[link.kind] = (row.newlyDefinite[link.kind] ?? 0) + 1;
  }
  for (const [key, old] of before.links) {
    const now = after.links.get(key);
    if (!now) row.sitesRemoved++;
    if (old.target && now?.target !== old.target)
      row.changed.push({
        file: old.file,
        ...lineOf(before.root, old.file, old.start),
        kind: old.kind,
        name: old.name,
        before: old.target,
        after: now ? (now.target ?? `${now.resolution}${now.reason ? ` (${now.reason})` : ""}`) : "site removed",
      });
  }
  out.push(row);
}
console.log(JSON.stringify(out, null, 1));
