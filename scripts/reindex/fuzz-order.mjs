// SPDX-License-Identifier: MIT
// C-36: a seeded, deterministic differential fuzzer for the Rust resolver's
// caches. It generates small workspaces from the shapes that meet lookup
// cuts and lazy caches: glob cycles, mutual `pub use`, globs shadowed by a
// textual macro, `#[macro_use] extern crate`, serde derive helpers through
// aliases, and cfg sibling modules (C-24's shape: cfg-alternative files of
// one module, glob-imported back by their parent and each importing from
// it). It also uses the review's method call through a three-module glob
// chain, with a varying number of other callers. For each workspace it
//
//   1. indexes it cold with the first decision loop in forward, reversed and
//      shuffled link order: the three stores must be identical;
//   2. applies seeded edits one at a time (comments, whitespace, body calls,
//      and surface edits), re-indexes incrementally and indexes the edited
//      tree cold, the two in different decision orders (rotating through
//      the pairs of forward, reversed and shuffled): the stores must be
//      identical row for row.
//
// The run is bounded by the edit count, never by time. Everything follows
// from the seed: the same seed gives the same workspaces, edits and orders.
//
//   node scripts/reindex/fuzz-order.mjs <dist> <seed> <edits> [out.json]
//
// The suite runs a short fixed-seed run (test/graph-rust-fuzz-order.test.mjs);
// docs/changes/C-36.md records the long runs.
import "../isolated-home.mjs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compareRows, storeRows } from "./dump.mjs";

/** A small seeded generator (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n) => Math.floor(next() * n);
  return {
    next,
    int,
    pick: (xs) => xs[int(xs.length)],
    chance: (p) => next() < p,
    shuffle: (xs) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

export const SHAPES = [
  "glob-cycle",
  "mutual-pub-use",
  "macro-shadowed-glob",
  "macro-use-extern-crate",
  "serde-helper-alias",
  "cfg-siblings",
  "glob-chain-method",
  // C-57: a #[macro_use] module whose file cfg_attr(path) alternatives
  // choose, each defining the same macro differently.
  "cfg-attr-path-macro",
];

/**
 * A workspace model: an `app` library with modules m0..m(n-1) and a `util`
 * library exporting textual macros. Rendering is a pure function of it.
 */
export function generate(r) {
  const n = 3 + r.int(4);
  const shapes = SHAPES.filter(() => r.chance(0.6));
  if (!shapes.length) shapes.push(r.pick(SHAPES));
  const modules = Array.from({ length: n }, (_, i) => ({
    name: `m${i}`,
    uses: [],
    macros: [],
    derives: [],
    fns: [{ name: `f${i}`, calls: [], pad: "" }],
    structs: [`S${i}`],
    lead: "",
    trail: "",
  }));
  const other = (i) => (i + 1 + r.int(n - 1)) % n;
  const model = {
    modules,
    shapes,
    macroUse: false,
    cfgSiblings: false,
    serdeAlias: false,
    utilMacros: ["um0"],
    next: n,
    // C-24: cfg-alternative files globbed back by the crate root.
    cfgVariant: false,
    // The review's glob chain: callers of `r.area()` through a prelude.
    chain: null,
    // C-57: leading comments of the two alternative files (they move the
    // macros' offsets, which must never decide between the files).
    choice: null,
  };
  for (const shape of shapes) {
    const a = r.int(n);
    const b = other(a);
    if (shape === "glob-cycle") {
      modules[a].uses.push(`pub use super::m${b}::*;`);
      modules[b].uses.push(`pub use super::m${a}::*;`);
    } else if (shape === "mutual-pub-use") {
      modules[a].uses.push(`pub use super::m${b}::X${b};`);
      modules[b].uses.push(`pub use super::m${a}::X${b};`);
      modules[a].uses.push(`pub use super::m${b}::S${b} as A${a};`);
    } else if (shape === "macro-shadowed-glob") {
      modules[a].uses.push(`use super::m${b}::*;`);
      modules[a].macros.push(`f${b}`);
      modules[a].fns[0].calls.push(`f${b}!()`, `f${b}()`);
    } else if (shape === "macro-use-extern-crate") {
      model.macroUse = true;
      modules[a].fns[0].calls.push("um0!()");
    } else if (shape === "serde-helper-alias") {
      model.serdeAlias = true;
      modules[a].uses.push(
        r.chance(0.5)
          ? "use serde::Deserialize as De;"
          : "use crate::sd::Deserialize as De;",
      );
      modules[a].derives.push(`W${a}`);
    } else if (shape === "cfg-siblings") {
      model.cfgSiblings = true;
      model.cfgVariant = r.chance(0.5);
      modules[a].fns[0].calls.push("crate::imp::run()");
    } else if (shape === "cfg-attr-path-macro") {
      model.choice = { leadA: "", leadB: "" };
    } else if (shape === "glob-chain-method") {
      model.chain = {
        others: r.int(8),
        widgetCall: true,
        widgetDoc: false,
        traitInScope: r.chance(0.2),
      };
    }
  }
  // Ordinary calls between modules, so other files read each one's facts.
  for (const m of modules)
    for (let k = r.int(3); k > 0; k--) {
      const j = r.int(n);
      m.fns[0].calls.push(
        r.pick([
          `crate::m${j}::f${j}()`,
          `super::m${j}::S${j}::new()`,
          `crate::m${j}::S${j}::new().get()`,
        ]),
      );
    }
  return model;
}

