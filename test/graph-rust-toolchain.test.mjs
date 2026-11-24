// SPDX-License-Identifier: MIT
import "./isolated-config.mjs";
// C-43: the opt-in Rust toolchain route (rust-analyzer SCIP). Most tests use
// a controlled fake rust-analyzer, cargo and rustc that emit fixed answers;
// the last ones run the real rust-analyzer when it is installed with
// rust-src. No test asserts a time; the hang is ended by the index's
// signal or a controlled clock after a readiness handshake.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LanguageRegistry,
  SqliteGraphStore,
  indexProject,
} from "../dist/graph/index.js";
import rust, { analysisInput } from "../dist/graph/languages/rust/index.js";
import { readScip, parseSymbol } from "../dist/graph/languages/rust/scip.js";
import {
  libraryPath,
  nameSite,
} from "../dist/graph/languages/rust/toolchain-join.js";
import { setRunControls } from "../dist/graph/languages/rust/toolchain-route.js";
import {
  buildTarget,
  tomlString,
} from "../dist/graph/languages/rust/toolchain.js";
import { toolchainState } from "../dist/graph/command-toolchain.js";
import { decideLink } from "../dist/graph/analysis.js";
import { generate as generateOracle } from "./rust-cfg-oracle.mjs";
import { executeGraph } from "../dist/graph/commands.js";
import { graphConfig, graphToolchains } from "../dist/shared/config.js";
import { initializeWorkspace } from "../dist/project/workspace.js";
import { trustFile } from "../dist/project/local-trust.js";
import { controlledClock } from "./controlled-clock.mjs";

const FIXTURE = fileURLToPath(
  new URL("./fixtures/graph-rust-toolchain/basic", import.meta.url),
);

// ---------------------------------------------------------------- SCIP

const varint = (n) => {
  const out = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const field = (number, bytes) => [
  ...varint(number * 8 + 2),
  ...varint(bytes.length),
  ...bytes,
];
const textBytes = (s) => [...Buffer.from(s, "utf8")];
/** A SCIP index: documents of [line, startByte, endByte, symbol, definition?]. */
function encodeScip(documents) {
  const out = [];
  for (const [path, occurrences] of Object.entries(documents)) {
    const doc = [...field(1, textBytes(path))];
    for (const [line, start, end, symbol, def] of occurrences) {
      const range = [line, start, end].flatMap(varint);
      const occ = [
        ...field(1, range),
        ...field(2, textBytes(symbol)),
        ...(def ? [3 * 8, 1] : []),
      ];
      doc.push(...field(2, occ));
    }
    out.push(...field(2, doc));
  }
  return Buffer.from(out);
}
/** The SCIP position of `name` inside the nth occurrence of `context` in text. */
function at(text, context, name, nth = 0) {
  let index = -1;
  for (let i = 0; i <= nth; i++) {
    index = text.indexOf(context, index + 1);
    assert.ok(index >= 0, `no ${context} in the fixture`);
  }
  const offset = index + context.indexOf(name);
  const before = text.slice(0, offset);
  const line = before.split("\n").length - 1;
  const column = Buffer.byteLength(before.slice(before.lastIndexOf("\n") + 1));
  return [line, column, column + Buffer.byteLength(name)];
}

// ---------------------------------------------------------------- the fake toolchain

/**
 * A fake rust-analyzer, cargo and rustc. behaviour.json beside them says what
 * each answers; every run of `rust-analyzer scip` is counted and its working
 * directory and environment recorded.
 */
function fakeToolchain(dir, behaviour) {
  mkdirSync(dir, { recursive: true });
  const sysroot = join(dir, "sysroot");
  mkdirSync(
    join(
      sysroot,
      "lib",
      "rustlib",
      "src",
      "rust",
      behaviour.rustSrc === false ? "nothing" : "library",
    ),
    { recursive: true },
  );
  const full = {
    sysroot,
    runs: join(dir, "runs.txt"),
    seen: join(dir, "seen.json"),
    ready: join(dir, "ready.txt"),
    ...behaviour,
  };
  writeFileSync(join(dir, "behaviour.json"), JSON.stringify(full));
  const head = `#!${process.execPath}\nconst fs = require("fs"), path = require("path");\nconst b = JSON.parse(fs.readFileSync(path.join(__dirname, "behaviour.json"), "utf8"));\nconst a = process.argv.slice(2);\n`;
  const scripts = {
    rustc: `if (a[0] === "--print") { console.log(b.sysroot); process.exit(0); }
if (a[0] === "-vV") { console.log("rustc 1.98.1 (fake)\\nbinary: rustc\\nhost: x86_64-unknown-linux-gnu\\nrelease: 1.98.1"); process.exit(0); }
process.exit(2);`,
    cargo: `if (a[0] === "tree") {
  if (!b.tree) process.exit(2);
  console.log(b.tree.join("\\n").replaceAll("@ROOT@", process.cwd()));
  process.exit(0);
}
if (a[0] === "metadata") {
  fs.writeFileSync(path.join(__dirname, "cargo-args.json"), JSON.stringify(a));
  if (!b.metadata) { console.error("error: failed to get \`dep\` as a dependency (offline)"); process.exit(101); }
  console.log(JSON.stringify(b.metadata).replaceAll("@ROOT@", process.cwd()));
  process.exit(0);
}
process.exit(2);`,
    "rust-analyzer": `if (a[0] === "--version") { console.log("rust-analyzer 1.98.1 (fake 2026-09-01)"); process.exit(0); }
if (a[0] === "diagnostics") {
  process.stdout.write((b.diagnostics ?? "diagnostic scan complete\\n").replaceAll("@ROOT@", process.cwd()));
  process.exit(b.diagnosticsExit ?? 0);
}
if (a[0] === "scip") {
  fs.appendFileSync(b.runs, "run\\n");
  fs.writeFileSync(b.seen, JSON.stringify({ cwd: process.cwd(), env: process.env, config: JSON.parse(fs.readFileSync(a[a.indexOf("--config-path") + 1], "utf8")),
    files: fs.readdirSync(process.cwd(), { recursive: true }).map(String).sort(), lib: fs.existsSync("src/lib.rs") ? fs.readFileSync("src/lib.rs", "utf8") : null }));
  if (b.hang) { if (b.alive) fs.openSync(b.alive, "w"); fs.writeFileSync(b.ready, String(process.pid)); setInterval(() => {}, 1000); return; }
  if (b.noise) process.stdout.write("x".repeat(b.noise));
  if (b.scipExit) { console.error("error: the fake scip failed"); process.exit(b.scipExit); }
  if (b.garbage) { fs.writeFileSync(a[a.indexOf("--output") + 1], "not a scip index"); process.exit(0); }
  for (const o of b.buildOutputs ?? []) {
    const d = path.join(process.env.CARGO_TARGET_DIR, b.triple ?? "", "debug", "build", o.dir);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "invoked.timestamp"), "");
    if (o.output) fs.writeFileSync(path.join(d, "output"), "");
  }
  for (const [dir, file] of b.fingerprints ?? []) {
    const d = path.join(process.env.CARGO_TARGET_DIR, b.triple ?? "", "debug", ".fingerprint", dir);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, file), "");
  }
  for (const file of b.deps ?? []) {
    const d = path.join(process.env.CARGO_TARGET_DIR, b.triple ?? "", "debug", "deps");
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, file), "");
  }
  fs.copyFileSync(b.scip, a[a.indexOf("--output") + 1]);
  process.exit(0);
}
process.exit(2);`,
  };
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(dir, name), head + body);
    chmodSync(join(dir, name), 0o755);
  }
  return full;
}
/**
 * Readiness handshake: resolves once the fake has written `path` (watched,
 * not polled), and fails at once if `running` settles first. No count or
 * clock bounds the wait.
 */
function ready(path, running) {
  return new Promise((resolve, reject) => {
    const watcher = watch(dirname(path), () => check());
    const done = (fn, value) => {
      watcher.close();
      fn(value);
    };
    const check = () => {
      if (existsSync(path)) done(resolve);
    };
    running.then(
      () =>
        done(
          reject,
          Error("the run ended before the fake rust-analyzer was ready"),
        ),
      (error) => done(reject, error),
    );
    check();
  });
}
const runs = (tools) =>
  existsSync(tools.runs)
    ? readFileSync(tools.runs, "utf8").split("\n").filter(Boolean).length
    : 0;

// ---------------------------------------------------------------- the gate project

const GATES = {
  "Cargo.toml":
    '[package]\nname = "gates"\nversion = "0.1.0"\nedition = "2021"\n',
  "Cargo.lock":
    'version = 4\n\n[[package]]\nname = "gates"\nversion = "0.1.0"\n',
  "src/lib.rs": `pub mod a;
pub mod b;

pub fn caller(things: Vec<a::Thing>) {
    things.iter().for_each(|t| t.go());
    a::helper();
}

#[cfg(feature = "extra")]
pub fn gated(things: Vec<a::Thing>) {
    things.iter().for_each(|t| t.go());
}

pub fn variant(things: Vec<b::Other>) {
    things.iter().for_each(|o| o.run());
}
`,
  "src/a.rs": `pub struct Thing;

impl Thing {
    pub fn go(&self) {}
}

pub fn helper() {}
`,
  "src/b.rs": `pub struct Other;

#[cfg(unix)]
impl Other {
    pub fn run(&self) {}
}

#[cfg(windows)]
impl Other {
    pub fn run(&self) {}
}

pub fn helper() {}
`,
};
const sym = (path) => `rust-analyzer cargo gates 0.1.0 ${path}`;
const GO = sym("a/impl#[Thing]go().");
const metadata = (extra = {}) => ({
  packages: [
    {
      id: "gates 0.1.0",
      name: "gates",
      version: "0.1.0",
      targets: [
        { kind: ["lib"], name: "gates", src_path: "@ROOT@/src/lib.rs" },
        ...(extra.targets ?? []),
      ],
    },
    ...(extra.packages ?? []),
  ],
  workspace_members: ["gates 0.1.0"],
  resolve: {
    nodes: [
      { id: "gates 0.1.0", deps: extra.deps ?? [] },
      ...(extra.nodes ?? []),
    ],
  },
});

/** The gate project's SCIP with the `t.go` site in caller() answered by `answer` (one or more symbols). */
function gateScip(answer = [GO], overrides = {}) {
  const lib = GATES["src/lib.rs"];
  const a = GATES["src/a.rs"];
  const b = GATES["src/b.rs"];
  const docs = {
    "src/lib.rs": [
      [...at(lib, "pub fn caller", "caller"), sym("caller()."), true],
      ...answer.map((symbol) => [...at(lib, "t.go()", "go"), symbol, false]),
      [
        ...at(lib, "a::helper()", "helper"),
        overrides.helper ?? sym("a/helper()."),
        false,
      ],
      [...at(lib, "t.go()", "go", 1), GO, false],
      [...at(lib, "o.run()", "run"), sym("b/impl#[Other]run()."), false],
    ],
    "src/a.rs": [
      [...at(a, "pub struct Thing", "Thing"), sym("a/Thing#"), true],
      [...at(a, "pub fn go", "go"), GO, true],
      [...at(a, "pub fn helper", "helper"), sym("a/helper()."), true],
      ...(overrides.collision
        ? [[...at(a, "pub fn helper", "helper"), GO, true]]
        : []),
    ],
    "src/b.rs": [
      [...at(b, "pub fn run", "run"), sym("b/impl#[Other]run()."), true],
      [...at(b, "pub fn helper", "helper"), sym("b/helper()."), true],
    ],
  };
  return encodeScip(docs);
}

function writeProject(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

async function scratch(use) {
  const root = await mkdtemp(join(tmpdir(), "pym-rust-tc-"));
  try {
    return await use(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Indexes `project` with the route on and the fake toolchain on PATH (or the
 * given environment). Returns the notes, the state and the links by site.
 */
async function index(project, work, options = {}) {
  const store = new SqliteGraphStore(
    join(
      work,
      options.store ?? `graph-${Math.random().toString(36).slice(2)}.sqlite`,
    ),
    "tc",
  );
  try {
    const report = await indexProject(
      project,
      new LanguageRegistry([rust]),
      store,
      {
        toolchainDirectory: join(
          work,
          options.toolchainDirectory ?? "toolchain",
        ),
        environment: options.environment,
        ...(options.toolchains === null
          ? {}
          : { toolchains: options.toolchains ?? { rust: true } }),
        signal: options.signal ?? new AbortController().signal,
      },
    );
    const symbols = new Map(store.findSymbols().map((s) => [s.id, s]));
    const links = store.links().map((link) => ({
      ...link,
      targetSymbol: symbols.get(link.targetId),
    }));
    return {
      report,
      links,
      state: toolchainState({ rust: true }, report.toolchains).rust,
    };
  } finally {
    store.close();
  }
}
const note = (report, status) =>
  report.toolchains?.find((n) => n.note.status === status)?.note;
const goLinks = (dump) =>
  dump.links.filter(
    (l) =>
      l.file === "src/lib.rs" && l.kind === "calls" && l.targetName === "t.go",
  );
const environment = (tools, extra = {}) => ({
  PATH: dirname(tools.runs),
  HOME: join(dirname(tools.runs), "home"),
  CARGO_HOME: join(dirname(tools.runs), "cargo-home"),
  ...extra,
});

/** One gate case: the fake answers, then the route's counts and the caller's `t.go` link. */
async function gateCase(answer, overrides = {}, behaviour = {}) {
  return await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip(answer, overrides));
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      ...behaviour,
      metadata: metadata(behaviour.metadata),
    });
    const dump = await index(project, root, {
      environment: environment(tools),
    });
    const [caller, gated] = goLinks(dump).sort(
      (x, y) => x.range.start - y.range.start,
    );
    return {
      dump,
      caller,
      gated,
      join: note(dump.report, "available")?.join ?? {},
      decided: note(dump.report, "merged")?.decided ?? {},
    };
  });
}

