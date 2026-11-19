// SPDX-License-Identifier: MIT
// Replay statistics and fixed-seed samples from the stored graph sites.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import ts from "typescript";
import { sampleKey } from "../../scripts/sweep/coverage-rules.mjs";

const [scratch, ...selected] = process.argv.slice(2);
const read = (mode) =>
  JSON.parse(readFileSync(join(scratch, `${mode}-run.json`))).repos;
const open = (repo) =>
  new DatabaseSync(
    join(scratch, repo.attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"),
    { readOnly: true },
  );
const candidate = selected[0] === "--candidate";
if (candidate) selected.shift();
const verify = process.env.PYM_COMPARE_ALL_LINKS === "1";
const detailed = process.env.PYM_COMPARE_CANDIDATES === "1";
const candidateKeys = verify || detailed;
const old = read(process.env.C16_BASELINE ?? "main");
const next = new Map(
  candidate
    ? read(process.env.C16_CANDIDATE ?? "candidate").map((r) => [r.id, r])
    : [],
);
const referenceSamples = new Map(
  JSON.parse(
    gunzipSync(readFileSync("evidence/sw-3/samples.json.gz")),
  ).samples.map((sample) => [sample.key, sample.item]),
);
const rows = ["ts-package", "ts-runtime", "ts-package-chain"];
const tests =
  /^(?:after|before)(?:All|Each)?$|^(?:describe|expect|it|test|vi|jest|suite|specify|vitest|bench|assert|fit|xit|xdescribe|xtest)$/;
const runtime =
  /^(?:apply|assign|bind|call|catch|charAt|charCodeAt|clear|concat|delete|endsWith|entries|every|fill|filter|find|findIndex|flat|flatMap|forEach|from|hasOwn|includes|indexOf|join|keys|map|match|matchAll|normalize|padEnd|padStart|pop|push|reduce|reduceRight|repeat|replace|replaceAll|reverse|shift|slice|some|sort|split|startsWith|substring|then|toFixed|toLowerCase|toString|toUpperCase|trim|unshift|values|addEventListener|appendChild|createElement|dispatchEvent|getAttribute|getElementById|querySelector|querySelectorAll|removeEventListener|setAttribute)$/;
const runtimeGlobal =
  /^(?:AbortController|AbortSignal|Array|BigInt|Blob|Boolean|Date|Error|Event|fetch|File|Headers|Intl|JSON|Map|Math|Number|Object|parseFloat|parseInt|Promise|queueMicrotask|Reflect|RegExp|Request|Response|Set|setTimeout|clearTimeout|String|Symbol|TextDecoder|TextEncoder|URL|URLSearchParams|WeakMap|WeakSet|WebSocket)(?:\.|$)/;
const nodeGlobal =
  /^(?:Buffer|process|require|module|__dirname|__filename|setImmediate|clearImmediate)(?:\.|$)/;

function importNames(file, source) {
  const imports = new Set();
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const statement of tree.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      /^\.{1,2}\//.test(statement.moduleSpecifier.text)
    )
      continue;
    const clause = statement.importClause;
    if (clause?.name) imports.add(clause.name.text);
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      imports.add(bindings.name.text);
    else if (bindings)
      for (const { name } of bindings.elements) imports.add(name.text);
  }
  return imports;
}
function shape(name, imports, link, reference) {
  if (rows.includes(reference)) return reference;
  const [root, ...parts] = name.split(".");
  if (imports.has(root) || tests.test(name) || nodeGlobal.test(name))
    return "ts-package";
  if (runtimeGlobal.test(name) || runtime.test(parts.at(-1) ?? ""))
    return "ts-runtime";
  if (
    (link.kind === "calls" || link.kind === "references") &&
    parts.length &&
    !["local", "dynamic-scope", "invalid-code"].includes(link.data?.reason)
  )
    return "ts-package-chain";
}
function measuredRow(link, updated, item, reference) {
  if (rows.includes(reference)) return reference;
  const targets = updated?.libraries?.length
    ? updated.libraries
    : link.libraries;
  if (
    targets.some(
      ({ ecosystem }) => ecosystem === "typescript-lib" || ecosystem === "dom",
    ) ||
    (item === "ts-runtime" &&
      targets.some(({ ecosystem }) => ecosystem === "node"))
  )
    return "ts-runtime";
  if (
    targets.some(({ evidence }) => evidence === "declaring-owner") ||
    (link.resolution === "unresolved" &&
      updated?.resolution === "library" &&
      targets[0]?.evidence === "import-path")
  )
    return "ts-package-chain";
  return item ?? (targets.length ? "ts-package" : undefined);
}
const identity = ({ source, kind, range, targetName, module, origin }) =>
  JSON.stringify([
    source,
    kind,
    range?.start,
    range?.end,
    targetName,
    module,
    origin,
  ]);