export function render(model) {
  const files = {
    "Cargo.toml": '[workspace]\nmembers = ["app", "util"]\nresolver = "2"\n',
    "util/Cargo.toml":
      '[package]\nname = "util"\nversion = "0.1.0"\nedition = "2021"\n',
    "util/src/lib.rs": model.utilMacros
      .map((m) => `#[macro_export]\nmacro_rules! ${m} {\n    () => {\n        0\n    };\n}\n`)
      .join("\n"),
    "app/Cargo.toml":
      '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nutil = { path = "../util" }\nserde = { version = "1", features = ["derive"] }\n\n[features]\na = []\nb = []\n',
  };
  let lib = "";
  if (model.macroUse) lib += "#[macro_use]\nextern crate util;\n\n";
  if (model.serdeAlias) lib += "pub use serde as sd;\n\n";
  for (const m of model.modules) lib += `pub mod ${m.name};\n`;
  if (model.cfgSiblings) {
    if (model.cfgVariant) {
      lib +=
        '\n#[cfg_attr(feature = "a", path = "imp_unix.rs")]\n#[cfg_attr(feature = "b", path = "imp_other.rs")]\nmod imp;\n\n#[allow(unused_imports)]\npub(crate) use imp::*;\n\npub struct Event;\npub struct Task;\n\npub fn use_it() {\n    configure();\n}\n';
      for (const [file, v] of [["imp_unix.rs", 0], ["imp_other.rs", 1]])
        files[`app/src/${file}`] =
          `use super::{Event, Task};\n\npub(crate) fn configure() {}\n\npub fn run() -> u32 {\n    ${v}\n}\n\nimpl Event {\n    fn reg_val(&self) -> u32 {\n        ${v}\n    }\n}\n\nfn f(_: Task) {}\n`;
    } else {
      lib +=
        '\n#[cfg(unix)]\n#[path = "imp_unix.rs"]\nmod imp;\n#[cfg(not(unix))]\n#[path = "imp_other.rs"]\nmod imp;\n';
      files["app/src/imp_unix.rs"] = "pub fn run() -> u32 {\n    1\n}\n";
      files["app/src/imp_other.rs"] =
        "pub fn run() -> u32 {\n    crate::m0::f0()\n}\n";
    }
  }
  if (model.chain) {
    const c = model.chain;
    const chain = ["prelude", "util", "shapes", "widget"];
    // A trait with the same method, imported into widget when in scope.
    if (c.traitInScope) chain.push("traits");
    files["app/src/prelude.rs"] = "pub use crate::shapes::*;\n";
    files["app/src/util.rs"] = "pub fn helper() -> u32 {\n    1\n}\n";
    files["app/src/shapes.rs"] =
      "use crate::util::*;\n\npub struct Rect {\n    pub w: u32,\n}\n\nimpl Rect {\n    pub fn area(&self) -> u32 {\n        self.w * helper()\n    }\n}\n";
    // The trait lives outside the glob chain: in scope only where imported.
    if (c.traitInScope)
      files["app/src/traits.rs"] =
      "use crate::shapes::Rect;\n\npub trait Area {\n    fn area(&self) -> u32;\n}\n\nimpl Area for Rect {\n    fn area(&self) -> u32 {\n        0\n    }\n}\n";
    files["app/src/widget.rs"] =
      "use crate::prelude::*;\n" +
      (c.traitInScope ? "use crate::traits::Area;\n" : "") +
      `\n${c.widgetDoc ? "/// Draws.\n" : ""}pub fn draw(r: Rect) -> u32 {\n    ${c.widgetCall ? "r.area()" : "0"}\n}\n`;
    for (let i = 0; i < c.others; i++) {
      files[`app/src/other${i}.rs`] =
        `use crate::prelude::*;\n\npub fn make${i}() -> Rect {\n    Rect { w: ${i} }\n}\n\n#[cfg(test)]\nmod tests {\n    use super::*;\n\n    fn check(r: Rect) -> u32 {\n        r.area()\n    }\n}\n`;
      chain.push(`other${i}`);
    }
    for (const m of chain) lib += `pub mod ${m};\n`;
  }
  if (model.choice) {
    lib +=
      '\n#[macro_use]\n#[cfg_attr(feature = "a", path = "choice_a.rs")]\n#[cfg_attr(not(feature = "a"), path = "choice_b.rs")]\nmod choice;\n\npub struct ChoiceT;\npub trait ChoiceMarker {\n    fn mark();\n}\npick!(ChoiceT);\n\npub fn choice_check(_: Option<()>) -> usize {\n    std::mem::size_of::<Option<()>>()\n}\n';
    files["app/src/choice_a.rs"] =
      model.choice.leadA +
      "macro_rules! pick {\n    ($ty:ident) => {\n        pub struct Option<T>(T);\n    };\n}\n";
    files["app/src/choice_b.rs"] =
      model.choice.leadB +
      "macro_rules! pick {\n    ($ty:ident) => {\n        impl ChoiceMarker for $ty {\n            fn mark() {}\n        }\n    };\n}\n";
  }
  files["app/src/lib.rs"] = lib;
  for (const m of model.modules) {
    let text = m.lead;
    for (const u of m.uses) text += u + "\n";
    if (m.uses.length) text += "\n";
    for (const mac of m.macros)
      text += `macro_rules! ${mac} {\n    () => {\n        0\n    };\n}\n\n`;
    for (const s of m.structs)
      text += `pub struct ${s};\n\nimpl ${s} {\n    pub fn new() -> Self {\n        ${s}\n    }\n    pub fn get(&self) -> u32 {\n        0\n    }\n}\n\n`;
    for (const w of m.derives)
      text += `#[derive(De)]\npub struct ${w} {\n    #[serde(default)]\n    pub x: u32,\n}\n\n`;
    for (const f of m.fns) {
      text += `pub fn ${f.name}() -> u32 {\n${f.pad}`;
      for (const c of f.calls) text += `    let _ = ${c};\n`;
      text += "    0\n}\n\n";
    }
    text += m.trail;
    files[`app/src/${m.name}.rs`] = text;
  }
  return files;
}