// ---------------------------------------------------------------- settings

test("settings: this machine's trusted answer runs the Rust route; committed settings only turn it off; tool paths are local", () => {
  // C-44: only the local answer grants trust (D22).
  const config = (graph) => ({
    version: 1,
    scenarios: {},
    graph: graphConfig(graph),
  });
  const trusted = { trust: "trusted" };
  assert.deepEqual(graphToolchains(config({}), trusted), {
    go: true,
    rust: true,
  });
  assert.deepEqual(
    graphToolchains(config({ trust: "trusted" }), undefined),
    {},
  );
  assert.deepEqual(
    graphToolchains(config({ toolchain: { rust: true } }), undefined),
    {},
  );
  assert.deepEqual(
    graphToolchains(config({ toolchain: { rust: false } }), trusted),
    { go: true },
  );
  // A committed path is never used; a local one is.
  assert.deepEqual(
    graphToolchains(config({ toolchain: { rust: "/repo/ra" } }), trusted),
    { go: true, rust: true },
  );
  assert.deepEqual(
    graphToolchains(config({}), {
      ...trusted,
      toolchain: { rust: "/opt/ra/rust-analyzer" },
    }),
    { go: true, rust: "/opt/ra/rust-analyzer" },
  );
  assert.deepEqual(
    graphToolchains(config({ trust: "source-only" }), trusted),
    {},
  );
  assert.throws(
    () => graphConfig({ toolchain: { rust: "rust-analyzer" } }),
    /graph.toolchain.rust must be true, false or an absolute path to rust-analyzer/,
  );
});

// ---------------------------------------------------------------- reading SCIP

test("a toolchain record stands only on a link stored with its target; a kept source-only answer drops it", () => {
  const symbol = {
    id: "s1",
    projectId: "p",
    module: "rust",
    file: "src/lib.rs",
    key: "k1",
    kind: "function",
    name: "f",
    identity: "f",
    range: { start: 0, end: 1 },
    status: "clean",
  };
  const link = {
    id: "l1",
    projectId: "p",
    module: "rust",
    file: "src/lib.rs",
    origin: "parse",
    sourceId: null,
    kind: "calls",
    targetName: "f",
    range: { start: 2, end: 3 },
    targetId: null,
    targetStatus: null,
    candidates: [],
    resolution: "unresolved",
    data: {
      toolchain: { origin: "toolchain", from: "unresolved", target: "s1" },
    },
  };
  // The answer is stored: the record stands.
  const taken = decideLink(
    structuredClone(link),
    { linkId: "l1", targetId: "s1" },
    [symbol],
  );
  assert.equal(taken.targetId, "s1");
  assert.equal(taken.data.toolchain.target, "s1");
  assert.equal(taken.data.toolchainOutcome, undefined);
  // The resolve phase kept a source-only library target: the record goes.
  const kept = decideLink(
    structuredClone(link),
    {
      linkId: "l1",
      library: {
        ecosystem: "rust-std",
        unit: "core",
        symbol: "fmt::Debug::fmt",
        evidence: "qualified-path",
      },
    },
    [symbol],
  );
  assert.equal(kept.resolution, "library");
  assert.equal(kept.data.toolchain, undefined, JSON.stringify(kept.data));
  assert.equal(kept.data.toolchainOutcome, "kept:source-only");
  // A confirmation names no target and is left alone.
  const confirmed = decideLink(
    {
      ...structuredClone(link),
      data: { toolchain: { origin: "toolchain", from: "definite" } },
    },
    { linkId: "l1", targetId: "s1" },
    [symbol],
  );
  assert.equal(confirmed.data.toolchain.from, "definite");
  // Fifth review: an open link carrying candidates. Taken, the listed open
  // data goes with the list; kept, the data is the route-off data exactly,
  // in its order, with the outcome added last.
  const offData = {
    scope: "f",
    targets: ["s1", "s2"],
    targetCount: 2,
    uncertainty: "multiple-checkout-candidates",
    conditions: [],
  };
  const open = {
    ...structuredClone(link),
    data: {
      ...offData,
      toolchain: {
        origin: "toolchain",
        from: "candidates",
        target: "s1",
        clears: ["uncertainty", "targets", "targetCount"],
      },
    },
  };
  const openTaken = decideLink(
    structuredClone(open),
    { linkId: "l1", targetId: "s1" },
    [symbol],
  );
  assert.equal(
    JSON.stringify(openTaken.data),
    JSON.stringify({
      scope: "f",
      conditions: [],
      toolchain: { origin: "toolchain", from: "candidates", target: "s1" },
    }),
  );
  const openKept = decideLink(
    structuredClone(open),
    {
      linkId: "l1",
      library: {
        ecosystem: "rust-std",
        unit: "core",
        symbol: "fmt::Debug::fmt",
        evidence: "qualified-path",
      },
    },
    [symbol],
  );
  assert.equal(
    JSON.stringify(openKept.data),
    JSON.stringify({ ...offData, toolchainOutcome: "kept:source-only" }),
  );
});

test("the analysis input drops a previous run's record, outcome and library offer, and keeps the rest", () => {
  const input = analysisInput(
    {
      path: "src/lib.rs",
      result: {
        status: "clean",
        diagnostics: [],
        symbols: [],
        links: [
          {
            sourceKey: null,
            kind: "calls",
            targetName: "f",
            range: { start: 0, end: 1 },
            data: {
              scope: "g",
              conditions: [],
              toolchain: {
                origin: "toolchain",
                from: "unresolved",
                target: "x",
              },
              toolchainOutcome: "withheld:cfg-variant",
              toolchainLibrary: {
                library: { ecosystem: "cargo", unit: "dep", symbol: "f" },
              },
            },
          },
        ],
      },
    },
    new Map(),
  );
  assert.deepEqual(input.result.links[0].data, { scope: "g", conditions: [] });
});

test("D24 (PR 70 ruling): an offer the stored link does not take leaves it, and the outcome says why; the rest of the data is the route-off data exactly", () => {
  const symbol = {
    id: "s1",
    projectId: "p",
    module: "rust",
    file: "src/lib.rs",
    key: "k1",
    kind: "function",
    name: "f",
    identity: "f",
    range: { start: 0, end: 1 },
    status: "clean",
  };
  const offData = {
    scope: "f",
    uncertainty: "multiple-checkout-candidates",
    conditions: [],
  };
  const offer = {
    library: { ecosystem: "rust-std", unit: "core", symbol: "fmt::Debug::fmt" },
    written: "fmt",
    rustAnalyzer: "rust-analyzer (fake)",
    configuration: "host",
  };
  const link = {
    id: "l1",
    projectId: "p",
    module: "rust",
    file: "src/lib.rs",
    origin: "parse",
    sourceId: null,
    kind: "calls",
    targetName: "fmt",
    range: { start: 2, end: 3 },
    targetId: null,
    targetStatus: null,
    candidates: [],
    resolution: "unresolved",
    data: { ...offData, toolchainLibrary: offer },
  };
  const library = (symbolPath, evidence) => ({
    linkId: "l1",
    library: {
      ecosystem: "rust-std",
      unit: "core",
      symbol: symbolPath,
      evidence,
    },
  });
  const decided = (decision) =>
    decideLink(structuredClone(link), decision, [symbol]);
  // Applied: the stored target is the offer; the record stays.
  const applied = decided(
    library("fmt::Debug::fmt", "toolchain-declaring-path"),
  );
  assert.equal(applied.data.toolchainLibrary.written, "fmt");
  assert.equal(applied.data.toolchainOutcome, undefined);
  for (const [decision, outcome] of [
    [library("fmt::Debug::fmt", "qualified-path"), "library:agrees"],
    [library("fmt::Display::fmt", "qualified-path"), "library:kept-other-key"],
    [{ linkId: "l1", targetId: "s1" }, "library:kept-checkout"],
    [undefined, "library:not-applied"],
  ]) {
    const kept = decided(decision);
    assert.equal(
      JSON.stringify(kept.data),
      JSON.stringify({ ...offData, toolchainOutcome: outcome }),
      outcome,
    );
  }
test("sixth review C: [build] target is read as a TOML string in every quoting form", () => {
  const host = "x86_64-unknown-linux-gnu";
  const target = (text) => buildTarget([text], host);
  assert.equal(
    target("[build]\ntarget = 'aarch64-unknown-linux-gnu'\n"),
    "aarch64-unknown-linux-gnu",
  );
  assert.equal(
    target('[build]\ntarget = "aarch64-unknown-linux-gnu" # note\n'),
    "aarch64-unknown-linux-gnu",
  );
  assert.equal(
    target("[build]\ntarget = '''riscv64gc-unknown-linux-gnu'''\n"),
    "riscv64gc-unknown-linux-gnu",
  );
  assert.equal(
    target('[build]\ntarget = """thumbv7em-none-eabihf"""\n'),
    "thumbv7em-none-eabihf",
  );
  assert.equal(
    target("build.target = 'wasm32-unknown-unknown'\n"),
    "wasm32-unknown-unknown",
  );
  assert.match(
    target("[build]\ntarget = ['a', 'b']\n").unavailable,
    /more than one build target/,
  );
  assert.match(
    target("[build]\ntarget = 'custom.json'\n").unavailable,
    /target file/,
  );
  assert.equal(target("[net]\noffline = true\n"), host);
  assert.equal(tomlString('"a\\tb"'), "a\tb");
  assert.equal(tomlString("'unclosed"), undefined);
});

test("the SCIP reader reads documents, ranges, roles and rust-analyzer symbols; name sites end at the written name", () => {
  const docs = readScip(
    encodeScip({
      "src/a.rs": [
        [3, 4, 9, GO, true],
        [0, 0, 1, "local 2", false],
      ],
    }),
  );
  assert.deepEqual(docs, [
    {
      path: "src/a.rs",
      occurrences: [
        { range: [3, 4, 3, 9], symbol: GO, roles: 1 },
        { range: [0, 0, 0, 1], symbol: "local 2", roles: 0 },
      ],
    },
  ]);
  const p = parseSymbol("rust-analyzer cargo core 1.98.1 option/Option#None.");
  assert.deepEqual(
    [p.crate, p.version, p.path, p.kinds],
    [
      "core",
      "1.98.1",
      ["option", "Option", "None"],
      ["namespace", "type", "term"],
    ],
  );
  assert.deepEqual(parseSymbol(GO).kinds, [
    "namespace",
    "type",
    "typeparam",
    "method",
  ]);
  assert.equal(parseSymbol("local 7").local, true);
  const text = "let x = Vec::<u8>::new(); m!(); use a::b as c;";
  assert.deepEqual(nameSite(text, { start: 8, end: 22 }, "Vec::new"), {
    s: 19,
    e: 22,
  });
  assert.deepEqual(nameSite(text, { start: 26, end: 28 }, "m!"), {
    s: 26,
    e: 27,
  });
  assert.deepEqual(nameSite(text, { start: 36, end: 45 }, "a::b"), {
    s: 39,
    e: 40,
  });
  assert.equal(nameSite(text, { start: 8, end: 22 }, "Vec::old"), null);
  assert.throws(() => readScip(Buffer.from([0x12, 0x05, 0x0a])), /truncated/);
});

// ---------------------------------------------------------------- the join's gates

test("gates: a checkout answer at the link's own name site upgrades an unresolved link, and the link records it", async () => {
  const { caller, gated, decided, join: counts } = await gateCase();
  assert.equal(caller.resolution, "resolved");
  assert.equal(caller.targetSymbol.name, "go");
  assert.equal(caller.targetSymbol.file, "src/a.rs");
  assert.deepEqual(
    { ...caller.data.toolchain, target: undefined },
    {
      origin: "toolchain",
      rustAnalyzer: "rust-analyzer 1.98.1 (fake 2026-09-01)",
      configuration:
        "x86_64-unknown-linux-gnu (host), default features, all targets, cfg(test) on, build scripts and proc macros on, offline",
      upgrade: "definite",
      from: "unresolved",
      target: undefined,
    },
  );
  assert.equal(caller.data.uncertainty, undefined);
  // The same answer under a cfg condition other than test: withheld.
  assert.equal(gated.resolution, "unresolved");
  assert.equal(gated.data.toolchain, undefined);
  assert.equal(decided["withheld:cfg-link"], 1);
  // A target with cfg variants (`#[cfg(unix)]` / `#[cfg(windows)]` impls): withheld.
  // Design B: `o.run()` meets the cfg-gated impls of b::Other.
  assert.equal(decided["withheld:selected-receiver"], 1);
  assert.ok(counts.answer >= 4);
});

for (const [name, answer, overrides, behaviour, why] of [
  [
    "a symbol of the wrong kind (a module for a call)",
    [sym("a/")],
    {},
    {},
    "filter:kind-incompatible",
  ],
  [
    "a symbol defined more than once in the index",
    [GO],
    { collision: true },
    {},
    "filter:collision",
  ],
  [
    "a trait-method declaration (dispatch)",
    [sym("a/Speak#go().")],
    {},
    {},
    "none:trait-declaration",
  ],
  ["a local binding", ["local 4"], {}, {}, "none:local"],
  [
    "two symbols at the site",
    [GO, sym("a/helper().")],
    {},
    {},
    "none:several-symbols-at-site",
  ],
  ["a crate root", [sym("crate/")], {}, {}, "filter:extern-crate"],
  [
    "a non-macro item of a proc-macro crate from another package",
    ["rust-analyzer cargo pm 0.1.0 thing()."],
    {},
    {
      metadata: {
        packages: [
          {
            id: "pm 0.1.0",
            name: "pm",
            targets: [
              {
                kind: ["proc-macro"],
                name: "pm",
                src_path: "/elsewhere/pm/src/lib.rs",
              },
            ],
          },
        ],
      },
    },
    "filter:proc-macro-crate-item",
  ],
  [
    // D24 applies library answers; a blanket impl has no nameable owner.
    "a library item of a blanket impl (no nameable owner)",
    ["rust-analyzer cargo alloc 1.98.1 string/impl#[T][ToString]go()."],
    {},
    {},
    "unapplied:library-blanket",
  ],
]) {
  test(`gates: ${name} takes no answer`, async () => {
    const { caller, join: counts } = await gateCase(
      answer,
      overrides,
      behaviour,
    );
    assert.equal(caller.resolution, "unresolved", caller.resolution);
    assert.equal(caller.data.toolchain, undefined);
    assert.ok(counts[why] >= 1, `${why}: ${JSON.stringify(counts)}`);
  });
}

test("gates: a source-only definite target the toolchain disagrees with is kept, and counted", async () => {
  const { dump, decided } = await gateCase([GO], {
    helper: sym("b/helper()."),
  });
  const helper = dump.links.find(
    (l) =>
      l.file === "src/lib.rs" &&
      l.kind === "calls" &&
      l.targetName === "a::helper",
  );
  assert.equal(helper.resolution, "resolved");
  assert.equal(helper.targetSymbol.file, "src/a.rs");
  assert.equal(helper.data.toolchain, undefined);
  assert.equal(decided["kept:source-only-differs"], 1);
  const merged = note(dump.report, "merged");
  assert.equal(merged.disagreements.length, 1);
  assert.equal(merged.disagreements[0].name, "a::helper");
  assert.equal(dump.state.disagreements, 1);
});

test("gates: a confirming answer marks the source-only link without changing it", async () => {
  const { dump, decided } = await gateCase();
  const helper = dump.links.find(
    (l) =>
      l.file === "src/lib.rs" &&
      l.kind === "calls" &&
      l.targetName === "a::helper",
  );
  assert.equal(helper.targetSymbol.file, "src/a.rs");
  assert.equal(helper.data.toolchain.from, "definite");
  assert.equal(helper.data.toolchain.target, undefined);
  assert.equal(decided["definite:definite"], 1);
  assert.equal(dump.state.state, "used");
  assert.equal(dump.state.upgradedLinks, 1);
  assert.equal(dump.state.confirmedLinks, 1);
});

// ---------------------------------------------------------------- states

test("unavailable: no rust-analyzer, no rust-src, no Cargo.toml, a missing configured binary", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const empty = join(root, "empty");
    mkdirSync(empty);
    const none = await index(project, root, {
      environment: { PATH: empty, HOME: root },
    });
    assert.equal(none.state.state, "unavailable");
    assert.equal(none.state.reason, "rust-analyzer was not found on PATH");
    const noSrc = fakeToolchain(join(root, "nosrc"), {
      scip,
      metadata: metadata(),
      rustSrc: false,
    });
    const missing = await index(project, root, {
      environment: environment(noSrc),
      toolchainDirectory: "t2",
    });
    assert.equal(missing.state.state, "unavailable");
    assert.match(
      missing.state.reason,
      /^rust-src is not installed for .*sysroot \(rustup component add rust-src\)$/,
    );
    assert.equal(runs(noSrc), 0);
    const named = await index(project, root, {
      environment: environment(noSrc),
      toolchains: { rust: join(root, "no-such", "rust-analyzer") },
      toolchainDirectory: "t3",
    });
    assert.match(named.state.reason, /no-such\/rust-analyzer does not exist$/);
    const bare = join(root, "bare");
    writeProject(bare, {
      "src/lib.rs": GATES["src/lib.rs"],
      "src/a.rs": GATES["src/a.rs"],
      "src/b.rs": GATES["src/b.rs"],
    });
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
    });
    const noManifest = await index(bare, root, {
      environment: environment(tools),
      toolchainDirectory: "t4",
    });
    assert.equal(noManifest.state.reason, "no Cargo.toml at the project root");
    // Unavailable leaves every link source-only.
    for (const dump of [none, missing, named, noManifest])
      assert.equal(
        dump.links.some((l) => l.data?.toolchain),
        false,
      );
  });
});

