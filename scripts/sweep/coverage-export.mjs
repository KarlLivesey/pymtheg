// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { classify, columns, countLines, failedFamily, goImports, modules, repositoryScore,
  rustImports, rustPreludeMacros, rustPreludeTypes, sampleKey, sampleSize, sampleStratum, sourceScope, tsBindings } from "./coverage-rules.mjs";

const readJson = (name) => JSON.parse(name.endsWith(".gz") ? gunzipSync(readFileSync(name)) : readFileSync(name, "utf8"));
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const atomicJson = (path, value) => {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value)}\n`);
  renameSync(tmp, path);
};

async function loadReaders(packageRoot) {
  const load = (name) => import(pathToFileURL(join(packageRoot, name)));
  const [ts, go, rust, toml] = await Promise.all([
    import(pathToFileURL(resolve(packageRoot, "../typescript/lib/typescript.js"))),
    load("dist/graph/languages/go/gomod.js"), load("dist/graph/languages/rust/cargo.js"),
    load("dist/graph/languages/rust/toml.js"),
  ]);
  return { ts: ts.default, go, rust, toml };
}

function projectEvidence(db, readers, files, paths) {
  const contexts = db.prepare("SELECT body FROM graph_contexts").all().map(({ body }) => JSON.parse(body));
  const tsPackages = new Set();
  const tsExternal = new Set();
  const tsAliasStrings = new Set();
  const rustLocal = new Set();
  const rustShadows = new Set();
  let explicitPrelude = false, opaqueMacroImports = false, noStd = false;
  const rustByDirectory = new Map();
  const normalise = (name) => name.replaceAll("-", "_");
  for (const context of contexts) {
    if (context.status !== "clean") continue;
    if (context.path.endsWith("Cargo.toml")) {
      const doc = readers.toml.readToml(context.text);
      for (const name of [doc?.package?.name, doc?.lib?.name]) if (typeof name === "string") rustLocal.add(normalise(name));
    }
    if (context.path.endsWith("package.json")) {
      try {
        const doc = JSON.parse(context.text.replace(/^\ufeff/, ""));
        if (typeof doc?.name === "string") tsPackages.add(doc.name);
        for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
          for (const [name, value] of Object.entries(doc?.[field] ?? {})) {
            if (typeof value !== "string") continue;
            if (/^(?:file|link|workspace|portal):/.test(value)) tsPackages.add(name);
            else tsExternal.add(name);
          }
        }
      } catch { /* An unreadable manifest establishes no package binding. */ }
    }
    if (/(?:ts|js)config[^/]*\.json$/.test(context.path)) {
      const { config } = readers.ts.parseConfigFileTextToJson(context.path, context.text);
      for (const alias of Object.keys(config?.compilerOptions?.paths ?? {})) {
        const literal = alias.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
        tsAliasStrings.add(`^${literal}$`);
      }
    }
  }
  const rustContexts = readers.rust.crates(contexts, new Set(files.filter(({ module }) => module === "rust").map(({ path }) => path)));
  for (const crate of rustContexts) {
    const dir = posix.dirname(crate.manifest);
    const entries = rustByDirectory.get(dir) ?? new Map();
    for (const dependency of crate.dependencies ?? []) {
      const known = entries.get(dependency.name) ?? new Set();
      const destination = dependency.manifest ? "inside"
        : dependency.registryVersion || dependency.registryRequirement ? "outside" : "unclassified";
      known.add(destination === "outside" && dependency.packageName && rustLocal.has(normalise(dependency.packageName)) ? "unclassified" : destination);
      entries.set(dependency.name, known);
    }
    rustByDirectory.set(dir, entries);
  }
  for (const { name } of db.prepare("SELECT DISTINCT name FROM graph_symbols WHERE json_extract(body,'$.module')='rust' AND json_extract(body,'$.kind')='module'").iterate()) rustLocal.add(name);
  if (files.some(({ module }) => module === "rust")) {
    for (const { source } of db.prepare("SELECT json_extract(body,'$.text') AS source FROM graph_files WHERE json_extract(body,'$.module')='rust'").iterate()) {
      const text = source ?? "";
      explicitPrelude ||= /\bno_implicit_prelude\b/.test(text);
      opaqueMacroImports ||= /#\s*\[\s*macro_use\b/.test(text);
      noStd ||= /\bno_std\b/.test(text);
      for (const [, name] of text.matchAll(/\b(?:macro_rules\s*!|macro|struct|enum|type|trait|mod|union)\s+(?:r#)?(\w+)/g)) {
        if (rustPreludeMacros.has(name) || rustPreludeTypes.has(name)) rustShadows.add(name);
      }
    }
    for (const { body } of db.prepare("SELECT body FROM graph_links WHERE module='rust' AND kind='imports'").iterate()) {
      const { targetName, data } = JSON.parse(body);
      const name = data?.alias;
      if (name && (rustPreludeMacros.has(name) || rustPreludeTypes.has(name)) && !/^(?:::)?(?:std|core|alloc)::/.test(targetName)) rustShadows.add(name);
    }
  }
  const layout = readers.go.readLayout(contexts);
  const goMemo = new Map();
  const goExternalMemo = new Map();
  const vendoredGo = new Set();
  for (const path of paths) {
    const parts = path.split("/");
    if (parts.includes("vendor") && path.endsWith(".go")) vendoredGo.add(parts.slice(parts.lastIndexOf("vendor") + 1, -1).join("/"));
    const vendored = /(?:^|\/)(?:vendor|node_modules)\/(@[^/]+\/[^/]+|[^/]+)/.exec(path)?.[1];
    if (vendored) tsPackages.add(vendored);
  }
  // Internal path overrides and local workspace names defeat external guesses.
  const goModules = layout.modules.map(({ path }) => path);
  const goDestinations = (file, path) => {
    const directory = posix.dirname(file) === "." ? "" : posix.dirname(file);
    const key = `${directory}\0${path}`;
    if (!goMemo.has(key)) goMemo.set(key, readers.go.directoryOfImport(layout, directory, path));
    return goMemo.get(key);
  };
  const goExternal = (file, path) => {
    const dir = posix.dirname(file);
    const key = `${dir}\0${path}`;
    if (!goExternalMemo.has(key)) {
      const own = readers.go.moduleOf(layout, dir === "." ? "" : dir);
      goExternalMemo.set(key, own && [...own.requires.keys()].some((name) => path === name || path.startsWith(`${name}/`)));
    }
    return goExternalMemo.get(key);
  };
  const ownerMemo = new Map();
  const rustBindings = (file, name) => {
    let dir = posix.dirname(file);
    const original = dir;
    if (!ownerMemo.has(dir)) {
      while (!rustByDirectory.has(dir) && dir !== ".") dir = posix.dirname(dir);
      ownerMemo.set(original, rustByDirectory.get(dir));
    }
    const options = ownerMemo.get(original)?.get(name);
    return options?.size === 1 ? options.values().next().value : undefined;
  };
  return { tsPackages, tsExternal, tsAliases: [...tsAliasStrings].map((pattern) => new RegExp(pattern)),
    goModules, goDestinations, goExternal, vendoredGo, rustLocal, rustBindings,
    rustPrelude: (name, kind) => !explicitPrelude && !rustShadows.has(name) && !rustLocal.has(name) &&
      (kind === "macros" ? !opaqueMacroImports && (!noStd || !/^(?:e?print(?:ln)?|dbg|vec|format)$/.test(name))
        : !noStd || !/^(?:Vec|String|Box|ToOwned|ToString)$/.test(name)),
  };
}

function selectAttempt(scratch, repo) {
  if (repo.attempt) {
    const path = resolve(scratch, repo.attempt);
    if (!path.startsWith(`${resolve(scratch, "work")}/`)) throw Error(`Invalid attempt path for ${repo.id}`);
    return path;
  }
  const directory = join(scratch, "work", repo.id, repo.commit);
  const candidates = [directory, ...readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => join(directory, entry.name))]
    .filter((path) => existsSync(join(path, "warm.out")) && existsSync(join(path, "query-status.out")));
  if (candidates.length !== 1) throw Error(`Expected one completed checkout for ${repo.id}. Use a results file with attempt paths.`);
  return candidates[0];
}

function remember(samples, stratum, key, makeSample) {
  const entries = samples.get(stratum) ?? [];
  const limit = sampleSize(stratum);
  if (entries.length === limit && compare(key, entries.at(-1).key) >= 0) return;
  entries.push({ key, ...makeSample() });
  entries.sort((a, b) => compare(a.key, b.key));
  if (entries.length > limit) entries.pop();
  samples.set(stratum, entries);
}

function location(text, offset) {
  const at = Math.max(0, Number.isInteger(offset) ? offset : 0);
  const stop = text.indexOf("\n", at);
  const start = text.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const line = text.slice(0, start).split("\n").length;
  const before = text.slice(Math.max(0, at - 1100), at);
  return { line, code: text.slice(Math.max(start, at - 85), Math.min(stop < 0 ? text.length : stop, at + 146)).trim(), before };
}

function scanRepo(scratch, repo, readers, referenceFiles) {
  const attempt = selectAttempt(scratch, repo);
  const paths = readFileSync(join(attempt, "tree.out"), "utf8").split("\0")
    .filter((item) => /^100(?:644|755) blob /.test(item)).map((item) => item.slice(item.indexOf("\t") + 1));
  const db = new DatabaseSync(join(attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  try {
    if (db.prepare("SELECT value FROM graph_meta WHERE key='schema'").get()?.value !== "3") throw Error("Coverage export supports graph schema 3");
    const files = db.prepare("SELECT path,status,json_extract(body,'$.module') AS module FROM graph_files ORDER BY path").all();
    const getFile = db.prepare(`SELECT json_extract(body,'$.text') AS text,
      json_extract(body,'$.result.diagnostics[0].message') AS reason,
      json_extract(body,'$.result.diagnostics[0].range.start') AS start FROM graph_files WHERE path=?`);
    const getLinks = db.prepare("SELECT body,resolution,kind,module FROM graph_links WHERE file=?");
    const imports = db.prepare("SELECT body,resolution FROM graph_links WHERE file=? AND kind='imports'");
    const declared = db.prepare(`SELECT 1 AS present FROM graph_symbols WHERE name=? AND file=?
      AND json_extract(body,'$.kind') IN ('enum','struct','type','trait','class','interface','function','method') LIMIT 1`);
    const hasName = db.prepare("SELECT 1 FROM graph_symbols WHERE name=? AND json_extract(body,'$.module')='typescript' LIMIT 1");
    const goSignatures = db.prepare(`SELECT file, json_extract(body,'$.data') AS data FROM graph_symbols WHERE name=?
      AND json_extract(body,'$.module')='go' AND json_extract(body,'$.kind')=?`);
    const capturedNames = new Map();
    const project = projectEvidence(db, readers, files, paths);
    const goFactory = (file, expr, imports) => {
      const called = expr?.k === "sel" && expr.x?.k === "call" ? expr.x.f : null;
      const specifier = called?.k === "sel" && called.x?.k === "name" ? imports.get(called.x.n) : null;
      if (!specifier) return false;
      const { directories, outside } = project.goDestinations(file, specifier);
      if (outside || directories.length !== 1) return false;
      const fromPackage = (row) => posix.dirname(row.file) === (directories[0] || ".");
      const targets = goSignatures.all(called.n, "function").filter(fromPackage);
      if (!targets.length) return false;
      return targets.every(({ data }) => {
        const returned = JSON.parse(data)?.results?.[expr.x.i];
        if (returned?.k !== "val" || returned.t?.q || !returned.t?.n) return false;
        return goSignatures.all(expr.n, "method").some((method) => fromPackage(method) && JSON.parse(method.data)?.receiver === returned.t.n);
      });
    };
    const counts = new Map();
    const samples = new Map();
    const strata = {};
    const failed = new Map();
    const sourceFiles = new Map();
    const checks = {};
    for (const file of files) {
      const snapshot = getFile.get(file.path);
      const source = snapshot.text ?? "";
      const scope = sourceScope(repo.id, file.path, source);
      const lines = countLines(source);
      if (!modules.includes(file.module)) throw Error(`Unexpected graph module on ${file.path}`);
      const countKey = `${file.module}:${scope}`;
      const count = sourceFiles.get(countKey) ?? { module: file.module, scope, files: 0, lines: 0, readableLines: 0 };
      count.files++;
      count.lines += lines;
      if (file.status !== "failed") count.readableLines += lines;
      sourceFiles.set(countKey, count);
      if (file.status === "failed") {
        const family = failedFamily(scope, snapshot.reason ?? "", file.module, source);
        const key = `${file.module}:${family}:${scope}`;
        const entry = failed.get(key) ?? { module: file.module, family, scope, files: 0, lines: 0, examples: [] };
        entry.files++;
        entry.lines += lines;
        if (entry.examples.length < 2) {
          const where = location(source, snapshot.start);
          entry.examples.push({ file: file.path, line: where.line, code: where.code });
        }
        failed.set(key, entry);
      }
      const records = imports.all(file.path).map(({ body, resolution }) => ({ ...JSON.parse(body), resolution }));
      let bindings;
      const tsSourceBindings = () => bindings ??= tsBindings(readers.ts, file.path, source);
      const evidence = {
        goImports: file.module === "go" ? goImports(records) : new Map(),
        rustImports: file.module === "rust" ? rustImports(records) : new Map(),
        tsSpecifiers: new Set(records.map((link) => link.data?.specifier).filter(Boolean)),
        tsImports: () => tsSourceBindings().imports,
        tsSpecifierAt: (offset) => tsSourceBindings().specifiers.find(({ start, end }) => start <= offset && offset < end)?.value,
        tsGlobal: (name) => {
          if (!capturedNames.has(name)) capturedNames.set(name, Boolean(hasName.get(name)));
          const local = tsSourceBindings();
          return !local.unsafe && !local.names.has(name) && !capturedNames.get(name);
        },
      };
      for (const row of getLinks.iterate(file.path)) {
        const link = { ...JSON.parse(row.body), module: row.module, kind: row.kind, resolution: row.resolution };
        const disposition = classify(link, evidence, project);
        const tuple = [link.module, link.kind, link.resolution, link.data?.reason ?? null, link.data?.uncertainty ?? null, scope, disposition];
        const key = JSON.stringify(tuple);
        const aggregate = counts.get(key);
        const blocked = Number(link.data?.blocked === true);
        if (aggregate) { aggregate[7]++; aggregate[8] += blocked; }
        else counts.set(key, [...tuple, 1, blocked]);
        const stratum = sampleStratum(link, disposition);
        const references = referenceFiles?.get(file.path);
        const rank = stratum || references ? sampleKey(repo, link) : null;
        if (rank && references?.has(rank)) {
          const previous = checks[rank];
          // Identical source facts can occur twice. Credit recovery only when
          // every matching fact is resolved.
          if (!previous || previous === "resolved") checks[rank] = link.resolution;
        }
        if (!stratum) continue;
        const population = `${stratum}:${scope}`;
        strata[population] = (strata[population] ?? 0) + 1;
        remember(samples, stratum, rank, () => {
          const p = location(source, link.range?.start);
          const data = link.data ?? {};
          const targetRoot = /^[\w$]+/.exec(link.targetName)?.[0];
          const expr = data.expr;
          const type = data.receiverType?.split("::").at(-1) ?? targetRoot;
          return { repo: repo.id, file: file.path, line: p.line, code: p.code, before: p.before,
            scope, kind: link.kind, disposition, target: link.targetName, reason: link.data?.reason ?? link.data?.uncertainty ?? null,
            ...(type && declared.get(type, file.path) ? { declaredHere: true } : {}),
            ...(link.module === "go" ? { expr, open: data.open,
              ...(link.kind === "calls" && goFactory(file.path, expr, evidence.goImports) ? { factory: "inside" } : {}) } : {}),
            ...(link.module === "rust" ? { receiver: data.receiverType, method: data.method, impl: data.implType } : {}),
            ...(link.module === "typescript" ? { jsx: data.jsx, specifier: data.specifier ?? evidence.tsImports().get(targetRoot) } : {}) };
        });
      }
    }
    const rows = [...counts].sort(([a], [b]) => compare(a, b)).map(([, value]) => value);
    const actual = repositoryScore(rows);
    const warm = readJson(join(attempt, "warm.out")).counts;
    if (actual.total !== warm.links || actual.ambiguous !== warm.ambiguous ||
        actual.inside + actual.outside + actual.unclassified !== warm.unresolved) throw Error(`Stored link totals disagree with released CLI for ${repo.id}`);
    return { audit: { id: repo.id, language: repo.language, commit: repo.commit, outcome: repo.outcome,
      trackedSource: repo.trackedSource, breakdown: rows, sourceFiles: [...sourceFiles.values()],
      failedSources: [...failed.values()].map(({ examples, ...record }) => record), strata, ...(referenceFiles ? { checks } : {}) },
      failedExamples: [...failed.values()],
      samples: Object.fromEntries(samples) };
  } finally { db.close(); }
}

const { values } = parseArgs({ options: {
  results: { type: "string" }, scratch: { type: "string", default: process.env.PYM_SCRATCH },
  output: { type: "string" }, "metadata-root": { type: "string" }, "reference-samples": { type: "string" },
  "include-failed": { type: "string" },
} });
if (!values.results || !values.scratch || !values.output) throw Error("Use --results, --output and --scratch (or PYM_SCRATCH)");
const scratch = resolve(values.scratch);
const output = resolve(values.output);
const input = readJson(values.results);
if (values["include-failed"]) {
  const previous = readJson(values["include-failed"]);
  if (previous.release.integrity !== input.release.integrity || !input.release.integrity) {
    throw Error("Old failure records must use the same released package");
  }
  const current = new Set(input.repos.map(({ id }) => id));
  input.repos.push(...previous.repos.filter((repo) => repo.outcome !== "finished" && !current.has(repo.id)));
}
const readers = await loadReaders(resolve(values["metadata-root"] ?? join(scratch, "release/node_modules/pymtheg")));
const reference = new Map();
if (values["reference-samples"]) {
  for (const row of readJson(values["reference-samples"]).samples) {
    if (!reference.has(row.repo)) reference.set(row.repo, new Map());
    const files = reference.get(row.repo);
    if (!files.has(row.file)) files.set(row.file, new Set());
    files.get(row.file).add(row.key);
  }
}
const cacheVersion = createHash("sha256").update(readFileSync(new URL(import.meta.url)))
  .update(readFileSync(new URL("./coverage-rules.mjs", import.meta.url)))
  .update(values["reference-samples"] ? readFileSync(values["reference-samples"]) : "").digest("hex");
const cache = `${output}.cache`;
mkdirSync(dirname(output), { recursive: true });
mkdirSync(cache, { recursive: true });
const repositories = [];
const shortlist = new Map();
const failures = {};
const taintExamples = {};
for (const repo of input.repos) {
  // Keep failed attempts in the exported result so a candidate regression
  // replaces its baseline graph with an explicit zero.
  if (repo.outcome !== "finished") {
    repositories.push(repo);
    continue;
  }
  const attempt = selectAttempt(scratch, repo);
  const key = sampleKey(repo, { file: attempt, module: JSON.stringify(input.release), kind: cacheVersion });
  const path = join(cache, `${key}.json`);
  if (!existsSync(path)) {
    console.error(`Exporting ${repo.id}`);
    atomicJson(path, scanRepo(scratch, repo, readers, reference.get(repo.id)));
  }
  const { audit, samples, failedExamples } = readJson(path);
  if (failedExamples.length) failures[repo.id] = failedExamples;
  if (samples["rust:failed-file-taint"]?.length) taintExamples[repo.id] = samples["rust:failed-file-taint"].slice(0, 5);
  repositories.push(audit);
  for (const [stratum, entries] of Object.entries(samples)) for (const { key, ...sample } of entries) {
    remember(shortlist, stratum, key, () => sample);
  }
}
const release = input.release;
writeFileSync(output, ["{", '  "schema": "pymtheg.sweep.coverage/v1",', `  "columns": ${JSON.stringify(columns)},`,
  `  "release": ${JSON.stringify(release)},`, '  "repos": [',
  repositories.sort((a, b) => compare(a.id, b.id)).map((repo) => `    ${JSON.stringify(repo)}`).join(",\n"), "  ]", "}", ""].join("\n"));
atomicJson(`${output}.samples.json`, Object.fromEntries([...shortlist].sort(([a], [b]) => compare(a, b))));
atomicJson(`${output}.failed-examples.json`, failures);
atomicJson(`${output}.taint-examples.json`, taintExamples);
console.error(`Exported ${repositories.length} attempts, ${repositories.filter(({ outcome }) => outcome === "finished").length} studied graphs`);
