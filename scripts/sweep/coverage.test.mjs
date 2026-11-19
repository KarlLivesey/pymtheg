// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { aggregate, auditDesign, estimateCoverage, failedRustInfluence, installedCoverage, median, stratumShare } from "./coverage.mjs";
import { classify, columns, externalIdentity, goImports, libraryScore, repositoryScore, reviewQuotas, rustImports, sampleKey, sampleStratum, sourceScope, workspaceNames } from "./coverage-rules.mjs";

test("assumed Level 2 links remain in the total and are counted separately", () => {
  const score = libraryScore([
    ["rust", "types", "resolved", null, null, "source", "eligible", 4, 0, null, null, null],
    ["rust", "calls", "resolved", null, null, "source", "eligible", 2, 0, null, null, null, true],
    ["rust", "types", "library", null, null, "source", "outside", 3, 0, 2, "declared-builtin", null, true],
    ["rust", "calls", "unresolved", null, null, "source", "inside", 1, 0, null, null, null],
  ]);
  assert.equal(score.total, 10);
  assert.equal(score.level2, 0.9);
  assert.equal(score.level2WithoutAssumptions, 0.4);
  assert.equal(score.assumedLevel2, 5);
});

test("the plan input regenerates Rust and preserves the other sections", () => {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const checkedIn = readFileSync(join(root, "docs/coverage-plan.md"));
  const scratch = mkdtempSync(join(tmpdir(), "pymtheg-coverage-plan-"));
  const plan = join(scratch, "coverage-plan.md");
  const old = checkedIn.toString("utf8").replace(
    /^### Rust\n[\s\S]*?(?=^### TypeScript \/ JS\n)/m,
    "### Rust\n\nPlaceholder\n\n",
  );
  assert.notEqual(old, checkedIn.toString("utf8"));
  writeFileSync(plan, old);
  try {
    execFileSync(process.execPath, ["scripts/sweep/coverage.mjs", "--results", "sweep/plan-input.json.gz",
      "--plan", plan, "--rust-section"], { cwd: root });
    assert.ok(readFileSync(plan).equals(checkedIn), "regenerated coverage plan differs");
  } finally {
    unlinkSync(plan);
    rmdirSync(scratch);
  }
});

import { cargoPathLocations, checkoutLocation, npmPathLocation, yarnArchivePackages } from "./coverage-locations.mjs";