test("partial: offline cargo metadata fails, or a build script does not finish; no answer is applied", async () => {
  for (const [behaviour, reason] of [
    [
      { metadata: null },
      /^cargo metadata failed offline \(dependencies not in the crate cache\?\): error: failed to get `dep`/,
    ],
    [
      {
        metadata: metadata({
          targets: [
            {
              kind: ["custom-build"],
              name: "build-script-build",
              src_path: "@ROOT@/build.rs",
            },
          ],
        }),
        buildOutputs: [
          { dir: "gates-0123456789abcdef", output: false },
          { dir: "gates-fedcba9876543210", output: false },
        ],
      },
      /^build script of gates did not finish$/,
    ],
    [
      {
        metadata: metadata({
          packages: [
            {
              id: "pm 0.1.0",
              name: "pm",
              targets: [
                { kind: ["proc-macro"], name: "pm", src_path: "/x/src/lib.rs" },
              ],
            },
          ],
          nodes: [{ id: "pm 0.1.0" }],
          deps: [{ pkg: "pm 0.1.0", dep_kinds: [{ kind: null }] }],
        }),
        // C-43 review: cargo never attempted it (a dependency of the macro
        // failed to compile), so it left no fingerprint and no library.
      },
      /^proc macro pm was not built$/,
    ],
    [
      {
        metadata: metadata(),
        diagnostics:
          'at crate gates, file @ROOT@/src/lib.rs: Error Ra("macro-error", Error) from LineCol { line: 2, col: 4 } to LineCol { line: 2, col: 9 }: proc-macro panicked: planted panic\ndiagnostic scan complete\n',
      },
      /^a proc macro failed to expand in 1 file: src\/lib\.rs: proc-macro panicked: planted panic \(line 3\)$/,
    ],
    [
      { metadata: metadata(), diagnostics: "", diagnosticsExit: 101 },
      /^rust-analyzer diagnostics did not finish \(exited 101\), so proc-macro failures are unknown$/,
    ],
  ]) {
    await scratch(async (root) => {
      const project = join(root, "project");
      writeProject(project, GATES);
      const scip = join(root, "answer.scip");
      writeFileSync(scip, gateScip());
      const tools = fakeToolchain(join(root, "tools"), { scip, ...behaviour });
      const dump = await index(project, root, {
        environment: environment(tools),
      });
      assert.equal(dump.state.state, "partial");
      assert.match(dump.state.reason, reason);
      assert.equal(dump.state.upgradedLinks, 0);
      assert.equal(
        dump.links.some((l) => l.data?.toolchain),
        false,
      );
      assert.equal(note(dump.report, "merged"), undefined);
      // Never cached: whatever made it partial may be fixed outside the key.
      const again = await index(project, root, {
        environment: environment(tools),
      });
      assert.equal(again.state.cached, false);
      assert.equal(again.state.state, "partial");
    });
  }
});

test("not partial: packages cargo metadata lists but the run never builds, a finished build script, a built proc macro", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const pm = {
      id: "pm 0.1.0",
      name: "pm",
      targets: [
        { kind: ["proc-macro"], name: "pm", src_path: "/x/src/lib.rs" },
      ],
    };
    const unused = {
      id: "opt 0.1.0",
      name: "opt",
      targets: [
        { kind: ["lib"], name: "opt", src_path: "/y/src/lib.rs" },
        {
          kind: ["custom-build"],
          name: "build-script-build",
          src_path: "/y/build.rs",
        },
      ],
    };
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata({
        targets: [
          {
            kind: ["custom-build"],
            name: "build-script-build",
            src_path: "@ROOT@/build.rs",
          },
        ],
        packages: [pm, unused],
        // pm is needed; opt only as a dev-dependency of pm, which is not a
        // member, so the run never builds it.
        nodes: [
          {
            id: "pm 0.1.0",
            deps: [{ pkg: "opt 0.1.0", dep_kinds: [{ kind: "dev" }] }],
          },
          { id: "opt 0.1.0" },
        ],
        deps: [{ pkg: "pm 0.1.0", dep_kinds: [{ kind: null }] }],
      }),
      buildOutputs: [
        { dir: "gates-0123456789abcdef", output: false },
        { dir: "gates-fedcba9876543210", output: true },
      ],
      fingerprints: [["pm-0123456789abcdef", "lib-pm"]],
      deps: ["libpm-0123456789abcdef.so"],
    });
    const dump = await index(project, root, {
      environment: environment(tools),
    });
    assert.equal(dump.state.state, "used", JSON.stringify(dump.state));
  });
});

test("review: the expected units are what cargo tree builds; an optional dependency cargo metadata's resolve lists is not expected", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    // As jiff and defmt on actix-web: the resolve lists defmt, no enabled
    // feature turns it on, and cargo never builds it.
    const defmt = {
      id: "defmt 1.0.0",
      name: "defmt",
      version: "1.0.0",
      targets: [
        { kind: ["lib"], name: "defmt", src_path: "/z/src/lib.rs" },
        {
          kind: ["custom-build"],
          name: "build-script-build",
          src_path: "/z/build.rs",
        },
      ],
    };
    const behaviour = {
      scip,
      metadata: metadata({
        packages: [defmt],
        nodes: [{ id: "defmt 1.0.0" }],
        deps: [{ pkg: "defmt 1.0.0", dep_kinds: [{ kind: null }] }],
      }),
    };
    const withTree = fakeToolchain(join(root, "tools"), {
      ...behaviour,
      tree: ["gates v0.1.0 (@ROOT@)"],
    });
    const used = await index(project, root, {
      environment: environment(withTree),
    });
    assert.equal(used.state.state, "used", JSON.stringify(used.state));
    // Without cargo tree the resolve is walked, and the unbuilt build script
    // makes the index partial (erring towards partial).
    const noTree = fakeToolchain(join(root, "tools2"), behaviour);
    const walked = await index(project, root, {
      environment: environment(noTree),
      toolchainDirectory: "toolchain2",
    });
    assert.equal(walked.state.state, "partial");
    assert.equal(walked.state.reason, "build script of defmt did not finish");
  });
});

test("a library root rust-analyzer did not index makes the index partial", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, encodeScip({ "src/a.rs": [] }));
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
    });
    const dump = await index(project, root, {
      environment: environment(tools),
    });
    assert.equal(dump.state.state, "partial");
    assert.equal(
      dump.state.reason,
      "crate root src/lib.rs is not in the index",
    );
  });
});

// ---------------------------------------------------------------- D24: library answers

test("D24: the declaring path of a library symbol is its module path; impl items are Type::item or <Type as Trait>::item; blanket impls and crate roots have none", () => {
  const path = (symbol) => libraryPath(parseSymbol(symbol));
  const core =
    "rust-analyzer cargo core https://github.com/rust-lang/rust/library/core";
  assert.equal(path(`${core} ops/range/Range#`), "ops::range::Range");
  assert.equal(
    path(`${core} option/impl#[\`Option<T>\`]unwrap().`),
    "option::Option::unwrap",
  );
  assert.equal(
    path(`${core} result/impl#[\`Result<T, E>\`][Try]branch().`),
    "<result::Result as Try>::branch",
  );
  assert.equal(
    path(`${core} num/impl#[u64]to_be_bytes().`),
    "num::u64::to_be_bytes",
  );
  assert.equal(
    path("rust-analyzer cargo tempfile 3.27.0 dir/tempdir()."),
    "dir::tempdir",
  );
  assert.equal(path(`${core} option/Option#None.`), "option::Option::None");
  // A blanket impl (its self type is a type parameter) has no nameable owner.
  assert.equal(
    path("rust-analyzer cargo alloc 1 string/impl#[T][ToString]to_string()."),
    undefined,
  );
  assert.equal(path("rust-analyzer cargo tempfile 3.27.0 crate/"), undefined);
});

test("D24: an unresolved link answered with a dependency's item becomes a library target keyed by the unit and declaring path, with the lockfile's version and the written path", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, {
      ...GATES,
      "Cargo.lock":
        'version = 4\n\n[[package]]\nname = "gates"\nversion = "0.1.0"\n\n[[package]]\nname = "dep"\nversion = "1.2.3"\n',
    });
    const scip = join(root, "answer.scip");
    // The t.go call is answered with dep's inherent method Thing::go.
    writeFileSync(
      scip,
      gateScip(["rust-analyzer cargo dep 1.2.3 inner/impl#[Thing]go()."]),
    );
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
    });
    const dump = await index(project, root, {
      environment: environment(tools),
    });
    assert.equal(dump.state.state, "used", JSON.stringify(dump.state));
    const [caller] = goLinks(dump).sort(
      (x, y) => x.range.start - y.range.start,
    );
    assert.equal(caller.resolution, "library");
    assert.deepEqual(
      caller.libraries.map(({ id: _id, ...t }) => t),
      [
        {
          ecosystem: "cargo",
          unit: "dep",
          symbol: "inner::Thing::go",
          version: "1.2.3",
          versionSource: "Cargo.lock",
          evidence: "toolchain-declaring-path",
        },
      ],
    );
    // Offered by the analysis with the written path; applied in the resolve
    // phase (the stored target's evidence records it).
    assert.equal(caller.data.toolchainLibrary.written, "t.go");
    assert.equal(caller.data.toolchain, undefined);
    assert.ok(dump.state.libraryOffered >= 1, JSON.stringify(dump.state));
    // The gated twin under cfg(feature = "extra") takes no answer.
    const gated = goLinks(dump).sort(
      (x, y) => x.range.start - y.range.start,
    )[1];
    assert.notEqual(gated.resolution, "library");
  });
});

