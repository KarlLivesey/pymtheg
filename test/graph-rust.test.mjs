import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readdir,
  readFile,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  checkLanguageConformance,
  indexProject,
  LanguageRegistry,
  SqliteGraphStore,
} from "../dist/graph/index.js";
import rust from "../dist/graph/languages/rust/index.js";

const fixtureRoot = new URL("./fixtures/graph-rust/", import.meta.url);
async function fixtures(dir = fixtureRoot, prefix = "") {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory())
      result.push(
        ...(await fixtures(new URL(entry.name + "/", dir), path + "/")),
      );
    else if (entry.name === "Cargo.toml" || path.endsWith(".rs"))
      result.push({
        path,
        text: await readFile(new URL(entry.name, dir), "utf8"),
        ...(entry.name === "Cargo.toml"
          ? { context: true }
          : path.endsWith("broken.rs")
            ? { status: "partial" }
            : {}),
      });
  }
  return result;
}
async function project(inputs, run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-rust-test-"));
  const store = new SqliteGraphStore(":memory:", "rust-tests");
  try {
    for (const { path, text } of inputs) {
      await mkdir(dirname(join(scratch, path)), { recursive: true });
      await writeFile(join(scratch, path), text);
    }
    const report = await indexProject(
      scratch,
      new LanguageRegistry([rust]),
      store,
    );
    assert.deepEqual(
      [...report.errors, ...report.analysisErrors, ...report.resolutionErrors],
      [],
    );
    await run(store, report, scratch);
  } finally {
    store.close();
    await rm(scratch, { recursive: true, force: true });
  }
}
const manifest = {
  path: "Cargo.toml",
  text: '[package]\nname = "example"\nversion = "0.1.0"\n',
};
const lib = (text) => ({ path: "src/lib.rs", text });
const selector = (store, link) =>
  store.findSymbols().find((s) => s.id === link.targetId);
const calls = (store, name) =>
  store.links().filter((l) => l.kind === "calls" && l.targetName === name);
function resolved(store, name, identity, file) {
  const values = calls(store, name);
  assert.ok(values.length, name);
  for (const l of values) {
    assert.equal(l.resolution, "resolved", name);
    assert.equal(selector(store, l).identity, identity);
    if (file) assert.equal(selector(store, l).file, file);
  }
}
function unresolved(store, name, kind = "calls") {
  const values = store
    .links()
    .filter((l) => l.kind === kind && l.targetName === name);
  assert.ok(values.length, name);
  for (const l of values) assert.equal(l.resolution, "unresolved", name);
}

test("Rust sample workspace passes exact-position conformance including Unicode, partial and candidate facts", async () => {
  const expected = JSON.parse(
    await readFile(
      new URL("./fixtures/graph-rust/expected.json", import.meta.url),
      "utf8",
    ),
  );
  await checkLanguageConformance(rust, await fixtures(), expected);
});

test("Rust sample: module layouts, private sibling calls, imports, distinct impls and workspace binaries", async () => {
  await project(await fixtures(), async (store, report, root) => {
    assert.deepEqual(report.partial, ["app/src/broken.rs"]);
    const crate = store
      .findSymbols({ file: "app/src/lib.rs" })
      .find((s) => s.key === "file");
    assert.equal(crate.data.unitKind, "crate");
    assert.equal(crate.data.crateName, "sample_app");
    assert.equal(
      store
        .findSymbols({ file: "app/src/driver.rs" })
        .find((s) => s.key === "file").data.targetKind,
      "bin",
    );
    assert.equal(
      store
        .findSymbols({ file: "app/src/tree/mod.rs" })
        .find((s) => s.key === "file").data.unitKind,
      "module",
    );
    resolved(store, "super::flat::private", "private", "app/src/flat.rs");
    resolved(store, "self::leaf::leaf", "leaf", "app/src/tree/leaf.rs");
    resolved(store, "renamed::special", "special", "app/src/other.rs");
    resolved(store, "inline::inside", "inline::inside");
    resolved(store, "Alias::new", "impl Thing::new");
    resolved(store, "A::new", "impl A::new");
    resolved(store, "B::new", "impl B::new");
    resolved(store, "sample_app::A::new", "impl A::new", "app/src/lib.rs");
    resolved(store, "a.own", "impl A::own");
    resolved(store, "foreign", "outside", "helper/src/lib.rs");
    resolved(store, "globbed", "globbed");
    unresolved(store, "unknown.speak");
    unresolved(store, "std::mem::drop");
    assert.equal(
      calls(store, "private").filter((l) => l.resolution === "resolved").length,
      1,
    );
    assert.equal(
      calls(store, "private").filter((l) => l.resolution === "unresolved")
        .length,
      1,
    );
    assert.equal(
      store.findSymbols({ name: "private" })[0].data.visibility,
      "private",
    );
    assert.deepEqual(
      store
        .findSymbols({ name: "speak" })
        .map((s) => s.identity)
        .sort(),
      ["Speak::speak", "impl Speak for A::speak", "impl Speak for B::speak"],
    );
    assert.equal(
      store
        .links()
        .filter((l) => l.kind === "implements" && l.resolution === "resolved")
        .length,
      2,
    );
    assert.equal(
      store
        .links()
        .find((l) => l.kind === "macros" && l.targetName === "local_macro")
        .resolution,
      "resolved",
    );
    unresolved(store, "external_macro", "macros");
    unresolved(store, "later", "macros");
    const collision = calls(store, "collision")[0];
    assert.equal(collision.resolution, "ambiguous");
    assert.deepEqual(
      collision.candidates
        .map((c) => store.findSymbols().find((s) => s.id === c.id).identity)
        .sort(),
      ["left::collision", "right::collision"],
    );
    // No cargo/rustc is available to the parser even in this controlled PATH.
    const before = new Map(
      store
        .findSymbols()
        .map((s) => [s.file + ":" + s.identity + ":" + s.ordinal, s.id]),
    );
    const file = join(root, "app/src/lib.rs");
    await writeFile(
      file,
      "// inserted 😀 comment\n" + (await readFile(file, "utf8")),
    );
    const oldPath = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent";
      await indexProject(root, new LanguageRegistry([rust]), store);
    } finally {
      process.env.PATH = oldPath;
    }
    for (const s of store.findSymbols())
      assert.equal(
        s.id,
        before.get(s.file + ":" + s.identity + ":" + s.ordinal),
      );
  });
});

