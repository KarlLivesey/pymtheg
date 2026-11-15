#!/usr/bin/env node
// Proves the acceptance gate bites. Run on the dev server from the repository
// root:
//
//   pymtheg-dev --name r1f-xxxx -- node scripts/acceptance/selftest.mjs [--out DIR] [--parallel 6] [--commit SHA]
//
// 1. Checks the Java/Quint/TLC wording matcher against fixed positive and
//    negative strings (e.g. "JavaScript" must not match, JAVA_HOME must).
// 2. Builds the release tarball once (run.mjs --pack-only).
// 3. Makes sabotaged copies, each breaking one thing a release must not ship,
//    and runs the real harness on each (scenario a-node-only unless a case
//    names another), several at once, which also exercises overlapping runs.
// 4. Requires: the unmodified control exits 0 with no failed step and no gap
//    (or 2 with only the R1-H warning gap); every sabotaged tarball exits 1 with the named step(s) reported
//    `fail`, never `pass`, `expected-fail` or `known-gap`.
// A sabotage whose anchor is not found exactly once is reported NOT APPLIED
// (a failure): a break that did not happen proves nothing.
// Writes selftest.json and selftest.md to --out (default evidence/r1-f).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { WORDING, WORDING_CASES } from "./wording.mjs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const REPO = resolve(new URL("../..", import.meta.url).pathname);
const OUT = resolve(opt("--out", join(REPO, "evidence/r1-f")));
const PARALLEL = Number(opt("--parallel", "6"));
const WORK = mkdtempSync(join(process.env.PYM_SCRATCH ?? tmpdir(), "acc-selftest-"));
const log = (...a) => console.log(`[selftest ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------- 1. matcher

const matcher = [...WORDING_CASES.match.map((s) => ({ text: s, expected: true })), ...WORDING_CASES.noMatch.map((s) => ({ text: s, expected: false }))].map((c) => ({ ...c, got: WORDING.test(c.text) }));
const matcherFailures = matcher.filter((c) => c.got !== c.expected);
log(`wording matcher: ${matcher.length - matcherFailures.length}/${matcher.length} cases correct`);

// ---------------------------------------------------------------- 2. tarball

function harness(args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(REPO, "scripts/acceptance/run.mjs"), ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => done({ code, out }));
  });
}
log("building the release tarball");
const pack = await harness(["--pack-only"]);
const tarball = /TARBALL=(\S+)/.exec(pack.out)?.[1];
if (pack.code !== 0 || !tarball) {
  console.error(pack.out.slice(-3000));
  process.exit(3);
}
const pristine = join(WORK, "pristine");
mkdirSync(pristine);
spawnSync("tar", ["-xzf", tarball, "-C", pristine], { stdio: "inherit" });

// ---------------------------------------------------------------- 3. sabotage

/** Replace exactly one match of `pattern` (string or RegExp), or refuse. */
function patch(dir, file, pattern, replacement) {
  const path = join(dir, "package", file);
  const text = readFileSync(path, "utf8");
  const re = typeof pattern === "string" ? new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") : new RegExp(pattern.source, "g");
  const count = [...text.matchAll(re)].length;
  if (count !== 1) throw Error(`sabotage anchor found ${count} times in ${file}: ${String(pattern).slice(0, 60)}`);
  writeFileSync(path, text.replace(re, () => replacement));
}
/** Insert code at the top of the CLI entry point, after its shebang. */
function prelude(dir, code) {
  const path = join(dir, "package/dist/cli/main.js");
  const [shebang, ...rest] = readFileSync(path, "utf8").split("\n");
  if (!shebang.startsWith("#!")) throw Error("dist/cli/main.js has no shebang line");
  writeFileSync(path, [shebang, code, ...rest].join("\n"));
}
/** Make an MCP tool's handler throw: the first `async (…) => {` after its registration name. */
function toolThrows(dir, name) {
  const path = join(dir, "package/dist/mcp/server.js");
  const text = readFileSync(path, "utf8");
  const at = text.indexOf(`"${name}"`);
  const m = at < 0 ? null : /async \([^)]*\) => \{/.exec(text.slice(at));
  if (!m) throw Error(`${name} handler not found`);
  const cut = at + m.index + m[0].length;
  writeFileSync(path, text.slice(0, cut) + ` throw new Error("sabotaged ${name}");` + text.slice(cut));
}
const GRAPH_JSON = 'JSON.stringify(response) + "\\n"';
const callersOnly = (transform) => `JSON.stringify(positional[0] === "callers" && response.data?.links ? { ...response, data: { ...response.data, links: response.data.links.map(${transform}) } } : response) + "\\n"`;
const DEPRECATION = 'if (process.argv[2] === "--help") process.emitWarning("Buffer() is deprecated due to security and usability issues.", { type: "DeprecationWarning", code: "DEP0005" });';

const SABOTAGES = [
  // Round 1 reviewers' breaks.
  { id: "check-exits-0", what: "`check` exits 0 on the broken design", expect: ["check-broken"], apply: (d) => prelude(d, 'if (process.argv[2] === "check") process.on("exit", () => { process.exitCode = 0; });') },
  { id: "grammar-removed", what: "the vendored Go grammar is missing from the tarball", expect: ["tarball-contents", "graph-index"], apply: (d) => rmSync(join(d, "package/grammars/go/tree-sitter-go.wasm")) },
  { id: "mcp-check-design-throws", what: "MCP `check_design` throws", expect: ["mcp-check_design"], apply: (d) => toolThrows(d, "check_design") },
  { id: "callers-no-links", what: "`graph callers` returns no links", expect: ["graph-ts-callers"], apply: (d) => patch(d, "dist/cli/graph.js", GRAPH_JSON, callersOnly("() => null").replace(".map(() => null)", ".filter(() => false)")) },
  { id: "caller-target-renamed", what: "a caller link's target is renamed", expect: ["graph-ts-callers"], apply: (d) => patch(d, "dist/cli/graph.js", GRAPH_JSON, callersOnly('(l) => ({ ...l, target: l.target && { ...l.target, name: l.target.name + "_renamed" } })')) },
  { id: "certainty-downgraded", what: "caller certainty downgraded to name-only", expect: ["graph-ts-callers"], apply: (d) => patch(d, "dist/cli/graph.js", GRAPH_JSON, callersOnly('(l) => ({ ...l, certainty: "name-only" })')) },
  { id: "prints-java", what: 'a command prints "java"', expect: ["help"], apply: (d) => prelude(d, 'if (process.argv[2] === "--help") console.log("Optional backend: java (not installed).");') },
  { id: "index-runs-java", what: "`graph index` silently runs `java -version`", expect: ["graph-index", "no-toolchain-processes"], apply: (d) => prelude(d, 'if (process.argv[2] === "graph" && process.argv[3] === "index") { try { (await import("node:child_process")).spawnSync("java", ["-version"]); } catch {} }') },
  { id: "mcp-wrong-verdict", what: "MCP reports a failing verdict for the valid design", expect: ["mcp-check_design"], apply: (d) => patch(d, "dist/mcp/workspace.js", "exitStatus: exitStatus(r),", "exitStatus: r.diagnostics.length ? exitStatus(r) : 1,") },
  { id: "link-crashes", what: "`pymtheg link` crashes (exit 77)", expect: ["link-requirement"], apply: (d) => prelude(d, 'if (process.argv[2] === "link") { console.error("link: internal error"); process.exit(77); }') },
  // Round 2 reviewers' breaks that slipped through, now caught.
  {
    id: "stack-trace-exit-0",
    what: "`--version` prints an internal-error stack trace and exits 0",
    expect: ["version"],
    apply: (d) =>
      prelude(d, 'if (process.argv[2] === "--version") { console.log("1.0.0"); console.error("TypeError: Cannot read properties of undefined (reading \'x\')\\n    at main (file:///usr/lib/node_modules/pymtheg/dist/cli/main.js:12:5)"); process.exit(0); }'),
  },
  { id: "wrong-diagnostic-message", what: "the N002 suggestion text changes", expect: ["check-broken", "mcp-check_design-broken"], apply: (d) => patch(d, "dist/semantic/core.js", /did you mean \$\{match\}\?/, "did you mean ${match} instead?") },
  { id: "listed-tool-throws", what: "a listed MCP tool (`design_recipe`) throws", expect: ["mcp-design_recipe"], apply: (d) => toolThrows(d, "design_recipe") },
  { id: "deprecation-warning", what: "a coded DeprecationWarning (DEP0005) on Node 24.22", expect: ["help"], apply: (d) => prelude(d, DEPRECATION) },
  { id: "deprecation-warning-24.0.0", what: "the same DeprecationWarning on Node 24.0.0 (beside the R1-H SQLite warning)", scenarios: "e-node-24.0.0", expect: ["help"], apply: (d) => prelude(d, DEPRECATION) },
  {
    id: "tools-list-error",
    what: "`tools/list` answers with a JSON-RPC error",
    expect: ["mcp-tools-list", "mcp-project_info", "mcp-tool-coverage", "mcp-requirement_links-requirement"],
    apply: (d) =>
      prelude(
        d,
        'if (process.argv[2] === "mcp") { const write = process.stdout.write.bind(process.stdout); process.stdout.write = (chunk, ...rest) => { const s = String(chunk); if (s.includes("\\"inputSchema\\"")) { try { const m = JSON.parse(s); if (Array.isArray(m.result?.tools)) chunk = JSON.stringify({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "sabotaged tools/list" } }) + "\\n"; } catch {} } return write(chunk, ...rest); }; }',
      ),
  },
  { id: "simulate-exhaustive-true", what: "MCP simulate reports `exhaustive: true`", expect: ["mcp-explore_behaviour-simulate"], apply: (d) => patch(d, "dist/mcp/workspace.js", ".every((p) => p.exhaustive === true)", ".every(() => true)") },
  {
    id: "init-writes-root-file",
    what: "`init` writes a file in the project root",
    expect: ["init"],
    apply: (d) => prelude(d, 'if (process.argv[2] === "init" && process.argv[3] && !process.argv[3].startsWith("--")) (await import("node:fs")).writeFileSync((await import("node:path")).join(process.argv[3], "PYMTHEG.md"), "notes\\n");'),
  },
  { id: "engine-hides-violation", what: "the built-in engine turns a violation into no_counterexample", expect: ["verify-violation"], apply: (d) => patch(d, "dist/backends/adapter.js", /outcome: violation\s*\?\s*"counterexample"/, 'outcome: false ? "counterexample"') },
  { id: "link-check-passes-changed", what: "`link check` exits 0 with a changed link", expect: ["link-check-after-edit"], apply: (d) => prelude(d, 'if (process.argv[2] === "link" && process.argv[3] === "check") process.on("exit", () => { process.exitCode = 0; });') },
  // Round 4: requirement links over MCP.
  { id: "mcp-link-check-ok-after-edit", what: "MCP `requirement_links check` reports every link ok after a body edit", expect: ["mcp-requirement_links-check-after-edit"], apply: (d) => patch(d, "dist/mcp/links-view.js", "state: r.state,", 'state: "ok",') },
  { id: "link-add-stores-nothing", what: "`add` reports created but stores no link", expect: ["mcp-requirement_links-add-go", "link-add-go"], apply: (d) => patch(d, "dist/architecture/code-links.js", /store!?\.writeCodeLink\(key, value, true\)/, '({ id: "sabotaged-link", changed: true })') },
  // Round 4: the Go opt-in must change the actual link, not only the counts.
  { id: "go-facts-discarded", what: "Go toolchain facts counted but discarded at final resolution", scenarios: "c-node-go-rust", expect: ["go-toolchain-callers"], apply: (d) => patch(d, "dist/graph/languages/go/resolve.js", "decision = decided;", "void decided;") },
  { id: "code-graph-candidate", what: "MCP `code_graph` reports a definite caller as a candidate", expect: ["mcp-code_graph-callers-ts"], apply: (d) => patch(d, "dist/mcp/graph-view.js", "certainty: l.certainty,", 'certainty: l.certainty === "definite" ? "candidate-set" : l.certainty,') },
];

const cases = [{ id: "control", what: "unmodified tarball", expect: [], apply: () => {} }, ...SABOTAGES];
for (const c of cases) {
  const dir = join(WORK, c.id);
  cpSync(pristine, dir, { recursive: true });
  try {
    c.apply(dir);
  } catch (e) {
    c.setupError = String(e.message ?? e);
    continue;
  }
  mkdirSync(join(dir, "out"), { recursive: true });
  c.tgz = join(dir, "out", "pymtheg-1.0.0.tgz");
  spawnSync("tar", ["-czf", c.tgz, "-C", dir, "package"], { stdio: "inherit" });
}

// ---------------------------------------------------------------- 4. run

async function runCase(c) {
  if (c.setupError) {
    log(`NOT APPLIED ${c.id}: ${c.setupError}`);
    return { id: c.id, what: c.what, scenarios: c.scenarios ?? "a-node-only", expect: c.expect, exitCode: null, verdict: "NOT APPLIED", detail: c.setupError, failingSteps: [] };
  }
  const out = join(WORK, c.id, "results");
  const r = await harness(["--tarball", c.tgz, "--scenarios", c.scenarios ?? "a-node-only", "--out", out]);
  let doc = null;
  try {
    doc = JSON.parse(readFileSync(join(out, "latest.json"), "utf8"));
  } catch {}
  const rows = doc?.results ?? [];
  const fails = rows.filter((x) => x.status === "fail");
  const statusOf = (step) => rows.filter((x) => x.step === step).map((x) => x.status);
  let ok, detail;
  if (c.id === "control") {
    // Clean: exit 0 with no gap, or exit 2 whose only gaps are the R1-H warning.
    const gaps = rows.filter((x) => x.status === "known-gap");
    ok = !fails.length && rows.length > 0 && ((r.code === 0 && !gaps.length) || (r.code === 2 && gaps.length > 0 && gaps.every((x) => x.chunk === "R1-H")));
    detail = `exit ${r.code}; ${fails.length} failed steps; gaps: ${rows
      .filter((x) => x.status === "known-gap")
      .map((x) => `${x.step} (${x.chunk})`)
      .join(", ")}`;
  } else {
    const named = c.expect.map((s) => [s, statusOf(s)]);
    ok = r.code === 1 && named.every(([, st]) => st.length && st.every((x) => x === "fail"));
    detail = `exit ${r.code}; ${named.map(([s, st]) => `${s}: ${st.join("/") || "absent"}`).join("; ")}; all failing: ${fails.map((x) => x.step).join(", ")}`;
  }
  log(`${ok ? "caught  " : "MISSED  "} ${c.id}: ${detail.slice(0, 300)}`);
  return {
    id: c.id,
    what: c.what,
    scenarios: c.scenarios ?? "a-node-only",
    expect: c.expect,
    exitCode: r.code,
    verdict: ok ? (c.id === "control" ? "clean" : "caught") : "MISSED",
    detail,
    failingSteps: fails.map((x) => ({ step: x.step, reason: x.reason.slice(0, 200) })),
  };
}

const queue = [...cases];
const outcomes = [];
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (queue.length) outcomes.push(await runCase(queue.shift()));
  }),
);
outcomes.sort((a, b) => cases.findIndex((c) => c.id === a.id) - cases.findIndex((c) => c.id === b.id));

const passed = !matcherFailures.length && outcomes.every((o) => o.verdict === "caught" || o.verdict === "clean");
mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, "selftest.json"),
  JSON.stringify({ schema: "pymtheg.acceptance-selftest/v1", generatedAt: new Date().toISOString(), commit: opt("--commit", null), passed, matcher: { cases: matcher.length, failures: matcherFailures }, outcomes }, null, 2) + "\n",
);
const cell = (t) => String(t).replace(/\|/g, "\\|").slice(0, 260);
writeFileSync(
  join(OUT, "selftest.md"),
  [
    "# Acceptance self-test — latest run",
    "",
    `Generated ${new Date().toISOString()} from commit ${opt("--commit", "unknown")}. Result: **${passed ? "every sabotage caught" : "FAILED"}**.`,
    "",
    `Wording matcher: ${matcher.length - matcherFailures.length}/${matcher.length} fixed cases correct${matcherFailures.length ? " — wrong: " + matcherFailures.map((c) => JSON.stringify(c.text)).join(", ") : ""}.`,
    "",
    "Each row runs the real harness on a tarball broken in one way. A case passes only if the harness exits 1 and every named step is `fail`.",
    "",
    "| Case | Break | Scenario | Named step(s) | Harness exit | Verdict | Detail |",
    "|---|---|---|---|---|---|---|",
    ...outcomes.map((o) => `| ${o.id} | ${cell(o.what)} | ${o.scenarios} | ${o.expect.join(", ") || "–"} | ${o.exitCode ?? "–"} | ${o.verdict} | ${cell(o.detail)} |`),
    "",
  ].join("\n"),
);
rmSync(WORK, { recursive: true, force: true });
log(passed ? "self-test passed: every sabotage caught" : "self-test FAILED");
process.exit(passed ? 0 : 1);