// ---------------------------------------------------------------- policy, cache, cancellation

/** Path, size and content of every file under a directory. */
function treeHash(dir) {
  const hash = createHash("sha256");
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const info = statSync(p);
      hash.update(`${p} ${info.size}\n`);
      if (info.isDirectory()) walk(p);
      else hash.update(readFileSync(p));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

test("policy: rust-analyzer runs offline on a copy outside the project, with its own target dir and crate cache, in one configuration", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, {
      ...GATES,
      "target/debug/stale.txt": "old build output",
      "notes/data.txt": "read by a build script",
    });
    mkdirSync(join(project, ".git"));
    writeFileSync(join(project, ".git", "HEAD"), "ref: refs/heads/main\n");
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
    });
    const userCache = join(root, "cargo-home");
    writeProject(userCache, {
      "registry/cache/index.crates.io-0/dep-1.0.0.crate": "archive",
      "config.toml": "[net]\noffline = true\n",
    });
    const before = treeHash(project);
    const cacheBefore = treeHash(userCache);
    await index(project, root, { environment: environment(tools) });
    assert.equal(treeHash(project), before, "the project is never written");
    assert.equal(
      treeHash(userCache),
      cacheBefore,
      "the user's crate cache is never written",
    );
    const seen = JSON.parse(readFileSync(tools.seen, "utf8"));
    assert.equal(seen.cwd.startsWith(project), false);
    assert.equal(seen.cwd.startsWith(join(root, "toolchain", "rust")), true);
    assert.equal(seen.env.CARGO_NET_OFFLINE, "true");
    for (const name of ["CARGO_TARGET_DIR", "CARGO_HOME"]) {
      assert.equal(
        seen.env[name].startsWith(join(root, "toolchain", "rust", "run-")),
        true,
        name,
      );
    }
    assert.equal(seen.env.PATH.split(delimiter)[0], dirname(tools.runs));
    // The copy: sources and other files, no build output and no version control.
    assert.ok(
      seen.files.includes("src/lib.rs") &&
        seen.files.includes("notes/data.txt"),
    );
    assert.equal(
      seen.files.some((f) => f.startsWith("target") || f.startsWith(".git")),
      false,
    );
    assert.equal(seen.lib, GATES["src/lib.rs"]);
    assert.deepEqual(seen.config.cfg, { setTest: true });
    assert.equal(seen.config.cargo.allTargets, true);
    assert.deepEqual(seen.config.cargo.features, []);
    assert.equal(seen.config.cargo.noDefaultFeatures, false);
    // No run directory is left behind.
    assert.deepEqual(
      readdirSync(join(root, "toolchain", "rust")).filter((n) =>
        n.startsWith("run-"),
      ),
      [],
    );
  });
});

test("cache: unchanged inputs reuse the index; an edit to a Rust file, a manifest or another project file runs rust-analyzer again", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
    });
    const env = { environment: environment(tools) };
    const first = await index(project, root, env);
    assert.equal(first.state.cached, false);
    const second = await index(project, root, env);
    assert.equal(second.state.cached, true);
    assert.equal(second.state.key, first.state.key);
    assert.equal(runs(tools), 1);
    assert.deepEqual(
      second.links.map((l) => [l.id, l.resolution, l.targetId]),
      first.links.map((l) => [l.id, l.resolution, l.targetId]),
    );
    writeFileSync(
      join(project, "src/a.rs"),
      GATES["src/a.rs"] + "\npub fn more() {}\n",
    );
    const edited = await index(project, root, env);
    assert.equal(edited.state.cached, false);
    assert.equal(runs(tools), 2);
    writeFileSync(join(project, "data.txt"), "include_str! input");
    await index(project, root, env);
    assert.equal(runs(tools), 3);
    writeFileSync(
      join(project, "Cargo.toml"),
      GATES["Cargo.toml"] + "\n[features]\nextra = []\n",
    );
    await index(project, root, env);
    assert.equal(runs(tools), 4);
  });
});

test("cancellation: aborting the index ends a rust-analyzer that never finishes and leaves nothing running", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    // Exit handshake: the hanging fake holds the write end of this FIFO
    // open; when it dies, by any signal, the reader below sees its end.
    const alive = join(root, "alive.fifo");
    execFileSync("mkfifo", [alive]);
    const gone = new Promise((resolve, reject) => {
      const stream = createReadStream(alive);
      stream.on("data", () => {});
      stream.on("end", resolve);
      stream.on("error", reject);
    });
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
      hang: true,
      alive,
    });
    const controller = new AbortController();
    const indexing = index(project, root, {
      environment: environment(tools),
      signal: controller.signal,
    });
    // Readiness handshake: the fake writes its pid once it is running.
    await ready(tools.ready, indexing);
    controller.abort();
    const dump = await indexing;
    assert.deepEqual(
      dump.report.analysisErrors.map((e) => e.message),
      ["Indexing was cancelled"],
    );
    // The kill is asynchronous: the FIFO's end is the process's exit.
    await gone;
    assert.deepEqual(
      readdirSync(join(root, "toolchain", "rust")).filter((n) =>
        n.startsWith("run-"),
      ),
      [],
    );
  });
});

test("the run limit: a hang past the limit (a controlled clock) makes the route unavailable, not stuck", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
      hang: true,
    });
    const clock = controlledClock();
    const LIMIT = 123456;
    const real = {
      schedule: (cb, ms) =>
        ms === LIMIT ? clock.schedule(cb, ms) : setTimeout(cb, ms),
      cancel: (h) =>
        typeof h === "number" ? clock.cancel(h) : clearTimeout(h),
    };
    setRunControls({ clock: real, limitMs: LIMIT });
    try {
      const indexing = index(project, root, {
        environment: environment(tools),
      });
      await ready(tools.ready, indexing);
      assert.equal(clock.fireNext(), LIMIT);
      const dump = await indexing;
      assert.equal(dump.state.state, "unavailable");
      assert.match(dump.state.reason, /^rust-analyzer timed_out/);
      assert.equal(
        dump.links.some((l) => l.data?.toolchain),
        false,
      );
    } finally {
      setRunControls({});
    }
  });
});

// ---------------------------------------------------------------- off is unchanged

test("off: no setting stores no toolchain data and the same rows as an index before C-43 would", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const off = await index(project, root, { toolchains: null });
    assert.equal(off.report.toolchains, undefined);
    assert.equal(
      off.links.some(
        (l) => l.data && ("toolchain" in l.data || "tc" in l.data),
      ),
      false,
    );
    const [caller] = goLinks(off);
    assert.equal(caller.resolution, "unresolved");
  });
});

test("graph answers report the Rust route's state beside Go's", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    // Trusted on this machine, with a local rust-analyzer path that does not exist.
    await initializeWorkspace(project, undefined, { trust: "trusted" });
    // The user's own answer file (C-44), outside the checkout.
    const file = trustFile();
    const answers = JSON.parse(readFileSync(file, "utf8"));
    answers.checkouts[realpathSync(project)].toolchain = {
      go: false,
      rust: join(root, "none", "rust-analyzer"),
    };
    writeFileSync(file, JSON.stringify(answers));
    const response = await executeGraph({ command: "index", root: project });
    assert.equal(response.trust, "trusted");
    assert.deepEqual(Object.keys(response.toolchain).sort(), [
      "rust",
      "setting",
    ]);
    assert.equal(response.toolchain.rust.state, "unavailable");
    assert.match(
      response.toolchain.rust.reason,
      /none\/rust-analyzer does not exist$/,
    );
  });
});

// ---------------------------------------------------------------- C-43 review: the route never makes source-only worse

const runFolders = (root) => {
  const dir = join(root, "toolchain", "rust");
  return existsSync(dir)
    ? readdirSync(dir).filter((n) => /^run-[0-9a-f-]{36}$/.test(n))
    : [];
};

test("review B2: a FIFO, an unreadable file and a read-only checkout leave the route used, every Rust file analysed and no run folder", async () => {
  for (const shape of ["fifo", "unreadable", "read-only"]) {
    await scratch(async (root) => {
      const project = join(root, "project");
      writeProject(project, { ...GATES, "notes/data.txt": "data" });
      if (shape === "fifo")
        execFileSync("mkfifo", [join(project, "notes", "pipe")]);
      if (shape === "unreadable") chmodSync(join(project, "notes/data.txt"), 0);
      const readOnly = (dir) => {
        for (const name of readdirSync(dir)) {
          const p = join(dir, name);
          if (statSync(p).isDirectory()) readOnly(p);
          else chmodSync(p, 0o444);
        }
        chmodSync(dir, 0o555);
      };
      if (shape === "read-only") readOnly(project);
      try {
        const scip = join(root, "answer.scip");
        writeFileSync(scip, gateScip());
        const tools = fakeToolchain(join(root, "tools"), {
          scip,
          metadata: metadata(),
        });
        const dump = await index(project, root, {
          environment: environment(tools),
        });
        assert.equal(
          dump.state.state,
          "used",
          shape + JSON.stringify(dump.state),
        );
        assert.equal(dump.report.failedCount, 0, shape);
        assert.deepEqual(dump.report.analysisErrors, [], shape);
        assert.deepEqual(runFolders(root), [], shape);
        const seen = JSON.parse(readFileSync(tools.seen, "utf8"));
        assert.equal(seen.files.includes("notes/pipe"), false, shape);
        assert.equal(seen.files.includes("src/lib.rs"), true, shape);
      } finally {
        // The scratch folder must be removable.
        execFileSync("chmod", ["-R", "u+rwX", project]);
      }
    });
  }
});

test("review B2: an unexpected failure in the route reports unavailable with its reason and keeps the source-only rows", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const tools = fakeToolchain(join(root, "tools"), {
      scip: join(root, "none.scip"),
      metadata: metadata(),
    });
    const off = await index(project, root, { toolchains: null });
    // The toolchain folder is a file: creating the run folder fails.
    writeFileSync(join(root, "blocked"), "a file, not a folder");
    const dump = await index(project, root, {
      environment: environment(tools),
      toolchainDirectory: "blocked",
    });
    assert.equal(dump.state.state, "unavailable");
    assert.match(dump.state.reason, /^the toolchain route failed: /);
    assert.equal(dump.report.failedCount, 0);
    assert.deepEqual(dump.report.analysisErrors, []);
    assert.deepEqual(
      dump.links.map((l) => [l.id, l.resolution, l.targetId]),
      off.links.map((l) => [l.id, l.resolution, l.targetId]),
    );
  });
});

test("review B2: run folders of runs that are no longer live are swept; a live run's folder is kept", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
    });
    const work = join(root, "toolchain", "rust");
    const dead = join(work, "run-00000000-0000-4000-8000-000000000001");
    const live = join(work, "run-00000000-0000-4000-8000-000000000002");
    mkdirSync(join(dead, "project"), { recursive: true });
    // A read-only folder in the dead run, as a read-only checkout's copy.
    mkdirSync(join(dead, "project", "locked"));
    writeFileSync(join(dead, "project", "locked", "f"), "x");
    chmodSync(join(dead, "project", "locked"), 0o555);
    mkdirSync(live, { recursive: true });
    // Another process holds the live run's lock until told to stop.
    const holder = spawn(
      process.execPath,
      [
        "-e",
        "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('BEGIN IMMEDIATE');console.log('held');process.stdin.on('data',()=>process.exit(0));",
        live + ".lock",
      ],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    await new Promise((resolve) => holder.stdout.once("data", resolve));
    try {
      await index(project, root, { environment: environment(tools) });
      assert.deepEqual(runFolders(root), [basename(live)]);
    } finally {
      holder.stdin.write("stop\n");
      await new Promise((resolve) => holder.once("exit", resolve));
    }
    // The holder is gone: the next run sweeps that folder too.
    writeFileSync(join(project, "notes.txt"), "changed");
    await index(project, root, { environment: environment(tools) });
    assert.deepEqual(runFolders(root), []);
  });
});

test("review: [build] target is honoured and recorded; a list of targets, a target file and a rust-project.json are unavailable", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    const triple = "aarch64-unknown-linux-gnu";
    writeProject(project, {
      ...GATES,
      ".cargo/config.toml": '[build]\ntarget = "' + triple + '"\n',
    });
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      triple,
      metadata: metadata({
        targets: [
          {
            kind: ["custom-build"],
            name: "build-script-build",
            src_path: "@ROOT@/build.rs",
          },
        ],
      }),
      // The build script's output lives under target/<triple>/debug.
      buildOutputs: [{ dir: "gates-0123456789abcdef", output: true }],
    });
    const dump = await index(project, root, {
      environment: environment(tools),
    });
    assert.equal(dump.state.state, "used", JSON.stringify(dump.state));
    assert.match(
      dump.state.configuration,
      /^aarch64-unknown-linux-gnu \(\[build\] target\)/,
    );
    const args = JSON.parse(
      readFileSync(join(dirname(tools.runs), "cargo-args.json"), "utf8"),
    );
    assert.equal(args[args.indexOf("--filter-platform") + 1], triple);
  });
  for (const [files, reason] of [
    [
      { ".cargo/config.toml": '[build]\ntarget = ["a-b-c", "d-e-f"]\n' },
      /names more than one build target/,
    ],
    [
      { ".cargo/config.toml": '[build]\ntarget = "my-board.json"\n' },
      /names a target file/,
    ],
    [{ "rust-project.json": "{}" }, /rust-project\.json/],
  ])
    await scratch(async (root) => {
      const project = join(root, "project");
      writeProject(project, { ...GATES, ...files });
      const tools = fakeToolchain(join(root, "tools"), {
        scip: join(root, "none.scip"),
        metadata: metadata(),
      });
      const dump = await index(project, root, {
        environment: environment(tools),
      });
      assert.equal(dump.state.state, "unavailable");
      assert.match(dump.state.reason, reason);
      assert.equal(runs(tools), 0);
    });
});