/** One seeded edit of the model; returns its kind. */
export function edit(model, r) {
  const m = r.pick(model.modules);
  const n = model.modules.length;
  const kinds = [
    "leading-comment",
    "trailing-comment",
    "whitespace",
    "body-call",
    "body-call",
    "remove-call",
    "add-glob",
    "remove-use",
    "add-fn",
    "rename-fn",
    "add-macro",
    "remove-macro",
    "add-util-macro",
    "toggle-macro-use",
    ...(model.chain
      ? ["chain-doc", "chain-doc", "chain-call", "chain-other", "chain-trait"]
      : []),
    ...(model.cfgSiblings ? ["cfg-variant"] : []),
    ...(model.choice ? ["choice-lead-a", "choice-lead-b"] : []),
  ];
  const kind = r.pick(kinds);
  const j = r.int(n);
  switch (kind) {
    case "leading-comment":
      m.lead = m.lead ? "" : "// moved\n";
      break;
    case "trailing-comment":
      m.trail = m.trail ? "" : "// trailing\n";
      break;
    case "whitespace": {
      const f = r.pick(m.fns);
      f.pad = f.pad ? "" : "\n";
      break;
    }
    case "body-call":
      r.pick(m.fns).calls.push(
        r.pick([
          `crate::m${j}::f${j}()`,
          `super::m${j}::S${j}::new()`,
          `f${j}()`,
          `S${j}::new().get()`,
          `um0!()`,
          `crate::imp::run()`,
          `A${j}::new()`,
        ]),
      );
      break;
    case "remove-call": {
      const f = r.pick(m.fns);
      if (f.calls.length) f.calls.splice(r.int(f.calls.length), 1);
      break;
    }
    case "add-glob":
      m.uses.push(
        r.pick([`pub use super::m${j}::*;`, `use crate::m${j}::*;`]),
      );
      break;
    case "remove-use":
      if (m.uses.length) m.uses.splice(r.int(m.uses.length), 1);
      break;
    case "add-fn":
      m.fns.push({ name: `g${model.next++}`, calls: [`f${j}()`], pad: "" });
      break;
    case "rename-fn": {
      const f = r.pick(m.fns);
      f.name = f.name.startsWith("f") ? `h${f.name.slice(1)}` : `f${f.name.slice(1)}`;
      break;
    }
    case "add-macro":
      m.macros.push(`f${j}`);
      break;
    case "remove-macro":
      if (m.macros.length) m.macros.splice(r.int(m.macros.length), 1);
      break;
    case "add-util-macro":
      if (model.utilMacros.length < 3)
        model.utilMacros.push(`um${model.utilMacros.length}`);
      break;
    case "toggle-macro-use":
      model.macroUse = !model.macroUse;
      break;
    case "chain-doc":
      model.chain.widgetDoc = !model.chain.widgetDoc;
      break;
    case "chain-call":
      model.chain.widgetCall = !model.chain.widgetCall;
      break;
    case "chain-other":
      model.chain.others = (model.chain.others + 1 + r.int(4)) % 8;
      break;
    case "chain-trait":
      model.chain.traitInScope = !model.chain.traitInScope;
      break;
    case "cfg-variant":
      model.cfgVariant = !model.cfgVariant;
      break;
    // C-57: a comment long enough to move one file's macro past the
    // other's offset, or back.
    case "choice-lead-a":
      model.choice.leadA = model.choice.leadA
        ? ""
        : `// ${"moved ".repeat(20 + r.int(40))}\n`;
      break;
    case "choice-lead-b":
      model.choice.leadB = model.choice.leadB
        ? ""
        : `// ${"moved ".repeat(20 + r.int(40))}\n`;
      break;
  }
  return kind;
}