const project = {
  tsPackages: new Set(["@my/workspace"]), tsExternal: new Set(["react", "@my/workspace"]), tsAliases: [/@app\//],
  goModules: ["example.com/app"], vendoredGo: new Set(["example.org/vendored"]),
  goDestinations: (_file, target) => target.startsWith("example.com/app/") ? { directories: ["local"], outside: false } : { directories: [], outside: true },
  goExternal: (_file, path) => path === "example.net/dependency", rustLocal: new Set(["core"]),
  rustBindings: (_file, alias) => alias === "captured" ? "inside" : undefined,
  rustPrelude: (name) => name === "assert_eq" || name === "usize",
};
const imports = (...paths) => paths.map((path) => ({ targetName: path, data: { path } }));
const evidence = {
  goImports: goImports(imports("strconv", "context", "net/http", "example.org/vendored", "example.net/dependency", "example.com/app/local")),
  rustImports: rustImports([{ targetName: "std::fs", data: { alias: "filesystem" } }]),
  tsImports: () => new Map([["io", "node:fs"], ["example", "@my/workspace"]]),
  tsSpecifiers: new Set(["node:fs", "@my/workspace"]),
};
const classifyLink = (module, targetName, data, kind = "calls") => classify({ module, targetName, data, kind, file: "src/example", resolution: "unresolved" }, evidence, project);
const selector = (name) => ({ expr: { k: "sel", x: { k: "name", n: name } } });

test("excludes proved external paths and keeps vendoring, aliases and shadows distinct", () => {
  assert.equal(classifyLink("go", "strconv.Quote", selector("strconv")), "outside");
  assert.equal(classifyLink("go", "vendor.Run", selector("vendored")), "inside");
  assert.equal(classifyLink("go", "local.Run", selector("local")), "inside");
  assert.equal(classifyLink("go", "dependency.Run", selector("dependency")), "outside");
  assert.equal(classifyLink("go", "strconv.Quote", { expr: { k: "sel", x: { k: "local" } } }), "unclassified");
  assert.equal(classifyLink("go", "C", { path: "C" }, "imports"), "unclassified");
  assert.equal(classifyLink("go", "cancel", { expr: { k: "call", f: { ...selector("context").expr, n: "WithCancel" }, i: 1 } }), "outside");
  assert.equal(classifyLink("go", "response.Body", { expr: { k: "sel", x: { k: "val", t: { q: "http", n: "Response" } } } }), "unclassified");
  assert.equal(classifyLink("go", "writer.Write", { expr: { k: "sel", x: { k: "val", t: { q: "http", n: "ResponseWriter" } } } }), "unclassified");
  assert.equal(classifyLink("rust", "filesystem::read", { pathSyntax: "filesystem::read" }), "outside");
  assert.equal(classifyLink("rust", "core::run", {}), "unclassified");
  assert.equal(classifyLink("rust", "std::run", { blocked: true }), "unclassified");
  assert.equal(classifyLink("rust", "self::run", {}), "inside");
  assert.equal(classifyLink("rust", "std", {}, "modules"), "inside");
  assert.equal(classifyLink("rust", "assert_eq", {}, "macros"), "outside");
  assert.equal(classifyLink("rust", "assert_eq", { blocked: true }, "macros"), "unclassified");
  assert.equal(classifyLink("rust", "usize", {}, "types"), "outside");
  assert.equal(classifyLink("typescript", "io.readFile", { reason: "external-package" }), "outside");
  assert.equal(classifyLink("typescript", "example.run", { reason: "external-package" }), "inside");
  assert.equal(classifyLink("typescript", "other.run", { reason: "external-package" }), "unclassified");
  assert.equal(classifyLink("typescript", "lib.dom", { reference: "lib", reason: "external" }, "imports"), "outside");
  assert.equal(classifyLink("typescript", "@app/local", { specifier: "@app/local", reason: "external-package" }, "imports"), "unclassified");
  assert.equal(classifyLink("typescript", "../../outside.js", { specifier: "../../outside.js", reason: "missing-module" }, "imports"), "outside");
});

const linkRow = (module, outcome, disposition, count, scope = "source", level = null, encoding = null, gap = null, reason = null) =>
  [module, "calls", outcome, reason, null, scope, disposition, count, 0, level, encoding, gap];

test("installed coverage keeps the bare score when an install failed", () => {
  const pin = (id, resolved) => ({ id, commit: "a".repeat(40), language: "typescript", outcome: "finished", breakdown: [
    linkRow("typescript", "resolved", "eligible", resolved),
    linkRow("typescript", "unresolved", "inside", 10 - resolved),
  ] });
  const a = { ...pin("package/a", 5), unbuiltWorkspaceLinks: 2 };
  const b = { ...pin("package/b", 3), unbuiltWorkspaceLinks: 1 };
  const score = installedCoverage([a, b], { repos: [
    { ...pin(a.id, 9), unbuiltWorkspaceLinks: 4, install: { manager: "pnpm", status: "installed" } },
    { id: b.id, commit: b.commit, outcome: "install-unavailable", install: { manager: "npm", status: "failed" } },
  ] });
  assert.equal(score.totals, "40.00% bare · 60.00% with installed declarations · 1/2 pins installed and indexed");
  assert.match(score.table, /\| package\/b \| 30\.00% \| 30\.00% \| npm · install-unavailable \|/);
  assert.deepEqual(score.unbuilt, { bare: 3, installed: 5 });
});
const bucketFor = (reason) => `typescript:${reason}:source:unclassified`;
const observed = (bucket, links = 1, state = "unresolved") => [{ bucket, links, state }];

test("distinguishes named packages, named members, and unproved receivers", () => {
  const external = (module, targetName, data, kind = "calls", details = evidence, location = project) => {
    const link = { resolution: "unresolved", module, kind, file: "src/main", targetName, data };
    return externalIdentity(link, details, location, classify(link, details, location));
  };
  assert.deepEqual(external("go", "strconv", { path: "strconv" }, "imports"),
    { level: 1, unit: "strconv", evidence: "path", gap: "whole-unit" });
  assert.deepEqual(external("go", "strconv.Quote", { expr: { ...selector("strconv").expr, n: "Quote" } }),
    { level: 2, unit: "strconv", symbol: "Quote", evidence: "import-binding", gap: null });
  assert.equal(external("go", "T", { t: { q: "vendor", n: "T" } }, "references"), null);
  assert.equal(external("go", "len", { builtin: true }).gap, "intrinsic");
  assert.deepEqual(external("rust", "std::fs::read", { pathSyntax: "std::fs::read" }),
    { level: 2, unit: "std", symbol: "fs::read", evidence: "path", gap: null });
  assert.equal(external("rust", "res.unwrap", { method: "unwrap" }), null);
  assert.equal(external("rust", "res.unwrap", { method: "unwrap", receiverType: "std::result::Result", blocked: true }), null);
  assert.equal(external("rust", "path.into", { method: "into", receiverType: "std::path::Path" }), null);
  const dependency = { ...project, rustBindings: (_file, name) => name === "keccak" ? "outside" : project.rustBindings(_file, name) };
  assert.equal(external("rust", "state.iter", { method: "iter", receiverType: "keccak::State1600" }, "calls", evidence, dependency), null);
  const externalCrates = { ...project, rustBindings: (_file, name) => ["ropey", "thiserror"].includes(name) ? "outside" : undefined };
  const importsWithLocalNames = { ...evidence, rustImports: rustImports([
    { targetName: "ropey::RopeSlice", data: { alias: "RopeSlice" } },
    { targetName: "helix_stdx::rope::RopeSliceExt", data: { alias: "_" } },
    { targetName: "thiserror::Error", data: { alias: "Error" } },
  ]) };
  // The dot call can pick the checkout's extension trait or the local
  // enum named Error. Neither the type spelling nor a matching import
  // establishes a library method owner.
  for (const [target, type] of [["text.regex_input", "RopeSlice"], ["source.floor_char_boundary", "ropey::RopeSlice"],
    ["source.ceil_char_boundary", "ropey::RopeSlice"], ["self.to_string", "Error"]]) {
    const method = target.split(".")[1];
    assert.equal(external("rust", target, { method, receiverType: type }, "calls", importsWithLocalNames, externalCrates), null);
  }
  assert.deepEqual(external("rust", "<T as std::io::Write>::write_all", { pathSyntax: "<T as std::io::Write>::write_all" }),
    { level: 2, unit: "std", symbol: "io::Write::write_all", evidence: "explicit-trait", gap: null });
  assert.equal(external("go", "file.Fd", { expr: { k: "sel", n: "Fd", x: { k: "val", t: { q: "os", n: "File" } } } },
    "calls", { ...evidence, goImports: goImports(imports("os")) }), null);
  const binding = { ...evidence, tsImportMember: (name) => name === "run" ? { specifier: "node:child_process", member: "spawnSync" }
    : name === "z" ? { specifier: "zod", member: "z" } : name === "io" ? { specifier: "node:fs", member: "*" } : undefined };
  const declared = { ...project, tsExternal: new Set(["zod"]) };
  assert.equal(external("typescript", "run", { reason: "external-package" }, "calls", binding).symbol, "spawnSync");
  for (const reason of ["no-symbol", "local"]) {
    assert.deepEqual(external("typescript", "io.readFile", { reason }, "calls", binding),
      { level: 2, unit: "node:fs", symbol: "readFile", evidence: "import-binding", gap: null });
  }
  assert.equal(external("typescript", "z.string", { reason: "external-package" }, "calls", binding, declared).symbol, "z.string");
  assert.equal(external("typescript", "z.string", { reason: "external-package" }, "calls", binding,
    { ...declared, tsPackages: new Set(["zod"]) }), null);
  assert.equal(external("typescript", "foo", { reason: "external-package" }), null);
  for (const reasonWithoutConfig of ["workspace-build-output-missing", "workspace-entry-unavailable"]) {
    assert.equal(external("typescript", "io.readFile",
      { reason: "incomplete-config", reasonWithoutConfig }, "calls", binding), null);
  }
});

test("reads Yarn package membership and resolves dependency paths against the checkout", () => {
  const scratch = mkdtempSync(join(tmpdir(), "coverage-locations-"));
  try {
    const name = Buffer.from("node_modules/@example/tool/package.json");
    const directory = Buffer.alloc(46 + name.length);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(name.length, 28);
    name.copy(directory, 46);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(directory.length, 12);
    const archive = join(scratch, "cached-package.zip");
    writeFileSync(archive, Buffer.concat([directory, end]));
    assert.deepEqual([...yarnArchivePackages(archive)], ["@example/tool"]);
    const link = { resolution: "unresolved", module: "typescript", kind: "imports", file: "app/main.ts",
      targetName: "@example/tool", data: { specifier: "@example/tool", reason: "external-package" } };
    const cached = { ...project, tsPackages: yarnArchivePackages(archive), tsExternal: new Set(["@example/tool"]) };
    assert.equal(classify(link, evidence, cached), "inside");
    assert.equal(externalIdentity(link, evidence, cached, "inside"), null);
    assert.equal(yarnArchivePackages(join(scratch, "missing.zip")), null);
    const tracked = new Set(["shared", "app"]);
    assert.equal(npmPathLocation(".", "file:../shared", tracked), "outside");
    assert.equal(npmPathLocation("app", "file:../shared", tracked), "inside");
    assert.equal(npmPathLocation("app", "file:/var/shared", tracked), "unclassified");
    assert.equal(npmPathLocation(".", "file:linked/../shared", tracked, new Set(["linked"])), "unclassified");
    assert.equal(checkoutLocation(".", "../shared/Cargo.toml", tracked), "outside");
    assert.equal(checkoutLocation(".", "missing/Cargo.toml", tracked), "unclassified");
    const cargoPaths = cargoPathLocations(new Map([["Cargo.toml", {
      workspace: { dependencies: { shared: { path: "../shared" } } },
      dependencies: { symlink: { path: "linked/../local" }, absolute: { path: "/other" } },
    }]]), new Set(["local/Cargo.toml", "other/Cargo.toml"]), new Set(["linked"]));
    assert.deepEqual([...cargoPaths], [["local/Cargo.toml", "unclassified"], ["other/Cargo.toml", "unclassified"],
      ["../shared/Cargo.toml", "outside"]]);
    assert.equal(classify(link, evidence, { ...project, tsLocation: () => "outside" }), "outside");
    const rust = { ...link, module: "rust", targetName: "shared::work", data: {} };
    assert.equal(externalIdentity(rust, evidence, { ...project, rustBindings: () => "outside" }, "outside").level, 2);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("raw and strict denominators use finished graphs only", () => {
  const row = (outcome, disposition, count, scope = "source") => linkRow("go", outcome, disposition, count, scope,
    ...(disposition === "outside" ? [1, "path", "whole-unit"] : []));
  const breakdown = [row("resolved", "eligible", 3), row("ambiguous", "eligible", 2), row("unresolved", "inside", 2),
    row("unresolved", "unclassified", 1), row("unresolved", "outside", 4, "bundle")];
  assert.deepEqual(repositoryScore(breakdown), { resolved: 3, ambiguous: 2, inside: 2, outside: 4, unclassified: 1,
    eligible: 8, total: 12, raw: 3/12, adjusted: 3/8 });
  const repos = [{ language: "go", outcome: "finished", breakdown }, { language: "go", outcome: "wall-limit" }];
  assert.equal(aggregate(repos, "go").observed, 1);
  assert.equal(aggregate(repos, "go").weighted.adjusted, 3/8);
  assert.equal(aggregate(repos, "go").median.adjusted, 3/8);
  assert.equal(aggregate(repos, "go", ["source"]).weighted.raw, 3/8);
  assert.equal(median([3, 1, 9, 6]), 4.5);
});

test("tracks declared npm and pnpm siblings and honours exclusions", () => {
  const manifests = new Map([
    ["package.json", { workspaces: { packages: ["tools/*"] } }],
    ["tools/cli/package.json", { name: "@local/cli" }],
    ["apps/editor/package.json", { name: "@local/editor" }],
    ["apps/fixtures/package.json", { name: "@local/fixtures" }],
    ["unrelated/package.json", { name: "@local/unrelated" }],
  ]);
  const pnpm = new Map([["pnpm-workspace.yaml", "packages:\n  - 'apps/*'\n  - '!apps/fixtures' # fixtures have their own package name\n"]]);
  assert.deepEqual([...workspaceNames(manifests, pnpm)], ["@local/cli", "@local/editor"]);
});

test("artifact rules are explicit and sample keys survive graph ID changes", () => {
  assert.equal(sourceScope("pocketbase/pocketbase", "ui/dist/assets/file.js", "x()"), "bundle");
  assert.equal(sourceScope("pocketbase/pocketbase", "ui/public/libs/uplot/uplot.iife.js", "x".repeat(900)), "bundle");
  assert.equal(sourceScope("pocketbase/pocketbase", "ui/public/libs/readable.js", "x()"), "source");
  assert.equal(sourceScope("vitejs/vite", "src/SyntaxError.ts", "x()"), "source");
  assert.equal(sourceScope("vitejs/vite", "test/fixtures/SyntaxError.ts", "x()"), "broken-fixture");
  assert.equal(sourceScope("tauri-apps/tauri", "a/templates/plugin.rs", "{{#if a}}"), "template");
  assert.equal(sourceScope("golang/tools", "go/ssa/interp/testdata/static.go", "_ = (make)([]int, 0)"), "source");
  assert.equal(sourceScope("golang/tools", "go/ssa/interp/testdata/complit_go128.go", "invalid"), "broken-fixture");
  const repo = { id: "example/repo", commit: "a".repeat(40) };
  const link = { id: "old", module: "go", file: "a.go", kind: "calls", range: { start: 1, end: 2 }, targetName: "run" };
  assert.equal(sampleKey(repo, link), sampleKey(repo, { ...link, id: "new" }));
  assert.notEqual(sampleKey(repo, link), sampleKey(repo, { ...link, range: { start: 2, end: 3 } }));
});

test("failed-file taint reserves links that also have a receiver reason", () => {
  const uncertainty = "receiver-type-unverified; failed-file-unseen-declarations";
  const link = { module: "rust", resolution: "unresolved", data: { uncertainty } };
  assert.equal(sampleStratum(link, "inside"), "rust:failed-file-taint");
  assert.deepEqual(failedRustInfluence({ breakdown: [
    ["rust", "calls", "unresolved", null, uncertainty, "source", "inside", 8, 5],
    ["rust", "calls", "unresolved", null, uncertainty, "source", "outside", 3, 1],
    ["rust", "calls", "unresolved", null, "receiver-type-unverified", "source", "unclassified", 2, 1],
  ] }), { total: 11, eligible: 8, missing: 11, blocked: 6, receivers: 11, allBlocked: 7 });
});

test("observes full-denominator coverage and weights each sampled site by its links", () => {
  const breakdown = [
    linkRow("go", "resolved", "eligible", 40),
    linkRow("go", "unresolved", "outside", 7, "source", 2, "import-binding"),
    linkRow("go", "unresolved", "outside", 3, "source", 1, "path", "whole-unit"),
    linkRow("go", "unresolved", "outside", 10, "source", 0, null, "dependency"),
    linkRow("go", "unresolved", "unclassified", 32),
    linkRow("go", "ambiguous", "eligible", 8),
  ];
  const missing = "go:empty:source:unclassified", options = "go:ambiguous:source:eligible";
  const repo = { id: "fixture/repo", language: "go", outcome: "finished", breakdown, reviewSites: { [missing]: 8, [options]: 2 } };
  const sample = (key, label, links, extra = {}) => ({ repo: repo.id, key, label, observations: observed(missing, links), ...extra });
  const samples = [sample("inside", "support", 4, { item: "inside" }),
    sample("outside", "outside", 1, { item: "outside" }), sample("dependency", "outside", 2, { horizon: "dependency" }),
    sample("unknown", "unknown", 1),
    sample("closed", "dynamic", 1, { observations: observed(options, 1, "ambiguous"), closed: "Both targets verified", candidateKey: "key" }),
    sample("open", "dynamic", 1, { observations: observed(options, 1, "ambiguous") })];
  const result = estimateCoverage([repo, { outcome: "wall-limit" }], samples, "go");
  assert.equal(result.measured.raw, 0.4);
  assert.equal(result.measured.adjusted, 0.5);
  assert.equal(result.measured.level1, 0.5);
  assert.equal(result.measured.level2, 0.47);
  assert.equal(result.closedCoverage, 0.51);
  assert.equal(result.ceiling, 0.71);
  assert.equal(result.dependency, 18);
  assert.equal(result.support.get("outside").outside, 4);
  assert.equal(result.support.get("inside").inside, 16);
  assert.ok(result.intervals.dependency[0] <= result.dependency && result.intervals.dependency[1] >= result.dependency);
  assert.equal(libraryScore(breakdown).neither, 10);
  assert.deepEqual([...reviewQuotas([repo])], [[missing, 32], [options, 8]]);
  const stats = stratumShare([{ links: 4, outside: 4 }, { links: 1, outside: 0 }], 4, "outside");
  assert.equal(stats.share, .8);
  assert.ok(Math.abs(stats.variance - .0512) < 1e-10);
});

test("a reason-only move between populated strata retains the original design weight", () => {
  const old = bucketFor("no-symbol"), current = bucketFor("external-package");
  const misses = (count, reason) => linkRow("typescript", "unresolved", "unclassified", count, "source", null, null, null, reason);
  const bound = (reason) => linkRow("typescript", "unresolved", "outside", 1, "source", 2, "import-binding", null, reason);
  const repo = { id: "fixture/repo", language: "typescript", outcome: "finished", reviewSites: { [old]: 100, [current]: 99 },
    breakdown: [misses(100, "no-symbol"), misses(99, "external-package"), bound("no-symbol")] };
  const sample = (key, bucket, label, item) => ({ repo: repo.id, key, label, item, observations: observed(bucket) });
  const samples = [sample("moves", old, "outside", "identify"), sample("stays", old, "support", "inside"),
    sample("there1", current, "support", "inside"), sample("there2", current, "support", "inside")];
  const candidate = { ...repo, reviewSites: { [old]: 99, [current]: 100 },
    breakdown: [misses(99, "no-symbol"), misses(100, "external-package"), bound("local")],
    checks: { moves: observed(current), stays: observed(old), there1: observed(current), there2: observed(current) } };
  const before = estimateCoverage([repo], samples, "typescript");
  const after = estimateCoverage([candidate], samples, "typescript", undefined, auditDesign([candidate], samples, [repo]));
  assert.equal(before.measured.level2, 1 / 200);
  assert.equal(after.measured.level2, before.measured.level2);
  assert.equal(after.support.get("identify").outside, 50);
  assert.deepEqual(after.support, before.support);
  assert.deepEqual(after.intervals, before.intervals);
  assert.equal(after.unaudited, 0);
});

test("candidate overlay rewrites the plan only for matched evidence", () => {
  const scratch = mkdtempSync(join(tmpdir(), "coverage-progress-"));
  try {
    const repo = { id: "fixture/repo", commit: "a".repeat(40), language: "go", outcome: "finished",
      sourceFiles: [{ module: "go", scope: "source", readableLines: 10 }], failedSources: [],
      reviewSites: { "go:empty:source:unclassified": 2 }, breakdown: [linkRow("go", "unresolved", "unclassified", 2)] };
    const packet = (repos) => ({ schema: "pymtheg.sweep.coverage/v2", release: { package: "fixture" }, columns, repos });
    const stalled = { id: "fixture/stalled", commit: "c".repeat(40), language: "rust", outcome: "wall-limit",
      failure: { lastProgress: "graph analyze rust: 1523/1523" } };
    const crash = { ...stalled, id: "fixture/crash", commit: "d".repeat(40) };
    const base = packet([repo, { id: "fixture/other", commit: "b".repeat(40), language: "rust", outcome: "wall-limit" }, stalled, crash]);
    const candidate = packet([{ ...repo, checks: { known: observed(null, 1, "resolved"), missing: observed("go:empty:source:unclassified") }, reviewSites: { "go:empty:source:unclassified": 1 }, breakdown: [
      linkRow("go", "resolved", "eligible", 1),
      linkRow("go", "unresolved", "unclassified", 1),
    ] }, { ...base.repos[1], outcome: "finished", sourceFiles: [], failedSources: [], reviewSites: { "rust:empty:source:unclassified": 3 }, breakdown: [
      linkRow("rust", "resolved", "eligible", 2),
      linkRow("rust", "unresolved", "unclassified", 3),
    ] }, stalled, { ...crash, outcome: "crashed" }]);
    const put = (filename, data) => {
      const file = join(scratch, filename);
      writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
      return file;
    };
    const example = { repo: repo.id, file: "main.go", line: 2, code: "work()" };
    const item = { id: "calls", module: "go", kind: "inside", title: "Resolve local calls", examples: [example, { ...example, line: 5 }] };
    const items = put("items.json", { items: [item] });
    const samples = put("samples.json", { samples: ["known", "missing"].map((key) => ({ key, item: "calls", repo: repo.id,
      label: "support", observations: observed("go:empty:source:unclassified"), basis: "Checked-in call", stratum: "go:empty", disposition: "unclassified", scope: "source" })) });
    const plan = put("plan.md", "Before.\n<!-- sweep:coverage:start -->\nold\n<!-- sweep:coverage:end -->\nAfter.\n");
    const scoreboard = join(scratch, "score.md");
    execFileSync(process.execPath, [fileURLToPath(new URL("./coverage.mjs", import.meta.url)), "--results", put("candidate.json", candidate),
      "--base", put("base.json", base), "--plan", plan, "--scoreboard", scoreboard, "--items", items, "--samples", samples]);
    const rendered = readFileSync(plan, "utf8");
    assert.match(rendered, /^Before\./);
    assert.match(rendered, /1\/2 reference sites settled/);
    assert.match(rendered, /50\.00 pp/);
    assert.ok(rendered.split("\n").includes("- [ ] fixture/stalled · Wall limit after Rust analysis completed · open"));
    assert.ok(rendered.split("\n").includes("- [ ] fixture/crash · crashed · open"));
    assert.match(rendered, /After\.\n$/);
    const report = readFileSync(scoreboard, "utf8");
    assert.match(report, /- \[x\] fixture\/other · wall-limit · finished/);
    assert.match(report, /\| All files \| Rust \| 1 \| 40\.00% \| 40\.00%/);

    delete candidate.repos[0].checks;
    execFileSync(process.execPath, [fileURLToPath(new URL("./coverage.mjs", import.meta.url)), "--results", put("candidate.json", candidate),
      "--base", put("base.json", base), "--plan", plan, "--scoreboard", scoreboard, "--items", items, "--samples", samples]);
    assert.doesNotMatch(readFileSync(plan, "utf8"), /reference sites settled/);
    assert.match(readFileSync(scoreboard, "utf8"), /\| Go \| 0 \| 1 \|/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("a stored library target is credited as stored; a 0.1.0 link is reconstructed", () => {
  const library = (target) => ({ resolution: "library", module: "go", kind: "calls", file: "src/main", targetName: "strconv.Quote", library: target });
  const stored = library({ ecosystem: "go-std", unit: "strconv", symbol: "Quote", evidence: "import-binding" });
  assert.equal(classify(stored, evidence, project), "outside");
  assert.deepEqual(externalIdentity(stored, evidence, project, "outside"),
    { level: 2, unit: "strconv", symbol: "Quote", evidence: "import-binding", gap: null });
  assert.deepEqual(externalIdentity(library({ ecosystem: "go-std", unit: "strconv", evidence: "import-path" }), evidence, project, "outside"),
    { level: 1, unit: "strconv", evidence: "import-path", gap: "whole-unit" });
  assert.deepEqual(externalIdentity(library({ ecosystem: "go-std", unit: "time", symbol: "Time.Equal", evidence: "declaring-owner" }), evidence, project, "outside"),
    { level: 2, unit: "time", symbol: "Time.Equal", evidence: "declaring-owner", gap: null });
  assert.deepEqual(externalIdentity(library({ ecosystem: "go-std", unit: "builtin", symbol: "len", evidence: "declared-builtin" }), evidence, project, "outside").level, 2);
  assert.throws(() => externalIdentity(library(undefined), evidence, project, "outside"), /without a stored target/);
  // The same site in a schema-3 graph: unresolved, identity rebuilt from its selector.
  const released = { resolution: "unresolved", module: "go", kind: "calls", file: "src/main", targetName: "strconv.Quote",
    data: { expr: { ...selector("strconv").expr, n: "Quote" } } };
  assert.deepEqual(externalIdentity(released, evidence, project, classify(released, evidence, project)),
    { level: 2, unit: "strconv", symbol: "Quote", evidence: "import-binding", gap: null });
  const rows = [linkRow("go", "resolved", "eligible", 6),
    [..."go calls library".split(" "), null, null, "source", "outside", 3, 0, 2, "import-binding", null],
    [..."go imports library".split(" "), null, null, "source", "outside", 1, 0, 1, "import-path", "whole-unit"],
    linkRow("go", "unresolved", "unclassified", 10)];
  const score = libraryScore(rows);
  assert.deepEqual([score.outside, score.total, score.level2, score.level1], [4, 20, 0.45, 0.5]);
});

test("TypeScript legacy export spelling cannot overwrite a current library decision", () => {
  const legacy = { module: "typescript", kind: "calls", resolution: "unresolved", file: "src/main.ts",
    targetName: "fs.readFileSync", data: { reason: "external-package" } };
  const details = { ...evidence, tsImportMember: () => ({ specifier: "node:fs", member: "default" }) };
  assert.deepEqual(externalIdentity(legacy, details, project, "outside"),
    { level: 2, unit: "node:fs", symbol: "default.readFileSync", evidence: "import-binding", gap: null });
  const current = { ...legacy, moduleVersion: "23+typescript-5.9.3" };
  assert.equal(externalIdentity(current, details, project, "outside").level, 0);
  assert.deepEqual(externalIdentity({ ...current, resolution: "library",
    library: { ecosystem: "node", unit: "fs", evidence: "import-path" } }, details, project, "outside"),
    { level: 1, unit: "fs", evidence: "import-path", gap: "whole-unit" });
});

test("Rust library coverage credits recorded evidence and leaves historical reconstruction to old graphs", () => {
  const link = { module: "rust", kind: "calls", file: "src/lib.rs", resolution: "unresolved", targetName: "std::fs::read" };
  assert.equal(externalIdentity(link, evidence, project, "outside").level, 2);
  const stored = { ...evidence, rustStoredTargets: true };
  assert.equal(externalIdentity(link, stored, project, "outside").level, 0);
  assert.deepEqual(externalIdentity({ ...link, resolution: "library", library: {
    unit: "std", symbol: "fs::read", evidence: "qualified-path",
  } }, stored, project, "outside"), {
    level: 2, unit: "std", symbol: "fs::read", evidence: "qualified-path", gap: null,
  });
});

test("Go library coverage uses stored targets from module 30 and the reconstruction before it", () => {
  const released = { resolution: "unresolved", module: "go", kind: "calls", file: "src/main", targetName: "strconv.Quote",
    data: { expr: { ...selector("strconv").expr, n: "Quote" } } };
  assert.equal(externalIdentity(released, evidence, project, "outside").level, 2);
  // A module-30 graph left this site unresolved: no rebuilt credit.
  const stored = { ...evidence, goStoredTargets: true };
  assert.equal(externalIdentity(released, stored, project, "outside").level, 0);
  assert.deepEqual(externalIdentity({ ...released, resolution: "library", library: {
    ecosystem: "go-std", unit: "strconv", symbol: "Quote", evidence: "import-binding",
  } }, stored, project, "outside"), {
    level: 2, unit: "strconv", symbol: "Quote", evidence: "import-binding", gap: null,
  });
});

test("coverage accepts stored library rows and rejects a library row without a named unit", () => {
  const scratch = mkdtempSync(join(tmpdir(), "coverage-library-"));
  try {
    const repo = (breakdown) => ({ id: "fixture/repo", commit: "a".repeat(40), language: "rust", outcome: "finished",
      sourceFiles: [{ module: "rust", scope: "source", readableLines: 10 }], failedSources: [], reviewSites: {}, breakdown });
    const packet = (breakdown) => ({ schema: "pymtheg.sweep.coverage/v2", release: { package: "fixture" }, columns, repos: [repo(breakdown)] });
    const put = (filename, data) => {
      const file = join(scratch, filename);
      writeFileSync(file, JSON.stringify(data));
      return file;
    };
    const run = (breakdown) => execFileSync(process.execPath, [fileURLToPath(new URL("./coverage.mjs", import.meta.url)),
      "--results", put("candidate.json", packet(breakdown)), "--scoreboard", join(scratch, "score.md")], { stdio: "pipe" });
    run([linkRow("rust", "resolved", "eligible", 2), ["rust", "calls", "library", null, null, "source", "outside", 2, 0, 2, "qualified-path", null],
      linkRow("rust", "unresolved", "unclassified", 1)]);
    assert.match(readFileSync(join(scratch, "score.md"), "utf8"), /\| fixture\/repo \| Rust \| finished \| 5 \| 2 \| 80\.00%/);
    assert.throws(() => run([["rust", "calls", "library", null, null, "source", "outside", 2, 0, 0, null, "unknown"]]), /Invalid breakdown/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("stored resolution classes, library included, agree with the CLI's counts one class at a time", async () => {
  const { linkShares } = await import("./run.mjs");
  const { storedTotalsAgree } = await import("./coverage-rules.mjs");
  const dist = (path) => new URL(`../../dist/${path}`, import.meta.url).href;
  const { executeGraph } = await import(dist("graph/commands.js"));
  const { LanguageRegistry, SqliteGraphStore } = await import(dist("graph/index.js"));
  const toy = (await import(dist("graph/languages/toy/index.js"))).default;
  const scratch = mkdtempSync(join(tmpdir(), "coverage-library-store-"));
  try {
    const root = join(scratch, "project");
    execFileSync("cp", ["-r", fileURLToPath(new URL("../../test/fixtures/graph-library-targets/", import.meta.url)), root]);
    const registry = new LanguageRegistry([toy]);
    await executeGraph({ command: "index", root }, { registry });
    // What the runner records as warm.out.
    const { counts } = JSON.parse(JSON.stringify(await executeGraph({ command: "status", root }, { registry })));
    assert.deepEqual(linkShares(counts), {
      total: 6, resolved: 1, ambiguous: 1, unresolved: 1, library: 3,
      percentages: { resolved: 16.67, ambiguous: 16.67, unresolved: 16.67, library: 50 },
    });
    // The 0.1.0 CLI reports no library count.
    assert.deepEqual(linkShares({ links: 4, ambiguous: 1, unresolved: 1 }).resolved, 2);
    const store = new SqliteGraphStore(join(root, ".pymtheg/rebuildable/graph.sqlite"), undefined, { readOnly: true });
    const grouped = new Map();
    for (const link of store.links()) {
      const key = `${link.kind}:${link.resolution}`;
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    store.close();
    const rows = [...grouped].map(([key, count]) => {
      const [kind, outcome] = key.split(":");
      return ["go", kind, outcome, null, null, "source", outcome === "library" ? "outside" : outcome === "unresolved" ? "unclassified" : "eligible", count];
    });
    assert.equal(storedTotalsAgree(rows, counts), true);
    const { library, ...released } = counts;
    assert.equal(library, 3);
    assert.equal(storedTotalsAgree(rows, released), false, "a CLI without library counts cannot have stored library rows");
    assert.equal(storedTotalsAgree(rows, { ...counts, unresolved: counts.unresolved + library, library: 0 }), false);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