test("review: a toolchain outside rustup's toolchains folder is pinned by its sysroot path", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
    });
    await index(project, root, { environment: environment(tools) });
    const seen = JSON.parse(readFileSync(tools.seen, "utf8"));
    assert.equal(seen.env.RUSTUP_TOOLCHAIN, tools.sysroot);
  });
});

// ---------------------------------------------------------------- the real rust-analyzer

const haveRealAnalyzer = (() => {
  const dirs = (process.env.PATH ?? "").split(delimiter);
  return (
    dirs.some((dir) => dir && existsSync(join(dir, "rust-analyzer"))) &&
    dirs.some((dir) => dir && existsSync(join(dir, "cargo")))
  );
})();
const needsAnalyzer = haveRealAnalyzer
  ? {}
  : { skip: "no rust-analyzer on PATH (real toolchain route)" };

test(
  "real rust-analyzer: a workspace with a proc macro and a build script is used, upgrades links and writes nothing to the project",
  needsAnalyzer,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "basic");
      cpSync(FIXTURE, project, { recursive: true });
      const before = treeHash(project);
      const dump = await index(project, root, { environment: process.env });
      if (
        dump.state.state === "unavailable" &&
        /rust-src/.test(dump.state.reason)
      )
        return; // no rust-src: nothing to check
      assert.equal(dump.state.state, "used", JSON.stringify(dump.state));
      assert.equal(treeHash(project), before);
      assert.equal(dump.state.disagreements, 0);
      const upgraded = dump.links.filter(
        (l) => l.data?.toolchain?.from === "unresolved",
      );
      const named = (file, name) =>
        upgraded.find((l) => l.file === file && l.targetName === name)
          ?.targetSymbol?.identity;
      // Design B: paths are decided through their bindings.
      const helper = dump.links.find(
        (l) => l.file === "app/src/lib.rs" && l.targetName === "util::helper",
      );
      assert.equal(helper?.data?.toolchain?.origin, "toolchain");
      assert.equal(helper?.targetSymbol?.identity, "helper");
      // run() calls code a build script generates (`generated()`) and a
      // derive's method (`Greeter.hello()`): macro output on the function's
      // trace, so its receiver calls are withheld (the trace is the whole
      // function up to the site, an over-approximation).
      for (const name of ["a.radius", "c.diameter", "square.side"])
        assert.equal(
          dump.links.find(
            (l) => l.file === "app/src/lib.rs" && l.targetName === name,
          )?.data?.toolchainOutcome,
          "withheld:selected-receiver",
          name,
        );
      // Sixth review: source-only records that an opaque item may shadow the
      // derive path, so the route only confirms it now (confirm-only).
      assert.equal(
        dump.links.find(
          (l) =>
            l.file === "app/src/lib.rs" && l.targetName === "macros::Hello",
        )?.data?.toolchainOutcome,
        "withheld:opaque-shadow",
      );
      // Dispatch on a trait object stays open: the toolchain names the declaration.
      const dispatch = dump.links.find(
        (l) => l.file === "app/src/lib.rs" && l.targetName === "s.area",
      );
      assert.notEqual(dispatch.resolution, "resolved");
      // D24: standard-library answers are applied as library targets.
      const library = dump.links.filter(
        (l) => l.libraries?.[0]?.evidence === "toolchain-declaring-path",
      );
      assert.ok(library.length >= 1, "no library answer was applied");
      assert.ok(
        library.every((l) =>
          ["rust-std", "cargo"].includes(l.libraries?.[0]?.ecosystem),
        ),
      );
      // A link to code a build-script cfg turns on is withheld.
      assert.ok(
        (note(dump.report, "merged").decided["withheld:opaque-shadow"] ?? 0) +
          (note(dump.report, "merged").decided["withheld:selected-binding"] ??
            0) >=
          1,
      );
    });
  },
);

test(
  "real rust-analyzer: a failing build script exits 0 and says nothing, and the route reports partial",
  needsAnalyzer,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "basic");
      cpSync(FIXTURE, project, { recursive: true });
      writeFileSync(
        join(project, "app/build.rs"),
        'fn main() { panic!("a missing system library") }\n',
      );
      const dump = await index(project, root, { environment: process.env });
      if (
        dump.state.state === "unavailable" &&
        /rust-src/.test(dump.state.reason)
      )
        return;
      assert.equal(dump.state.state, "partial", JSON.stringify(dump.state));
      assert.equal(dump.state.reason, "build script of app did not finish");
      assert.equal(
        dump.links.some((l) => l.data?.toolchain),
        false,
      );
    });
  },
);

/** The reviewer's repro: Greeter also implements a trait with a hello() method. */
function withHiTrait(project) {
  const lib = join(project, "app/src/lib.rs");
  writeFileSync(
    lib,
    readFileSync(lib, "utf8") +
      "\npub trait Hi {\n    fn hello(&self) -> &'static str;\n}\n\nimpl Hi for Greeter {\n    fn hello(&self) -> &'static str {\n        \"hi\"\n    }\n}\n",
  );
}
const helloLink = (dump) =>
  dump.links.find(
    (l) => l.file === "app/src/lib.rs" && l.targetName === "Greeter.hello",
  );

test(
  "real rust-analyzer, review B1: a proc macro whose dependency fails to compile is never attempted; the route reports partial and applies no answer",
  needsAnalyzer,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "basic");
      cpSync(FIXTURE, project, { recursive: true });
      writeProject(project, {
        "helper/Cargo.toml":
          '[package]\nname = "helper"\nversion = "0.1.0"\nedition = "2021"\n',
        "helper/src/lib.rs": 'pub fn name() -> u32 {\n    "no"\n}\n',
      });
      writeFileSync(
        join(project, "Cargo.toml"),
        '[workspace]\nmembers = ["app", "macros", "helper"]\nresolver = "2"\n',
      );
      writeFileSync(
        join(project, "macros/Cargo.toml"),
        readFileSync(join(project, "macros/Cargo.toml"), "utf8") +
          '\n[dependencies]\nhelper = { path = "../helper" }\n',
      );
      await rm(join(project, "Cargo.lock"), { force: true });
      withHiTrait(project);
      const dump = await index(project, root, { environment: process.env });
      if (
        dump.state.state === "unavailable" &&
        /rust-src/.test(dump.state.reason)
      )
        return;
      assert.equal(dump.state.state, "partial", JSON.stringify(dump.state));
      assert.ok(
        dump.state.partial.some((p) =>
          /^proc macro macros was not built$/.test(p),
        ),
        JSON.stringify(dump.state.partial),
      );
      assert.equal(
        dump.links.some((l) => l.data?.toolchain),
        false,
      );
      assert.equal(helloLink(dump)?.data?.toolchain, undefined);
    });
  },
);

test(
  "real rust-analyzer, review B1: a proc macro that panics while expanding makes the route partial (rust-analyzer diagnostics), with the file named",
  needsAnalyzer,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "basic");
      cpSync(FIXTURE, project, { recursive: true });
      const macros = join(project, "macros/src/lib.rs");
      writeFileSync(
        macros,
        readFileSync(macros, "utf8").replace(
          "    let text = input.to_string();",
          '    let text = input.to_string();\n    if text.contains("Greeter") {\n        panic!("planted panic");\n    }',
        ),
      );
      withHiTrait(project);
      const dump = await index(project, root, { environment: process.env });
      if (
        dump.state.state === "unavailable" &&
        /rust-src/.test(dump.state.reason)
      )
        return;
      assert.equal(dump.state.state, "partial", JSON.stringify(dump.state));
      assert.match(
        dump.state.reason,
        /^a proc macro failed to expand in 1 file: app\/src\/lib\.rs: proc-macro panicked: planted panic/,
      );
      assert.equal(
        dump.links.some((l) => l.data?.toolchain),
        false,
      );
    });
  },
);

/** The second reviewer's shapes in one crate (review B1 and the kind match). */
const CFG_CRATE = {
  "Cargo.toml":
    '[package]\nname = "cfgs"\nversion = "0.1.0"\nedition = "2021"\n\n[features]\nnope = []\n',
  "src/lib.rs": [
    "// (b) module-level cfg twins through #[path]",
    "#[cfg(unix)]",
    '#[path = "sys/unix.rs"]',
    "mod imp;",
    "#[cfg(windows)]",
    '#[path = "sys/windows.rs"]',
    "mod imp;",
    "pub fn a_use_imp() -> u32 {",
    "    imp::platform_a()",
    "}",
    "",
    "// (a) redb's shape: one name re-exported from two cfg-gated modules",
    "#[cfg(unix)]",
    "mod optimized;",
    "#[cfg(unix)]",
    "pub use optimized::FileBackend;",
    "#[cfg(not(unix))]",
    "mod fallback;",
    "#[cfg(not(unix))]",
    "pub use fallback::FileBackend;",
    "pub fn backend() -> u32 {",
    "    FileBackend::new().size()",
    "}",
    "",
    "// (c) twins declared only inside a macro invocation, as cfg_if! does",
    "macro_rules! pick {",
    "    ($($i:item)*) => { $($i)* };",
    "}",
    "pick! {",
    "    #[cfg(unix)]",
    "    mod c_unix;",
    "    #[cfg(unix)]",
    "    use c_unix as c_sys;",
    "    #[cfg(not(unix))]",
    "    mod c_other;",
    "    #[cfg(not(unix))]",
    "    use c_other as c_sys;",
    "}",
    "pub fn open() -> u32 {",
    "    c_sys::c_open()",
    "}",
    "",
    "// The kind match: a module and the function a macro declares inside it",
    "macro_rules! accessor {",
    "    ($n:ident) => {",
    "        pub fn $n() -> u32 {",
    "            1",
    "        }",
    "    };",
    "}",
    "pub mod e_width {",
    "    accessor!(e_width);",
    "}",
    "pub fn width() -> u32 {",
    "    e_width::e_width()",
    "}",
    "",
    "// Trait associated items in generic code: the trait's declaration",
    "pub trait Shape {",
    "    const SIDES: u32;",
    "}",
    "pub fn sides<S: Shape>() -> u32 {",
    "    S::SIDES",
    "}",
    "",
    "// Second review: one name imported from two cfg-gated modules (the",
    "// source-only uncertainty is compound)",
    "mod q_a;",
    "mod q_b;",
    "#[cfg(unix)]",
    "use q_a::q_helper;",
    "#[cfg(windows)]",
    "use q_b::q_helper;",
    "pub fn q() -> u32 {",
    "    q_helper()",
    "}",
    "",
    "// Second review: cfg_attr(path) twins of one module",
    '#[cfg_attr(unix, path = "s_sys/unix.rs")]',
    '#[cfg_attr(windows, path = "s_sys/windows.rs")]',
    "mod s_sys;",
    "pub fn s() -> u32 {",
    "    s_sys::s_open()",
    "}",
    "",
    "// Third review: one module name aliased from two cfg-gated modules",
    "mod q2_a;",
    "mod q2_b;",
    "#[cfg(unix)]",
    "use q2_a as q_sys;",
    "#[cfg(windows)]",
    "use q2_b as q_sys;",
    "pub fn q2() -> u32 {",
    "    q_sys::q_helper2()",
    "}",
    "",
    "// Third review: one type re-exported from two cfg-gated modules",
    "mod q_ta;",
    "mod q_tb;",
    "#[cfg(unix)]",
    "pub use q_ta::QConn;",
    "#[cfg(not(unix))]",
    "pub use q_tb::QConn;",
    "pub fn qc() -> u32 {",
    "    let c = QConn::new();",
    "    c.q_send()",
    "}",
    "",
    "// Third review: cfg_attr(path) with the default file as the other twin",
    '#[cfg_attr(unix, path = "s2_unix.rs")]',
    "mod s2;",
    "pub fn s2f() -> u32 {",
    "    s2::s2_open()",
    "}",
    "",
    "// Fourth review: ungated items of different names, selected by cfg on",
    "// the `use` (rgb's ZGray shape)",
    "mod z_fmt;",
    "#[cfg(unix)]",
    "pub use z_fmt::ZGrayV08 as ZGray;",
    "#[cfg(not(unix))]",
    "pub use z_fmt::ZGrayV09 as ZGray;",
    "pub fn zgray() -> u32 {",
    "    ZGray::zg()",
    "}",
    "",
    "// Fourth review: renamed function twins in another module (brotli's",
    "// shape), called through the module from a third file",
    "pub mod third;",
    "mod zcall;",
    "",
    "// The narrowed guard: a module under cfg with no twin is answered",
    '#[cfg(not(feature = "nope"))]',
    "mod gated_ok;",
    "pub fn g() -> u32 {",
    "    gated_ok::g_fn()",
    "}",
    "",
    "// A plain call, decided by the route",
    "pub fn plain() -> u32 {",
    "    helper()",
    "}",
    "fn helper() -> u32 {",
    "    2",
    "}",
    "",
  ].join("\n"),
  "src/sys/unix.rs": "pub fn platform_a() -> u32 {\n    1\n}\n",
  "src/sys/windows.rs": "pub fn platform_a() -> u32 {\n    2\n}\n",
  "src/optimized.rs":
    "pub struct FileBackend;\n\nimpl FileBackend {\n    pub fn new() -> Self {\n        FileBackend\n    }\n    pub fn size(&self) -> u32 {\n        1\n    }\n}\n",
  "src/fallback.rs":
    "pub struct FileBackend;\n\nimpl FileBackend {\n    pub fn new() -> Self {\n        FileBackend\n    }\n    pub fn size(&self) -> u32 {\n        2\n    }\n}\n",
  "src/c_unix.rs": "pub fn c_open() -> u32 {\n    1\n}\n",
  "src/q_a.rs": "pub fn q_helper() -> u32 {\n    1\n}\n",
  "src/q_b.rs": "pub fn q_helper() -> u32 {\n    2\n}\n",
  "src/s_sys/unix.rs": "pub fn s_open() -> u32 {\n    1\n}\n",
  "src/s_sys/windows.rs": "pub fn s_open() -> u32 {\n    2\n}\n",
  "src/gated_ok.rs": "pub fn g_fn() -> u32 {\n    1\n}\n",
  "src/q2_a.rs": "pub fn q_helper2() -> u32 {\n    1\n}\n",
  "src/q2_b.rs": "pub fn q_helper2() -> u32 {\n    2\n}\n",
  "src/q_ta.rs":
    "pub struct QConn;\n\nimpl QConn {\n    pub fn new() -> Self {\n        QConn\n    }\n    pub fn q_send(&self) -> u32 {\n        1\n    }\n}\n",
  "src/q_tb.rs":
    "pub struct QConn;\n\nimpl QConn {\n    pub fn new() -> Self {\n        QConn\n    }\n    pub fn q_send(&self) -> u32 {\n        2\n    }\n}\n",
  "src/s2.rs": "pub fn s2_open() -> u32 {\n    1\n}\n",
  "src/s2_unix.rs": "pub fn s2_open() -> u32 {\n    2\n}\n",
  "src/z_fmt.rs":
    "pub struct ZGrayV08;\n\nimpl ZGrayV08 {\n    pub fn zg() -> u32 {\n        8\n    }\n}\n\npub struct ZGrayV09;\n\nimpl ZGrayV09 {\n    pub fn zg() -> u32 {\n        9\n    }\n}\n",
  "src/third.rs":
    "mod z_multi;\nmod z_single;\n#[cfg(unix)]\npub use self::z_multi::compress_multi as z_compress;\n#[cfg(not(unix))]\npub use self::z_single::compress as z_compress;\n",
  "src/third/z_multi.rs": "pub fn compress_multi() -> u32 {\n    1\n}\n",
  "src/third/z_single.rs": "pub fn compress() -> u32 {\n    2\n}\n",
  "src/zcall.rs": "pub fn zc() -> u32 {\n    crate::third::z_compress()\n}\n",
  "src/c_other.rs": "pub fn c_open() -> u32 {\n    2\n}\n",
};

