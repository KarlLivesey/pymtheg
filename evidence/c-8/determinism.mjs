// SPDX-License-Identifier: MIT
// C-8 evidence: indexes fresh copies of a project cold, several times, with
// one build, and hashes every stored Go symbol and link row (symbol ids, which
// depend on where the copy is, replaced by file, kind and identity, also inside
// link data) so the runs can be compared.
// Usage: node determinism.mjs --build DIR --project DIR --work DIR [--runs 3]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    build: { type: "string" },
    project: { type: "string" },
    work: { type: "string" },
    runs: { type: "string", default: "3" },
  },
});
const out = [];
for (let run = 1; run <= Number(values.runs); run++) {
  const root = join(values.work, `run-${run}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(values.work, { recursive: true });
  cpSync(values.project, root, {
    recursive: true,
    filter: (path) => !/\/\.git(\/|$)/.test(path) && !path.includes("/.pymtheg"),
  });
  execFileSync("chmod", ["-R", "u+w", root]);
  const cli = (...args) =>
    execFileSync(process.execPath, [join(values.build, "dist/cli/main.js"), ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
  cli("init", ".", "--name", "determinism", "--format", "json");
  try {
    cli("graph", "index", "--root", ".", "--json");
  } catch (error) {
    if (error.status !== 2) throw error;
  }
  const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const names = new Map();
  const symbols = [];
  for (const row of db.prepare("SELECT id, file, kind, body FROM graph_symbols").iterate()) {
    const body = JSON.parse(row.body);
    names.set(row.id, `${row.file}:${row.kind}:${body.identity}`);
    if (body.module === "go") symbols.push(`${row.file}\u0000${row.kind}\u0000${row.body}`.replaceAll(row.id, "#"));
  }
  const links = [];
  for (const row of db.prepare("SELECT file, kind, target, resolution, body FROM graph_links WHERE module='go'").iterate()) {
    const body = JSON.parse(row.body);
    const candidates = (body.candidates ?? []).map((item) => names.get(item.id ?? item)).sort();
    links.push(
      JSON.stringify([row.file, row.kind, body.range, body.targetName, row.resolution, row.target ? names.get(row.target) : null, candidates, body.reason ?? null, body.data ?? null]).replace(/symbol:[0-9a-f]{64}/g, (id) => names.get(id) ?? "unknown-symbol"),
    );
  }
  db.close();
  symbols.sort();
  links.sort();
  writeFileSync(join(values.work, `links-${run}.txt`), links.join("\n"));
  const hash = (items) => createHash("sha256").update(items.join("\n")).digest("hex");
  out.push({ run, symbols: symbols.length, links: links.length, symbolHash: hash(symbols), linkHash: hash(links) });
  rmSync(root, { recursive: true, force: true });
}
const same = out.every((item) => item.symbolHash === out[0].symbolHash && item.linkHash === out[0].linkHash);
console.log(JSON.stringify({ identical: same, runs: out }, null, 1));
