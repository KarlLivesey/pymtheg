// SPDX-License-Identifier: MIT
// C-19: join a rust-analyzer SCIP index to Pymtheg's stored Rust links for
// the same pinned checkout, by file and byte range.
//
// A stored link matches the SCIP occurrence that lies inside the link's
// range and whose source text is the last segment of the link's written
// name (`a::b::c` -> `c`, `x.m` -> `m`, `m!` -> `m`), preferring a reference
// over a definition and the latest such occurrence. SCIP positions are UTF-8
// code units from the line start (rust-analyzer declares that encoding);
// Pymtheg ranges are UTF-16 code-unit offsets, converted to bytes (checked
// below: the range text ends with the written name).
//
// The toolchain's answer for a matched occurrence's symbol:
//   checkout   a definition occurrence of the symbol in an indexed checkout
//              file (or a local binding); mapped to the Pymtheg symbol whose
//              declaration range is the smallest containing the definition's
//              name and whose name is that text
//   generated  a checkout crate's symbol with no definition site (made by a
//              macro); there is no declaration for a graph target
//   library    another crate: crate, version, descriptor path
//   none       no occurrence matched (classified by why)
//
// Usage: node join.mjs --graph graph.sqlite --scip index.scip[=PREFIX][,...] --root CHECKOUT
//          --name PIN --out result.json [--seed c-19] [--samples 30]
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { parseSymbol, readScip } from "./scip.mjs";

const { values: opt } = parseArgs({
  options: {
    graph: { type: "string" },
    scip: { type: "string" },
    root: { type: "string" },
    name: { type: "string" },
    out: { type: "string" },
    seed: { type: "string", default: "c-19" },
    samples: { type: "string", default: "30" },
  },
});
const SAMPLES = Number(opt.samples);
const STD = new Set(["std", "core", "alloc", "proc_macro", "test"]);
const inc = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);
const obj = (map) => Object.fromEntries([...map].sort((a, b) => b[1] - a[1]));
const rank = (id) => createHash("sha256").update(opt.seed + "\0" + id).digest("hex");