test("Rust resolution negative controls: no parent-module leakage, type guessing, generic capture or local shadow guessing", async () => {
  await project(
    [
      manifest,
      lib(`
struct T; impl T { fn f(&self) {} fn new() -> Self { T } }
fn imported() {} fn root_only() {}
mod child { fn caller() { root_only(); super::root_only(); } }
fn generic<T>(x: T) { T::new(); x.f(); }
fn caller(x: T, imported: fn()) {
 imported(); x.f(); let y = T::new(); y.f();
 { let x = 1; x.f(); } x.f();
 for imported in [1] { imported(); }
 if let Some(imported) = None::<fn()> { imported(); }
}
fn block_import() { { use crate::root_only as scoped; scoped(); } scoped(); }
fn unknown() { missing::T::new(); std::f(); }
`),
    ],
    async (store) => {
      unresolved(store, "root_only");
      resolved(store, "super::root_only", "root_only");
      assert.equal(
        calls(store, "T::new").filter((l) => l.resolution === "unresolved")
          .length,
        1,
      );
      assert.equal(
        calls(store, "T::new").filter((l) => l.resolution === "resolved")
          .length,
        1,
      );
      unresolved(store, "imported");
      unresolved(store, "y.f");
      unresolved(store, "missing::T::new");
      unresolved(store, "std::f");
      assert.equal(
        calls(store, "x.f").filter((l) => l.resolution === "resolved").length,
        2,
      );
      assert.equal(
        calls(store, "x.f").filter((l) => l.resolution === "unresolved").length,
        2,
      );
      assert.deepEqual(
        calls(store, "scoped")
          .map((l) => l.resolution)
          .sort(),
        ["resolved", "unresolved"],
      );
    },
  );
});

test("Rust globs and duplicate layouts remain candidates; an opaque glob with one known target remains unresolved", async () => {
  await project(
    [
      manifest,
      lib(`mod a { pub fn f() {} } mod b { pub fn f() {} }
mod both; use crate::a::*; use crate::b::*; fn run() { f(); both::g(); }
mod uncertain { use crate::a::*; use external::*; fn run() { f(); } }
`),
      { path: "src/both.rs", text: "pub fn g() {}" },
      { path: "src/both/mod.rs", text: "pub fn g() {}" },
    ],
    async (store) => {
      assert.deepEqual(
        calls(store, "f")
          .map((l) => l.resolution)
          .sort(),
        ["ambiguous", "unresolved"],
      );
      assert.equal(calls(store, "both::g")[0].resolution, "ambiguous");
    },
  );
});

test("Rust Cargo context changes re-resolve cached sources and workspace dependency aliases", async () => {
  const inputs = [
    {
      path: "Cargo.toml",
      text: '[workspace]\nmembers = ["app", "dep-*"]\n[workspace.dependencies]\nrenamed = { package = "dep-real", path = "dep-real" }\n',
    },
    {
      path: "app/Cargo.toml",
      text: '[package]\nname = "app"\n[dependencies]\nrenamed.workspace = true\n',
    },
    { path: "dep-real/Cargo.toml", text: '[package]\nname = "dep-real"\n' },
    { path: "dep-real/src/lib.rs", text: "pub fn f() {}" },
    {
      path: "app/src/lib.rs",
      text: "fn run() { renamed::f(); dep_real::f(); }",
    },
  ];
  await project(inputs, async (store, report, root) => {
    resolved(store, "renamed::f", "f", "dep-real/src/lib.rs");
    unresolved(store, "dep_real::f");
    await writeFile(
      join(root, "app/Cargo.toml"),
      '[package]\nname = "app"\n[dependencies]\nrenamed = "1"\n',
    );
    const repeat = await indexProject(
      root,
      new LanguageRegistry([rust]),
      store,
    );
    assert.equal(repeat.indexed, 0);
    unresolved(store, "renamed::f");
  });
});
