// SPDX-License-Identifier: MIT
// Replay the main resolver on the captured graph facts. Raw rows include
// pinned source excerpts and belong in PYM_SCRATCH on disk.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";

const root = process.env.PYM_SCRATCH;
const compiled = join(root, "main-build/dist/graph/languages/rust");
const path = join(compiled, "resolve.js");
const instrumented = join(compiled, "diagnose-final.js");
function patch(source, needle, replacement) {
  if (source.split(needle).length !== 2) throw new Error(needle);
  return source.replace(needle, replacement);
}
let code = readFileSync(path, "utf8");
code = patch(
  code,
  "function checkoutFound(l, d) {",
  "function checkoutFound(l, d) { globalThis.c31.site(l);",
);
code = patch(
  code,
  "const site = { file: l.file, scope: str(d.scope) };",
  "const site = { file: l.file, scope: str(d.scope) }; globalThis.c31.place(loc, site.scope);",
);
code = patch(
  code,
  "else\n            typeName = ex.text;",
  "else\n            typeName = ex.text;\n        globalThis.c31.owner({name, instance, typeName, type, loc: ex.loc, scope: ex.scope, borrow, sameImpl, externalShape: ex.externalShape, unknown: ex.unknown});",
);
code = patch(
  code,
  "const proven = inherent.filter(",
  "globalThis.c31.matches(name, instance, matches, inherent);\n        const proven = inherent.filter(",
);
code = patch(
  code,
  "    return resolutions;",
  `    globalThis.c31.finish(({text, loc, scope, kind}) =>
      libraryAt({kind, targetName:text}, {}, loc, scope));
    return resolutions;`,
);
code = patch(
  code,
  "if (checkoutTraitMethodNames.has(name))\n            return false;",
  "if (checkoutTraitMethodNames.has(name)) { globalThis.c31.traitBlocking(name, form, scopedMembers); return false; }",
);
writeFileSync(instrumented, code);
const { resolveRust } = await import(instrumented);
const reasons = new Set([
  "receiver-type-unverified",
  "path-type-unverified",
  "inherent-applicability-unverified",
  "later-probe-step",
]);
const primitive =
  /^(?:u(?:8|16|32|64|128|size)|i(?:8|16|32|64|128|size)|f(?:32|64)|bool|char|str)$/;
const compact = (x) => x.replace(/\s+/g, "");
const base = (x) => x.split("<")[0];
const read = (db, sql) =>
  db
    .prepare(sql)
    .all()
    .map(({ body }) => JSON.parse(body));