// ---- source text, by byte
const texts = new Map();
function text(path) {
  if (!texts.has(path)) {
    let buf = null;
    try {
      buf = readFileSync(join(opt.root, path));
    } catch {}
    let lines = null;
    let units = null;
    if (buf) {
      lines = [0];
      for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines.push(i + 1);
      const str = buf.toString("utf8");
      if (str.length !== buf.length) {
        // UTF-16 code unit index -> byte offset
        units = new Int32Array(str.length + 1);
        let b = 0;
        for (let i = 0; i < str.length; i++) {
          units[i] = b;
          const c = str.charCodeAt(i);
          if (c < 0x80) b += 1;
          else if (c < 0x800) b += 2;
          else if (c >= 0xd800 && c <= 0xdbff) {
            b += 4;
            units[++i] = b; // low surrogate: inside the same character
          } else b += 3;
        }
        units[str.length] = b;
      }
    }
    texts.set(path, { buf, lines, units });
  }
  return texts.get(path);
}
// Pymtheg stores ranges as JavaScript string offsets (UTF-16 code units);
// SCIP positions are UTF-8 bytes. Convert Pymtheg offsets to bytes.
const toByte = (path, u) => {
  const { units } = text(path);
  return units ? units[Math.min(u, units.length - 1)] : u;
};
const slice = (path, s, e) => text(path).buf?.toString("utf8", s, e) ?? "";
function lineOf(path, offset) {
  const { lines } = text(path);
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
function lineText(path, offset) {
  const t = text(path);
  if (!t.buf) return "";
  const l = lineOf(path, offset);
  const end = l + 1 < t.lines.length ? t.lines[l + 1] - 1 : t.buf.length;
  return t.buf.toString("utf8", t.lines[l], end).trim().slice(0, 160);
}

// ---- SCIP
// --scip takes one or more comma-separated INDEX[=PREFIX]: an index of a nested
// workspace (axum's examples/) has paths relative to that workspace.
const scip = { documents: [] };
const seenPaths = new Set();
for (const spec of opt.scip.split(",")) {
  const [file, prefix = ""] = spec.split("=");
  for (const doc of readScip(file).documents) {
    const path = prefix ? posix.normalize(prefix + "/" + doc.path) : doc.path;
    if (seenPaths.has(path)) continue; // a file in two indexes: keep the first
    seenPaths.add(path);
    scip.documents.push({ ...doc, path });
  }
}
const defs = new Map(); // symbol (locals: path + symbol) -> {path, s, e}
// SCIP symbol strings carry no function-body scope: two items declared inside
// different function bodies of one module (`const SHERLOCK` in two tests) get
// the same symbol string. A symbol defined more than once names no single
// declaration; the join reports it as a collision and credits nothing.
const defCount = new Map();
const kindOf = new Map();
const occByFile = new Map();
const checkoutCrates = new Set();
for (const doc of scip.documents) {
  const t = text(doc.path);
  if (!t.buf) continue;
  const list = [];
  for (const o of doc.occurrences) {
    const [sl, sc, a, b] = o.range;
    const el = o.range.length === 3 ? sl : a;
    const ec = o.range.length === 3 ? a : b;
    if (sl >= t.lines.length || el >= t.lines.length) continue;
    const s = t.lines[sl] + sc;
    const e = t.lines[el] + ec;
    const local = o.symbol.startsWith("local ");
    const key = local ? doc.path + "\0" + o.symbol : o.symbol;
    const def = (o.roles & 1) !== 0;
    if (def) defCount.set(key, (defCount.get(key) ?? 0) + 1);
    if (def && !defs.has(key)) defs.set(key, { path: doc.path, s, e });
    if (def && !local) {
      const q = parseSymbol(o.symbol);
      checkoutCrates.add(`${q.crate} ${q.version}`); // by version: a checkout may depend on an older release of itself
    }
    list.push({ s, e, key, symbol: o.symbol, def });
  }
  for (const si of doc.symbols) kindOf.set(si.symbol.startsWith("local ") ? doc.path + "\0" + si.symbol : si.symbol, si.kind);
  list.sort((x, y) => x.s - y.s);
  occByFile.set(doc.path, list);
}

// ---- Pymtheg graph
const db = new DatabaseSync(opt.graph, { readOnly: true });
const symbols = new Map();
const symbolsByFile = new Map();
const symbolsByName = new Map();
for (const row of db.prepare("SELECT id, file, name, kind, body FROM graph_symbols WHERE json_extract(body,'$.module')='rust'").iterate()) {
  const body = JSON.parse(row.body);
  const s = { id: row.id, file: row.file, name: row.name, kind: row.kind, start: toByte(row.file, body.range.start), end: toByte(row.file, body.range.end) };
  symbols.set(row.id, s);
  if (!symbolsByFile.has(row.file)) symbolsByFile.set(row.file, []);
  symbolsByFile.get(row.file).push(s);
  if (!symbolsByName.has(row.name)) symbolsByName.set(row.name, []);
  symbolsByName.get(row.name).push(s);
}
const libraryRows = new Map();
for (const row of db.prepare("SELECT l.link, l.role, l.ecosystem, l.unit, l.symbol, l.evidence FROM graph_library_targets l JOIN graph_links g ON g.id = l.link WHERE g.module='rust'").iterate()) {
  if (!libraryRows.has(row.link)) libraryRows.set(row.link, []);
  libraryRows.get(row.link).push(row);
}
const candidates = new Map();
for (const row of db.prepare("SELECT c.link, c.symbol FROM graph_candidates c JOIN graph_links g ON g.id = c.link WHERE g.module='rust'").iterate()) {
  if (!candidates.has(row.link)) candidates.set(row.link, []);
  candidates.get(row.link).push(row.symbol);
}
const failedFiles = new Set(db.prepare("SELECT path FROM graph_files WHERE status <> 'clean' AND json_extract(body,'$.module')='rust'").all().map((r) => r.path));

function pymSymbolAt(path, s, name) {
  let best = null;
  for (const sym of symbolsByFile.get(path) ?? []) {
    if (sym.start <= s && s < sym.end && sym.name === name && (!best || sym.end - sym.start < best.end - best.start)) best = sym;
  }
  return best;
}

function enclosingItem(path, s) {
  let best = null;
  for (const sym of symbolsByFile.get(path) ?? []) {
    if (sym.start <= s && s < sym.end && (!best || sym.end - sym.start < best.end - best.start)) best = sym;
  }
  return best;
}

const lastSegment = (name) => {
  let n = name.replace(/!$/, "");
  n = n.replace(/<[^<>]*>/g, "").replace(/<[^<>]*>/g, "");
  const parts = n.split(/::|\./);
  return parts[parts.length - 1].replace(/^r#/, "").trim();
};

function pathClass(path) {
  if (/(^|\/)tests?\//.test(path)) return "tests";
  if (/(^|\/)examples?\//.test(path)) return "examples";
  if (/(^|\/)benches\//.test(path)) return "benches";
  if (/(^|\/)build\.rs$/.test(path)) return "build-script";
  return "src";
}

// Library descriptor path -> a readable `a::b::Type::m` path. An impl block
// `impl#[Self][Trait]m` becomes `Self::m` (trait recorded separately).
function libraryPath(p) {
  const out = [];
  let trait = "";
  for (let i = 0; i < p.path.length; i++) {
    if (p.path[i] === "impl" && p.kinds[i] === "type") {
      const self = p.kinds[i + 1] === "typeparam" ? p.path[i + 1] : "?";
      if (p.kinds[i + 2] === "typeparam") trait = p.path[i + 2];
      out.push(self.replace(/<.*$/, ""));
      i += trait ? 2 : 1;
      continue;
    }
    if (p.kinds[i] === "typeparam" || p.kinds[i] === "param") continue;
    out.push(p.path[i]);
  }
  return { path: out.filter((x) => x !== "crate").join("::"), trait: trait.replace(/<.*$/, "") };
}

function toolchainAnswer(file, link) {
  const list = occByFile.get(file);
  if (!list) return { kind: "none", why: "file-not-indexed" };
  const want = lastSegment(link.targetName);
  let best = null;
  // occurrences are sorted by start; scan the window
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].s < link.start) lo = mid + 1;
    else hi = mid;
  }
  let any = false;
  for (let i = lo; i < list.length && list[i].s < link.end; i++) {
    const o = list[i];
    if (o.e > link.end) continue;
    any = true;
    if (slice(file, o.s, o.e).replace(/^r#/, "") !== want) continue;
    if (!best || (best.def && !o.def) || (best.def === o.def && o.e > best.e)) best = o;
  }
  if (!best) return { kind: "none", why: any ? "no-occurrence-named-so" : "no-occurrence-in-range" };
  const p = parseSymbol(best.symbol);
  // A method named under its trait (`Trait#m().`, not `impl#[T][Trait]m().`):
  // the trait declaration, i.e. dispatch on a generic or dyn receiver, or a
  // default method body. rust-analyzer names inherent and impl methods
  // through their impl block.
  const n = p.kinds?.length ?? 0;
  const traitDecl = !p.local && p.kinds[n - 1] === "method" && p.kinds[n - 2] === "type" && p.path[n - 2] !== "impl";
  const def = defs.get(best.key);
  const scipKind = kindOf.get(best.key) ?? 0;
  if (p.local || def) {
    if (!def) return { kind: "none", why: "local-without-definition", symbol: best.symbol };
    if (defCount.get(best.key) > 1) return { kind: "collision", symbol: best.symbol, count: defCount.get(best.key) };
    // A module's SCIP definition is its whole file (or the inline `mod`);
    // compare modules by name.
    if (!p.local && p.kinds[p.kinds.length - 1] === "namespace") {
      const name = p.last;
      const target = [...(symbolsByFile.get(def.path) ?? []), ...(symbolsByName.get(name) ?? [])].find((s) => s.kind === "module" && (s.name === name || s.name === def.path));
      return { kind: "checkout", local: false, module: name, symbol: best.symbol, def, target, scipKind, isDef: best.def };
    }
    // A local binding is not a graph symbol: Pymtheg links a local to the
    // innermost item that declares it, so map a local to that item.
    const target = p.local ? enclosingItem(def.path, def.s) : pymSymbolAt(def.path, def.s, slice(def.path, def.s, def.e).replace(/^r#/, ""));
    return { kind: "checkout", local: p.local, symbol: best.symbol, def, target, scipKind, isDef: best.def, traitDecl };
  }
  if (checkoutCrates.has(`${p.crate} ${p.version}`)) return { kind: "generated", symbol: best.symbol, scipKind };
  const lp = libraryPath(p);
  return {
    kind: "library",
    symbol: best.symbol,
    ecosystem: STD.has(p.crate) ? "rust-std" : "cargo",
    crate: p.crate,
    version: p.version,
    path: lp.path,
    trait: lp.trait,
    last: p.last,
    scipKind,
    descriptorKind: p.kinds[p.kinds.length - 1],
    traitDecl,
  };
}

// ---- walk every stored Rust link
const cross = new Map(); // "pym|toolchain" -> n
const byKind = new Map();
const reasons = new Map(); // pym reason class x toolchain answer
const noAnswer = new Map();
const noAnswerSamples = new Map();
const agreement = new Map();
const candidateCheck = new Map();
const libraryIdentity = new Map();
const disagreements = [];
const gains = [];
const outsideSet = []; // candidate sets the toolchain answer falls outside of // lowest fixed-seed ranks among conservative gains
const offsetCheck = { matchedByText: 0 };
const rangeCheck = { textMatches: 0, textDiffers: 0, samples: [] }; // stored range text ends with the written name
const verdictSamples = new Map();
const notIndexedByDir = new Map();
// A cfg condition other than `test` (rust-analyzer enables cfg(test)): the
// toolchain sees one configuration (default features, host target).
const cfgBeyondTest = (body) => (body.data?.conditions ?? []).some((c) => c !== "test");
const conditional = new Map(); // verdicts on links under a cfg condition
const STRUCTURAL = new Set(["contains", "modules"]);
let total = 0;
let l2 = 0;
let gainCheckout = 0;
let gainLibrary = 0;
let gainGenerated = 0;
let dispatchGain = 0;
let gainUnderCfg = 0;
let gainUnderCfgAndTrait = 0;
const gainByReason = new Map();
let toolchainAlone = 0;

for (const row of db.prepare("SELECT id, file, kind, resolution, target, body FROM graph_links WHERE module='rust'").iterate()) {
  total++;
  const body = JSON.parse(row.body);
  const link = { start: toByte(row.file, body.range.start), end: toByte(row.file, body.range.end), targetName: body.targetName ?? "" };
  if (!STRUCTURAL.has(row.kind)) {
    const written = slice(row.file, link.start, link.end).replace(/\s+/g, "");
    if (written.replace(/!$/, "").endsWith(lastSegment(link.targetName))) rangeCheck.textMatches++;
    else {
      rangeCheck.textDiffers++;
      if (rangeCheck.samples.length < 12 && Number.parseInt(rank(row.id).slice(0, 2), 16) < 8) rangeCheck.samples.push(`${row.kind} ${link.targetName} :: ${written.slice(0, 80)}`);
    }
  }
  const lib = (libraryRows.get(row.id) ?? []).filter((r) => r.role === "target");
  let pym;
  if (row.resolution === "resolved") pym = "checkout";
  else if (row.resolution === "library") pym = lib[0]?.symbol ? "library" : "library-unit-only";
  else if (row.resolution === "ambiguous") pym = "candidate-set";
  else pym = "unresolved";
  const isL2 = pym === "checkout" || pym === "library";
  if (isL2) l2++;
  const reason =
    pym === "unresolved"
      ? failedFiles.has(row.file)
        ? "failed-file"
        : (body.data?.uncertainty ?? (body.data?.blocked ? "blocked" : (body.data?.reason ?? "no-reason")))
      : pym;
  const tc = toolchainAnswer(row.file, link);
  if (tc.kind !== "none") {
    offsetCheck.matchedByText++;
  }
  const tcLabel = tc.kind === "checkout" ? (tc.target ? "checkout" : "checkout-unmapped") : tc.kind === "library" ? (tc.path ? "library" : "library-crate-only") : tc.kind;
  inc(cross, pym + " | " + tcLabel);
  inc(byKind, row.kind + " | " + pym + " | " + tcLabel);
  if (!isL2) inc(reasons, reason + " | " + tcLabel);
  if (tcLabel === "checkout" || tcLabel === "library") toolchainAlone++;
  if (!isL2) {
    if ((tcLabel === "checkout" || tcLabel === "library") && cfgBeyondTest(body)) gainUnderCfg++;
    if (tcLabel === "checkout" || tcLabel === "library") inc(gainByReason, `${row.kind} | ${reason.split("; ")[0]} | ${tcLabel}`);
    if ((tcLabel === "checkout" || tcLabel === "library") && !tc.traitDecl && !cfgBeyondTest(body)) {
      // the conservative gain: candidates for the hand-check of gained links
      const g = { rank: rank("gain\0" + row.id), kind: row.kind, pymtheg: reason, site: `${row.file}:${lineOf(row.file, link.start) + 1}`, written: link.targetName, line: lineText(row.file, link.start) };
      g.toolchain = tc.kind === "checkout" ? `${tc.def.path}:${lineOf(tc.def.path, tc.def.s) + 1} ${tc.local ? "local " : ""}${tc.target.kind} ${tc.target.name} :: ${lineText(tc.def.path, tc.def.s)}` : `${tc.ecosystem} ${tc.crate} ${tc.path}`;
      if (gains.length < 400 || g.rank < gains[gains.length - 1].rank) {
        gains.push(g);
        gains.sort((a, b) => (a.rank < b.rank ? -1 : 1));
        if (gains.length > 400) gains.pop();
      }
    }
    if (tcLabel === "checkout") gainCheckout++;
    else if (tcLabel === "library") gainLibrary++;
    else if (tc.kind === "generated") gainGenerated++;
    if ((tcLabel === "checkout" || tcLabel === "library") && tc.traitDecl) dispatchGain++;
    if ((tcLabel === "checkout" || tcLabel === "library") && tc.traitDecl && cfgBeyondTest(body)) gainUnderCfgAndTrait++;
  }
  if (tc.kind === "none") {
    if (tc.why === "file-not-indexed") inc(notIndexedByDir, row.file.split("/").slice(0, 2).join("/"));
    const cls = tc.why === "file-not-indexed" ? "file-not-indexed:" + pathClass(row.file) : (cfgBeyondTest(body) ? "cfg-conditional" : tc.why) + ":" + row.kind;
    inc(noAnswer, cls);
    if (!noAnswerSamples.has(cls)) noAnswerSamples.set(cls, []);
    const s = noAnswerSamples.get(cls);
    if (s.length < 6) s.push(`${row.file}:${lineOf(row.file, link.start) + 1} ${link.targetName} :: ${lineText(row.file, link.start)}`);
  }
  if (tc.kind === "library") {
    const versionShape = /^\d+\.\d+/.test(tc.version) ? "semver" : tc.version.startsWith("https://") ? "url" : tc.version;
    inc(libraryIdentity, `${tc.ecosystem} version:${versionShape} descriptor:${tc.descriptorKind}${tc.trait ? " via-trait-impl" : ""}${tc.symbol.includes(" impl#") || tc.symbol.includes("/impl#") ? " impl-block" : ""}`);
  }

  // agreement on definite links
  let verdict = null;
  let pymDesc = "";
  if (pym === "checkout") {
    const t = symbols.get(row.target);
    pymDesc = t ? `${t.file}:${lineOf(t.file, t.start) + 1} ${t.kind} ${t.name} :: ${lineText(t.file, t.start)}` : `missing symbol ${row.target}`;
    if (tc.kind === "none") verdict = "no-answer";
    else if (tc.kind === "collision") verdict = "toolchain-symbol-collision";
    else if (tc.kind === "checkout" && tc.module) verdict = t?.kind === "module" && (t.name === tc.module || t.name === tc.def.path) ? "agree-module-by-name" : "disagree-module";
    else if (tc.kind === "checkout") verdict = !tc.target ? "toolchain-target-not-a-graph-symbol" : tc.target.id === row.target ? "agree" : "disagree-checkout-target";
    else if (tc.kind === "generated") verdict = "toolchain-generated-item";
    else verdict = "disagree-toolchain-says-library";
  } else if (pym === "library") {
    const r = lib[0];
    pymDesc = `${r.ecosystem} ${r.unit} ${r.symbol} (${r.evidence})`;
    if (tc.kind === "none") verdict = "no-answer";
    else if (tc.kind === "library") {
      const fam = (u) => (STD.has(u) ? "std-family" : u.replace(/-/g, "_"));
      const pymLast = lastSegment(r.symbol.replace(/^#\[(derive\()?/, "").replace(/\)?\]$/, ""));
      // Same name, other crate: the written path through a re-export
      // (`serde::Serialize` is declared in `serde_core`) against the
      // declaring crate the toolchain names. Classified apart; hand-checked.
      if (fam(r.unit) !== fam(tc.crate)) verdict = pymLast === tc.last ? "unit-differs-same-name" : "disagree-library-unit";
      else if (pymLast !== tc.last) verdict = "disagree-library-symbol";
      else if (r.symbol.replace(/!$/, "") === tc.path && r.unit === tc.crate) verdict = "agree-exact-path";
      else verdict = "agree-unit-and-name";
    } else if (tc.kind === "checkout" && tc.local) verdict = "disagree-toolchain-says-local";
    else verdict = "disagree-toolchain-says-checkout";
  } else if (pym === "candidate-set" && tc.kind !== "none") {
    const set = new Set(candidates.get(row.id) ?? []);
    const libs = (libraryRows.get(row.id) ?? []).filter((r) => r.role === "candidate");
    let inSet = false;
    if (tc.kind === "checkout" && tc.target) inSet = set.has(tc.target.id);
    if (tc.kind === "library") inSet = libs.some((r) => lastSegment(r.symbol ?? "") === tc.last);
    inc(candidateCheck, inSet ? "toolchain-answer-in-set" : `toolchain-answer-outside-set:${tcLabel}`);
    if (!inSet && tcLabel === "checkout") outsideSet.push(`${row.file}:${lineOf(row.file, link.start) + 1} ${link.targetName} candidates=${[...set].map((id) => symbols.get(id)?.file + ":" + (symbols.get(id) ? lineOf(symbols.get(id).file, symbols.get(id).start) + 1 : "?")).join(",")} tc=${tc.def.path}:${lineOf(tc.def.path, tc.def.s) + 1} :: ${lineText(row.file, link.start)}`);
  }
  if (verdict && STRUCTURAL.has(row.kind)) verdict = "structural:" + verdict;
  if (verdict) {
    inc(agreement, `${pym} | ${row.kind} | ${verdict}`);
    if (cfgBeyondTest(body)) inc(conditional, `${pym} | ${verdict}`);
    const vk = `${pym} | ${row.kind} | ${verdict}`;
    if (!verdictSamples.has(vk)) verdictSamples.set(vk, []);
    const vs = verdictSamples.get(vk);
    if (vs.length < 4) vs.push(`${row.file}:${lineOf(row.file, link.start) + 1} ${link.targetName} -> ${pymDesc} || tc: ${tc.kind === "checkout" ? tc.def.path + ":" + (lineOf(tc.def.path, tc.def.s) + 1) + " " + slice(tc.def.path, tc.def.s, tc.def.e) + " " + tc.symbol : (tc.symbol ?? tc.why)} :: ${lineText(row.file, link.start)}`);
    if (verdict.startsWith("disagree") || verdict.startsWith("unit-differs"))
      disagreements.push({
        rank: rank(row.id),
        conditional: cfgBeyondTest(body),
        verdict,
        kind: row.kind,
        site: `${row.file}:${lineOf(row.file, link.start) + 1}`,
        written: link.targetName,
        line: lineText(row.file, link.start),
        pymtheg: pymDesc,
        toolchain:
          tc.kind === "checkout"
            ? `${tc.def.path}:${lineOf(tc.def.path, tc.def.s) + 1} ${tc.local ? "local " : ""}${tc.target ? tc.target.kind + " " + tc.target.name : "(no graph symbol)"} [${tc.symbol}] :: ${lineText(tc.def.path, tc.def.s)}`
            : tc.kind === "library"
              ? `${tc.ecosystem} ${tc.crate} ${tc.path} [${tc.symbol}]`
              : tc.symbol,
      });
  }
}

disagreements.sort((a, b) => (a.rank < b.rank ? -1 : 1));
const pct = (n) => Math.round((10000 * n) / total) / 100;
const result = {
  pin: opt.name,
  scip: { documents: scip.documents.length, checkoutCrates: [...checkoutCrates].sort() },
  links: total,
  level2: { links: l2, percent: pct(l2) },
  withToolchain: {
    gainCheckout,
    gainLibrary,
    percent: pct(l2 + gainCheckout + gainLibrary),
    percentCheckoutOnly: pct(l2 + gainCheckout),
    generatedNotCredited: gainGenerated,
    gainThatIsTraitDeclaration: dispatchGain,
    percentWithoutTraitDeclarationsAndNonTestCfg: pct(l2 + gainCheckout + gainLibrary - dispatchGain - gainUnderCfg + gainUnderCfgAndTrait),
    gainUnderNonTestCfg: gainUnderCfg,
    gainByKindAndFirstReason: obj(gainByReason),
    toolchainAlonePercent: pct(toolchainAlone),
  },
  offsetCheck,
  rangeCheck,
  cross: obj(cross),
  agreement: obj(agreement),
  candidateSets: obj(candidateCheck),
  candidateSetsOutside: outsideSet,
  verdictsUnderNonTestCfg: obj(conditional),
  notCreditedReasons: obj(reasons),
  toolchainNoAnswer: obj(noAnswer),
  notIndexedLinksByDirectory: obj(notIndexedByDir),
  toolchainNoAnswerSamples: Object.fromEntries(noAnswerSamples),
  libraryIdentityShapes: obj(libraryIdentity),
  byKind: obj(byKind),
  gainSample: gains.slice(0, SAMPLES).map(({ rank, ...g }) => g),
  disagreementCount: disagreements.length,
  disagreementsByVerdict: obj(disagreements.reduce((m, d) => inc(m, d.verdict + " | " + d.kind) && m, new Map())),
  verdictSamples: Object.fromEntries(verdictSamples),
  // hand-check list: every hard disagreement first (target, unit or symbol
  // differs), then same-name re-export cases, each in fixed-seed order
  disagreementSample: [...disagreements.filter((d) => !d.verdict.startsWith("unit-differs")), ...disagreements.filter((d) => d.verdict.startsWith("unit-differs"))].slice(0, SAMPLES).map(({ rank, ...d }) => d),
  disagreementAll: disagreements.map(({ rank, ...d }) => d),
};
writeFileSync(opt.out, JSON.stringify(result, null, 1));
const { disagreementAll, byKind: _b, ...brief } = result;
console.log(JSON.stringify({ ...brief, disagreementSample: undefined, toolchainNoAnswerSamples: undefined }, null, 1));
