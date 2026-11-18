// SPDX-License-Identifier: MIT
// C-8 evidence: on a writable copy of a Go project, indexes source-only with a
// base build and a candidate build, and with the candidate build and the
// opt-in toolchain route on. For every link the candidate makes definite that
// the base did not (keyed by file, kind, range and target name), reports the
// toolchain route's answer: the same target (confirmed), a different one
// (disagreement), or no decision (the toolchain had no fact for it).
// Usage: node toolchain-agreement.mjs --base DIR --candidate DIR --project DIR --work DIR
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    candidate: { type: "string" },
    project: { type: "string" },
    work: { type: "string" },
  },
});
rmSync(values.work, { recursive: true, force: true });
mkdirSync(values.work, { recursive: true });

function index(build, label, toolchain) {
  const root = join(values.work, label);
  cpSync(values.project, root, {
    recursive: true,
    filter: (path) => !/\/\.git(\/|$)/.test(path) && !path.includes("/.pymtheg"),
  });
  // The pinned corpus is read-only; the copy must be writable.
  execFileSync("chmod", ["-R", "u+w", root]);
  const cli = (...args) =>
    execFileSync(process.execPath, [join(build, "dist/cli/main.js"), ...args], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1 << 28,
    });
  cli("init", ".", "--name", "agreement", "--format", "json");
  if (toolchain)
    writeFileSync(
      join(root, ".pymtheg/settings.json"),
      JSON.stringify({ version: 1, scenarios: {}, graph: { toolchain: { go: true } } }),
    );
  try {
    cli("graph", "index", "--root", ".", "--json");
  } catch (error) {
    if (error.status !== 2) throw error; // 2: incomplete, graph kept
  }
  const db = new DatabaseSync(join(root, ".pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  const names = new Map();
  for (const row of db.prepare("SELECT id, file, kind, json_extract(body,'$.identity') AS identity FROM graph_symbols").iterate())
    names.set(row.id, `${row.file}:${row.kind}:${row.identity}`);
  const links = new Map();
  for (const row of db.prepare("SELECT file, kind, target, body FROM graph_links WHERE module='go'").iterate()) {
    const body = JSON.parse(row.body);
    links.set(`${row.file}\u0000${row.kind}\u0000${body.range.start}\u0000${body.range.end}\u0000${body.targetName}`, {
      target: row.target ? names.get(row.target) : null,
      toolchain: body.data?.toolchain,
    });
  }
  db.close();
  return links;
}

const base = index(values.base, "base", false);
const candidate = index(values.candidate, "candidate", false);
const checked = index(values.candidate, "toolchain", true);
const out = { newlyDefinite: 0, confirmed: 0, disagreements: [], noDecision: 0, noDecisionSample: [], baseDefiniteLost: 0 };
for (const [key, link] of candidate) {
  if (base.get(key)?.target && link.target !== base.get(key).target) out.baseDefiniteLost++;
  if (!link.target || base.get(key)?.target) continue;
  out.newlyDefinite++;
  const view = checked.get(key);
  const [file, kind, start, , name] = key.split("\u0000");
  const t = view?.toolchain;
  if (t?.origin === "toolchain" && !t.sourceOnly && view.target === link.target) out.confirmed++;
  else if (t?.origin === "toolchain") out.disagreements.push({ file, kind, start: Number(start), name, sourceOnly: link.target, toolchain: view?.target ?? null });
  else {
    out.noDecision++;
    if (out.noDecisionSample.length < 20) out.noDecisionSample.push({ file, kind, start: Number(start), name, target: link.target });
  }
}
console.log(JSON.stringify(out, null, 1));