const hash = (x) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
const chosen = new Set(process.argv.slice(2));
const main = JSON.parse(readFileSync(join(root, "main.json")));
const allCounts = {};
for (const pin of main.repos) {
  if (
    pin.outcome !== "finished" ||
    (chosen.size && !chosen.has(pin.id.split("/")[1]))
  )
    continue;
  const db = new DatabaseSync(
    join(
      root,
      "main",
      pin.attempt,
      "checkout/.pymtheg/rebuildable/graph.sqlite",
    ),
    { readOnly: true },
  );
  const projectId =
    db.prepare("SELECT value FROM graph_meta WHERE key='project'").get()
      ?.value ?? "";
  const files = read(
    db,
    "SELECT body FROM graph_files WHERE json_extract(body,'$.module') = 'rust' ORDER BY path",
  );
  const contextFiles = read(
    db,
    "SELECT body FROM graph_contexts ORDER BY path",
  );
  const symbols = read(
    db,
    "SELECT body FROM graph_symbols WHERE json_extract(body,'$.module') = 'rust' ORDER BY file,id",
  );
  const definiteLibrary = new Set(
    db
      .prepare(
        "SELECT link FROM graph_library_targets WHERE role='target' AND symbol IS NOT NULL",
      )
      .all()
      .map((r) => r.link),
  );
  const links = [];
  const selected = new Map();
  for (const row of db
    .prepare(
      "SELECT id,body,resolution,target FROM graph_links WHERE module='rust' ORDER BY file,id",
    )
    .iterate()) {
    const l = JSON.parse(row.body);
    links.push(l);
    const all = (l.data?.uncertainty ?? l.data?.reason ?? "").split(/;\s*/);
    const found = all.filter((r) => reasons.has(r));
    if (!row.target && !definiteLibrary.has(row.id) && found.length)
      selected.set(row.id, { l, all, found, traces: [] });
  }
  db.close();
  let active;
  let traitForms;
  const probeCache = new Map();
  let probe;
  globalThis.c31 = {
    site(l) {
      active = selected.get(l.id);
    },
    place(loc, scope) {
      if (active) (active.places ??= []).push({ loc, scope });
    },
    owner(owner) {
      if (!active) return;
      const d = active.l.data ?? {};
      if (
        d.method ? d.method === owner.name && owner.instance : !owner.instance
      )
        active.traces.push({ ...owner, matches: [], inherent: [] });
    },
    traitBlocking(name, form, scopedMembers) {
      if (!active || active.l.data?.method !== name) return;
      traitForms ??= Map.groupBy(
        symbols.filter((s) => s.kind === "trait").flatMap(scopedMembers),
        (m) => m.name,
      );
      const forms = (traitForms.get(name) ?? []).map(
        (m) => m.data?.receiverKind,
      );
      if (
        forms.length &&
        forms.every(
          (f) =>
            f === "none" ||
            f === "&mut self" ||
            (form === "shared" && f === "&self"),
        )
      )
        (active.lateTraits ??= new Set()).add(name);
    },
    matches(name, instance, matches, inherent) {
      const last = active?.traces.at(-1);
      if (last?.name === name && last.instance === instance) {
        last.matches = matches;
        last.inherent = inherent;
      }
    },
    finish(callback) {
      probe = callback;
    },
  };
  resolveRust({ projectId, symbols, links, contextFiles, files }, () => {});
  // Lookup in the same snapshot, with normal shadowing and placement rules.
  // This establishes a receiver or callee path, never the method's declaring owner.
  const library = (text, trace, kind = "types", scope = trace.scope) => {
    if (!text) return;
    const { loc } = trace;
    const key = JSON.stringify([
      kind,
      text,
      loc.crate.root,
      loc.file,
      loc.local,
      scope,
      loc.conditions,
    ]);
    if (!probeCache.has(key))
      probeCache.set(key, probe({ text, loc, scope, kind }));
    return probeCache.get(key);
  };
  const fileMap = new Map(
    files.map((f) => {
      const starts = [0];
      for (let i = 0; i < f.text.length; i++)
        if (f.text[i] === "\n") starts.push(i + 1);
      return [f.path, { text: f.text, starts }];
    }),
  );
  function lineAt(starts, offset) {
    let lo = 0,
      hi = starts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid;
    }
    return lo;
  }
  const pinName = pin.id.split("/")[1];
  const output = createWriteStream(
    join(root, "diagnosis-" + pinName + ".jsonl"),
  );
  const counts = {
    total: 0,
    primary: 0,
    reasons: {},
    cross: {},
    detail: {},
    large: {},
  };
  const samples = new Map();
  const tally = (object, key) => (object[key] = (object[key] ?? 0) + 1);
  for (const {
    l,
    all,
    found,
    traces,
    places = [],
    lateTraits,
  } of selected.values()) {
    const d = l.data ?? {};
    const note = d.receiverTyping ?? {};
    const r = d.receiverExpr;
    const { text, starts } = fileMap.get(l.file);
    const at = lineAt(starts, l.range.start);
    const source = text.slice(l.range.start, l.range.end);
    const excerpt = text
      .slice(starts[at], starts[at + 1] ?? text.length)
      .trim();
    const head = (value) =>
      base(compact((value ?? "").replace(/^&\s*(?:'\w+\s*)?(?:mut\s+)?/, "")));
    const receiver =
      d.receiverType || note.outside || traces.at(-1)?.typeName || "";
    const type = head(receiver);
    const generic =
      !!type && (d.genericBindings ?? r?.g ?? "").split(",").includes(type);
    const gap = note.gap || d.receiverGap || "";
    let category;
    if (!d.method) category = "associated path";
    else if (compact(source) === "self." + d.method || gap === "self-type")
      category = "self in impl or trait";
    else if (
      generic ||
      gap === "generic-return" ||
      gap === "generic-field" ||
      gap === "associated-type"
    )
      category = "generic or associated type";
    else if (
      /^(?:dyn|impl)\b/.test(receiver) ||
      /^(?:impl-trait|trait-object|trait-self)$/.test(gap)
    )
      category = "impl Trait, dyn Trait or trait Self";
    else if (d.receiverStructLiteral || r?.lit || r?.k === "u")
      category = "struct literal or unit value";
    else if (d.receiverType || r?.k === "type")
      category = "written receiver type";
    else if (r?.k === "p") category = "call result";
    else if (r?.k === "m") category = "method chain";
    else if (r?.k === "f") category = "field";
    else if (["ref", "try", "await", "deref"].includes(r?.k))
      category = "borrow, deref, try or await";
    else if (gap === "literal")
      category = /^(?:r#*"|")/.test(source.trim())
        ? "string literal"
        : "literal or aggregate";
    else if (gap === "macro") category = "macro result or expansion";
    else if (
      [
        "pattern-binding",
        "destructured",
        "iterator-item",
        "closure-parameter",
      ].includes(gap)
    )
      category = gap;
    else category = gap || "no receiver recipe";
    const owners = new Set(),
      methods = new Map(),
      targetKinds = new Set();
    const producer = new Set();
    for (const tr of traces) {
      for (const symbol of tr.type.symbols) owners.add(symbol.name);
      for (const m of tr.matches) {
        methods.set(m.symbol.id, {
          file: m.symbol.file,
          range: m.symbol.range,
          kind: m.inherent ? "inherent" : "trait implementation",
          name: m.symbol.name,
          receiver: m.symbol.data?.receiverKind,
          implType: m.implType,
        });
      }
      if (tr.inherent.length) targetKinds.add("checkout inherent candidate");
      if (tr.matches.some((m) => !m.inherent))
        targetKinds.add("checkout trait impl candidate");
      if (tr.type.symbols.some((s) => s.kind === "trait"))
        targetKinds.add("checkout trait owner");
      if (tr.type.symbols.length && !tr.matches.length)
        targetKinds.add("checkout receiver only");
      const label = (t) => t.unit + (t.symbol ? "::" + t.symbol : "");
      if (!tr.type.symbols.length && !tr.unknown && !generic) {
        const h = head(tr.typeName);
        const lib = library(h, tr);
        if (lib) {
          owners.add(label(lib));
          targetKinds.add(
            lib.ecosystem === "rust-std"
              ? "standard receiver only"
              : "third-party receiver only",
          );
        } else if (
          primitive.test(h) &&
          tr.type.complete &&
          !tr.type.bound &&
          !tr.type.possibleImportNames?.length
        ) {
          owners.add(h);
          targetKinds.add("primitive receiver only");
        }
      }
    }
    let seed = r;
    while (seed?.e) seed = seed.e;
    if (seed?.k === "p" && gap === "callee-unresolved")
      for (const place of places) {
        const p = seed.p;
        const end = p.lastIndexOf("::");
        const libraryPath =
          end >= 0 && library(p.slice(0, end), place, "types", seed.s);
        const lib = libraryPath || library(p, place, "calls", seed.s);
        if (lib) producer.add(lib.unit + (lib.symbol ? "::" + lib.symbol : ""));
      }
    if (category === "string literal") {
      targetKinds.add("primitive receiver only");
      owners.add("&str");
    }
    if (category === "call result") {
      if (producer.size)
        category = [...producer].every((x) => /^(?:std|core|alloc)::/.test(x))
          ? "std call result"
          : "third-party call result";
      else if (gap === "callee-unresolved") category = "unresolved call result";
      else if (gap === "callee-kind") category = "untyped callee kind";
      else if (
        !gap &&
        /(?:^|::)(?:new|default|with_capacity)$/.test(r?.p ?? "")
      )
        category = "constructor-shaped checkout call result";
      else if (!gap) category = "written checkout call result";
    }
    const target =
      [...targetKinds].sort().join(" + ") || "method owner unknown";
    const cross = category + " | " + target;
    const key = hash([
      "c31-diagnosis-v1",
      pin.id,
      pin.commit,
      l.file,
      l.range,
      l.targetName,
    ]);
    const row = {
      id: pin.id,
      commit: pin.commit,
      file: l.file,
      line: at + 1,
      column: l.range.start - starts[at] + 1,
      range: l.range,
      spelling: l.targetName,
      source,
      excerpt,
      reason: all[0],
      reasons: found,
      receiver: receiver || undefined,
      gap: gap || undefined,
      recipe: r,
      owners: [...owners].sort(),
      producer: [...producer].sort(),
      methods: [...methods.values()],
      lateTraits: lateTraits?.size || undefined,
      category,
      target,
      key,
      conditions: d.conditions,
      details: {
        borrow: d.receiverBorrow,
        typeScope: d.typeScope,
        method: d.method,
        args: d.argumentCount,
        trace: traces.map((t) => [
          t.typeName,
          t.type.reason,
          t.type.complete,
          t.borrow,
          !!t.sameImpl,
        ]),
        macroArgument: !!d.macroArguments,
        derived: l.origin === "analysis",
      },
    };
    if (!output.write(JSON.stringify(row) + "\n")) await once(output, "drain");
    counts.total++;
    if (lateTraits?.size)
      (counts.lateTraitNames ??= {})[d.method] =
        ((counts.lateTraitNames ??= {})[d.method] ?? 0) + 1;
    if (reasons.has(all[0])) counts.primary++;
    for (const r of found) tally(counts.reasons, r);
    tally(counts.cross, cross);
    tally(counts.detail, [cross, gap, d.method ?? "", ...owners].join(" | "));
    const sample = samples.get(cross) ?? [];
    sample.push(row);
    sample.sort((a, b) => a.key.localeCompare(b.key));
    if (sample.length > 10) sample.pop();
    samples.set(cross, sample);
  }
  output.end();
  await once(output, "finish");
  writeFileSync(
    join(root, "diagnosis-" + pinName + "-counts.json"),
    JSON.stringify({ id: pin.id, commit: pin.commit, ...counts }, null, 2),
  );
  writeFileSync(
    join(root, "diagnosis-" + pinName + "-sample.json"),
    JSON.stringify(Object.fromEntries(samples)),
  );
  allCounts[pin.id] = {
    total: counts.total,
    primary: counts.primary,
    cross: counts.cross,
  };
  console.log(pin.id, counts.total, counts.primary);
}
console.log(Object.keys(allCounts).length + " pins exported");