const ORDERS = ["forward", "reversed", "shuffled"];
/** Pairs (incremental, cold) of distinct orders, then equal ones. */
const PAIRS = [
  ["reversed", "forward"],
  ["shuffled", "forward"],
  ["forward", "reversed"],
  ["shuffled", "reversed"],
  ["forward", "shuffled"],
  ["reversed", "shuffled"],
];

/**
 * Runs `edits` seeded edits over generated workspaces of `editsPerCase`
 * edits each. Returns counts and the mismatches (each with its seed, case,
 * step, edit and first row differences).
 */
export async function fuzz({
  dist,
  seed,
  edits,
  editsPerCase = 20,
  base: baseArg,
}) {
  const url = (path) => pathToFileURL(resolve(dist, path)).href;
  const { discoverLanguages, indexProject, SqliteGraphStore } = await import(
    url("graph/index.js")
  );
  // A build without the hook (before C-36 round 4) is still compared,
  // incremental against cold, in forward order only (permutedLoops stays 0).
  const rustDecisionOrder =
    (await import(url("graph/languages/rust/resolve.js"))).rustDecisionOrder ??
    {};
  const { graphWork, resetGraphWork } = await import(url("graph/work.js"));
  const registry = await discoverLanguages();
  const r = rng(seed);
  const base = mkdtempSync(join(baseArg ?? tmpdir(), "c36-fuzz-"));
  const counts = {
    seed,
    edits: 0,
    cases: 0,
    coldOrderChecks: 0,
    comparisons: 0,
    scopedEdits: 0,
    cutEdits: 0,
    kinds: {},
    shapes: Object.fromEntries(SHAPES.map((s) => [s, 0])),
    orders: Object.fromEntries(ORDERS.map((o) => [o, 0])),
    // Decision loops the order hook permuted (0 would mean it never ran).
    permutedLoops: 0,
  };
  const mismatches = [];
  const setOrder = (order) => {
    counts.orders[order]++;
    const permute =
      order === "forward"
        ? undefined
        : order === "reversed"
          ? (count) => Array.from({ length: count }, (_, i) => count - 1 - i)
          : (count) => r.shuffle(Array.from({ length: count }, (_, i) => i));
    rustDecisionOrder.permute = permute && ((count) => {
      counts.permutedLoops++;
      return permute(count);
    });
  };
  const index = async (root, store, order) => {
    setOrder(order);
    try {
      resetGraphWork();
      await indexProject(root, registry, store, {
        excludeDirectories: [".pymtheg"],
      });
      return { ...graphWork.counts };
    } finally {
      rustDecisionOrder.permute = undefined;
    }
  };
  const coldRows = async (root, projectId, order, name) => {
    const path = join(base, `${name}.sqlite`);
    const store = new SqliteGraphStore(path, projectId);
    try {
      await index(root, store, order);
    } finally {
      store.close();
    }
    const rows = storeRows(path);
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(path + suffix, { force: true });
    return rows;
  };
  try {
    for (let c = 0; counts.edits < edits; c++) {
      counts.cases++;
      const model = generate(r);
      for (const s of model.shapes) counts.shapes[s]++;
      const root = join(base, `case-${c}`);
      let written = {};
      const sync = () => {
        const files = render(model);
        for (const [path, text] of Object.entries(files))
          if (written[path] !== text) {
            mkdirSync(dirname(join(root, path)), { recursive: true });
            writeFileSync(join(root, path), text);
          }
        for (const path of Object.keys(written))
          if (!(path in files)) rmSync(join(root, path), { force: true });
        written = files;
      };
      sync();
      const incrementalPath = join(base, `case-${c}.sqlite`);
      const incremental = new SqliteGraphStore(incrementalPath);
      try {
        await index(root, incremental, "forward");
        const forward = storeRows(incrementalPath);
        for (const order of ["reversed", "shuffled"]) {
          counts.coldOrderChecks++;
          const other = await coldRows(
            root,
            incremental.projectId,
            order,
            `case-${c}-cold-${order}`,
          );
          const diff = compareRows(forward, other);
          if (diff.length)
            mismatches.push({ seed, case: c, step: 0, edit: `cold ${order}`, diff });
        }
        for (let step = 1; step <= editsPerCase && counts.edits < edits; step++) {
          const kind = edit(model, r);
          counts.edits++;
          counts.kinds[kind] = (counts.kinds[kind] ?? 0) + 1;
          sync();
          const [incOrder, coldOrder] = PAIRS[(counts.edits - 1) % PAIRS.length];
          const work = await index(root, incremental, incOrder);
          if (work["analyze.rust.scopedFiles"]) counts.scopedEdits++;
          if (work["analyze.rust.lookupCuts"]) counts.cutEdits++;
          const cold = await coldRows(
            root,
            incremental.projectId,
            coldOrder,
            `case-${c}-cold`,
          );
          counts.comparisons++;
          const diff = compareRows(storeRows(incrementalPath), cold);
          if (diff.length)
            mismatches.push({
              seed,
              case: c,
              step,
              edit: kind,
              orders: [incOrder, coldOrder],
              diff,
            });
        }
      } finally {
        incremental.close();
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
  return { counts, mismatches };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [dist, seedArg, editsArg, out] = process.argv.slice(2);
  if (!dist || !seedArg || !editsArg)
    throw Error("usage: fuzz-order.mjs <dist> <seed> <edits> [out.json]");
  const result = await fuzz({
    dist,
    seed: Number(seedArg),
    edits: Number(editsArg),
    base: process.env.PYM_SCRATCH,
  });
  const text = JSON.stringify(result, null, 1) + "\n";
  if (out) writeFileSync(out, text);
  process.stdout.write(
    JSON.stringify({ counts: result.counts, mismatches: result.mismatches.length }) + "\n",
  );
  if (result.mismatches.length) process.exitCode = 1;
}
