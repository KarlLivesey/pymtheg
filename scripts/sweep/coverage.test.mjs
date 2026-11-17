// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { aggregate, failedRustInfluence, median } from "./coverage.mjs";
import { classify, columns, goImports, repositoryScore, rustImports, sampleKey, sampleStratum, sourceScope } from "./coverage-rules.mjs";

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
  goImports: goImports(imports("strconv", "example.org/vendored", "example.net/dependency", "example.com/app/local")),
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

test("raw, adjusted and zero-scored inputs have separate denominators", () => {
  const row = (outcome, disposition, count, scope = "source") => ["go", "calls", outcome, null, null, scope, disposition, count, 0];
  const breakdown = [row("resolved", "eligible", 3), row("ambiguous", "eligible", 2), row("unresolved", "inside", 2),
    row("unresolved", "unclassified", 1), row("unresolved", "outside", 4, "bundle")];
  assert.deepEqual(repositoryScore(breakdown), { resolved: 3, ambiguous: 2, inside: 2, outside: 4, unclassified: 1,
    eligible: 8, total: 12, raw: 3/12, adjusted: 3/8 });
  const repos = [{ language: "go", outcome: "finished", breakdown }, { language: "go", outcome: "wall-limit" }];
  assert.equal(aggregate(repos, "go").all.adjusted, 3/16);
  assert.equal(aggregate(repos, "go").median.adjusted, 3/8);
  assert.equal(aggregate(repos, "go", ["source"]).weighted.raw, 3/8);
  assert.equal(median([3, 1, 9, 6]), 4.5);
});

test("artifact rules are explicit and sample keys survive graph ID changes", () => {
  assert.equal(sourceScope("pocketbase/pocketbase", "ui/dist/assets/file.js", "x()"), "bundle");
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
  ] }), { total: 11, eligible: 8, blocked: 6, receivers: 11 });
});

test("candidate overlay rewrites the plan only for matched evidence", () => {
  const scratch = mkdtempSync(join(tmpdir(), "coverage-progress-"));
  try {
    const repo = { id: "fixture/repo", commit: "a".repeat(40), language: "go", outcome: "finished",
      sourceFiles: [{ module: "go", scope: "source", readableLines: 10 }], failedSources: [],
      strata: { "go:empty:source": 2 }, breakdown: [["go", "calls", "unresolved", null, null, "source", "unclassified", 2, 0]] };
    const packet = (repos) => ({ schema: "pymtheg.sweep.coverage/v1", release: { package: "fixture" }, columns, repos });
    const base = packet([repo, { id: "fixture/other", commit: "b".repeat(40), language: "rust", outcome: "wall-limit" }]);
    const candidate = packet([{ ...repo, checks: { known: "resolved" }, strata: { "go:empty:source": 1 }, breakdown: [
      ["go", "calls", "resolved", null, null, "source", "eligible", 1, 0],
      ["go", "calls", "unresolved", null, null, "source", "unclassified", 1, 0],
    ] }]);
    const put = (filename, data) => {
      const file = join(scratch, filename);
      writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
      return file;
    };
    const example = { repo: repo.id, file: "main.go", line: 2, code: "work()" };
    const item = { id: "calls", module: "go", title: "Resolve local calls", examples: [example, { ...example, line: 5 }] };
    const items = put("items.json", { items: [item] });
    const samples = put("samples.json", { samples: ["known", "missing"].map((key) => ({ key, item: "calls", repo: repo.id, stratum: "go:empty", scope: "source" })) });
    const plan = put("plan.md", "Before.\n<!-- sweep:coverage:start -->\nold\n<!-- sweep:coverage:end -->\nAfter.\n");
    const scoreboard = join(scratch, "score.md");
    execFileSync(process.execPath, [fileURLToPath(new URL("./coverage.mjs", import.meta.url)), "--results", put("candidate.json", candidate),
      "--base", put("base.json", base), "--plan", plan, "--scoreboard", scoreboard, "--items", items, "--samples", samples]);
    const rendered = readFileSync(plan, "utf8");
    assert.match(rendered, /^Before\./);
    assert.match(rendered, /1\/2 sample sites resolved/);
    assert.match(rendered, /50\.00 pp/);
    assert.match(rendered, /After\.\n$/);
    assert.match(readFileSync(scoreboard, "utf8"), /fixture\/other .*wall-limit.*0% \/ 0%/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
