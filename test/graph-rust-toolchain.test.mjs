// SPDX-License-Identifier: MIT
// C-43: the opt-in Rust toolchain route (rust-analyzer SCIP). Most tests use
// a controlled fake rust-analyzer, cargo and rustc that emit fixed answers;
// the last ones run the real rust-analyzer when it is installed with
// rust-src. No test asserts a time; the hang is ended by the index's
// signal or a controlled clock after a readiness handshake.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  LanguageRegistry,
  SqliteGraphStore,
  indexProject,
} from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";
import { readScip, parseSymbol } from "../dist/graph/languages/rust/scip.js";
import { nameSite } from "../dist/graph/languages/rust/toolchain-join.js";
import { setRunControls } from "../dist/graph/languages/rust/toolchain-route.js";
import { toolchainState } from "../dist/graph/command-toolchain.js";
import { executeGraph } from "../dist/graph/commands.js";
import { graphConfig, graphToolchains } from "../dist/shared/config.js";
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
    cargo: `if (a[0] === "metadata") {
  if (!b.metadata) { console.error("error: failed to get \`dep\` as a dependency (offline)"); process.exit(101); }
  console.log(JSON.stringify(b.metadata).replaceAll("@ROOT@", process.cwd()));
  process.exit(0);
}
process.exit(2);`,
    "rust-analyzer": `if (a[0] === "--version") { console.log("rust-analyzer 1.98.1 (fake 2026-09-01)"); process.exit(0); }
if (a[0] === "scip") {
  fs.appendFileSync(b.runs, "run\\n");
  fs.writeFileSync(b.seen, JSON.stringify({ cwd: process.cwd(), env: process.env, config: JSON.parse(fs.readFileSync(a[a.indexOf("--config-path") + 1], "utf8")),
    files: fs.readdirSync(process.cwd(), { recursive: true }).map(String).sort(), lib: fs.existsSync("src/lib.rs") ? fs.readFileSync("src/lib.rs", "utf8") : null }));
  if (b.hang) { fs.writeFileSync(b.ready, String(process.pid)); setInterval(() => {}, 1000); return; }
  for (const o of b.buildOutputs ?? []) {
    const d = path.join(process.env.CARGO_TARGET_DIR, "debug", "build", o.dir);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "invoked.timestamp"), "");
    if (o.output) fs.writeFileSync(path.join(d, "output"), "");
  }
  for (const [dir, file] of b.fingerprints ?? []) {
    const d = path.join(process.env.CARGO_TARGET_DIR, "debug", ".fingerprint", dir);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, file), "");
  }
  for (const file of b.deps ?? []) {
    const d = path.join(process.env.CARGO_TARGET_DIR, "debug", "deps");
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
      targets: [
        { kind: ["lib"], name: "gates", src_path: "@ROOT@/src/lib.rs" },
        ...(extra.targets ?? []),
      ],
    },
    ...(extra.packages ?? []),
  ],
  workspace_members: ["gates 0.1.0"],
  resolve: { nodes: [{ id: "gates 0.1.0" }, ...(extra.nodes ?? [])] },
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
    join(work, `graph-${Math.random().toString(36).slice(2)}.sqlite`),
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

test("settings: trusted runs the Rust route, an explicit setting wins either way, and a relative path is refused", () => {
  const config = (graph) => ({
    version: 1,
    scenarios: {},
    graph: graphConfig(graph),
  });
  assert.deepEqual(graphToolchains(config({ trust: "trusted" })), {
    go: true,
    rust: true,
  });
  assert.deepEqual(
    graphToolchains(config({ trust: "trusted", toolchain: { rust: false } })),
    { go: true },
  );
  assert.deepEqual(
    graphToolchains(
      config({
        trust: "source-only",
        toolchain: { rust: "/opt/ra/rust-analyzer" },
      }),
    ),
    { rust: "/opt/ra/rust-analyzer" },
  );
  assert.deepEqual(graphToolchains(config({ toolchain: { rust: true } })), {
    rust: true,
  });
  assert.deepEqual(graphToolchains(config({ trust: "source-only" })), {});
  assert.throws(
    () => graphConfig({ toolchain: { rust: "rust-analyzer" } }),
    /graph.toolchain.rust must be true, false or an absolute path to rust-analyzer/,
  );
});

// ---------------------------------------------------------------- reading SCIP

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
  assert.equal(decided["withheld:cfg-variant"], 1);
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
    "a library item (counted, never applied)",
    ["rust-analyzer cargo std 1.98.1 vec/impl#[Vec]go()."],
    {},
    {},
    "unapplied:library",
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
        }),
        // Compiled (its compiler messages are recorded) but no library.
        fingerprints: [["pm-0123456789abcdef", "output-lib-pm"]],
      },
      /^proc macro pm was not built$/,
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
    });
  }
});

test("not partial: packages cargo metadata lists but the run never builds, a finished build script, a built proc macro", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    writeProject(project, GATES);
    const scip = join(root, "answer.scip");
    writeFileSync(scip, gateScip());
    const pm = { id: "pm 0.1.0", name: "pm", targets: [{ kind: ["proc-macro"], name: "pm", src_path: "/x/src/lib.rs" }] };
    const unused = { id: "opt 0.1.0", name: "opt", targets: [{ kind: ["lib"], name: "opt", src_path: "/y/src/lib.rs" }, { kind: ["custom-build"], name: "build-script-build", src_path: "/y/build.rs" }] };
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata({ packages: [pm, unused], nodes: [{ id: "pm 0.1.0" }, { id: "opt 0.1.0" }] }),
      buildOutputs: [{ dir: "gates-0123456789abcdef", output: false }, { dir: "gates-fedcba9876543210", output: true }],
      fingerprints: [["pm-0123456789abcdef", "lib-pm"]],
      deps: ["libpm-0123456789abcdef.so"],
    });
    const dump = await index(project, root, { environment: environment(tools) });
    assert.equal(dump.state.state, "used", JSON.stringify(dump.state));
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
    const tools = fakeToolchain(join(root, "tools"), {
      scip,
      metadata: metadata(),
      hang: true,
    });
    const controller = new AbortController();
    const indexing = index(project, root, {
      environment: environment(tools),
      signal: controller.signal,
    });
    // Readiness handshake: the fake writes its pid once it is running.
    for (let i = 0; !existsSync(tools.ready); i++) {
      assert.ok(i < 100000, "the fake rust-analyzer did not start");
      await new Promise((resolve) => setImmediate(resolve));
    }
    const pid = Number(readFileSync(tools.ready, "utf8"));
    controller.abort();
    const dump = await indexing;
    assert.deepEqual(
      dump.report.analysisErrors.map((e) => e.message),
      ["Indexing was cancelled"],
    );
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
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
      for (let i = 0; !existsSync(tools.ready); i++) {
        assert.ok(i < 100000, "the fake rust-analyzer did not start");
        await new Promise((resolve) => setImmediate(resolve));
      }
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
    writeProject(project, {
      ...GATES,
      ".pymtheg/settings.json": JSON.stringify({
        version: 1,
        scenarios: {},
        graph: { toolchain: { rust: join(root, "none", "rust-analyzer") } },
      }),
    });
    const response = await executeGraph({ command: "index", root: project });
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
      assert.equal(named("app/src/lib.rs", "a.radius"), "impl Circle::radius");
      assert.equal(
        named("app/src/lib.rs", "c.diameter"),
        "impl Circle::diameter",
      );
      assert.equal(named("app/src/lib.rs", "square.side"), "impl Square::side");
      assert.equal(named("app/src/lib.rs", "macros::Hello"), "derive_hello");
      // Dispatch on a trait object stays open: the toolchain names the declaration.
      const dispatch = dump.links.find(
        (l) => l.file === "app/src/lib.rs" && l.targetName === "s.area",
      );
      assert.notEqual(dispatch.resolution, "resolved");
      // A link to code a build-script cfg turns on is withheld.
      assert.ok(
        (note(dump.report, "merged").decided["withheld:cfg-variant"] ?? 0) >= 1,
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