const isLevel2 = ({ resolution, libraries }) =>
  resolution === "resolved" ||
  (resolution === "library" && typeof libraries[0]?.symbol === "string");
const queries = (db) => ({
  files: db.prepare("SELECT path, body FROM graph_files"),
  symbols: db.prepare(
    `SELECT json_extract(body,'$.module') AS module,
      json_extract(body,'$.key') AS key, json_extract(body,'$.ordinal') AS ordinal
    FROM graph_symbols WHERE file=? ORDER BY module, key, ordinal`,
  ),
  links: db.prepare(`SELECT l.body, l.kind, l.module, l.origin,
    json_array(s.file,json_extract(s.body,'$.key'),json_extract(s.body,'$.ordinal')) AS source,
    json_array(t.file,json_extract(t.body,'$.key'),json_extract(t.body,'$.ordinal')) AS target,
    l.resolution, (
      SELECT json_group_array(json_object('ecosystem',ecosystem,'unit',unit,'symbol',symbol,
        'evidence',evidence,'version',version,'versionSource',version_source)) FROM graph_library_targets WHERE link=l.id
    ) AS libraries${
      candidateKeys
        ? `, (
      SELECT json_group_array(json_array(file,key,ordinal,kind)) FROM (
        SELECT c.kind,cs.file,json_extract(cs.body,'$.key') AS key,json_extract(cs.body,'$.ordinal') AS ordinal
        FROM graph_candidates c JOIN graph_symbols cs ON cs.id=c.symbol WHERE c.link=l.id
        ORDER BY cs.file,key,ordinal,c.kind
      )
    ) AS candidateKeys`
        : ""
    } FROM graph_links l INDEXED BY graph_link_file
    LEFT JOIN graph_symbols s ON s.id=l.source LEFT JOIN graph_symbols t ON t.id=l.target
    WHERE l.file=? ORDER BY l.id`),
});
const links = (query, file) =>
  query.links.all(file).map(({ body, libraries, ...columns }) => ({
    ...JSON.parse(body),
    ...columns,
    file,
    libraries: JSON.parse(libraries),
  }));
const ordered = (sample) => sample.sort((a, b) => a.rank.localeCompare(b.rank));
const misses = Object.fromEntries(rows.map((id) => [id, []]));
const additions = Object.fromEntries(rows.map((id) => [id, []]));
const stats = [];
const locate = (source, offset) => source.slice(0, offset).split("\n").length;
const reason = (link) => link.data?.reason ?? link.resolution;
const rank = (repo, link) =>
  createHash("sha256")
    .update((process.env.PYM_COMPARE_SEED ?? "pymtheg-c16-2026") + "\0")
    .update(sampleKey(repo, link))
    .update(identity(link))
    .digest("hex");