test(
  "real rust-analyzer, second review B1: cfg on whole modules, twins in a cfg_if!-style macro and conditional candidates are never narrowed; a module is never the answer for a function",
  needsAnalyzer,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "cfgs");
      writeProject(project, CFG_CRATE);
      const dump = await index(project, root, { environment: process.env });
      if (
        dump.state.state === "unavailable" &&
        /rust-src/.test(dump.state.reason)
      )
        return;
      assert.equal(dump.state.state, "used", JSON.stringify(dump.state));
      const link = (name) =>
        dump.links.find(
          (l) => l.file === "src/lib.rs" && l.targetName === name,
        );
      // The route ran: the plain call is decided by it.
      assert.equal(link("helper").targetSymbol?.identity, "helper");
      for (const name of [
        "imp::platform_a",
        "FileBackend::new",
        "c_sys::c_open",
        "q_helper",
        "s_sys::s_open",
        "q_sys::q_helper2",
        "QConn::new",
        "c.q_send",
        "s2::s2_open",
        "ZGray::zg",
      ]) {
        const l = link(name);
        assert.ok(l, name);
        assert.equal(
          l.data?.toolchain,
          undefined,
          name + ": " + JSON.stringify(l.data?.toolchain),
        );
        assert.notEqual(
          l.resolution,
          "resolved",
          name + " stays open as source-only left it",
        );
      }
      // Fourth review: every link into the cfg-selected `use` twins stays as
      // source-only left it, including the call from another file.
      for (const l of dump.links.filter(
        (l) =>
          (l.file === "src/lib.rs" && /^ZGray(::|$)/.test(l.targetName)) ||
          (l.file === "src/zcall.rs" && /z_compress$/.test(l.targetName)),
      )) {
        assert.equal(
          l.data?.toolchain,
          undefined,
          `${l.file} ${l.targetName}: ${JSON.stringify(l.data)}`,
        );
        assert.notEqual(l.resolution, "resolved", `${l.file} ${l.targetName}`);
      }
      assert.ok(
        dump.links.some(
          (l) => l.file === "src/zcall.rs" && /z_compress$/.test(l.targetName),
        ),
        "the cross-module call is a link",
      );
      // The narrowed guard's positive control moved to the glob crate (no
      // opaque macro): this crate's cfg_if!-style macro makes every name
      // here one an opaque item may shadow, so the route only confirms.
      const g = link("gated_ok::g_fn");
      assert.equal(
        g?.data?.toolchainOutcome,
        "withheld:opaque-shadow",
        JSON.stringify(g?.data),
      );
      // Never the module e_width for the call e_width::e_width().
      const width = link("e_width::e_width");
      assert.notEqual(
        width?.targetSymbol?.kind,
        "module",
        JSON.stringify(width?.targetSymbol),
      );
      const counts = note(dump.report, "available").join;
      assert.ok(
        (counts["answer:trait-associated"] ?? 0) >= 1,
        JSON.stringify(counts),
      );
      const decided = note(dump.report, "merged").decided;
      assert.ok(
        // The fifth review's cfg-selected guard now takes some of these
        // first (the use twins); together they withhold at least three.
        (decided["withheld:selected-binding"] ?? 0) +
          (decided["withheld:selected-receiver"] ?? 0) +
          (decided["withheld:opaque-shadow"] ?? 0) >=
          3,
        JSON.stringify(decided),
      );
    });
  },
);

// Fifth review: names defined more than once under cfg select between items
// the toolchain sees only one of (aliases, test doubles, function twins).
const SEL_CRATE = {
  "Cargo.toml":
    '[package]\nname = "sel"\nversion = "0.1.0"\nedition = "2021"\n\n[features]\ndefault = ["fast"]\nfast = []\n',
  "src/lib.rs": [
    "#![allow(dead_code, unused_imports)]",
    "",
    "// B1, feature form: type alias twins over always-compiled types",
    "pub struct FastB;",
    "impl FastB {",
    "    pub fn b_new() -> Self {",
    "        FastB",
    "    }",
    "    pub fn b_run(&self) -> u32 {",
    "        1",
    "    }",
    "}",
    "pub struct SlowB;",
    "impl SlowB {",
    "    pub fn b_new() -> Self {",
    "        SlowB",
    "    }",
    "    pub fn b_run(&self) -> u32 {",
    "        2",
    "    }",
    "}",
    '#[cfg(feature = "fast")]',
    "pub type Backend = FastB;",
    '#[cfg(not(feature = "fast"))]',
    "pub type Backend = SlowB;",
    "pub fn backend() -> u32 {",
    "    let b = Backend::b_new();",
    "    b.b_run()",
    "}",
    "",
    "// B1: a field typed by such an alias",
    "pub struct Holder {",
    "    inner: Backend,",
    "}",
    "pub fn held(h: &Holder) -> u32 {",
    "    h.inner.b_run()",
    "}",
    "",
    "// B1, platform form",
    "pub struct UnixS;",
    "impl UnixS {",
    "    pub fn s_open() -> Self {",
    "        UnixS",
    "    }",
    "}",
    "pub struct OtherS;",
    "impl OtherS {",
    "    pub fn s_open() -> Self {",
    "        OtherS",
    "    }",
    "}",
    "#[cfg(unix)]",
    "pub type Sys = UnixS;",
    "#[cfg(not(unix))]",
    "pub type Sys = OtherS;",
    "pub fn sys() -> Sys {",
    "    Sys::s_open()",
    "}",
    "",
    "// F1: a test double selected by cfg(test) on the use",
    "mod mdb;",
    "mod rdb;",
    "#[cfg(test)]",
    "use mdb::MockDb as Db;",
    "#[cfg(not(test))]",
    "use rdb::RealDb as Db;",
    "pub fn db() -> u32 {",
    "    Db::get_db()",
    "}",
    "",
    "// F2, feature form: function twins returning different types",
    "pub struct FastT;",
    "impl FastT {",
    "    pub fn run_t(&self) -> u32 {",
    "        1",
    "    }",
    "}",
    "pub struct SlowT;",
    "impl SlowT {",
    "    pub fn run_t(&self) -> u32 {",
    "        2",
    "    }",
    "}",
    '#[cfg(feature = "fast")]',
    "fn mk() -> FastT {",
    "    FastT",
    "}",
    '#[cfg(not(feature = "fast"))]',
    "fn mk() -> SlowT {",
    "    SlowT",
    "}",
    "pub fn made() -> u32 {",
    "    mk().run_t()",
    "}",
    "",
    "// F2, platform form",
    "pub struct UnixT;",
    "impl UnixT {",
    "    pub fn run_u(&self) -> u32 {",
    "        1",
    "    }",
    "}",
    "pub struct OtherT;",
    "impl OtherT {",
    "    pub fn run_u(&self) -> u32 {",
    "        2",
    "    }",
    "}",
    "#[cfg(unix)]",
    "fn mk2() -> UnixT {",
    "    UnixT",
    "}",
    "#[cfg(not(unix))]",
    "fn mk2() -> OtherT {",
    "    OtherT",
    "}",
    "pub fn made2() -> u32 {",
    "    mk2().run_u()",
    "}",
    "",
    "// Control: one definition under cfg(test) selects nothing",
    "pub struct Plain;",
    "impl Plain {",
    "    pub fn p_go() -> u32 {",
    "        7",
    "    }",
    "}",
    "#[cfg(test)]",
    "mod tests {",
    "    use super::Plain;",
    "    pub fn t_go() -> u32 {",
    "        Plain::p_go()",
    "    }",
    "}",
    "pub fn plain() -> u32 {",
    "    Plain::p_go()",
    "}",
    "",
    "mod extra;",
    "",
  ].join("\n"),
  "src/mdb.rs":
    "pub struct MockDb;\n\nimpl MockDb {\n    pub fn get_db() -> u32 {\n        1\n    }\n}\n",
  "src/rdb.rs":
    "pub struct RealDb;\n\nimpl RealDb {\n    pub fn get_db() -> u32 {\n        2\n    }\n}\n",
  "src/extra.rs": "pub fn extra() -> u32 {\n    crate::plain()\n}\n",
};

test(
  "real rust-analyzer, fifth review: a cfg-selected name (alias twins, a cfg(test) double, function twins) is never narrowed; one cfg(test) definition selects nothing",
  needsAnalyzer,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "sel");
      writeProject(project, SEL_CRATE);
      const dump = await index(project, root, { environment: process.env });
      if (
        dump.state.state === "unavailable" &&
        /rust-src/.test(dump.state.reason)
      )
        return;
      assert.equal(dump.state.state, "used", JSON.stringify(dump.state));
      const all = (name) =>
        dump.links.filter(
          (l) => l.file === "src/lib.rs" && l.targetName === name,
        );
      const wrong = [];
      for (const name of [
        "Backend::b_new",
        "b.b_run",
        "h.inner.b_run",
        "Sys::s_open",
        "Db::get_db",
        "mk().run_t",
        "mk2().run_u",
      ]) {
        const links = all(name);
        if (!links.length) wrong.push(`${name}: no link`);
        for (const l of links)
          if (
            l.data?.toolchain !== undefined ||
            l.resolution === "resolved" ||
            !/^withheld:selected-(binding|receiver)$/.test(
              l.data?.toolchainOutcome ?? "",
            )
          )
            wrong.push(
              `${name}: ${l.resolution} ${l.data?.toolchainOutcome ?? l.data?.toolchain?.origin}`,
            );
      }
      // Every shape is checked before failing, so a run names them all.
      assert.deepEqual(wrong, []);
      // The control: the plain call and the one in cfg(test) code are
      // answered (or confirmed) by the route.
      for (const l of all("Plain::p_go"))
        assert.equal(
          l.resolution,
          "resolved",
          `Plain::p_go: ${JSON.stringify(l.data)}`,
        );
    });
  },
);

test(
  "real rust-analyzer, fifth review: an incremental re-index stores the same link rows as a cold index, byte for byte",
  needsAnalyzer,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "sel");
      writeProject(project, SEL_CRATE);
      const run = async (path) => {
        const store = new SqliteGraphStore(path, "tc");
        try {
          const report = await indexProject(
            project,
            new LanguageRegistry([rust]),
            store,
            {
              toolchainDirectory: join(root, "toolchain"),
              environment: process.env,
              toolchains: { rust: true },
              signal: new AbortController().signal,
            },
          );
          return {
            state: toolchainState({ rust: true }, report.toolchains).rust,
            rows: new Map(
              store
                .links()
                .map((l) => [
                  l.id,
                  JSON.stringify([
                    l.file,
                    l.kind,
                    l.targetName,
                    l.range,
                    l.resolution,
                    l.targetId,
                    l.candidates,
                    l.data,
                  ]),
                ]),
            ),
          };
        } finally {
          store.close();
        }
      };
      const first = await run(join(root, "warm.sqlite"));
      if (
        first.state.state === "unavailable" &&
        /rust-src/.test(first.state.reason)
      )
        return;
      assert.equal(first.state.state, "used", JSON.stringify(first.state));
      // Edit another file than the one holding the withheld links.
      writeFileSync(
        join(project, "src/extra.rs"),
        SEL_CRATE["src/extra.rs"] +
          "\npub fn extra_two() -> u32 {\n    crate::plain()\n}\n",
      );
      const warm = await run(join(root, "warm.sqlite"));
      const cold = await run(join(root, "cold.sqlite"));
      assert.equal(warm.state.state, "used");
      assert.equal(cold.state.state, "used");
      assert.ok(
        [...cold.rows.values()].some((row) =>
          row.includes("withheld:selected-"),
        ),
        "the rows hold recorded outcomes",
      );
      assert.equal(warm.rows.size, cold.rows.size);
      for (const [id, row] of cold.rows)
        assert.equal(warm.rows.get(id), row, id);
    });
  },
);

