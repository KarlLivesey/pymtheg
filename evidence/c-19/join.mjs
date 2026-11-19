// SPDX-License-Identifier: MIT
// C-19: join a rust-analyzer SCIP index to Pymtheg's stored Rust links for
// the same pinned checkout, by file and range, two ways.
//
// LOOSE (the first measurement, kept for comparison): a link matches the
// SCIP occurrence anywhere inside the link's range whose text is the last
// segment of the written name, a reference preferred.
//
// STRICT (the figures that count): the occurrence must be at the link's own
// name site — exactly the byte range of the written name's last segment at
// the end of the link's range (after a trailing `!`, `as alias` or generic
// arguments) — and be the only symbol there. Then the answer must pass:
//   kind       the symbol's kind fits the link kind (KINDS below)
//   import     a `use` the toolchain answers with a module is not credited:
//              SCIP gives one symbol per occurrence and cannot show that a
//              same-named function or macro is not imported too
//   extern     `extern crate` lines and crate-root answers are not credited
//   collision  a symbol defined more than once in the index (function-body
//              items share a symbol string) names no single declaration
//   proc-macro an item of a proc-macro crate referenced from another package
//              (such a crate exports only its macros; rust-analyzer names
//              same-named private items)
// Inactive-cfg fallbacks cannot be told from the index; the "gated" figure
// drops every answer on a link Pymtheg records under a cfg condition other
// than `test`, and trait-method declarations (dispatch).
//
// SCIP positions are UTF-8 bytes; Pymtheg ranges are UTF-16 code-unit
// offsets, converted. The toolchain's answer:
//   checkout   a definition of the symbol in an indexed checkout file (or a
//              local), mapped to the Pymtheg symbol declaring that name there
//              (a local maps to its innermost enclosing item)
//   generated  a checkout crate's symbol with no definition site
//   library    another crate: crate, version, descriptor path
// Library agreement is checked on both sides with rustpath.mjs: Pymtheg's
// written path and the toolchain's declaring path are each resolved through
// `mod` and `use` re-exports to a definition; "verified" means the same
// definition (members compared by name). Otherwise only "same crate family
// and final name" (heuristic) or a difference.
//
// Usage: node join.mjs --graph graph.sqlite --scip index.scip[=PREFIX][,...]
//          --root CHECKOUT --name PIN --out result.json
//          [--cargo-home DIR] [--sysroot DIR] [--seed c-19] [--samples 30]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";
import { createResolver } from "./rustpath.mjs";
import { parseSymbol, readScip } from "./scip.mjs";

const { values: opt } = parseArgs({
  options: {
    graph: { type: "string" },
    scip: { type: "string" },
    root: { type: "string" },
    name: { type: "string" },
    out: { type: "string" },
    "cargo-home": { type: "string" },
    sysroot: { type: "string" },
    seed: { type: "string", default: "c-19" },
    samples: { type: "string", default: "30" },
  },
});
const SAMPLES = Number(opt.samples);
const STD = new Set(["std", "core", "alloc", "proc_macro", "test"]);
const inc = (map, key, n = 1) => map.set(key, (map.get(key) ?? 0) + n);
const obj = (map) => Object.fromEntries([...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
// Fixed-seed ranks keyed by site and written name (not by link id), so a
// fresh run draws the same samples.
const rank = (key) => createHash("sha256").update(opt.seed + "\0" + key).digest("hex");
const resolver = opt["cargo-home"] ? createResolver({ registries: [join(opt["cargo-home"], "registry/src")], sysroot: opt.sysroot ?? "" }) : null;

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
const defCount = new Map();
const occByFile = new Map();
const checkoutCrates = new Set(); // "crate version": a checkout may depend on an older release of itself
const fileCrate = new Map(); // indexed file -> package name of its crate
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
      checkoutCrates.add(`${q.crate} ${q.version}`);
      if (!fileCrate.has(doc.path)) fileCrate.set(doc.path, q.crate);
    }
    list.push({ s, e, key, symbol: o.symbol, def });
  }
  list.sort((x, y) => x.s - y.s);
  occByFile.set(doc.path, list);
}
const symbolsDefinedMoreThanOnce = [...defCount].filter(([k, n]) => n > 1 && !k.includes("\0")).length;

