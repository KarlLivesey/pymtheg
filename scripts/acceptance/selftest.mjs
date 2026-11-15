#!/usr/bin/env node
// Proves the acceptance gate bites. Run on the dev server from the repository
// root:
//
//   pymtheg-dev --name r1f-xxxx -- node scripts/acceptance/selftest.mjs [--out DIR] [--parallel 5]
//
// 1. Checks the Java/Quint/TLC wording matcher against fixed positive and
//    negative strings (e.g. "JavaScript" must not match).
// 2. Builds the release tarball once (run.mjs --pack-only).
// 3. Makes ten sabotaged copies, each breaking one thing a release must not
//    ship, and runs the real harness (scenario a-node-only) on each, several
//    at once (which also exercises concurrent runs on one Docker host).
// 4. Requires: the unmodified control exits 2 (known gaps only) with no
//    failed step; every sabotaged tarball exits 1 with the named step(s)
//    reported `fail`, never `pass` or `known-gap`.
// Writes selftest.json and selftest.md to --out (default evidence/r1-f).
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const PARALLEL = Number(opt("--parallel", "5"));
const WORK = mkdtempSync(join(process.env.PYM_SCRATCH ?? tmpdir(), "acc-selftest-"));
const log = (...a) => console.log(`[selftest ${new Date().toISOString().slice(11, 19)}]`, ...a);

// ---------------------------------------------------------------- 1. matcher

const matcher = [
  ...WORDING_CASES.match.map((s) => ({ text: s, expected: true })),
  ...WORDING_CASES.noMatch.map((s) => ({ text: s, expected: false })),
].map((c) => ({ ...c, got: WORDING.test(c.text) }));
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

/** Replace exactly one occurrence of `anchor`, or refuse: a sabotage that does not apply proves nothing. */
function patch(dir, file, anchor, replacement) {
  const path = join(dir, "package", file);
  const text = readFileSync(path, "utf8");
  const count = text.split(anchor).length - 1;
  if (count !== 1) throw Error(`sabotage anchor found ${count} times in ${file}: ${anchor.slice(0, 60)}`);
  writeFileSync(path, text.replace(anchor, replacement));
}
/** Insert code at the top of the CLI entry point, after its shebang. */
function prelude(dir, code) {
  const path = join(dir, "package/dist/cli/main.js");
  const [shebang, ...rest] = readFileSync(path, "utf8").split("\n");
  if (!shebang.startsWith("#!")) throw Error("dist/cli/main.js has no shebang line");
  writeFileSync(path, [shebang, code, ...rest].join("\n"));
}
const GRAPH_JSON = 'JSON.stringify(response) + "\\n"';
const callersOnly = (transform) => `JSON.stringify(positional[0] === "callers" && response.data?.links ? { ...response, data: { ...response.data, links: response.data.links.map(${transform}) } } : response) + "\\n"`;

