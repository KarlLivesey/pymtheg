// SPDX-License-Identifier: MIT
// Replay the stored Rust facts using main's scope audit. The copy of the
// compiled resolver records the namespace and the location of each read.
import { createHash } from "node:crypto";
import { createWriteStream, readFileSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const scratch = process.env.PYM_SCRATCH;
const build = join(scratch, "main-build/dist/graph");
const compiled = join(build, "languages/rust");
const instrumented = join(compiled, "c34-diagnose.js");
let code =
  'import { addedLinkId as c34LinkId } from "../../identity.js";\n' +
  readFileSync(join(compiled, "resolve.js"), "utf8");
function patch(needle, replacement) {
  if (code.split(needle).length !== 2) throw Error("Audit anchor: " + needle);
  code = code.replace(needle, replacement);
}
patch(
  "function scopeOpaque(key, name, library, allowAssumption) {",
  'function scopeOpaque(key, name, library, allowAssumption, ns = "unclassified") {',
);
patch(
  '${libraryAttributeStart ?? ""}:${name}`',
  '${libraryAttributeStart ?? ""}:${ns}:${name}`',
);
patch(
  "                    allowAssumption,\n                    attributeStart: libraryAttributeStart,",
  "                    allowAssumption, ns,\n                    attributeStart: libraryAttributeStart,",
);
patch(
  "scopeOpaque(scopeKey, name, true, !uses?.globs.length)",
  "scopeOpaque(scopeKey, name, true, !uses?.globs.length, headNs)",
);
patch(
  "scopeOpaque(scopeKey, name, false, !uses?.globs.length)",
  "scopeOpaque(scopeKey, name, false, !uses?.globs.length, headNs)",
);
patch(
  "scopeOpaque(`${loc.crate.root}|${q}`, name, true, true)",
  "scopeOpaque(`${loc.crate.root}|${q}`, name, true, true, headNs)",
);
patch(
  "libraryOpaque(`${loc.crate.root}|${qualified(loc, local)}`)",
  'scopeOpaque(`${loc.crate.root}|${qualified(loc, local)}`, head, true, false, "associated extension guard")',
);
patch(
  "    const auditedSites = [];",
  "    const auditedSites = [];\n    const c34Definitions = new WeakMap();\n    const c34DiagnosticReads = new Map();",
);
patch(
  "    if (derived)\n        macroBodyCalls(derived);",
  `
    const c34Derived = [];
    if (derived) macroBodyCalls(derived);`,
);
patch(
  "const found = bodyCall(path, call.argumentCount, at, from);",
  `
                    const capturedBody = lookupReads(() => bodyCall(path, call.argumentCount, at, from));
                    const found = capturedBody.result;`,
);
patch(
  "                    if (found.failedFiles?.length) {\n                        emit({",
  `
                    const id = c34LinkId(ctx.projectId, "rust", base.file, base.key);
                    const link = { ...base, id, data: facts, origin: "analysis" };
                    if (scopeAudit?.includes(link))
                      c34Derived.push({ link, reads: auditReads(capturedBody.trace) });
                    if (found.failedFiles?.length) {
                        emit({`,
);
patch(
  "        for (const { link, reads } of auditedSites)\n            scopeAudit.blocked(link, auditScopeBlockers(reads));",
  "",
);
patch(
  "                library = eligible ? libraryFor(link, facts) : undefined;",
  `
                if (eligible && scopeAudit?.includes(link)) {
                  const captured = lookupReads(() => libraryFor(link, facts));
                  library = captured.result;
                  c34DiagnosticReads.set(link.id, auditReads(captured.trace));
                } else library = eligible ? libraryFor(link, facts) : undefined;`,
);
patch(
  "    return resolutions;\n    function missingReason",
  `
    for (const { link, reads: checkoutReads } of [...auditedSites, ...c34Derived]) {
      const reads = c34DiagnosticReads.get(link.id) ?? checkoutReads;
      scopeAudit.blocked(link, auditScopeBlockers(reads));
    }
    return resolutions;
    function missingReason`,
);
patch(
  "scopeAudit.blocked(link, auditScopeBlockers(reads));",
  `
            scopeAudit.blocked(link, reads.flatMap(read => {
              const { key, name, library, allowAssumption, attributeStart, ns } = read;
              const hard = hardOpaqueScopes.has(key);
              const origins = opaqueOrigins.get(key) ?? [];
              if (!origins.length) return [{ ns, name, kind: "unrecorded layout or helper", relation: "unknown" }];
              const placements = ownerPlace(link.file, str(data(link).scope));
              const relation = origin => {
                const paths = placements.filter(p => p.crate.root === origin.loc.crate.root)
                  .map(p => qualified(p, str(data(link).scope)));
                const q = key.slice(key.indexOf("|") + 1);
                return paths.includes(q) ? "same scope"
                  : paths.some(path => !q || path.startsWith(q + "::")) ? "enclosing scope"
                  : "scope read along a path";
              };
              return origins.flatMap(origin => {
                const effect = scopeEffects.get(origin);
                if (library && origin.attribute && origin.start === attributeStart) return [];
                const boundedAway = ns !== "associated extension guard" && !hard && effect &&
                  (!effect.assumed || allowAssumption) && !macroEffectNames(effect, name.normalize());
                const position = origin.attribute ? "attribute"
                  : origin.block ? "block statement" : "module item";
                if (!c34Definitions.has(origin)) {
                  const site = origin.attribute ? undefined : macroSites.get(origin.loc.file + "|" + origin.start);
                  c34Definitions.set(origin, site && definiteMacro(origin.name, site, siteLoc(site, origin.loc), origin.scope));
                }
                const definition = c34Definitions.get(origin);
                return describeScopeOrigin(origin).map(blocker => ({
                  ns, searched: name, position, relation: relation(origin), boundedAway: !!boundedAway,
                  ...blocker,
                  ...(definition && { definition }),
                  ...(effect && { finite: true, assumed: !!effect.assumed, couldBind: macroEffectNames(effect, name.normalize()) }),
                  ...(hard && { hard: true }),
                }));
              });
            }));`,
);
writeFileSync(instrumented, code);
const { resolveRust } = await import(instrumented);
const { SqliteGraphStore } = await import(join(build, "store.js"));
const { default: rust } = await import(join(compiled, "index.js"));
const { matchesPattern } = await import(join(build, "registry.js"));
const { fileFacts } = await import(join(build, "identity.js"));
const { attributeRules } = await import(join(compiled, "parse.js"));
const wanted = new Set(process.argv.slice(2));
const pins = JSON.parse(readFileSync(join(scratch, "main.json"), "utf8")).repos;
const opaque = "opaque-item-may-shadow-name";
const builtInDerives = new Set([
  "Debug",
  "Clone",
  "Copy",
  "PartialEq",
  "Eq",
  "PartialOrd",
  "Ord",
  "Hash",
  "Default",
]);
const tally = (counts, key) => (counts[key] = (counts[key] ?? 0) + 1);
const key = (v) => JSON.stringify(v);
const splitReasons = (l) => [
  ...new Set(
    (l.data?.uncertainty ?? l.data?.reason ?? "").split(/;\s*/).filter(Boolean),
  ),
];

for (const pin of pins) {
  const name = pin.id.split("/")[1];
  if (pin.outcome !== "finished" || (wanted.size && !wanted.has(name)))
    continue;
  const path = join(
    scratch,
    "main",
    pin.attempt,
    "checkout/.pymtheg/rebuildable/graph.sqlite",
  );
  const store = new SqliteGraphStore(path, undefined, { readOnly: true });
  const db = new DatabaseSync(path, { readOnly: true });
  const selected = new Map();
  const macros = new Map();
  for (const row of db
    .prepare(
      `SELECT l.id,l.body,t.unit,t.ecosystem,t.symbol FROM graph_links l
    LEFT JOIN graph_library_targets t ON t.link=l.id AND t.role='target'
    WHERE l.module='rust' AND (l.kind='macros'
      OR json_extract(l.body, '$.data.uncertainty') LIKE '%opaque-item-may-shadow-name%'
      OR json_extract(l.body, '$.data.reason') LIKE '%opaque-item-may-shadow-name%')`,
    )
    .iterate()) {
    const l = JSON.parse(row.body);
    if (l.kind === "macros") {
      const start = l.data?.libraryAttributeStart ?? l.range.start;
      macros.set(key([l.file, start, l.targetName]), row);
    }
    const reasons = splitReasons(l);
    if (reasons.includes(opaque)) selected.set(row.id, { l, reasons });
  }
  db.close();
  const files = store.filesAt(
    store
      .fileSummaries()
      .filter((f) => f.module === "rust")
      .map((f) => f.path),
  );
  const fileByPath = new Map(files.map((f) => [f.path, f.text]));
  const sourceLine = new Map();
  function location(file, start) {
    let starts = sourceLine.get(file);
    if (!starts) {
      const text = fileByPath.get(file) ?? "";
      starts = [0];
      for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1))
        starts.push(i + 1);
      sourceLine.set(file, starts);
    }
    let low = 0,
      high = starts.length;
    while (high - low > 1) {
      const i = (low + high) >>> 1;
      if (starts[i] <= start) low = i;
      else high = i;
    }
    return [low + 1, start - starts[low] + 1];
  }
  const visited = new Map();
  const facts = files.map((file) => {
    const metadata = file.result.data ?? {};
    const initial = (item) => ({
      ...item,
      data: {
        ...item.data,
        conditions: metadata.hasSourceConditions
          ? [
              ...new Set(
                metadata.attributeContexts[Number(item.data?.attributeContext)]
                  ?.sourceConditions ?? [],
              ),
            ]
          : (item.data?.conditions ?? []),
      },
    });
    return fileFacts(store.projectId, {
      ...file,
      result: {
        ...file.result,
        links: file.result.links.map(initial),
        symbols: file.result.symbols.map(initial),
      },
    });
  });
  resolveRust(
    {
      projectId: store.projectId,
      files: files.map(
        ({ path, module, result: { status, diagnostics, data } }) => ({
          path,
          module,
          result: { status, diagnostics, data },
        }),
      ),
      contextFiles: store
        .contexts()
        .filter(({ path }) =>
          rust.contextFiles.some((pattern) => matchesPattern(path, pattern)),
        ),
      symbols: facts.flatMap((f) => f.symbols),
      links: facts.flatMap((f) => f.links),
    },
    () => {},
    undefined,
    undefined,
    () => {},
    undefined,
    undefined,
    undefined,
    {
      includes: (l) => selected.has(l.id),
      blocked(l, reads) {
        if (visited.has(l.id)) throw Error("Repeated audit site");
        visited.set(l.id, reads);
      },
    },
  );
  store.close();
  function classify(origin) {
    if (!origin.origin) return origin.kind;
    const { file, start } = origin.origin;
    const macro = macros.get(key([file, start, origin.name]));
    const leaf = origin.name.split("::").at(-1);
    if (origin.kind === "derive") {
      if (macro?.ecosystem === "rust-std") return "built-in derive proved";
      if (macro?.ecosystem === "cargo") return "external derive identified";
      return builtInDerives.has(leaf)
        ? "built-in derive spelling"
        : "other derive identity open";
    }
    if (origin.position === "attribute") {
      const rule = attributeRules.get(origin.name.split("::")[0]);
      if (rule?.category === "builtin") return "builtin attribute";
      if (rule) return "prelude or tool attribute spelling";
      if (macro?.ecosystem === "cargo" || origin.kind === "attribute")
        return "procedural attribute";
      return "attribute identity open";
    }
    if (origin.construct === "layout macro")
      return "include or layout invocation";
    if (origin.definition)
      return origin.position === "block statement"
        ? "block-local macro_rules expansion"
        : "module macro_rules expansion";
    if (origin.position === "block statement")
      return "block statement macro identity open or external";
    if (macro?.ecosystem === "cargo" || origin.kind === "external-item")
      return "external item macro";
    return "module item macro identity open";
  }
  const output = createWriteStream(
    join(scratch, "diagnosis-" + name + ".jsonl"),
  );
  const counts = {
    links: selected.size,
    primary: 0,
    sole: 0,
    origins: {},
    classes: {},
    namespaces: {},
    positions: {},
    samples: {},
  };
  const samples = new Map();
  const visit = (table, names, type) => {
    for (const name of new Set(names)) tally(table, key([name, type]));
  };
  for (const [id, { l, reasons }] of selected) {
    const observed = visited.get(id) ?? [];
    const unique = new Map();
    for (const origin of observed) {
      const category = classify(origin);
      const { file, start } = origin.origin ?? {};
      const record = {
        category,
        name: origin.name,
        searched: origin.origin ? origin.searched : undefined,
        namespace: origin.ns,
        relation: origin.relation,
        position: origin.position,
        file,
        line: file ? location(file, start)[0] : undefined,
        start,
        cause: origin.origin?.cause,
        construct: origin.construct,
        boundedAway: origin.boundedAway,
        finite: origin.finite,
        assumed: origin.assumed,
        couldBind: origin.couldBind,
        ...(origin.definition && {
          definition: [
            origin.definition.file,
            location(origin.definition.file, origin.definition.range.start)[0],
          ],
          profile: origin.definition.data?.macroProfile?.scope,
        }),
      };
      unique.set(key(record), record);
    }
    const origins = [...unique.values()];
    const blockers = origins.filter((o) => !o.boundedAway);
    const classes = [...new Set(blockers.map((o) => o.category))].sort();
    const primary = reasons[0] === opaque;
    const sole = reasons.every((r) => r === opaque || r === "too-many-targets");
    const status = sole ? "sole" : "several";
    const category =
      classes.length > 1
        ? "multiple origin classes"
        : (classes[0] ??
          (origins.length
            ? "traced guard already bounded by main"
            : l.origin === "analysis"
              ? "derived call without traced guard"
              : "stored reason without traced guard"));
    counts.primary += Number(primary);
    counts.sole += Number(sole);
    visit(counts.origins, classes, status);
    visit(counts.classes, [category], status);
    visit(
      counts.namespaces,
      origins.length ? origins.map((o) => o.namespace) : ["untraced"],
      status,
    );
    visit(
      counts.positions,
      origins.length ? origins.map((o) => o.relation) : ["untraced"],
      status,
    );
    const [line, column] = location(l.file, l.range.start);
    const rank = createHash("sha256")
      .update(
        key([
          "c34-opaque-v1",
          pin.id,
          pin.commit,
          l.file,
          l.range,
          l.kind,
          l.targetName,
        ]),
      )
      .digest("hex");
    const row = {
      pin: pin.id,
      file: l.file,
      line,
      column,
      range: l.range,
      kind: l.kind,
      primary,
      sole,
      reasons,
      category,
      origins,
      rank,
    };
    if (!output.write(JSON.stringify(row) + "\n")) await once(output, "drain");
    const sample = samples.get(category) ?? [];
    sample.push({ ...row, spelling: l.targetName });
    sample.sort((a, b) => a.rank.localeCompare(b.rank));
    if (sample.length > 10) sample.pop();
    samples.set(category, sample);
  }
  output.end();
  await once(output, "finish");
  counts.samples = Object.fromEntries(samples);
  writeFileSync(
    join(scratch, "diagnosis-" + name + ".json"),
    JSON.stringify({ pin: pin.id, commit: pin.commit, ...counts }, null, 2) +
      "\n",
  );
  console.log(
    JSON.stringify({
      pin: pin.id,
      links: counts.links,
      primary: counts.primary,
      sole: counts.sole,
      classes: counts.classes,
    }),
  );
}
