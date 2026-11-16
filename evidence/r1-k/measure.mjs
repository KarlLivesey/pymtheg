// R1-K measurement: cold-index one Rust project with the production indexer
// and Rust module, then break every link down by outcome, reason and target
// class. Usage (from a built checkout, on the dev server):
//   node evidence/r1-k/measure.mjs <source-root> <label> <out-dir>
// Writes <out-dir>/<label>-summary.json and <out-dir>/<label>-links.jsonl.
// The source root is copied first (only *.rs, Cargo.toml, Cargo.lock), so the
// pinned corpus is never written to. Timings are observations only.
import { readdir, mkdir, cp, mkdtemp, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { join, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import {
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../../dist/graph/index.js";
import rust from "../../dist/graph/languages/rust/index.js";

const [source, label, outDir] = process.argv.slice(2);
if (!source || !label || !outDir)
  throw new Error("usage: measure.mjs <source-root> <label> <out-dir>");
await mkdir(outDir, { recursive: true });
const scratch = await mkdtemp(
  join(process.env.PYM_SCRATCH ?? "/tmp", `r1k-${label}-`),
);
const root = join(scratch, "sources");
async function copy(dir = "") {
  for (const entry of (
    await readdir(join(source, dir), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".git" || entry.isSymbolicLink()) continue;
    const path = dir ? dir + "/" + entry.name : entry.name;
    if (entry.isDirectory()) await copy(path);
    else if (
      ["Cargo.toml", "Cargo.lock"].includes(entry.name) ||
      entry.name.endsWith(".rs")
    ) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await cp(join(source, path), join(root, path));
    }
  }
}
await copy();
const registry = new LanguageRegistry([rust]);
const store = new SqliteGraphStore(join(scratch, "graph.sqlite"), label);
const started = performance.now();
const report = await indexProject(root, registry, store);
const seconds = (performance.now() - started) / 1000;
const symbols = store.findSymbols();
const byId = new Map(symbols.map((s) => [s.id, s]));
const names = new Set(symbols.map((s) => s.name));
const links = store.links();
// Crate names written in paths that are workspace crates (lib names).
const workspaceCrates = new Set(
  symbols
    .filter((s) => s.data?.unitKind === "crate" && s.data?.crateName)
    .map((s) => String(s.data.crateName).replace(/-/g, "_")),
);
const external = /^(?:::)?(?:std|core|alloc)(?:::|$)/;
function targetClass(l) {
  const d = l.data ?? {};
  if (d.uncertainty === "invalid-code") return "failed-file";
  // Parse marked the head name as a local, parameter or generic binding.
  if (d.blocked && !d.method && !(d.targets?.length || d.targetCount))
    return "local-binding";
  if ((d.targets?.length ?? 0) > 0 || (d.targetCount ?? 0) > 0)
    return "workspace-would-be-targets";
  const name = l.targetName.replace(/\br#/g, "");
  if (external.test(name)) return "std-path";
  const head = name.replace(/^::/, "").split(/::|\./)[0];
  if (name.includes("::") && !workspaceCrates.has(head) && !names.has(head))
    return "external-path";
  const tail = String(d.method ?? name.split(/::|\./).at(-1));
  return names.has(tail)
    ? "workspace-name-exists"
    : "no-workspace-symbol-named-so";
}
const count = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const outcome = new Map(),
  byKind = new Map(),
  byReason = new Map(),
  byClass = new Map(),
  byReasonClass = new Map();
const out = createWriteStream(join(outDir, `${label}-links.jsonl`));
for (const l of links.sort((a, b) =>
  a.file < b.file
    ? -1
    : a.file > b.file
      ? 1
      : a.range.start - b.range.start || (a.kind < b.kind ? -1 : 1),
)) {
  const state = l.targetId
    ? "resolved"
    : l.candidates.length
      ? "candidates"
      : "unresolved";
  count(outcome, state);
  count(byKind, `${l.kind}|${state}`);
  const row = {
    file: l.file,
    start: l.range.start,
    end: l.range.end,
    kind: l.kind,
    name: l.targetName,
    ...(l.origin === "analysis" ? { derived: true } : {}),
    ...(l.data?.macroArguments ? { macroArgument: true } : {}),
    state,
    targets: (l.targetId ? [l.targetId] : l.candidates.map((c) => c.id))
      .map((id) => byId.get(id))
      .map((s) => `${s.file}|${s.identity}|${s.kind}`),
  };
  if (state === "unresolved" && l.kind !== "contains") {
    const reason = String(l.data?.uncertainty ?? "(none)");
    const cls = targetClass(l);
    for (const r of reason.split(/;\s*/)) count(byReason, `${l.kind}|${r}`);
    count(byClass, `${l.kind}|${cls}`);
    count(byReasonClass, `${cls}|${reason}`);
    row.reason = reason;
    row.class = cls;
    row.wouldBe = l.data?.targets ?? l.data?.targetCount ?? null;
  }
  if (!out.write(JSON.stringify(row) + "\n")) await once(out, "drain");
}
out.end();
await once(out, "finish");
const sorted = (m) =>
  Object.fromEntries([...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
const summary = {
  label,
  module: { id: rust.id, version: rust.version },
  source,
  seconds: Math.round(seconds * 10) / 10,
  files: report.claimed,
  failed: report.failed.map((f) => f.path ?? f),
  links: links.length,
  outcome: sorted(outcome),
  nonContains: links.filter((l) => l.kind !== "contains").length,
  byKind: sorted(byKind),
  unresolvedByReason: sorted(byReason),
  unresolvedByClass: sorted(byClass),
  unresolvedByClassAndReason: sorted(byReasonClass),
};
await writeFile(
  join(outDir, `${label}-summary.json`),
  JSON.stringify(summary, null, 2) + "\n",
);
store.close();
console.log(JSON.stringify({ label, seconds: summary.seconds, links: summary.links, outcome: summary.outcome }));