// Checkout proc-macro packages, from the manifests.
const procMacroPackages = new Set();
(function walk(dir, depth) {
  if (depth > 6) return;
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === "target" || e === ".git" || e === "node_modules") continue;
    const p = join(dir, e);
    if (e === "Cargo.toml") {
      const toml = readFileSync(p, "utf8");
      const section = (h) => toml.match(new RegExp(`^\\[${h}\\]\\s*$((?:(?!\\n\\[)[\\s\\S])*)`, "m"))?.[1] ?? ""; // a table up to the next header
      const name = section("package").match(/^\s*name\s*=\s*"([^"]+)"/m)?.[1];
      if (name && /^\s*proc[-_]macro\s*=\s*true/m.test(section("lib"))) procMacroPackages.add(name);
    } else if (statSync(p).isDirectory()) walk(p, depth + 1);
  }
})(opt.root, 0);
const isProcMacro = (crate, version) => procMacroPackages.has(crate) || (resolver ? resolver.isProcMacroCrate(crate, version) : false);

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
for (const row of db.prepare("SELECT l.link, l.role, l.ecosystem, l.unit, l.symbol, l.version, l.evidence FROM graph_library_targets l JOIN graph_links g ON g.id = l.link WHERE g.module='rust'").iterate()) {
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

// The trait name of an impl-block method symbol (`impl#[T][Trait<X>]m().`).
function implTraitOf(p) {
  for (let i = 0; i < p.path.length; i++)
    if (p.path[i] === "impl" && p.kinds[i] === "type" && p.kinds[i + 2] === "typeparam") return p.path[i + 2].replace(/<.*$/, "").split("::").pop();
  return "";
}

// A SCIP symbol's category. Locals cover bindings and generic parameters.
function category(p) {
  if (p.local) return "local";
  const k = p.kinds[p.kinds.length - 1];
  if (p.path.length === 1 && p.path[0] === "crate") return "crate-root";
  return { namespace: "module", type: "type", term: "value", method: "fn", macro: "macro", meta: "attr-macro", typeparam: "type", param: "local" }[k] ?? "other";
}
// What each link kind may name.
const KINDS = {
  calls: new Set(["fn", "type", "local"]), // functions and methods; tuple-struct and variant constructors; closures in locals
  macros: new Set(["macro", "attr-macro"]),
  types: new Set(["type", "local"]), // types, traits, aliases, associated types; generic parameters
  values: new Set(["value", "type", "fn", "local"]), // consts, statics, unit structs and variants, function items, locals
  patterns: new Set(["type", "value"]),
  implements: new Set(["type"]),
  imports: new Set(["type", "value", "fn", "macro", "attr-macro"]), // a module answer is withheld (see header)
};

// The checkout/library answer for an occurrence (shared by both joins).
function answerFor(best) {
  const p = parseSymbol(best.symbol);
  const n = p.kinds?.length ?? 0;
  // A method named under its trait (`Trait#m().`, not `impl#[T][Trait]m().`):
  // dispatch on a generic or dyn receiver, or a default body.
  const traitDecl = !p.local && p.kinds[n - 1] === "method" && p.kinds[n - 2] === "type" && p.path[n - 2] !== "impl";
  const def = defs.get(best.key);
  const cat = category(p);
  if (p.local || def) {
    if (!def) return { kind: "none", why: "local-without-definition", symbol: best.symbol, cat };
    if (defCount.get(best.key) > 1) return { kind: "collision", symbol: best.symbol, cat };
    if (cat === "module") {
      const name = p.last;
      const target = [...(symbolsByFile.get(def.path) ?? []), ...(symbolsByName.get(name) ?? [])].find((s) => s.kind === "module" && (s.name === name || s.name === def.path));
      return { kind: "checkout", local: false, module: name, symbol: best.symbol, def, target, cat, p };
    }
    const target = p.local ? enclosingItem(def.path, def.s) : pymSymbolAt(def.path, def.s, slice(def.path, def.s, def.e).replace(/^r#/, ""));
    return { kind: "checkout", local: p.local, symbol: best.symbol, def, target, traitDecl, cat, p };
  }
  if (checkoutCrates.has(`${p.crate} ${p.version}`)) return { kind: "generated", symbol: best.symbol, cat, p };
  const lp = libraryPath(p);
  return { kind: "library", symbol: best.symbol, ecosystem: STD.has(p.crate) ? "rust-std" : "cargo", crate: p.crate, version: p.version, path: lp.path, trait: lp.trait, last: p.last, descriptorKind: p.kinds[n - 1], traitDecl, cat, p };
}

function looseAnswer(file, link) {
  const list = occByFile.get(file);
  if (!list) return { kind: "none", why: "file-not-indexed" };
  const want = lastSegment(link.targetName);
  let best = null;
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
  return answerFor(best);
}

// The byte range of the written name's last segment at the end of the link.
function nameSite(file, link) {
  let s = slice(file, link.start, link.end);
  for (;;) {
    const before = s;
    s = s.replace(/\s+$/, "").replace(/!$/, "").replace(/\s+as\s+(r#)?\w+$/, "");
    if (s.endsWith(">")) {
      let d = 0;
      let k = s.length - 1;
      for (; k >= 0; k--) {
        if (s[k] === ">") d++;
        else if (s[k] === "<") d--;
        if (d === 0) break;
      }
      if (k > 0) s = s.slice(0, k).replace(/::$/, "");
    }
    if (s === before) break;
  }
  const want = lastSegment(link.targetName);
  const m = s.match(/(r#)?([A-Za-z_][A-Za-z0-9_]*)$/);
  if (!m || m[2] !== want) return null;
  const end = link.start + Buffer.byteLength(s);
  return { s: end - Buffer.byteLength(m[0]), e: end };
}

function strictAnswer(file, link, linkKind, line) {
  const list = occByFile.get(file);
  if (!list) return { kind: "none", why: "file-not-indexed" };
  const site = nameSite(file, link);
  if (!site) return { kind: "none", why: "no-name-site" };
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].s < site.s) lo = mid + 1;
    else hi = mid;
  }
  const at = [];
  for (let i = lo; i < list.length && list[i].s === site.s; i++) if (list[i].e === site.e) at.push(list[i]);
  if (at.length === 0) return { kind: "none", why: "no-occurrence-at-site" };
  const distinct = new Set(at.map((o) => o.symbol));
  if (distinct.size > 1) return { kind: "none", why: "several-symbols-at-site" };
  const best = at.find((o) => !o.def) ?? at[0];
  const a = answerFor(best);
  if (a.kind === "none") return a;
  if (/^\s*(pub(\([^)]*\))?\s+)?extern\s+crate\b/.test(line) || a.cat === "crate-root") return { kind: "none", why: "filter:extern-crate", loose: a };
  if (a.kind === "collision") return { kind: "none", why: "filter:collision", loose: a };
  const allowed = KINDS[linkKind];
  if (linkKind === "imports" && a.cat === "module") return { kind: "none", why: "filter:import-names-module", loose: a };
  if (allowed && !allowed.has(a.cat)) return { kind: "none", why: "filter:kind-incompatible", loose: a, detail: `${linkKind}->${a.cat}` };
  const pkg = a.kind === "library" ? a.crate : a.p?.crate;
  // a proc-macro crate exports only its macros: a non-macro item of one,
  // referenced from another package, is the naming confusion
  if (pkg && a.cat !== "macro" && a.cat !== "attr-macro" && (a.kind === "library" ? isProcMacro(a.crate, a.version) : procMacroPackages.has(pkg)) && fileCrate.get(file) !== pkg)
    return { kind: "none", why: "filter:proc-macro-crate-item", loose: a };
  return a;
}

// ---- library identity, both sides resolved to a definition
const verifyCache = new Map();
function toolchainSegments(a) {
  const p = a.p;
  const segs = [];
  for (let i = 0; i < p.path.length; i++) {
    if (p.path[i] === "crate" && p.kinds[i] === "namespace") continue;
    if (p.path[i] === "impl" && p.kinds[i] === "type") {
      if (p.kinds[i + 1] !== "typeparam") return null;
      const owner = p.path[i + 1].replace(/^&(mut\s+)?/, "").replace(/<.*$/, "").trim();
      if (!/^[A-Za-z_]\w*$/.test(owner)) return null; // primitive, tuple, slice or generic owner
      segs.push(owner);
      i += p.kinds[i + 2] === "typeparam" ? 2 : 1;
      continue;
    }
    if (p.kinds[i] === "typeparam" || p.kinds[i] === "param") continue;
    segs.push(p.path[i]);
  }
  return segs;
}
function verifyLibrary(r, a) {
  if (!resolver) return { result: "unverified", why: "no resolver" };
  const key = `${r.unit} ${r.version ?? ""} ${r.symbol} | ${a.symbol}`;
  if (verifyCache.has(key)) return verifyCache.get(key);
  let out;
  const pymMacro = /!$/.test(r.symbol) || /^#\[/.test(r.symbol);
  const pymSegs = r.symbol.replace(/^#\[(derive\()?/, "").replace(/\)?\]$/, "").replace(/!$/, "").split("::").filter(Boolean);
  const tcSegs = toolchainSegments(a);
  const tcMacro = a.cat === "macro" || a.cat === "attr-macro";
  const pv0 = r.unit === a.crate ? a.version : (r.version ?? null);
  if (tcSegs && r.unit === a.crate && (pv0 === a.version || STD.has(a.crate)) && pymSegs.join("::") === tcSegs.join("::") && pymMacro === tcMacro)
    // the same path in the same crate and version: one declaration
    out = { result: "same", why: "identical path in the same crate" };
  else if (!tcSegs) out = { result: "unverified", why: "toolchain owner is not a named type" };
  else {
    const pv = r.unit === a.crate ? a.version : (r.version ?? null);
    const P = resolver.resolveItem(r.unit, STD.has(r.unit) ? null : pv, pymSegs, pymMacro);
    const T = resolver.resolveItem(a.crate, STD.has(a.crate) ? null : a.version, tcSegs, tcMacro);
    if (P.error || T.error) out = { result: "unverified", why: P.error ? `pymtheg side: ${P.error}` : `toolchain side: ${T.error}` };
    else if (P.module || T.module) {
      const same = P.module && T.module && P.module.file === T.module.file && P.module.start === T.module.start;
      out = { result: same ? "same" : "different", why: "module" };
    } else {
      const sameDef = P.def.file === T.def.file && P.def.offset === T.def.offset;
      const pr = (P.rest ?? []).join("::");
      const tr = (T.rest ?? []).join("::");
      out = { result: sameDef && pr === tr ? "same" : "different", why: sameDef ? `members ${pr} / ${tr}` : `${P.def.name}@${P.def.file.split("/").slice(-3).join("/")} vs ${T.def.name}@${T.def.file.split("/").slice(-3).join("/")}` };
    }
  }
  // no absolute paths in results: name the toolchain sources and the crate cache
  out.why = out.why.split(opt.sysroot || "\0").join("<rust-src>").split(opt["cargo-home"] || "\0").join("<crate-cache>").replace(/\/(home|Users)\/[^ ]*\/(\.rustup|\.cargo)\/[^ ]*/g, "<toolchain>");
  verifyCache.set(key, out);
  return out;
}

// ---- walk every stored Rust link
const cfgBeyondTest = (body) => (body.data?.conditions ?? []).some((c) => c !== "test");
const STRUCTURAL = new Set(["contains", "modules"]);
const tally = () => ({ checkout: 0, library: 0, generated: 0, traitDecl: 0, underCfg: 0, gated: 0 });
const gain = { loose: tally(), strict: tally() };
const strictRemoved = new Map(); // why the strict join drops a loose gain
const kindIncompatible = new Map();
const cross = new Map();
const byKind = new Map();
const noAnswer = new Map();
const noAnswerSamples = new Map();
const notIndexedByDir = new Map();
const agreement = new Map();
const looseAgreement = new Map();
const candidateCheck = new Map();
const libraryIdentity = new Map();
const verifyWhy = new Map();
const verdictSamples = new Map();
const disagreements = [];
const gains = [];
const filterSamples = new Map();
const rangeCheck = { textMatches: 0, textDiffers: 0 };
let total = 0;
let l2 = 0;

for (const row of db.prepare("SELECT id, file, kind, resolution, target, body FROM graph_links WHERE module='rust'").iterate()) {
  total++;
  const body = JSON.parse(row.body);
  const link = { start: toByte(row.file, body.range.start), end: toByte(row.file, body.range.end), targetName: body.targetName ?? "" };
  const siteKey = `${row.file}\0${body.range.start}\0${body.range.end}\0${link.targetName}\0${row.kind}`;
  const line = lineText(row.file, link.start);
  if (!STRUCTURAL.has(row.kind)) {
    const written = slice(row.file, link.start, link.end).replace(/\s+/g, "");
    if (written.replace(/!$/, "").endsWith(lastSegment(link.targetName))) rangeCheck.textMatches++;
    else rangeCheck.textDiffers++;
  }
  const lib = (libraryRows.get(row.id) ?? []).filter((r) => r.role === "target");
  let pym;
  if (row.resolution === "resolved") pym = "checkout";
  else if (row.resolution === "library") pym = lib[0]?.symbol ? "library" : "library-unit-only";
  else if (row.resolution === "ambiguous") pym = "candidate-set";
  else pym = "unresolved";
  const isL2 = pym === "checkout" || pym === "library";
  if (isL2) l2++;
  const reason = pym === "unresolved" ? (failedFiles.has(row.file) ? "failed-file" : (body.data?.uncertainty ?? (body.data?.blocked ? "blocked" : (body.data?.reason ?? "no-reason")))) : pym;
  const loose = looseAnswer(row.file, link);
  const strict = STRUCTURAL.has(row.kind) ? { kind: "none", why: "structural" } : strictAnswer(row.file, link, row.kind, line);
  const label = (a) => (a.kind === "checkout" ? (a.target ? "checkout" : "checkout-unmapped") : a.kind === "library" ? (a.path ? "library" : "library-crate-only") : a.kind);
  const L = label(loose);
  const S = label(strict);
  inc(cross, `${pym} | ${S}`);
  inc(byKind, `${row.kind} | ${pym} | ${S}`);
  const cond = cfgBeyondTest(body);
  if (!isL2 && !STRUCTURAL.has(row.kind)) {
    for (const [name, a, lab] of [["loose", loose, L], ["strict", strict, S]]) {
      if (lab !== "checkout" && lab !== "library") {
        if (a.kind === "generated") gain[name].generated++;
        continue;
      }
      gain[name][lab]++;
      if (a.traitDecl) gain[name].traitDecl++;
      if (cond) gain[name].underCfg++;
      if (!a.traitDecl && !cond) gain[name].gated++;
    }
    if ((L === "checkout" || L === "library") && S !== "checkout" && S !== "library") {
      const why = strict.why ?? `strict answer ${S}`;
      inc(strictRemoved, why);
      if (strict.detail) inc(kindIncompatible, strict.detail);
      if (!filterSamples.has(why)) filterSamples.set(why, []);
      const fs = filterSamples.get(why);
      if (fs.length < 8) fs.push(`${row.file}:${lineOf(row.file, link.start) + 1} ${row.kind} ${link.targetName} -> ${loose.symbol} :: ${line}`);
    }
    if ((S === "checkout" || S === "library") && !strict.traitDecl && !cond) {
      const g = { rank: rank("gain\0" + siteKey), kind: row.kind, pymtheg: reason, site: `${row.file}:${lineOf(row.file, link.start) + 1}`, written: link.targetName, line };
      g.toolchain = strict.kind === "checkout" ? `${strict.def.path}:${lineOf(strict.def.path, strict.def.s) + 1} ${strict.local ? "local " : ""}${strict.target.kind} ${strict.target.name} :: ${lineText(strict.def.path, strict.def.s)}` : `${strict.ecosystem} ${strict.crate} ${strict.path}`;
      if (gains.length < 200 || g.rank < gains[gains.length - 1].rank) {
        gains.push(g);
        gains.sort((a, b) => (a.rank < b.rank ? -1 : 1));
        if (gains.length > 200) gains.pop();
      }
    }
  }
  if (strict.kind === "none" && !STRUCTURAL.has(row.kind)) {
    if (strict.why === "file-not-indexed") inc(notIndexedByDir, row.file.split("/").slice(0, 2).join("/"));
    const cls = strict.why === "file-not-indexed" ? "file-not-indexed:" + pathClass(row.file) : strict.why.startsWith("filter:") ? strict.why : (cond ? "cfg-conditional" : strict.why) + ":" + row.kind;
    inc(noAnswer, cls);
    if (!noAnswerSamples.has(cls)) noAnswerSamples.set(cls, []);
    const s = noAnswerSamples.get(cls);
    if (s.length < 6) s.push(`${row.file}:${lineOf(row.file, link.start) + 1} ${link.targetName} :: ${line}`);
  }
  if (strict.kind === "library") {
    const versionShape = /^\d+\.\d+/.test(strict.version) ? "semver" : strict.version.startsWith("https://") ? "url" : strict.version;
    inc(libraryIdentity, `${strict.ecosystem} version:${versionShape}${strict.trait ? " via-trait-impl" : ""}${/[ /]impl#/.test(strict.symbol) ? " impl-block" : ""}`);
  }

  // agreement on links Pymtheg calls definite (non-structural), strict answers
  if (STRUCTURAL.has(row.kind) || (!isL2 && pym !== "candidate-set")) continue;
  let verdict = null;
  let pymDesc = "";
  let verification = null;
  if (pym === "checkout") {
    const t = symbols.get(row.target);
    pymDesc = t ? `${t.file}:${lineOf(t.file, t.start) + 1} ${t.kind} ${t.name} :: ${lineText(t.file, t.start)}` : `missing symbol ${row.target}`;
    if (strict.kind === "none") verdict = strict.why.startsWith("filter:") ? `filtered:${strict.why.slice(7)}` : "no-answer";
    else if (strict.kind === "checkout" && strict.module) verdict = t?.kind === "module" && (t.name === strict.module || t.name === strict.def.path) ? "agree-module-by-name" : "disagree-module";
    else if (strict.kind === "checkout") verdict = !strict.target ? "toolchain-target-not-a-graph-symbol" : strict.target.id === row.target ? "agree-same-declaration" : "disagree-checkout-target";
    else if (strict.kind === "generated") verdict = "toolchain-generated-item";
    else verdict = "disagree-toolchain-says-library";
  } else if (pym === "library") {
    const r = lib[0];
    pymDesc = `${r.ecosystem} ${r.unit} ${r.symbol} (${r.evidence})`;
    // `<T as Trait>::m` (evidence explicit-trait): Pymtheg names the trait's
    // method, the toolchain the impl that `T` provides. Different
    // declarations by convention, both correct: a class of its own.
    const segs = r.symbol.split("::");
    const implTrait = strict.p ? implTraitOf(strict.p) : "";
    if (strict.kind !== "none" && r.evidence === "explicit-trait" && implTrait && implTrait === segs[segs.length - 2] && lastSegment(r.symbol) === (strict.last ?? strict.p?.last)) verdict = "trait-method-vs-its-impl";
    else if (strict.kind === "none") verdict = strict.why.startsWith("filter:") ? `filtered:${strict.why.slice(7)}` : "no-answer";
    else if (strict.kind === "library") {
      verification = verifyLibrary(r, strict);
      inc(verifyWhy, `${verification.result}: ${verification.why.replace(/ [^ ]*\/[^ ]*| \S+ not downloaded|[\w-]+: \d+ versions/g, "").slice(0, 60)}`);
      const fam = (u) => (STD.has(u) ? "std-family" : u.replace(/-/g, "_"));
      const pymLast = lastSegment(r.symbol.replace(/^#\[(derive\()?/, "").replace(/\)?\]$/, ""));
      const familyAndName = fam(r.unit) === fam(strict.crate) && pymLast === strict.last;
      if (verification.result === "same") verdict = "agree-same-declaration";
      else if (verification.result === "different") verdict = "disagree-verified-different";
      else if (familyAndName) verdict = "heuristic-same-family-and-name";
      else if (pymLast === strict.last) verdict = "unverified-same-name-other-crate";
      else verdict = "unverified-different-name";
    } else if (strict.kind === "checkout" && strict.local) verdict = "disagree-toolchain-says-local";
    else verdict = "disagree-toolchain-says-checkout";
  } else {
    // candidate sets: does the strict answer fall inside the set?
    if (strict.kind === "none") continue;
    const set = new Set(candidates.get(row.id) ?? []);
    const libs = (libraryRows.get(row.id) ?? []).filter((r) => r.role === "candidate");
    let inSet = false;
    if (strict.kind === "checkout" && strict.target) inSet = set.has(strict.target.id) || [...set].some((id) => symbols.get(id)?.file === strict.def.path && symbols.get(id).start <= strict.def.s && strict.def.s < symbols.get(id).end);
    if (strict.kind === "library") inSet = libs.some((r) => lastSegment(r.symbol ?? "") === strict.last);
    inc(candidateCheck, inSet ? "toolchain-answer-in-set" : `toolchain-answer-outside-set:${S}`);
    continue;
  }
  const vk = `${pym} | ${row.kind} | ${verdict}`;
  inc(agreement, vk);
  inc(looseAgreement, `${pym} | ${L}`);
  if (!verdictSamples.has(vk)) verdictSamples.set(vk, []);
  const vs = verdictSamples.get(vk);
  if (vs.length < 4) vs.push(`${row.file}:${lineOf(row.file, link.start) + 1} ${link.targetName} -> ${pymDesc.slice(0, 120)} || tc: ${strict.symbol ?? strict.why}${verification ? " || " + verification.why : ""}`);
  if (verdict.startsWith("disagree") || verdict.startsWith("unverified") || verdict.startsWith("heuristic") || verdict === "trait-method-vs-its-impl")
    disagreements.push({
      rank: rank(siteKey),
      conditional: cond,
      verdict,
      kind: row.kind,
      site: `${row.file}:${lineOf(row.file, link.start) + 1}`,
      written: link.targetName,
      line,
      pymtheg: pymDesc,
      toolchain:
        strict.kind === "checkout"
          ? `${strict.def.path}:${lineOf(strict.def.path, strict.def.s) + 1} ${strict.local ? "local " : ""}${strict.target ? strict.target.kind + " " + strict.target.name : "(no graph symbol)"} [${strict.symbol}] :: ${lineText(strict.def.path, strict.def.s)}`
          : strict.kind === "library"
            ? `${strict.ecosystem} ${strict.crate} ${strict.path} [${strict.symbol}]`
            : (strict.symbol ?? ""),
      verification: verification?.why ?? null,
    });
}

disagreements.sort((a, b) => (a.rank < b.rank ? -1 : 1));
const pct = (n) => Math.round((10000 * n) / total) / 100;
const cov = (g) => ({
  gainCheckout: g.checkout,
  gainLibrary: g.library,
  percent: pct(l2 + g.checkout + g.library),
  percentCheckoutOnly: pct(l2 + g.checkout),
  percentLibraryOnly: pct(l2 + g.library),
  gated: pct(l2 + g.gated),
  gatedLinks: l2 + g.gated,
  withoutTraitDeclarations: pct(l2 + g.checkout + g.library - g.traitDecl),
  gainTraitDeclaration: g.traitDecl,
  gainUnderNonTestCfg: g.underCfg,
  generatedNotCredited: g.generated,
});
const result = {
  pin: opt.name,
  scip: { documents: scip.documents.length, symbolsDefinedMoreThanOnce, checkoutCrates: [...checkoutCrates].sort(), procMacroPackages: [...procMacroPackages].sort() },
  links: total,
  level2: { links: l2, percent: pct(l2) },
  loose: cov(gain.loose),
  strict: cov(gain.strict),
  strictRemovedFromLooseGain: obj(strictRemoved),
  kindIncompatible: obj(kindIncompatible),
  strictFilterSamples: Object.fromEntries(filterSamples),
  rangeCheck,
  cross: obj(cross),
  agreement: obj(agreement),
  looseAnswerOnComparedLinks: obj(looseAgreement),
  libraryVerification: obj(verifyWhy),
  candidateSets: obj(candidateCheck),
  toolchainNoAnswer: obj(noAnswer),
  notIndexedLinksByDirectory: obj(notIndexedByDir),
  toolchainNoAnswerSamples: Object.fromEntries(noAnswerSamples),
  libraryIdentityShapes: obj(libraryIdentity),
  byKind: obj(byKind),
  gainSample: gains.slice(0, SAMPLES).map(({ rank, ...g }) => g),
  disagreementCount: disagreements.length,
  disagreementsByVerdict: obj(disagreements.reduce((m, d) => inc(m, d.verdict + " | " + d.kind) && m, new Map())),
  verdictSamples: Object.fromEntries(verdictSamples),
  // hand-check list: hard differences first, then unverified library
  // identities, then "same crate family and final name" only; fixed-seed order
  disagreementSample: [
    ...disagreements.filter((d) => d.verdict.startsWith("disagree") || d.verdict === "trait-method-vs-its-impl"),
    ...disagreements.filter((d) => d.verdict.startsWith("unverified")),
    ...disagreements.filter((d) => d.verdict.startsWith("heuristic")),
  ]
    .slice(0, SAMPLES)
    .map(({ rank, ...d }) => d),
  disagreementAll: disagreements.map(({ rank, ...d }) => d),
};
writeFileSync(opt.out, JSON.stringify(result, null, 1));
const { disagreementAll, byKind: _b, disagreementSample, verdictSamples: _v, toolchainNoAnswerSamples: _t, strictFilterSamples: _f, ...brief } = result;
console.log(JSON.stringify(brief, null, 1));