const SABOTAGES = [
  {
    id: "check-exits-0",
    what: "`check` exits 0 on the broken design",
    expect: ["check-broken"],
    apply: (d) =>
      prelude(
        d,
        // Node reads process.exitCode after the 'exit' listeners run.
        'if (process.argv[2] === "check") process.on("exit", () => { process.exitCode = 0; });',
      ),
  },
  {
    id: "grammar-removed",
    what: "the vendored Go grammar is missing from the tarball",
    expect: ["tarball-contents", "graph-index"],
    apply: (d) => rmSync(join(d, "package/grammars/go/tree-sitter-go.wasm")),
  },
  {
    id: "mcp-check-design-throws",
    what: "MCP `check_design` throws",
    expect: ["mcp-check-design"],
    apply: (d) => {
      const path = join(d, "package/dist/mcp/server.js");
      const text = readFileSync(path, "utf8");
      const at = text.indexOf('"check_design"');
      const handler = text.indexOf("async (a, ctx) => {", at);
      if (at < 0 || handler < 0) throw Error("check_design handler not found");
      const cut = handler + "async (a, ctx) => {".length;
      writeFileSync(path, text.slice(0, cut) + ' throw new Error("sabotaged check_design");' + text.slice(cut));
    },
  },
  {
    id: "callers-no-links",
    what: "`graph callers` returns no links",
    expect: ["graph-ts-callers"],
    apply: (d) => patch(d, "dist/cli/graph.js", GRAPH_JSON, `JSON.stringify(positional[0] === "callers" && response.data?.links ? { ...response, data: { ...response.data, links: [] } } : response) + "\\n"`),
  },
  {
    id: "caller-target-renamed",
    what: "a caller link's target is renamed",
    expect: ["graph-ts-callers"],
    apply: (d) => patch(d, "dist/cli/graph.js", GRAPH_JSON, callersOnly('(l) => ({ ...l, target: l.target && { ...l.target, name: l.target.name + "_renamed" } })')),
  },
  {
    id: "certainty-downgraded",
    what: "caller certainty downgraded to name-only",
    expect: ["graph-ts-callers"],
    apply: (d) => patch(d, "dist/cli/graph.js", GRAPH_JSON, callersOnly('(l) => ({ ...l, certainty: "name-only" })')),
  },
  {
    id: "prints-java",
    what: "a command prints \"java\"",
    expect: ["help"],
    apply: (d) => prelude(d, 'if (process.argv[2] === "--help") console.log("Optional backend: java (not installed).");'),
  },
  {
    id: "index-runs-java",
    what: "`graph index` silently runs `java -version`",
    expect: ["graph-index", "no-toolchain-processes"],
    apply: (d) => prelude(d, 'if (process.argv[2] === "graph" && process.argv[3] === "index") { try { (await import("node:child_process")).spawnSync("java", ["-version"]); } catch {} }'),
  },
  {
    id: "mcp-wrong-verdict",
    what: "MCP reports a failing verdict for the valid design",
    expect: ["mcp-check-design"],
    apply: (d) => patch(d, "dist/mcp/workspace.js", "exitStatus: exitStatus(r),", "exitStatus: r.diagnostics.length ? exitStatus(r) : 1,"),
  },
  {
    id: "link-crashes",
    what: "`pymtheg link` crashes (exit 77) instead of today's unknown-command answer",
    expect: ["link-requirement"],
    apply: (d) => prelude(d, 'if (process.argv[2] === "link") { console.error("link: internal error"); process.exit(77); }'),
  },
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
  if (c.setupError) return { ...c, verdict: "NOT APPLIED", detail: c.setupError };
  const out = join(WORK, c.id, "results");
  const r = await harness(["--tarball", c.tgz, "--scenarios", "a-node-only", "--out", out]);
  let doc = null;
  try {
    doc = JSON.parse(readFileSync(join(out, "latest.json"), "utf8"));
  } catch {}
  const rows = doc?.results ?? [];
  const fails = rows.filter((x) => x.status === "fail");
  const statusOf = (step) => rows.filter((x) => x.step === step).map((x) => x.status);
  let ok, detail;
  if (c.id === "control") {
    ok = r.code === 2 && !fails.length && rows.length > 0;
    detail = `exit ${r.code}; ${fails.length} failed steps; ${rows.filter((x) => x.status === "known-gap").map((x) => `${x.step} (${x.chunk})`).join(", ")}`;
  } else {
    const named = c.expect.map((s) => [s, statusOf(s)]);
    ok = r.code === 1 && named.every(([, st]) => st.length && st.every((x) => x === "fail"));
    detail = `exit ${r.code}; ${named.map(([s, st]) => `${s}: ${st.join("/") || "absent"}`).join("; ")}; failing steps: ${fails.map((x) => x.step).join(", ")}`;
  }
  log(`${ok ? "caught  " : "MISSED  "} ${c.id}: ${detail}`);
  return { id: c.id, what: c.what, expect: c.expect, exitCode: r.code, verdict: ok ? (c.id === "control" ? "clean" : "caught") : "MISSED", detail, failingSteps: fails.map((x) => ({ step: x.step, reason: x.reason.slice(0, 200) })) };
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
    "Each row runs the real harness (scenario a-node-only) on a tarball broken in one way.",
    "",
    "| Case | Break | Harness exit | Verdict | Detail |",
    "|---|---|---|---|---|",
    ...outcomes.map((o) => `| ${o.id} | ${cell(o.what)} | ${o.exitCode ?? "–"} | ${o.verdict} | ${cell(o.detail)} |`),
    "",
  ].join("\n"),
);
rmSync(WORK, { recursive: true, force: true });
log(passed ? "self-test passed: every sabotage caught" : "self-test FAILED");
process.exit(passed ? 0 : 1);
