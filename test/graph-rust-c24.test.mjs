// SPDX-License-Identifier: MIT
// C-24: an inherent impl belongs to its type's own crate, and the Rust graph
// is a function of the snapshot only (not of the order its inputs arrive in).
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  contentHash,
  fileFacts,
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
  validateResult,
} from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";

const crate = (name, deps = "") =>
  `[package]\nname="${name}"\nedition="2021"\nversion="0.1.0"\n${deps}`;

async function index(files) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-c24-"));
  const store = new SqliteGraphStore(":memory:", "c24");
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(scratch, path)), { recursive: true });
      await writeFile(join(scratch, path), text);
    }
    await indexProject(scratch, new LanguageRegistry([rust]), store);
    const symbols = new Map(store.findSymbols().map((s) => [s.id, s]));
    return { links: store.links(), symbols };
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

/** The one call `name` on the line holding `marker`, as a plain answer. */
function call(g, file, name, marker) {
  const ls = g.links.filter(
    (l) =>
      l.file === file &&
      l.kind === "calls" &&
      l.targetName === name &&
      lineOf(g, l) === marker,
  );
  assert.equal(ls.length, 1, `${file} ${name} ${marker}`);
  const l = ls[0];
  const where = (id) => {
    const s = g.symbols.get(id);
    return `${s.file}#${s.identity}`;
  };
  return {
    resolution: l.resolution,
    target: l.targetId ? where(l.targetId) : null,
    // Possible targets of a withheld link, kept as hints.
    possible: (l.data.targets ?? []).map(where).sort(),
  };
}
const sources = new Map();
const lineOf = (g, l) => {
  const text = sources.get(l.file);
  const start = text.lastIndexOf("\n", l.range.start) + 1;
  const end = text.indexOf("\n", l.range.start);
  return text
    .slice(start, end === -1 ? undefined : end)
    .match(/\/\/ (.*)$/)?.[1];
};

// Crate `b` holds an impl whose self type an opaque attribute macro makes
// (dioxus `packages/interpreter/src/unified_bindings.rs`: `impl Interpreter`
// beside `#[sledgehammer_bindgen::bindgen(module)] mod js`). Rust rejects an
// inherent impl outside its type's crate (E0116), so it cannot add `base` to
// crate `a`'s `Cursor`. A trait impl there is legal and stays a candidate.
const workspace = {
  "Cargo.toml": '[workspace]\nmembers = ["a", "b"]\nresolver = "2"\n',
  "b/Cargo.toml": crate("b", '[dependencies]\ngen = "1"\n'),
  "b/src/lib.rs": [
    "#[gen::bindgen(module)]",
    "mod js {}",
    "pub use js::*;",
    "impl Interpreter {",
    "    pub fn base(&self) -> u8 { 1 }",
    "}",
    "pub trait Ext { fn walk(&self) -> u8; }",
    "impl Ext for Interpreter {",
    "    fn walk(&self) -> u8 { 2 }",
    "}",
  ].join("\n"),
  "a/Cargo.toml": crate("a", '[dependencies]\nb = { path = "../b" }\n'),
  "a/src/lib.rs": [
    "use b::Ext;",
    "pub struct Cursor;",
    "impl Cursor {",
    "    pub fn base(&self) -> u8 { 0 }",
    "}",
    "pub struct Plain;",
    "pub fn f(c: &Cursor, p: &Plain) -> u8 {",
    "    c.base() // inherent in own crate",
    "        + p.walk() // trait impl elsewhere",
    "}",
  ].join("\n"),
};

test("an unplaced inherent impl in another crate cannot add a method to a checkout type", async () => {
  for (const [path, text] of Object.entries(workspace)) sources.set(path, text);
  const g = await index(workspace);
  assert.deepEqual(call(g, "a/src/lib.rs", "c.base", "inherent in own crate"), {
    resolution: "resolved",
    target: "a/src/lib.rs#impl Cursor::base",
    possible: [],
  });
  // The other crate's trait impl may be for `Plain`: it stays possible.
  assert.deepEqual(call(g, "a/src/lib.rs", "p.walk", "trait impl elsewhere"), {
    resolution: "unresolved",
    target: null,
    possible: ["b/src/lib.rs#impl Ext for Interpreter::walk"],
  });
});

test("the same unplaced inherent impl in the type's own crate keeps the call open", async () => {
  const files = {
    "Cargo.toml": crate("a", '[dependencies]\ngen = "1"\n'),
    "src/lib.rs": [
      "#[gen::bindgen(module)]",
      "mod js {}",
      "pub use js::*;",
      "impl Interpreter {",
      "    pub fn base(&self) -> u8 { 1 }",
      "}",
      "pub struct Cursor;",
      "impl Cursor {",
      "    pub fn base(&self) -> u8 { 0 }",
      "}",
      "pub fn f(c: &Cursor) -> u8 {",
      "    c.base() // macro may name Cursor",
      "}",
    ].join("\n"),
  };
  for (const [path, text] of Object.entries(files)) sources.set(path, text);
  const g = await index(files);
  const base = call(g, "src/lib.rs", "c.base", "macro may name Cursor");
  assert.equal(base.resolution, "unresolved");
  assert.equal(base.target, null);
});