// ---------------------------------------------------------------- fifth review: stale outcomes, failures and the key

/** Every stored link row, whole data included, in stored key order. */
const rowsOf = (dump) =>
  new Map(
    dump.links.map((l) => [
      l.id,
      JSON.stringify([
        l.file,
        l.kind,
        l.targetName,
        l.range,
        l.resolution,
        l.targetId,
        l.candidates,
        l.data,
      ]),
    ]),
  );
const sameRows = (warm, cold) => {
  const a = rowsOf(warm),
    b = rowsOf(cold);
  assert.equal(a.size, b.size);
  for (const [id, row] of b) assert.equal(a.get(id), row, id);
};

test("fifth review: an edit that makes the route partial leaves no earlier outcome; the rows equal a cold index", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
    });
    const first = await index(project, root, {
      environment: environment(tools),
      store: "warm.sqlite",
    });
    assert.equal(first.state.state, "used");
    assert.ok(
      first.links.some(
        (l) => l.data?.toolchainOutcome === "withheld:selected-receiver",
      ),
      "the used index records an outcome",
    );
    // cargo metadata now fails offline (partial), and a Rust file changes.
    fakeToolchain(join(root, "tools"), { scip, metadata: null });
    writeFileSync(
      join(project, "src/a.rs"),
      GATES["src/a.rs"] + "\npub fn added() {}\n",
    );
    const warm = await index(project, root, {
      environment: environment(tools),
      store: "warm.sqlite",
    });
    const cold = await index(project, root, {
      environment: environment(tools),
      store: "cold.sqlite",
    });
    assert.equal(warm.state.state, "partial");
    assert.equal(cold.state.state, "partial");
    assert.equal(
      warm.links.some((l) => l.data?.toolchainOutcome),
      false,
      "no outcome survives",
    );
    sameRows(warm, cold);
  });
});

test("fifth review: turning the route off leaves no outcome or record; the rows equal a cold index without it", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
    });
    const on = await index(project, root, {
      environment: environment(tools),
      store: "warm.sqlite",
    });
    assert.equal(on.state.state, "used");
    assert.ok(on.links.some((l) => l.data?.toolchainOutcome));
    const off = await index(project, root, {
      environment: environment(tools),
      store: "warm.sqlite",
      toolchains: null,
    });
    const cold = await index(project, root, {
      environment: environment(tools),
      store: "cold.sqlite",
      toolchains: null,
    });
    assert.equal(
      off.links.some((l) => l.data?.toolchainOutcome || l.data?.toolchain),
      false,
    );
    sameRows(off, cold);
  });
});

/**
 * Index once and query three times through the graph command, trusted, with
 * the fake toolchain first on PATH and a crate cache of its own. Returns
 * each answer's sync mode and the count of `rust-analyzer scip` runs after
 * each step.
 */
async function failingRoute(root, behaviour, { setup, controls, edit } = {}) {
  const project = join(root, "project");
  writeProject(project, GATES);
  setup?.(project);
  const scip = join(root, "answer.scip");
  writeFileSync(scip, gateScip());
  const tools = fakeToolchain(join(root, "tools"), {
    scip,
    metadata: metadata(),
    ...behaviour,
  });
  await initializeWorkspace(project, undefined, { trust: "trusted" });
  const file = trustFile();
  const answers = JSON.parse(readFileSync(file, "utf8"));
  answers.checkouts[realpathSync(project)].toolchain = {
    go: false,
    rust: true,
  };
  writeFileSync(file, JSON.stringify(answers));
  const saved = {
    PATH: process.env.PATH,
    CARGO_HOME: process.env.CARGO_HOME,
  };
  process.env.PATH = `${dirname(tools.runs)}${delimiter}${saved.PATH}`;
  process.env.CARGO_HOME = join(root, "cargo-home");
  mkdirSync(process.env.CARGO_HOME, { recursive: true });
  try {
    const steps = [];
    const indexing = executeGraph({ command: "index", root: project });
    if (controls) await controls(tools, indexing);
    const first = await indexing;
    steps.push([first.sync.mode, first.toolchain.rust?.state, runs(tools)]);
    for (let i = 0; i < 3; i++) {
      const answer = await executeGraph({
        command: "search",
        args: ["g"],
        root: project,
      });
      steps.push([answer.sync.mode, answer.toolchain.rust?.state, runs(tools)]);
    }
    if (edit) {
      edit(project);
      const answer = await executeGraph({
        command: "search",
        args: ["g"],
        root: project,
      });
      steps.push([answer.sync.mode, answer.toolchain.rust?.state, runs(tools)]);
    }
    return { steps, reason: first.toolchain.rust?.reason };
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.CARGO_HOME === undefined) delete process.env.CARGO_HOME;
    else process.env.CARGO_HOME = saved.CARGO_HOME;
  }
}
const editRust = (project) =>
  writeFileSync(
    join(project, "src/a.rs"),
    GATES["src/a.rs"] + "\npub fn edited() {}\n",
  );

for (const [name, behaviour, reason, options] of [
  ["rust-analyzer scip exits 1", { scipExit: 1 }, /^rust-analyzer exited 1/],
  [
    "rust-analyzer writes an unreadable index",
    { garbage: true },
    /^rust-analyzer's index cannot be read/,
  ],
  [
    "rust-analyzer's output is over the limit",
    { noise: 4096 },
    /^rust-analyzer /,
    { limits: { outputLimit: 1024 } },
  ],
]) {
  test(`fifth review: after a failure (${name}) an unchanged checkout is current: one run, then queries are unchanged; an edit runs it again`, async () => {
    if (options?.limits) setRunControls(options.limits);
    try {
      await scratch(async (root) => {
        const { steps, reason: why } = await failingRoute(root, behaviour, {
          edit: editRust,
        });
        assert.match(why, reason);
        assert.deepEqual(steps, [
          ["index", "unavailable", 1],
          ["unchanged", "unavailable", 1],
          ["unchanged", "unavailable", 1],
          ["unchanged", "unavailable", 1],
          ["updated", "unavailable", 2],
        ]);
      });
    } finally {
      setRunControls({});
    }
  });
}

test("fifth review: after a timeout (a controlled clock) an unchanged checkout is current: queries do not run rust-analyzer again", async () => {
  const clock = controlledClock();
  const LIMIT = 654321;
  setRunControls({
    clock: {
      schedule: (cb, ms) =>
        ms === LIMIT ? clock.schedule(cb, ms) : setTimeout(cb, ms),
      cancel: (h) =>
        typeof h === "number" ? clock.cancel(h) : clearTimeout(h),
    },
    limitMs: LIMIT,
  });
  try {
    await scratch(async (root) => {
      const { steps, reason } = await failingRoute(
        root,
        { hang: true },
        {
          controls: async (tools, indexing) => {
            await ready(tools.ready, indexing);
            assert.equal(clock.fireNext(), LIMIT);
            // A later run would no longer hang, so one that should not
            // happen finishes and is counted instead of blocking the test.
            fakeToolchain(dirname(tools.runs), {
              scip: tools.scip,
              metadata: metadata(),
            });
          },
        },
      );
      assert.match(reason, /^rust-analyzer timed_out/);
      assert.deepEqual(steps, [
        ["index", "unavailable", 1],
        ["unchanged", "unavailable", 1],
        ["unchanged", "unavailable", 1],
        ["unchanged", "unavailable", 1],
      ]);
    });
  } finally {
    setRunControls({});
  }
});

for (const [name, setup, reason] of [
  [
    "a rust-project.json",
    (project) => writeFileSync(join(project, "rust-project.json"), "{}"),
    /rust-project\.json/,
  ],
  [
    "a list of build targets",
    (project) => {
      mkdirSync(join(project, ".cargo"), { recursive: true });
      writeFileSync(
        join(project, ".cargo/config.toml"),
        '[build]\ntarget = ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu"]\n',
      );
    },
    /more than one build target/,
  ],
]) {
  test(`fifth review: ${name} is found by the warm key as by the run: queries are unchanged and rust-analyzer never runs`, async () => {
    await scratch(async (root) => {
      const { steps, reason: why } = await failingRoute(root, {}, { setup });
      assert.match(why, reason);
      assert.deepEqual(steps, [
        ["index", "unavailable", 0],
        ["unchanged", "unavailable", 0],
        ["unchanged", "unavailable", 0],
        ["unchanged", "unavailable", 0],
      ]);
    });
  });
}

test("fifth review: the Cargo configuration outside the project is in the key; changing its build target re-runs, never serves the old index", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
    });
    // The user's crate cache and configuration (CARGO_HOME).
    const home = join(dirname(tools.runs), "cargo-home");
    const first = await index(project, root, {
      environment: environment(tools),
    });
    assert.equal(first.state.state, "used");
    const again = await index(project, root, {
      environment: environment(tools),
    });
    assert.equal(note(again.report, "available").cached, true);
    assert.equal(runs(tools), 1);
    // The user's Cargo configuration now names a build target.
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "config.toml"),
      '[build]\ntarget = "aarch64-unknown-linux-gnu"\n',
    );
    const changed = await index(project, root, {
      environment: environment(tools),
    });
    assert.equal(note(changed.report, "available").cached, false);
    assert.equal(
      note(changed.report, "available").target,
      "aarch64-unknown-linux-gnu",
    );
    assert.equal(runs(tools), 2);
    // A value the route does not read itself (cfg flags), same target: the
    // run reads it, so it is in the key too.
    writeFileSync(
      join(home, "config.toml"),
      '[build]\ntarget = "aarch64-unknown-linux-gnu"\nrustflags = ["--cfg", "fast_path"]\n',
    );
    const flagged = await index(project, root, {
      environment: environment(tools),
    });
    assert.equal(note(flagged.report, "available").cached, false);
    assert.equal(runs(tools), 3);
    // Nothing of the file is stored or reported but its effect.
    assert.equal(
      JSON.stringify(changed.report).includes(home),
      false,
      "the configuration's path is not reported",
    );
  });
});

// Sixth review: selections inside `cfg_if!` (opaque to source-only), glob
// twins of gated modules, method twins in one impl, and static twins.
const CFG_IF = [
  "macro_rules! cfg_if {",
  "    (if #[cfg($m:meta)] { $($i:item)* } else { $($e:item)* }) => {",
  "        $(#[cfg($m)] $i)*",
  "        $(#[cfg(not($m))] $e)*",
  "    };",
  "}",
].join("\n");
const SIXTH_CRATE = {
  "Cargo.toml":
    '[package]\nname = "sixth"\nversion = "0.1.0"\nedition = "2021"\n\n[features]\ndefault = ["fast"]\nfast = []\nasm = []\n',
  "src/lib.rs": [
    "#![allow(dead_code, unused_imports)]",
    CFG_IF,
    "",
    "// 1. a use twin inside cfg_if!",
    "mod a_fast;",
    "mod a_slow;",
    "cfg_if! {",
    '    if #[cfg(feature = "fast")] {',
    "        pub use a_fast::AEngine;",
    "    } else {",
    "        pub use a_slow::AEngine;",
    "    }",
    "}",
    "pub fn a1b(e: &AEngine) -> u32 {",
    "    e.a_go()",
    "}",
    "",
    "// 1. an alias twin inside cfg_if!",
    "pub struct BFast;",
    "impl BFast {",
    "    pub fn b_go(&self) -> u32 {",
    "        1",
    "    }",
    "}",
    "pub struct BSlow;",
    "impl BSlow {",
    "    pub fn b_go(&self) -> u32 {",
    "        2",
    "    }",
    "}",
    "cfg_if! {",
    '    if #[cfg(feature = "fast")] {',
    "        pub type BBackend = BFast;",
    "    } else {",
    "        pub type BBackend = BSlow;",
    "    }",
    "}",
    "pub fn b1(x: &BBackend) -> u32 {",
    "    x.b_go()",
    "}",
    "",
    "// 1. rav1e's shape: a glob inside cfg_if! beside an ungated fallback",
    "pub mod rust {",
    "    pub fn ft() -> u32 {",
    "        1",
    "    }",
    "}",
    '#[cfg(feature = "asm")]',
    "mod asmx {",
    "    pub fn ft() -> u32 {",
    "        2",
    "    }",
    "}",
    "cfg_if! {",
    '    if #[cfg(feature = "asm")] {',
    "        pub use asmx::*;",
    "    } else {",
    "        pub use self::rust::*;",
    "    }",
    "}",
    "pub fn call_ft() -> u32 {",
    "    ft()",
    "}",
    "",
    "// 2. glob twins of gated modules (the std/mio sys/mod.rs shape)",
    "#[cfg(unix)]",
    "mod gu;",
    "#[cfg(unix)]",
    "pub use gu::*;",
    "#[cfg(not(unix))]",
    "mod gw;",
    "#[cfg(not(unix))]",
    "pub use gw::*;",
    "pub fn g1() -> u32 {",
    "    g_thing()",
    "}",
    "",
    "// 3. method twins in one impl block",
    "pub struct CFast;",
    "impl CFast {",
    "    pub fn c_go(&self) -> u32 {",
    "        1",
    "    }",
    "}",
    "pub struct CSlow;",
    "impl CSlow {",
    "    pub fn c_go(&self) -> u32 {",
    "        2",
    "    }",
    "}",
    "pub struct H;",
    "impl H {",
    '    #[cfg(feature = "fast")]',
    "    pub fn c_backend(&self) -> CFast {",
    "        CFast",
    "    }",
    '    #[cfg(not(feature = "fast"))]',
    "    pub fn c_backend(&self) -> CSlow {",
    "        CSlow",
    "    }",
    "}",
    "pub fn c1(h: &H) -> u32 {",
    "    h.c_backend().c_go()",
    "}",
    "",
    "// 3. static twins of different types",
    "pub struct DFast;",
    "impl DFast {",
    "    pub fn d_go(&self) -> u32 {",
    "        1",
    "    }",
    "}",
    "pub struct DSlow;",
    "impl DSlow {",
    "    pub fn d_go(&self) -> u32 {",
    "        2",
    "    }",
    "}",
    '#[cfg(feature = "fast")]',
    "static D_IMPL: DFast = DFast;",
    '#[cfg(not(feature = "fast"))]',
    "static D_IMPL: DSlow = DSlow;",
    "pub fn d1() -> u32 {",
    "    D_IMPL.d_go()",
    "}",
    "",
  ].join("\n"),
  "src/a_fast.rs":
    "pub struct AEngine;\n\nimpl AEngine {\n    pub fn a_go(&self) -> u32 {\n        1\n    }\n}\n",
  "src/a_slow.rs":
    "pub struct AEngine;\n\nimpl AEngine {\n    pub fn a_go(&self) -> u32 {\n        2\n    }\n}\n",
  "src/gu.rs": "pub fn g_thing() -> u32 {\n    1\n}\n",
  "src/gw.rs": "pub fn g_thing() -> u32 {\n    2\n}\n",
};

