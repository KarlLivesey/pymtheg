// SPDX-License-Identifier: MIT
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { cargoPathLocations, checkoutLocation, npmPathLocation, yarnArchivePackages } from "./coverage-locations.mjs";
import { goMapKeyReader, typescriptShapes } from "./coverage-source.mjs";
import { classify, columns, countLines, externalIdentity, failedFamily, goImports, modules, packageName, repositoryScore,
  reviewBucket, reviewQuotas, rustImports, rustPreludeMacros, rustPreludeTypes, sampleKey, sampleSize, sampleStratum, sourceScope, tsBindings, workspaceNames } from "./coverage-rules.mjs";

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

function projectEvidence(db, readers, files, paths, symlinks, checkout) {
  const contexts = db.prepare("SELECT body FROM graph_contexts").all().map(({ body }) => JSON.parse(body));
  const tsPackages = new Set();
  const tsExternal = new Set();
  const tsAliasStrings = new Set();
  const tsManifests = new Map();
  const tsConfigs = new Map();
  const cargoManifests = new Map();
  const rustLocal = new Set();
  const rustShadows = new Set();
  let explicitPrelude = false, opaqueMacroImports = false, noStd = false;
  const rustByDirectory = new Map();
  const normalise = (name) => name.replaceAll("-", "_");
  for (const context of contexts) {
    if (context.status !== "clean") continue;
    if (context.path.endsWith("Cargo.toml")) {
      const doc = readers.toml.readToml(context.text);
      if (doc) cargoManifests.set(context.path, doc);
      for (const name of [doc?.package?.name, doc?.lib?.name]) if (typeof name === "string") rustLocal.add(normalise(name));
    }
    if (context.path.endsWith("package.json")) {
      try {
        const doc = JSON.parse(context.text.replace(/^\ufeff/, ""));
        tsManifests.set(context.path, doc);
        if (typeof doc?.name === "string") tsPackages.add(doc.name);
      } catch { /* An unreadable manifest establishes no package binding. */ }
    }
    if (/(?:ts|js)config[^/]*\.json$/.test(context.path)) {
      const { config } = readers.ts.parseConfigFileTextToJson(context.path, context.text);
      if (config?.extends) tsConfigs.set(context.path, [config.extends].flat().filter((part) => typeof part === "string"));
      for (const alias of Object.keys(config?.compilerOptions?.paths ?? {})) {
        const literal = alias.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
        tsAliasStrings.add(`^${literal}$`);
      }
    }
  }
  const pnpmFiles = new Map();
  if (files.some(({ module }) => module === "typescript")) for (const path of paths) {
    if (posix.basename(path) === "pnpm-workspace.yaml") pnpmFiles.set(path, readFileSync(join(checkout, path), "utf8"));
    if (posix.basename(path) !== "package.json" || tsManifests.has(path)) continue;
    try { tsManifests.set(path, JSON.parse(readFileSync(join(checkout, path), "utf8").replace(/^\ufeff/, ""))); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  }
  const workspace = workspaceNames(tsManifests, pnpmFiles);
  for (const name of workspace) tsPackages.add(name);
  const tracked = new Set([".", ...paths]);
  for (const path of paths) {
    for (let dir = posix.dirname(path); !tracked.has(dir); dir = posix.dirname(dir)) tracked.add(dir);
  }
  const tsLocations = new Map();
  for (const [manifest, doc] of tsManifests) {
    const directory = posix.dirname(manifest);
    const local = new Map();
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, value] of Object.entries(doc?.[field] ?? {})) {
        if (typeof value !== "string") continue;
        const location = npmPathLocation(directory, value, tracked, symlinks) ??
          (value.startsWith("workspace:") ? workspace.has(name) ? "inside" : "unclassified" : undefined);
        if (location === undefined) tsExternal.add(name);
        else local.set(name, local.has(name) && local.get(name) !== location ? "unclassified" : location);
      }
    }
    if (local.size) tsLocations.set(directory, local);
  }
  const tsLocation = (file, name) => {
    for (let dir = posix.dirname(file); ; dir = posix.dirname(dir)) {
      const value = tsLocations.get(dir)?.get(name);
      if (value || dir === ".") return value;
    }
  };
  let tsArchiveUnknown = false;
  for (const path of paths.filter((file) => /(?:^|\/)\.yarn\/cache\/[^/]+\.zip$/i.test(file))) {
    const packages = yarnArchivePackages(join(checkout, path));
    if (packages) for (const name of packages) tsPackages.add(name);
    else tsArchiveUnknown = true;
  }
  const rustContexts = readers.rust.crates(contexts, new Set(files.filter(({ module }) => module === "rust").map(({ path }) => path)));
  const cargoLocations = cargoPathLocations(cargoManifests, tracked, symlinks);
  for (const crate of rustContexts) {
    const dir = posix.dirname(crate.manifest);
    const entries = rustByDirectory.get(dir) ?? new Map();
    for (const dependency of crate.dependencies ?? []) {
      const known = entries.get(dependency.name) ?? new Set();
      const destination = dependency.manifest ? cargoLocations.get(dependency.manifest) ?? checkoutLocation(".", dependency.manifest, tracked, symlinks)
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
    return options?.size === 1 ? options.values().next().value : options?.size ? "unclassified" : undefined;
  };
  return { tsPackages, workspace, tsConfigs, tsExternal, tsLocation, tsArchiveUnknown,
    tsAliases: [...tsAliasStrings].map((pattern) => new RegExp(pattern)),
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

function remember(samples, stratum, key, makeSample, limit) {
  if (limit === 0) return;
  const entries = samples.get(stratum) ?? [];
  if (entries.length === limit && compare(key, entries.at(-1).key) >= 0) return;
  const existing = entries.findIndex((entry) => entry.key === key);
  if (existing !== -1) return;
  entries.push({ key, ...makeSample() });
  entries.sort((a, b) => compare(a.key, b.key));
  if (entries.length > limit) entries.pop();
  samples.set(stratum, entries);
}

function addObservation(observations, identity, make) {
  let entry = observations.get(identity);
  if (!entry) {
    entry = { ...make(), links: 0 };
    observations.set(identity, entry);
  }
  entry.links++;
}

function sourceClues(source, at, names) {
  if (!names.length) return [];
  const pattern = new RegExp(`\\b(?:${names.join("|")})\\b`);
  const lines = [];
  let offset = 0;
  for (const line of source.split("\n")) {
    if (line.length < 520 && pattern.test(line) && /\b(use|import|from|let|const|var|fn|func|class|type|struct|enum|trait)\b|\w+\s*[:=]/.test(line)) {
      lines.push({ code: line.trim(), distance: Math.abs(offset - at) });
    }
    offset += line.length + 1;
  }
  return lines.sort((a, b) => a.distance - b.distance).slice(0, 7).map((line) => line.code);
}

function tsCallSite(ts, source, range) {
  if (!range) return undefined;
  const { start, end } = range;
  const visit = (node) => {
    if (node.pos > start || node.end < end) return undefined;
    if (node.getStart(source) === start && node.end === end) return node;
    return ts.forEachChild(node, visit);
  };
  const node = visit(source);
  if (!node) return undefined;
  const unwrap = (value) => {
    while (ts.isParenthesizedExpression(value) || ts.isNonNullExpression(value)) value = value.expression;
    return value;
  };
  const expression = unwrap(node);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) return { kind: "inline-function" };
  if (ts.isElementAccessExpression(expression)) {
    return { kind: ts.isStringLiteralLike(expression.argumentExpression) ? "literal-property" : "computed-property" };
  }
  const member = node.parent;
  if (!member || !ts.isPropertyAccessExpression(member) || member.name !== node) return undefined;
  const receiver = unwrap(member.expression);
  return { kind: "member", receiver: receiver.getText(source).slice(0, 160), syntax: ts.SyntaxKind[receiver.kind] };
}

function location(text, offset) {
  const at = Math.max(0, Number.isInteger(offset) ? offset : 0);
  const stop = text.indexOf("\n", at);
  const start = text.lastIndexOf("\n", Math.max(0, at - 1)) + 1;
  const line = text.slice(0, start).split("\n").length;
  const before = text.slice(Math.max(0, at - 1100), at);
  return { line, code: text.slice(Math.max(start, at - 85), Math.min(stop < 0 ? text.length : stop, at + 146)).trim(), before };
}

function scanRepo(scratch, repo, readers, referenceFiles, quotas, goMapKeys) {
  const attempt = selectAttempt(scratch, repo);
  const tree = readFileSync(join(attempt, "tree.out"), "utf8").split("\0");
  const symlinks = new Set(tree.filter((item) => /^120000 blob /.test(item)).map((item) => item.slice(item.indexOf("\t") + 1)));
  const paths = tree
    .filter((item) => /^100(?:644|755) blob /.test(item)).map((item) => item.slice(item.indexOf("\t") + 1));
  const db = new DatabaseSync(join(attempt, "checkout/.pymtheg/rebuildable/graph.sqlite"), { readOnly: true });
  try {
    if (db.prepare("SELECT value FROM graph_meta WHERE key='schema'").get()?.value !== "3") throw Error("Coverage export supports graph schema 3");
    const files = db.prepare(`SELECT path,status,json_extract(body,'$.module') AS module,
      json_extract(body,'$.result.data.go.package') AS package FROM graph_files ORDER BY path`).all();
    const getFile = db.prepare(`SELECT json_extract(body,'$.text') AS text,
      json_extract(body,'$.result.diagnostics[0].message') AS reason,
      json_extract(body,'$.result.diagnostics[0].range.start') AS start FROM graph_files WHERE path=?`);
    const getLinks = db.prepare("SELECT id,body,resolution,kind,module FROM graph_links WHERE file=?");
    const imports = db.prepare("SELECT body,resolution FROM graph_links WHERE file=? AND kind='imports'");
    const declared = db.prepare(`SELECT 1 AS present FROM graph_symbols WHERE name=? AND file=?
      AND json_extract(body,'$.kind') IN ('enum','struct','type','trait','class','interface','function','method') LIMIT 1`);
    const hasName = db.prepare("SELECT 1 FROM graph_symbols WHERE name=? AND json_extract(body,'$.module')='typescript' LIMIT 1");
    const goSignatures = db.prepare(`SELECT file, json_extract(body,'$.data') AS data FROM graph_symbols WHERE name=?
      AND json_extract(body,'$.module')='go' AND json_extract(body,'$.kind')=?`);
    const goDefinitions = db.prepare(`SELECT file, json_extract(body,'$.kind') AS kind,
      json_extract(body,'$.data') AS data FROM graph_symbols WHERE name=? AND json_extract(body,'$.module')='go'`);
    const namesInModule = db.prepare(`SELECT name,file,json_extract(body,'$.kind') AS kind FROM graph_symbols
      WHERE name=? AND json_extract(body,'$.module')=? ORDER BY file,kind LIMIT 16`);
    const candidatesFor = db.prepare(`SELECT s.file,s.name,s.kind,json_extract(s.body,'$.identity') AS identity
      FROM graph_candidates c JOIN graph_symbols s ON s.id=c.symbol WHERE c.link=? ORDER BY s.file,s.name,s.kind,identity`);
    const definitionMemo = new Map();
    const definitions = (name, module) => {
      const key = `${name}\0${module}`;
      if (!definitionMemo.has(key)) definitionMemo.set(key, namesInModule.all(name, module));
      return definitionMemo.get(key);
    };
    const capturedNames = new Map();
    const project = projectEvidence(db, readers, files, paths, symlinks, join(attempt, "checkout"));
    const goPackages = new Map(files.filter(({ module }) => module === "go").map((file) => [file.path, file.package]));
    const goAliasCache = new Map();
    const goAliasesFor = (file, rows) => {
      if (!goAliasCache.has(file)) goAliasCache.set(file, goImports(rows ?? imports.all(file).map(({ body }) => JSON.parse(body))));
      return goAliasCache.get(file);
    };
    const goDeclarations = new Map();
    const goSampleDeclarations = (names, file, aliases) => {
      const directories = new Set([posix.dirname(file)]);
      for (const path of aliases.values()) {
        if (!path) continue;
        for (const directory of project.goDestinations(file, path).directories) directories.add(directory || ".");
      }
      return names.flatMap((name) => {
        if (!goDeclarations.has(name)) goDeclarations.set(name, goDefinitions.all(name).map((row) => ({ ...row, data: JSON.parse(row.data) })));
        return goDeclarations.get(name).filter((row) => directories.has(posix.dirname(row.file))).slice(0, 8).map((row) => {
          const { receiver, owner, results, t, v, underlying } = row.data ?? {};
          const types = new Set([t?.q, underlying?.q, ...(results ?? []).map((result) => result.t?.q)]);
          const bindings = [...goAliasesFor(row.file)].filter(([name]) => types.has(name));
          return { file: row.file, name, kind: row.kind, receiver, owner, results, t, v, underlying, bindings };
        });
      });
    };
    const returnedCache = new Map();
    const goReturned = (file, desc) => {
      if (desc.f?.k !== "name") return null;
      const owner = goPackages.get(file);
      if (!owner) return null;
      const directory = posix.dirname(file);
      const key = JSON.stringify([directory, owner, desc.f.n, desc.i]);
      if (!returnedCache.has(key)) {
        const definitions = goDefinitions.all(desc.f.n).filter((row) => posix.dirname(row.file) === directory && goPackages.get(row.file) === owner);
        const origins = definitions.map((row) => {
          if (row.kind !== "function") return null;
          const result = JSON.parse(row.data)?.results?.[desc.i];
          if (result?.k !== "val" || !result.t?.q) return null;
          const path = goAliasesFor(row.file).get(result.t.q);
          if (!path || classify({ module: "go", kind: "imports", resolution: "unresolved", file: row.file,
            targetName: path }, {}, project) !== "outside") return null;
          return { path, type: result.t.n };
        });
        const first = origins[0];
        returnedCache.set(key, first && origins.every((row) => row?.path === first.path && row?.type === first.type) ? first : null);
      }
      return returnedCache.get(key);
    };
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
    const reviewSites = {};
    const reviewOverlap = new Set();
    const workspaceMisses = new Map();
    const librarySites = new Map();
    const omissions = new Map();
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
      const tsRecordedBindings = new Set(records.filter((link) => !link.data?.specifier)
        .map((link) => `${link.range?.start}:${link.targetName}`));
      const tsRequires = new Set(records.filter((link) => link.data?.require && link.data?.specifier)
        .map((link) => `${link.range?.start}:${link.data.specifier}`));
      let bindings;
      const tsSourceBindings = () => bindings ??= tsBindings(readers.ts, file.path, source);
      const shapes = quotas && file.module === "typescript" && file.status !== "failed" ?
        typescriptShapes(readers.ts, tsSourceBindings().source, tsSourceBindings().names) : undefined;
      const observedSites = new Set();
      const reviewByBucket = new Map();
      const omittedCandidates = shapes?.omittedCandidates ?? [];
      const evidence = {
        goImports: file.module === "go" ? goAliasesFor(file.path, records) : new Map(),
        goExplicitAliases: new Set(records.map((link) => link.data?.alias).filter(Boolean)),
        goReturned: (desc) => goReturned(file.path, desc),
        rustImports: file.module === "rust" ? rustImports(records) : new Map(),
        tsSpecifiers: new Set(records.map((link) => link.data?.specifier).filter(Boolean)),
        tsImports: () => tsSourceBindings().imports,
        tsImportMember: (name) => {
          const binding = tsSourceBindings().importMembers.get(name);
          if (binding && (tsRecordedBindings.has(`${binding.start}:${binding.member}`) ||
              binding.member === "*" && tsRequires.has(`${binding.start}:${binding.specifier}`))) return binding;
          return undefined;
        },
        tsSpecifierAt: (offset) => tsSourceBindings().specifiers.find(({ start, end }) => start <= offset && offset < end)?.value,
        tsPropertyRoot: (offset) => tsSourceBindings().propertyRoots.get(offset),
        tsLiteral: (offset) => tsSourceBindings().literalProperties.has(offset),
        tsGlobal: (name) => {
          if (!capturedNames.has(name)) capturedNames.set(name, Boolean(hasName.get(name)));
          const local = tsSourceBindings();
          return !local.unsafe && !local.names.has(name) && !capturedNames.get(name);
        },
      };
      for (const row of getLinks.iterate(file.path)) {
        const link = { ...JSON.parse(row.body), module: row.module, kind: row.kind, resolution: row.resolution };
        if (quotas && link.range && !["contains", "receiver"].includes(link.kind)) {
          if (link.kind !== "calls" || file.module === "typescript") observedSites.add(link.range.start);
          const base = link.data?.expr?.x;
          if (file.module === "go" && link.kind === "calls" && base?.k === "name" && !evidence.goImports.has(base.n)) {
            const local = goSampleDeclarations([base.n], file.path, new Map()).some((row) =>
              row.kind === "var" && goPackages.get(row.file) === file.package);
            if (local) omittedCandidates.push({ family: "go-package-receiver", name: base.n, start: link.range.start });
          }
        }
        const disposition = classify(link, evidence, project);
        const library = externalIdentity(link, evidence, project, disposition);
        const tsExternal = link.module === "typescript" && link.resolution === "unresolved" && link.data?.reason === "external-package";
        const tsRoot = tsExternal ? /^(?:new\s+)?([\w$]+)(?:\??\.[\w$]+)?$/.exec(link.targetName)?.[1] : undefined;
        const specifier = tsExternal ? link.data?.specifier ?? (["imports", "exports"].includes(link.kind) ?
          evidence.tsSpecifierAt(link.range?.start) : evidence.tsImports().get(tsRoot)) : undefined;
        const workspaceName = specifier ? packageName(specifier) : undefined;
        const sibling = workspaceName && project.workspace.has(workspaceName) &&
          !["outside", "unclassified"].includes(project.tsLocation(file.path, workspaceName)) ? workspaceName : undefined;
        if (sibling) {
          if (disposition === "outside" || library) throw Error(`Workspace package classified outside at ${repo.id}/${file.path}`);
          const row = workspaceMisses.get(sibling) ?? { name: sibling, links: 0, files: new Set(), examples: [] };
          row.links++;
          row.files.add(file.path);
          if (row.examples.length < 2) {
            const { line } = location(source, link.range?.start);
            row.examples.push({ file: file.path, line });
          }
          workspaceMisses.set(sibling, row);
        }
        const tuple = [link.module, link.kind, link.resolution, link.data?.reason ?? null, link.data?.uncertainty ?? null, scope, disposition];
        const identity = [library?.level ?? null, library?.evidence ?? null, library?.gap ?? null];
        const key = JSON.stringify([...tuple, ...identity]);
        const aggregate = counts.get(key);
        const blocked = Number(link.data?.blocked === true);
        if (aggregate) { aggregate[7]++; aggregate[8] += blocked; }
        else counts.set(key, [...tuple, 1, blocked, ...identity]);
        if (library) {
          const group = JSON.stringify([link.module, link.kind, library.level, library.evidence, library.gap]);
          if (!librarySites.has(group)) {
            librarySites.set(group, { module: link.module, kind: link.kind, file: file.path,
              line: location(source, link.range?.start).line, ...library });
          }
        }
        const stratum = sampleStratum(link, disposition);
        const bucket = stratum ? reviewBucket(stratum, scope, disposition) : null;
        const references = referenceFiles?.get(file.path);
        const rank = stratum || references ? sampleKey(repo, link) : null;
        const state = library ? "outside" : link.resolution;
        const matched = rank && references?.has(rank);
        const verifiedCandidates = matched && state === "ambiguous" ? candidatesFor.all(row.id) : [];
        const candidateKey = verifiedCandidates.length ? createHash("sha256").update(JSON.stringify(verifiedCandidates)).digest("hex") : null;
        let site;
        if (bucket) {
          const ranks = reviewByBucket.get(bucket) ?? new Map();
          if (!reviewByBucket.has(bucket)) reviewByBucket.set(bucket, ranks);
          site = ranks.get(rank) ?? new Map();
          if (!ranks.has(rank)) ranks.set(rank, site);
          addObservation(site, JSON.stringify(library ?? state), () => ({ state, bucket, ...(library && { library }) }));
        }
        if (matched) {
          const observations = checks[rank] ?? new Map();
          if (!checks[rank]) checks[rank] = observations;
          addObservation(observations, JSON.stringify([state, bucket, library, candidateKey]),
            () => ({ state, bucket, ...(library && { library }), ...(candidateKey && { candidateKey }) }));
        }
        if (!stratum) continue;
        const population = `${stratum}:${scope}`;
        strata[population] = (strata[population] ?? 0) + 1;
        const sampleBucket = quotas ? bucket : stratum;
        remember(samples, sampleBucket, rank, () => {
          const p = location(source, link.range?.start);
          const data = link.data ?? {};
          const propertyRoot = quotas && link.module === "typescript" ? evidence.tsPropertyRoot(link.range?.start) : undefined;
          const targetRoot = propertyRoot ?? /^[\w$]+/.exec(link.targetName)?.[0];
          const expr = data.expr;
          const type = data.receiverType?.split("::").at(-1) ?? targetRoot;
          const binding = link.module === "rust" ? evidence.rustImports.get(targetRoot) :
            link.module === "typescript" ? evidence.tsImports().get(targetRoot) : evidence.goImports.get(targetRoot);
          const used = new Set([...(link.targetName ?? "").matchAll(/\b\w+\b/g)].map(([name]) => name));
          if (quotas) for (const [name] of JSON.stringify(expr ?? {}).matchAll(/\b\w+\b/g)) used.add(name);
          const aliases = link.module === "rust" ? evidence.rustImports : link.module === "go" ? evidence.goImports :
            quotas ? evidence.tsImports() : [];
          const origin = (path) => path && classify({ module: link.module, kind: "imports", file: file.path,
            resolution: "unresolved", targetName: path, data: { path, specifier: path } }, evidence, project);
          if (targetRoot) used.add(targetRoot);
          const relevantNames = [...new Set([targetRoot, type, expr?.x?.t?.n, data.method,
            /(?:\.|::)(\w+)$/.exec(link.targetName)?.[1]])].filter((name) => /^\w{2,65}$/.test(name ?? ""));
          const clues = quotas ? sourceClues(source, link.range?.start ?? 0, relevantNames) : [];
          for (const clue of clues) for (const [name] of clue.matchAll(/\b\w+\b/g)) used.add(name);
          const tsSite = quotas && link.module === "typescript" && link.kind === "calls" ?
            tsCallSite(readers.ts, tsSourceBindings().source, link.range) : undefined;
          const candidates = quotas && state === "ambiguous" ? verifiedCandidates.length ?
            verifiedCandidates : candidatesFor.all(row.id) : undefined;
          return { repo: repo.id, file: file.path, line: p.line, code: p.code, before: p.before,
            scope, kind: link.kind, disposition, target: link.targetName, reason: link.data?.reason ?? link.data?.uncertainty ?? null,
            ...(quotas ? { stratum, binding, sibling, propertyRoot, offset: link.range?.start, observations: site,
              after: source.slice(link.range?.start ?? 0, (link.range?.start ?? 0) + 460),
              aliases: [...aliases].filter(([name]) => used.has(name)).map(([name, path]) => [name, path, origin(path)]),
              clues, tsSite,
              tsNestedFunction: shapes?.nested.has(targetRoot) || undefined,
              tsObjectMember: shapes?.objectMembers.has(link.range?.start) || undefined,
              rustGlob: link.module === "rust" ? records.filter((record) => record.data?.glob).map((record) => record.targetName) : undefined,
              tsConfig: link.module === "typescript" ? [...project.tsConfigs].filter(([path]) => {
                const dir = posix.dirname(path);
                return dir === "." || file.path.startsWith(`${dir}/`);
              }).sort(([a], [b]) => b.length - a.length).slice(0, 3) : undefined,
              definitions: relevantNames.flatMap((name) => definitions(name, link.module)),
              goDefinitions: link.module === "go" ? goSampleDeclarations([...used].filter((name) => /^\w{2,65}$/.test(name)),
                file.path, evidence.goImports) : undefined,
              candidates: candidates?.slice(0, 20), candidateCount: candidates?.length,
              candidateKey: candidates?.length ? createHash("sha256").update(JSON.stringify(candidates)).digest("hex") : undefined,
              tsLocalBindings: link.module === "typescript" ? tsSourceBindings().names.get(targetRoot) : undefined,
              tsLiteralReceiver: link.module === "typescript" && evidence.tsLiteral(link.range?.start) || undefined } : {}),
            ...(type && declared.get(type, file.path) ? { declaredHere: true } : {}),
            ...(link.module === "go" ? { expr, open: data.open,
              ...(link.kind === "calls" && goFactory(file.path, expr, evidence.goImports) ? { factory: "inside" } : {}) } : {}),
            ...(link.module === "rust" ? { receiver: data.receiverType, method: data.method, impl: data.implType,
              ...(quotas && { receiverBindings: data.genericBindings }) } : {}),
            ...(link.module === "typescript" ? { jsx: data.jsx, specifier: data.specifier ?? evidence.tsImports().get(targetRoot) } : {}) };
        }, quotas?.get(sampleBucket) ?? (quotas ? 6 : sampleSize(sampleBucket)));
      }
      const strataBySite = new Map();
      for (const [bucket, ranks] of reviewByBucket) {
        const eligible = [...ranks.values()].filter((observations) =>
          [...observations.values()].some(({ state }) => state !== "outside"));
        reviewSites[bucket] = (reviewSites[bucket] ?? 0) + eligible.length;
        for (const rank of ranks.keys()) {
          const others = strataBySite.get(rank) ?? [];
          for (const other of others) reviewOverlap.add(JSON.stringify([bucket, other].sort(compare)));
          others.push(bucket);
          strataBySite.set(rank, others);
        }
      }
      if (goMapKeys && file.module === "go" && file.status !== "failed" && /\bmap\s*\[/.test(source)) {
        for (const site of goMapKeys(source)) {
          if (goSampleDeclarations([site.name], file.path, new Map()).some((row) =>
            ["const", "var"].includes(row.kind) && goPackages.get(row.file) === file.package)) {
            omittedCandidates.push({ ...site, family: "go-map-key" });
          }
        }
      }
      const visited = new Set();
      for (const { family, name, start } of omittedCandidates) {
        if (observedSites.has(start)) continue;
        const key = `${family}:${start}`;
        if (visited.has(key)) continue;
        visited.add(key);
        const row = omissions.get(family) ?? { family, sites: 0, examples: [] };
        row.sites++;
        if (row.examples.length < 2) {
          row.examples.push({ file: file.path, line: location(source, start).line, name });
        }
        omissions.set(family, row);
      }
    }
    const rows = [...counts].sort(([a], [b]) => compare(a, b)).map(([, value]) => value);
    const actual = repositoryScore(rows);
    const warm = readJson(join(attempt, "warm.out")).counts;
    if (actual.total !== warm.links || actual.ambiguous !== warm.ambiguous ||
        actual.inside + actual.outside + actual.unclassified !== warm.unresolved) throw Error(`Stored link totals disagree with released CLI for ${repo.id}`);
    return { audit: { id: repo.id, language: repo.language, commit: repo.commit, outcome: repo.outcome,
      trackedSource: repo.trackedSource, breakdown: rows, sourceFiles: [...sourceFiles.values()],
      failedSources: [...failed.values()].map(({ examples, ...record }) => record), strata, reviewSites,
      ...(reviewOverlap.size ? { reviewOverlap: [...reviewOverlap].sort(compare).map((key) => JSON.parse(key)) } : {}),
      ...(librarySites.size ? { libraryExamples: [...librarySites.values()] } : {}),
      ...(omissions.size ? { sourceOmissions: [...omissions.values()] } : {}),
      ...(workspaceMisses.size ? { workspaceMisses: [...workspaceMisses.values()].map((row) => ({ ...row, files: row.files.size })) } : {}),
      ...(referenceFiles ? { checks: Object.fromEntries(Object.entries(checks).map(([key, facts]) => [key, [...facts.values()]])) } : {}) },
      failedExamples: [...failed.values()],
      samples: Object.fromEntries([...samples].map(([bucket, rows]) => [bucket, rows.map(({ observations, ...row }) =>
        observations ? { ...row, observations: [...observations.values()] } : row)])) };
  } finally { db.close(); }
}

const { values } = parseArgs({ options: {
  results: { type: "string" }, scratch: { type: "string", default: process.env.PYM_SCRATCH },
  output: { type: "string" }, "metadata-root": { type: "string" }, "reference-samples": { type: "string" },
  "include-failed": { type: "string" },
  "sampling-base": { type: "string" },
} });
if (!values.results || !values.scratch || !values.output) throw Error("Use --results, --output and --scratch (or PYM_SCRATCH)");
const scratch = resolve(values.scratch);
const output = resolve(values.output);
const input = readJson(values.results);
const basis = values["sampling-base"] ? readJson(values["sampling-base"]) : null;
const quotas = basis ? basis.samplingQuotas ? new Map(Object.entries(basis.samplingQuotas)) : reviewQuotas(basis.repos) : null;
if (values["include-failed"]) {
  const previous = readJson(values["include-failed"]);
  if (previous.release.integrity !== input.release.integrity || !input.release.integrity) {
    throw Error("Old failure records must use the same released package");
  }
  const current = new Set(input.repos.map(({ id }) => id));
  input.repos.push(...previous.repos.filter((repo) => repo.outcome !== "finished" && !current.has(repo.id)));
}
const packageRoot = resolve(values["metadata-root"] ?? join(scratch, "release/node_modules/pymtheg"));
const readers = await loadReaders(packageRoot);
const goMapKeys = quotas ? await goMapKeyReader((await import(pathToFileURL(join(packageRoot, "dist/graph/tree-sitter.js")))).createTagsParser,
  packageRoot) : undefined;
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
  .update(readFileSync(new URL("./coverage-locations.mjs", import.meta.url)))
  .update(readFileSync(new URL("./coverage-source.mjs", import.meta.url)))
  .update(JSON.stringify([...quotas ?? []]))
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
    atomicJson(path, scanRepo(scratch, repo, readers, reference.get(repo.id), quotas, goMapKeys));
  }
  const { audit, samples, failedExamples } = readJson(path);
  if (failedExamples.length) failures[repo.id] = failedExamples;
  if (samples["rust:failed-file-taint"]?.length) taintExamples[repo.id] = samples["rust:failed-file-taint"].slice(0, 5);
  repositories.push(audit);
  for (const [stratum, entries] of Object.entries(samples)) for (const { key, ...sample } of entries) {
    remember(shortlist, stratum, key, () => sample, quotas?.get(stratum) ?? (quotas ? 6 : sampleSize(stratum)));
  }
}
const release = input.release;
writeFileSync(output, ["{", '  "schema": "pymtheg.sweep.coverage/v2",', `  "columns": ${JSON.stringify(columns)},`,
  ...(quotas ? [`  "samplingQuotas": ${JSON.stringify(Object.fromEntries(quotas))},`] : []),
  `  "release": ${JSON.stringify(release)},`, '  "repos": [',
  repositories.sort((a, b) => compare(a.id, b.id)).map((repo) => `    ${JSON.stringify(repo)}`).join(",\n"), "  ]", "}", ""].join("\n"));
atomicJson(`${output}.samples.json`, Object.fromEntries([...shortlist].sort(([a], [b]) => compare(a, b))));
atomicJson(`${output}.failed-examples.json`, failures);
atomicJson(`${output}.taint-examples.json`, taintExamples);
console.error(`Exported ${repositories.length} attempts, ${repositories.filter(({ outcome }) => outcome === "finished").length} studied graphs`);