// A seeded order: the same seed always gives the same permutation.
function shuffled(list, seed) {
  let state = seed >>> 0 || 1;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 2 ** 32;
  };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The Rust phases on a fixture, with every input list (files, Cargo files,
 * symbols, links) presented in the order a seed picks and a project id that
 * changes every store id (stores list rows by id). Answers are keyed by file,
 * kind, name and position, never by id.
 */
async function answersInOrder(fixture, seed) {
  const directory = new URL(
    `fixtures/graph-rust-c24/${fixture}/`,
    import.meta.url,
  );
  const paths = ["Cargo.toml", ...fixtureSources[fixture]];
  const texts = Object.fromEntries(
    await Promise.all(
      paths.map(async (p) => [
        p,
        await readFile(new URL(p, directory), "utf8"),
      ]),
    ),
  );
  const projectId = `order-${seed}`;
  const files = [];
  for (const path of shuffled(paths.slice(1), seed)) {
    const result = await rust.parse({ path, text: texts[path] });
    validateResult(texts[path], result);
    files.push({
      path,
      text: texts[path],
      result,
      module: "rust",
      version: rust.version,
      hash: contentHash(texts[path]),
    });
  }
  const contextFiles = [
    {
      path: "Cargo.toml",
      text: texts["Cargo.toml"],
      status: "clean",
      hash: contentHash(texts["Cargo.toml"]),
      diagnostics: [],
    },
  ];
  const ctx = { projectId, files, contextFiles };
  const analyzed = new Map((await rust.analyze(ctx)).map((f) => [f.path, f]));
  const facts = files.map((file) => {
    file.result = analyzed.get(file.path).result;
    return fileFacts(projectId, file);
  });
  const links = facts.flatMap((f) => f.links);
  const symbols = facts.flatMap((f) => f.symbols);
  const output = await rust.resolve({
    ...ctx,
    files: shuffled(files, seed + 1),
    links: shuffled(links, seed + 2),
    symbols: shuffled(symbols, seed + 3),
  });
  const decisions = new Map(
    (Array.isArray(output) ? output : output.resolutions).map((d) => [
      d.linkId,
      d,
    ]),
  );
  const where = new Map(symbols.map((s) => [s.id, `${s.file}#${s.identity}`]));
  return Object.fromEntries(
    links
      .map((l) => {
        const d = decisions.get(l.id);
        return [
          `${l.file} ${l.kind} ${l.targetName} @${l.range.start}`,
          {
            target: d?.targetId ? where.get(d.targetId) : null,
            candidates: (d?.candidateIds ?? [])
              .map((id) => where.get(id))
              .sort(),
            library: d?.library
              ? `${d.library.unit}::${d.library.symbol}`
              : null,
            reason: l.data.uncertainty ?? null,
          },
        ];
      })
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
const fixtureSources = {
  "cfg-siblings": [
    "src/lib.rs",
    "src/ppi/mod.rs",
    "src/ppi/ppi.rs",
    "src/ppi/dppi.rs",
  ],
  "glob-retry": [
    "src/main.rs",
    "src/serve/mod.rs",
    "src/serve/runner.rs",
    "src/serve/server.rs",
  ],
};

test("a lookup through a glob cycle has one answer whatever ran before it", async () => {
  // The macro-scope retry looks `AppServer` up again beside `tracing::warn!`.
  // On main its answer depended on whether another lookup had already met
  // the `serve` glob cycle from the outside.
  const first = await answersInOrder("glob-retry", 1);
  for (const seed of [2, 3, 5, 8, 13, 21, 34, 55, 89, 144])
    assert.deepEqual(
      await answersInOrder("glob-retry", seed),
      first,
      `seed ${seed}`,
    );
  const struct = "src/serve/runner.rs#AppServer";
  assert.equal(
    first["src/serve/server.rs types AppServer @177"].target,
    struct,
  );
  // Inside `impl WebServer` it may stay open, but never names anything else.
  assert.ok(
    [null, struct].includes(
      first["src/serve/server.rs types AppServer @72"].target,
    ),
  );
});

test("cfg-alternative sibling files get one symmetric answer whatever the input order", async () => {
  const first = await answersInOrder("cfg-siblings", 1);
  for (const seed of [2, 3, 5, 8, 13, 21, 34, 55, 89, 144])
    assert.deepEqual(
      await answersInOrder("cfg-siblings", seed),
      first,
      `seed ${seed}`,
    );
  // Neither sibling is "the" file for `_version`: each import from the
  // parent gets the same answer in both, never definite in one only.
  for (const name of ["ChannelNumber", "Event", "Task"]) {
    const imports = Object.entries(first).filter(([k]) =>
      k.endsWith(
        `imports super::${name} @${name === "ChannelNumber" ? 12 : name === "Event" ? 27 : 34}`,
      ),
    );
    assert.equal(imports.length, 2, name);
    assert.deepEqual(imports[0][1], imports[1][1], name);
    assert.deepEqual(imports[0][1], {
      target: null,
      candidates: [],
      library: null,
      reason: "conditional module path lacks captured alternatives",
    });
  }
  // Uses of the parent's types inside either file are definite.
  for (const file of ["src/ppi/ppi.rs", "src/ppi/dppi.rs"])
    assert.equal(
      first[`${file} types Event @77`].target,
      "src/ppi/mod.rs#Event",
    );
});