test(
  "real rust-analyzer, sixth review: selections inside cfg_if!, glob twins of gated modules, method twins and static twins are never narrowed",
  needsAnalyzer,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "sixth");
      writeProject(project, SIXTH_CRATE);
      const dump = await index(project, root, { environment: process.env });
      if (
        dump.state.state === "unavailable" &&
        /rust-src/.test(dump.state.reason)
      )
        return;
      assert.equal(dump.state.state, "used", JSON.stringify(dump.state));
      const wrong = [];
      for (const name of [
        "AEngine",
        "e.a_go",
        "BBackend",
        "x.b_go",
        "ft",
        "g_thing",
        "h.c_backend().c_go",
        "D_IMPL.d_go",
      ]) {
        const links = dump.links.filter(
          (l) =>
            l.file === "src/lib.rs" &&
            l.targetName === name &&
            l.kind !== "contains",
        );
        if (!links.length) wrong.push(`${name}: no link`);
        for (const l of links)
          if (l.data?.toolchain !== undefined || l.resolution === "resolved")
            wrong.push(
              `${name}: ${l.kind} ${l.resolution} ${l.targetSymbol?.file ?? ""}#${l.targetSymbol?.identity ?? ""} ${l.data?.toolchainOutcome ?? l.data?.toolchain?.origin ?? ""} ${l.data?.uncertainty ?? ""}`,
            );
      }
      // Every shape is checked before failing, so a run names them all.
      assert.deepEqual(wrong, []);
    });
  },
);

// Sixth review, item 2: glob twins of gated modules with no opaque macro in
// the crate (the std/mio sys/mod.rs shape). Only the conditional-candidate
// rule keeps these sets from being narrowed.
const GLOB_CRATE = {
  "Cargo.toml":
    '[package]\nname = "globs"\nversion = "0.1.0"\nedition = "2021"\n',
  "src/lib.rs": [
    "#![allow(dead_code, unused_imports)]",
    "#[cfg(unix)]",
    "mod gu;",
    "#[cfg(unix)]",
    "pub use gu::*;",
    "#[cfg(not(unix))]",
    "mod gw;",
    "#[cfg(not(unix))]",
    "pub use gw::*;",
    "mod user;",
    "// Sixth review A: one name in two namespaces (cortex-m-rt's exception)",
    "pub mod rtm;",
    "// The narrowed guard: a module under cfg with no twin is answered",
    '#[cfg(not(feature = "never"))]',
    "mod gated_ok;",
    "pub fn g2() -> u32 {",
    "    gated_ok::g_fn()",
    "}",
    "pub fn plain_fn() -> u32 {",
    "    3",
    "}",
    "pub fn g3() -> u32 {",
    "    crate::plain_fn()",
    "}",
    "pub fn g1() -> u32 {",
    "    let s = GSys::open();",
    "    g_thing() + s.g_run()",
    "}",
    "",
  ].join("\n"),
  "src/gu.rs":
    "pub fn g_thing() -> u32 {\n    1\n}\n\npub struct GSys;\n\nimpl GSys {\n    pub fn open() -> Self {\n        GSys\n    }\n    pub fn g_run(&self) -> u32 {\n        1\n    }\n}\n",
  "src/gw.rs":
    "pub fn g_thing() -> u32 {\n    2\n}\n\npub struct GSys;\n\nimpl GSys {\n    pub fn open() -> Self {\n        GSys\n    }\n    pub fn g_run(&self) -> u32 {\n        2\n    }\n}\n",
  "src/user.rs":
    "use crate::*;\nuse crate::rtm::exception;\n\npub fn u() -> u32 {\n    let s = crate::GSys::open();\n    exception();\n    crate::g_thing() + s.g_run()\n}\n",
  "src/gated_ok.rs": "pub fn g_fn() -> u32 {\n    1\n}\n",
  "src/rtm.rs":
    "pub enum Exception {\n    A,\n}\n\npub use self::Exception as exception;\n\npub fn exception() {}\n",
};

test(
  "real rust-analyzer, sixth review: glob twins of gated modules (no opaque macro) keep their candidate sets; the route decides none",
  needsAnalyzer,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "globs");
      writeProject(project, GLOB_CRATE);
      const dump = await index(project, root, { environment: process.env });
      if (
        dump.state.state === "unavailable" &&
        /rust-src/.test(dump.state.reason)
      )
        return;
      assert.equal(dump.state.state, "used", JSON.stringify(dump.state));
      const sites = dump.links.filter(
        (l) =>
          ["src/lib.rs", "src/user.rs"].includes(l.file) &&
          /g_thing|GSys|g_run/.test(l.targetName) &&
          l.kind !== "contains",
      );
      assert.ok(sites.length >= 6, `the sites are links: ${sites.length}`);
      const decided = sites
        .filter(
          (l) => l.data?.toolchain && l.data.toolchain.from !== "definite",
        )
        .map((l) => `${l.file} ${l.targetName}: ${l.targetSymbol?.file ?? ""}`);
      assert.deepEqual(decided, []);
      // Design B: a module under any cfg is a selection, twin or not.
      const gatedModule = dump.links.find(
        (l) => l.file === "src/lib.rs" && l.targetName === "gated_ok::g_fn",
      );
      assert.equal(
        gatedModule?.data?.toolchainOutcome,
        "withheld:selected-binding",
        JSON.stringify(gatedModule?.data),
      );
      // The positive control: a path through ungated bindings is decided.
      const control = dump.links.find(
        (l) => l.file === "src/lib.rs" && l.targetName === "crate::plain_fn",
      );
      assert.equal(
        control?.data?.toolchain?.origin,
        "toolchain",
        JSON.stringify(control?.data),
      );
      // A: the import of a name bound in two namespaces is not decided.
      const [imported] = dump.links.filter(
        (l) =>
          l.file === "src/user.rs" &&
          l.kind === "imports" &&
          l.targetName === "crate::rtm::exception",
      );
      assert.ok(imported, "the import is a link");
      assert.ok(
        !imported.data?.toolchain ||
          imported.data.toolchain.from === "definite",
        JSON.stringify(imported.data),
      );
    });
  },
);

test("sixth review D: only a readable index is cached; a bad index is never kept, and a damaged cached pair is run again once", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const dir = join(root, "tools");
    const tools = fakeToolchain(dir, {
      scip,
      metadata: metadata(),
      garbage: true,
    });
    const cached = () =>
      readdirSync(join(root, "toolchain", "rust")).filter((n) =>
        /^scip-[0-9a-f]+\.scip$/.test(n),
      );
    const bad = await index(project, root, { environment: environment(tools) });
    assert.equal(bad.state.state, "unavailable");
    assert.match(bad.state.reason, /index cannot be read/);
    assert.deepEqual(cached(), [], "a bad index is not cached");
    // The next explicit index runs again and recovers.
    fakeToolchain(dir, { scip, metadata: metadata() });
    const good = await index(project, root, {
      environment: environment(tools),
    });
    assert.equal(good.state.state, "used", JSON.stringify(good.state));
    assert.equal(runs(tools), 2);
    assert.equal(cached().length, 1);
    // A cached pair damaged on disk is discarded and run again.
    writeFileSync(join(root, "toolchain", "rust", cached()[0]), "damaged");
    const again = await index(project, root, {
      environment: environment(tools),
    });
    assert.equal(again.state.state, "used", JSON.stringify(again.state));
    assert.equal(note(again.report, "available").cached, false);
    assert.equal(runs(tools), 3);
  });
});

test("sixth review E: a path dependency outside the checkout is in the key; restoring it re-runs on the next query without touching the checkout", async () => {
  await scratch(async (root) => {
    const outside = join(root, "outside-dep");
    const { steps } = await failingRoute(
      root,
      {},
      {
        setup: (project) =>
          writeFileSync(
            join(project, "Cargo.toml"),
            GATES["Cargo.toml"] +
              `\n[dependencies]\ndep = { path = ${JSON.stringify(outside)} }\n`,
          ),
        edit: () => {
          mkdirSync(join(outside, "src"), { recursive: true });
          writeFileSync(
            join(outside, "Cargo.toml"),
            '[package]\nname = "dep"\nversion = "0.1.0"\nedition = "2021"\n',
          );
          writeFileSync(join(outside, "src", "lib.rs"), "pub fn d() {}\n");
        },
      },
    );
    assert.deepEqual(steps, [
      ["index", "used", 1],
      ["unchanged", "used", 1],
      ["unchanged", "used", 1],
      ["unchanged", "used", 1],
      ["updated", "used", 2],
    ]);
  });
});

test(
  "real rust-analyzer, sixth review G: every link the route did not decide stores its route-off data exactly, apart from its outcome",
  needsAnalyzer,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "cfgs");
      writeProject(project, CFG_CRATE);
      const on = await index(project, root, { environment: process.env });
      if (on.state.state === "unavailable" && /rust-src/.test(on.state.reason))
        return;
      assert.equal(on.state.state, "used", JSON.stringify(on.state));
      const off = await index(project, root, {
        environment: process.env,
        toolchains: null,
      });
      const offData = new Map(off.links.map((l) => [l.id, l.data]));
      const withOutcome = on.links.filter((l) => l.data?.toolchainOutcome);
      assert.ok(withOutcome.length >= 5, String(withOutcome.length));
      const differs = [];
      for (const l of withOutcome) {
        const { toolchainOutcome: _outcome, ...data } = l.data;
        if (JSON.stringify(data) !== JSON.stringify(offData.get(l.id)))
          differs.push(`${l.targetName}: ${JSON.stringify(data)}`);
      }
      assert.deepEqual(differs, []);
    });
  },
);

// Design B's oracle: crates from the review rounds' selection shapes, the
// route run with and without default features. No link decided in both may
// name two different targets; the control is decided in both (not vacuous).
for (const seed of [4301, 4302])
  test(
    `real rust-analyzer, design B oracle (seed ${seed}): no link decided under one setting names a different target under the other`,
    needsAnalyzer,
    async () => {
      await scratch(async (root) => {
        const project = join(root, "oracle");
        const { files, ingredients } = generateOracle(seed, 5);
        writeProject(project, files);
        const a = await index(project, root, {
          environment: process.env,
          store: "a.sqlite",
          toolchainDirectory: "tc-a",
        });
        if (a.state.state === "unavailable" && /rust-src/.test(a.state.reason))
          return;
        setRunControls({ noDefaultFeatures: true });
        let b;
        try {
          b = await index(project, root, {
            environment: process.env,
            store: "b.sqlite",
            toolchainDirectory: "tc-b",
          });
        } finally {
          setRunControls({});
        }
        assert.equal(a.state.state, "used", JSON.stringify(a.state));
        assert.equal(b.state.state, "used", JSON.stringify(b.state));
        const decided = (dump) =>
          new Map(
            dump.links
              .filter((l) => l.data?.toolchain?.target)
              .map((l) => [l.id, [l.targetName, l.data.toolchain.target]]),
          );
        const da = decided(a);
        const db = decided(b);
        const conflicts = [...da]
          .filter(([id, pair]) => db.has(id) && db.get(id)[1] !== pair[1])
          .map(([, pair]) => pair[0]);
        assert.deepEqual(conflicts, [], ingredients.join(", "));
        const control = (dump) =>
          dump.links.find((l) => l.targetName === "crate::p0_free")?.data
            ?.toolchain?.origin;
        assert.equal(
          control(a),
          "toolchain",
          "the control is decided (default)",
        );
        assert.equal(
          control(b),
          "toolchain",
          "the control is decided (no default)",
        );
      });
    },
  );