for (const repo of old) {
  if (selected.length && !selected.includes(repo.id)) continue;
  const replacement = next.get(repo.id);
  if (
    repo.outcome !== "finished" ||
    (candidate &&
      (replacement?.outcome !== "finished" ||
        repo.commit !== replacement.commit))
  ) {
    stats.push({
      pin: repo.id,
      main: repo.outcome,
      candidate: replacement?.outcome,
    });
    continue;
  }
  const before = open(repo);
  const after = replacement && open(replacement);
  const a = queries(before);
  const b = after && queries(after);
  const files = new Map(
    a.files.all().map(({ path, body }) => [path, JSON.parse(body)]),
  );
  if (b)
    for (const { path } of b.files.iterate())
      if (!files.has(path)) files.set(path, {});
  const count = {
    pin: repo.id,
    before: 0,
    after: 0,
    beforeL2: 0,
    afterL2: 0,
    shared: 0,
    sharedBeforeL2: 0,
    sharedAfterL2: 0,
    allLinks: 0,
    allLinksAfter: 0,
    symbols: 0,
    symbolChanges: 0,
    lostSites: 0,
    addedSites: 0,
    definite: 0,
    vitestBench: 0,
    newNodeGlobals: 0,
    newMemberForms: 0,
    unitUpgrades: 0,
    changedDefinite: [],
    ...(verify && { changedOutcomes: 0, changedOutcomeExamples: [] }),
    rows: Object.fromEntries(
      rows.map((id) => [
        id,
        {
          population: 0,
          recovered: 0,
          unit: 0,
          candidates: 0,
          sites: 0,
          level2Before: 0,
          level2After: 0,
          referenceBefore: 0,
          referenceAfter: 0,
          referenceSites: 0,
        },
      ]),
    ),
  };
  for (const [file, { text = "", result }] of files) {
    const prior = links(a, file);
    const later = b ? links(b, file) : [];
    const oldSymbols = a.symbols.all(file);
    count.symbols += oldSymbols.length;
    if (b && JSON.stringify(oldSymbols) !== JSON.stringify(b.symbols.all(file)))
      count.symbolChanges++;
    count.allLinks += prior.length;
    count.allLinksAfter += later.length;
    count.before += prior.filter(
      ({ module }) => module === "typescript",
    ).length;
    const afterTypeScript = later.filter(
      ({ module }) => module === "typescript",
    );
    count.after += afterTypeScript.length;
    count.afterL2 += afterTypeScript.filter(isLevel2).length;
    const current = new Map();
    for (const link of later) {
      const key = identity(link);
      if (!current.has(key)) current.set(key, []);
      current.get(key).push(link);
    }
    let imports;
    const site = (link, updated) => {
      const line = locate(text, link.range?.start ?? 0);
      const snippet = text.split("\n")[line - 1]?.trim().slice(0, 300);
      return {
        rank: rank(repo, link),
        pin: repo.id,
        file,
        line,
        name: link.targetName,
        offset: link.range?.start,
        snippet,
        reason: reason(link),
        config: result?.data?.project ?? result?.data?.projects,
        assumes: link.data?.assumes,
        was: link.libraries,
        ...(updated && {
          after: reason(updated),
          outcome: updated.resolution,
          targets: updated.libraries,
        }),
      };
    };
    for (const link of prior) {
      const choices = current.get(identity(link));
      const exact = choices?.findIndex(
        (other) =>
          other.resolution === link.resolution &&
          other.target === link.target &&
          JSON.stringify(other.libraries) === JSON.stringify(link.libraries) &&
          (!verify ||
            (other.candidateKeys === link.candidateKeys &&
              JSON.stringify(other.data) === JSON.stringify(link.data))),
      );
      const [updated] = choices?.splice(exact >= 0 ? exact : 0, 1) ?? [];
      if (verify && b && !(exact >= 0)) {
        count.changedOutcomes++;
        if (count.changedOutcomeExamples.length < 10)
          count.changedOutcomeExamples.push(site(link, updated));
      }
      const wasLevel2 = isLevel2(link);
      const isNowLevel2 = updated && isLevel2(updated);
      if (
        !wasLevel2 &&
        isNowLevel2 &&
        updated.libraries.some(
          (target) =>
            target.unit === "vitest" &&
            target.symbol === "bench" &&
            target.evidence === "declared-builtin",
        )
      )
        count.vitestBench++;
      if (
        !wasLevel2 &&
        isNowLevel2 &&
        updated.libraries.some(
          (target) =>
            target.ecosystem === "node" &&
            target.evidence === "declared-builtin",
        )
      )
        count.newNodeGlobals++;
      const typescript = link.module === "typescript";
      if (typescript && wasLevel2) count.beforeL2++;
      if (typescript && updated) {
        count.shared++;
        if (wasLevel2) count.sharedBeforeL2++;
        if (isNowLevel2) count.sharedAfterL2++;
      }
      if (!updated && b) count.lostSites++;
      if (link.resolution === "resolved" || link.resolution === "library") {
        count.definite++;
        if (b && (exact ?? -1) < 0) {
          const priorUnit = link.libraries[0];
          const newUnit = updated?.libraries[0];
          const refined =
            link.resolution === "library" &&
            updated?.resolution === "library" &&
            priorUnit.symbol === null &&
            newUnit.symbol !== null &&
            priorUnit.ecosystem === newUnit.ecosystem &&
            priorUnit.unit === newUnit.unit &&
            priorUnit.version === newUnit.version;
          if (refined) count.unitUpgrades++;
          if (!refined || detailed)
            count.changedDefinite.push({
              file,
              range: link.range,
              name: link.targetName,
              prior: link,
              updated,
            });
        }
      }
      if (!typescript) continue;
      const reference = referenceSamples.get(sampleKey(repo, link));
      if (rows.includes(reference)) {
        const row = count.rows[reference];
        row.referenceSites++;
        if (wasLevel2) row.referenceBefore++;
        if (isNowLevel2) row.referenceAfter++;
      }
      if (
        link.kind === "contains" ||
        (link.resolution === "resolved" && !reference)
      )
        continue;
      const name = link.targetName;
      imports ??= importNames(file, text);
      const item = shape(name, imports, link, reference);
      const recovered = measuredRow(link, updated, item, reference);
      if (recovered) {
        const row = count.rows[recovered];
        row.sites++;
        if (wasLevel2) row.level2Before++;
        if (isNowLevel2) row.level2After++;
      }
      if (wasLevel2) continue;
      if (item) {
        count.rows[item].population++;
        const draw = misses[item];
        const hash = rank(repo, link);
        if (draw.length < 100 || hash < draw.at(-1).rank) {
          draw.push(site(link, updated));
          ordered(draw).splice(100);
        }
      }
      if (
        !updated ||
        exact >= 0 ||
        (link.resolution === updated.resolution &&
          link.libraries.length === updated.libraries.length &&
          link.libraries.every(({ ecosystem, unit, symbol, version }) =>
            updated.libraries.some(
              (target) =>
                target.ecosystem === ecosystem &&
                target.unit === unit &&
                target.symbol === symbol &&
                target.version === version,
            ),
          ))
      )
        continue;
      if (
        link.kind === "calls" &&
        updated.libraries.length &&
        (link.targetName === "(expression)" || link.data?.reason === "local")
      )
        count.newMemberForms++;
      if (!recovered) continue;
      const row = count.rows[recovered];
      if (isNowLevel2) row.recovered++;
      else if (updated.resolution === "library") row.unit++;
      else if (updated.resolution === "ambiguous") row.candidates++;
      else continue;
      const rankOrder = rank(repo, link);
      const draw = additions[recovered];
      const samePool = ({ pin, outcome }) =>
        pin === repo.id && outcome === updated.resolution;
      const fromPin = draw.filter(samePool);
      if (fromPin.length < 20 || rankOrder < fromPin.at(-1).rank) {
        draw.push({
          ...site(link, updated),
          target: updated.target,
        });
        ordered(draw);
        const high = draw.findLastIndex(samePool);
        if (fromPin.length >= 20) draw.splice(high, 1);
      }
    }
    for (const links of current.values()) count.addedSites += links.length;
  }
  before.close();
  after?.close();
  stats.push(count);
}
console.log(JSON.stringify({ stats, misses, additions }));
