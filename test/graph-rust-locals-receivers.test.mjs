// SPDX-License-Identifier: MIT
// C-10: references to local bindings and generic parameters, and method calls
// on locals, constructors, fields and chains of checkout types. The fixtures
// under fixtures/rust-c10 pass `cargo check --all-targets` with and without
// their features; each negative case is one where rustc selects a different
// method, or the source does not prove one target.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileFacts, contentHash, validateResult } from "../dist/graph/index.js";
const rust = (
  await import(
    process.env.RUST_TEST_MODULE ?? "../dist/graph/languages/rust/index.js"
  )
).default;

const root = new URL("./fixtures/rust-c10/", import.meta.url);
async function sources(name) {
  const base = new URL(name + "/", root);
  const result = {};
  async function walk(dir) {
    for (const entry of await readdir(new URL(dir, base), {
      withFileTypes: true,
    })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path + "/");
      else if (entry.name.endsWith(".rs"))
        result[path] = await readFile(new URL(path, base), "utf8");
    }
  }
  await walk("");
  return {
    files: result,
    manifest: await readFile(new URL("Cargo.toml", base), "utf8"),
  };
}

async function graph(name) {
  const { files: texts, manifest } = await sources(name);
  const files = [];
  for (const [path, text] of Object.entries(texts)) {
    const result = await rust.parse({ path, text });
    validateResult(text, result);
    files.push({
      path,
      text,
      result,
      hash: contentHash(text),
      module: "rust",
      version: rust.version,
    });
  }
  const contextFiles = [
    {
      path: "Cargo.toml",
      text: manifest,
      hash: contentHash(manifest),
      status: "clean",
      diagnostics: [],
    },
  ];
  for (const a of await rust.analyze({
    projectId: "c10",
    files,
    contextFiles,
    changedFiles: files.map((f) => f.path),
    changedContextFiles: [],
  }))
    files.find((f) => f.path === a.path).result = a.result;
  const facts = files.map((f) => fileFacts("c10", f));
  const symbols = facts.flatMap((f) => f.symbols);
  const links = facts.flatMap((f) => f.links);
  const resolved = await rust.resolve({
    projectId: "c10",
    files,
    contextFiles,
    symbols,
    links,
  });
  const decisions = Array.isArray(resolved) ? resolved : resolved.resolutions;
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const byLink = new Map(decisions.map((d) => [d.linkId, d]));
  const text = (file) => texts[file];
  /** The link of `kind` named `name` starting at the nth occurrence of `at`. */
  function at(file, kind, name, marker, nth = 0) {
    let start = -1;
    for (let i = 0; i <= nth; i++)
      start = text(file).indexOf(marker, start + 1);
    assert.ok(start >= 0, marker);
    const offset = start + marker.indexOf(name);
    const link = links.find(
      (l) =>
        l.file === file &&
        l.kind === kind &&
        l.range.start === offset &&
        l.targetName === name,
    );
    assert.ok(link, `${kind} ${name} at ${marker}`);
    return link;
  }
  /** The method call link for `.method(` at the nth occurrence of `marker`. */
  function call(file, marker, method, nth = 0) {
    let start = -1;
    for (let i = 0; i <= nth; i++)
      start = text(file).indexOf(marker, start + 1);
    assert.ok(start >= 0, marker);
    const end = start + marker.length;
    const link = links.find(
      (l) =>
        l.file === file &&
        l.kind === "calls" &&
        l.data?.method === method &&
        l.range.end <= end &&
        l.range.end >= start &&
        text(file).slice(l.range.start, l.range.end).endsWith(method),
    );
    assert.ok(link, `call .${method} in ${marker}`);
    return link;
  }
  function target(link) {
    const d = byLink.get(link.id);
    return d?.targetId ? byId.get(d.targetId) : undefined;
  }
  return { at, call, target, text, links, symbols };
}

const span = (source, marker, name, nth = 0) => {
  let start = -1;
  for (let i = 0; i <= nth; i++) start = source.indexOf(marker, start + 1);
  const offset = start + marker.indexOf(name);
  return { name, start: offset, end: offset + name.length };
};

test("references to locals and parameters target the enclosing function", async () => {
  const g = await graph("locals");
  const file = "src/lib.rs";
  const source = g.text(file);
  const local = (kind, name, marker, binding, nth = 0) => {
    const link = g.at(file, kind, name, marker, nth);
    const t = g.target(link);
    assert.ok(t, `${name} at ${marker} is definite`);
    return { link, target: t, binding };
  };
  for (const { link, target, binding } of [
    local("values", "input", "input + 1", span(source, "input: u32", "input")),
    local(
      "values",
      "total",
      "helper(total)",
      span(source, "total = input", "total"),
    ),
    local(
      "values",
      "total",
      "v > total",
      span(source, "total = helper", "total"),
    ),
    local("values", "v", "v > total", span(source, "v: u32", "v")),
    local("calls", "check", "check(total)", span(source, "check =", "check")),
    local(
      "values",
      "total",
      "check(total)",
      span(source, "total = helper", "total"),
    ),
    local("values", "found", "=> found", span(source, "Some(found)", "found")),
    local(
      "values",
      "input",
      "None => input",
      span(source, "input: u32", "input"),
    ),
  ]) {
    assert.equal(target.name, "locals");
    assert.equal(target.kind, "function");
    assert.deepEqual(link.data.localBinding, binding);
  }
  const me = g.at(file, "values", "self", "        self\n");
  assert.equal(g.target(me).name, "me");
  assert.deepEqual(me.data.localBinding, span(source, "fn me(&self)", "self"));
  // A statement macro whose expansion is proved empty keeps the binding.
  const kept = g.at(file, "values", "kept", "    kept\n");
  assert.equal(g.target(kept).name, "after_macro");
  assert.deepEqual(kept.data.localBinding, span(source, "let kept", "kept"));
  // A binding written by a macro and a binding chosen by cfg are not proved.
  for (const [name, marker] of [
    ["made", "    made\n"],
    ["chosen", "    chosen\n"],
  ]) {
    const link = g.at(file, "values", name, marker);
    assert.equal(g.target(link), undefined, name);
    assert.equal(link.data.localBinding, undefined, name);
  }
  // A constant or unit variant in a pattern is not a binding.
  for (const [name, marker] of [
    ["LIMIT", "=> LIMIT"],
    ["None", "=> None"],
  ]) {
    const link = g.at(file, "values", name, marker);
    assert.notEqual(g.target(link)?.name, "path_patterns", name);
  }
  const x = g.at(file, "values", "x", "x + limited");
  assert.equal(g.target(x).name, "path_patterns");
  // Locals add no symbols.
  for (const name of ["total", "check", "found", "made", "kept", "value"])
    assert.ok(!g.symbols.some((s) => s.name === name), name);
});

test("a statement macro from a dependency leaves later locals unproved", async () => {
  // Not a cargo fixture: the macro's crate is not part of the checkout.
  const text = [
    "pub fn f() -> u32 {",
    "    let kept = 2;",
    "    other_crate::declare!();",
    "    kept",
    "}",
    "",
  ].join("\n");
  const result = await rust.parse({ path: "src/lib.rs", text });
  const manifest =
    '[package]\nname="app"\nedition="2021"\n[dependencies]\nother_crate="1"\n';
  const files = [
    {
      path: "src/lib.rs",
      text,
      result,
      hash: contentHash(text),
      module: "rust",
      version: rust.version,
    },
  ];
  const contextFiles = [
    {
      path: "Cargo.toml",
      text: manifest,
      hash: contentHash(manifest),
      status: "clean",
      diagnostics: [],
    },
  ];
  for (const a of await rust.analyze({
    projectId: "c10",
    files,
    contextFiles,
    changedFiles: ["src/lib.rs"],
    changedContextFiles: [],
  }))
    files[0].result = a.result;
  const facts = fileFacts("c10", files[0]);
  const resolved = await rust.resolve({
    projectId: "c10",
    files,
    contextFiles,
    symbols: facts.symbols,
    links: facts.links,
  });
  const decisions = Array.isArray(resolved) ? resolved : resolved.resolutions;
  const link = facts.links.find(
    (l) => l.kind === "values" && l.targetName === "kept",
  );
  assert.ok(link);
  assert.ok(
    !decisions.some((d) => d.linkId === link.id && d.targetId),
    "kept stays unresolved",
  );
});

test("generic parameters target their declaring item", async () => {
  const g = await graph("locals");
  const file = "src/lib.rs";
  const source = g.text(file);
  const get = g.at(file, "types", "T", "-> T {");
  assert.equal(g.target(get).kind, "impl");
  assert.deepEqual(get.data.typeParameter, span(source, "impl<T: Clone>", "T"));
  const header = g.at(file, "types", "T", "Wrapper<T> {\n    pub fn");
  assert.equal(g.target(header).kind, "impl");
  for (const marker of ["value: U", "-> U {"]) {
    const link = g.at(file, "types", "U", marker);
    assert.equal(g.target(link).name, "ident");
    assert.deepEqual(link.data.typeParameter, span(source, "ident<U>", "U"));
  }
  const n = g.at(file, "values", "N", "[0; N]");
  assert.equal(g.target(n).name, "sized");
  // An associated type path is not the parameter.
  const item = g.links.find(
    (l) => l.kind === "types" && l.targetName === "S::Item",
  );
  assert.ok(item);
  assert.equal(g.target(item), undefined);
  assert.equal(item.data.typeParameter, undefined);
});

test("methods on locals, constructors, fields and chains of checkout types", async () => {
  const g = await graph("receivers");
  const definite = (file, marker, method, owner, nth = 0) => {
    const t = g.target(g.call(file, marker, method, nth));
    assert.ok(t, `${marker}`);
    assert.equal(t.name, method, marker);
    assert.equal(t.file, owner, marker);
  };
  // fd tests/tests.rs:2811 shape.
  definite(
    "tests/tests.rs",
    "te.assert_output(",
    "assert_output",
    "tests/testenv/mod.rs",
  );
  definite(
    "tests/tests.rs",
    "te.assert_success_and_get_output(",
    "assert_success_and_get_output",
    "tests/testenv/mod.rs",
  );
  // just tests/cache.rs shape: a by-value builder chain.
  for (const method of ["arg", "stdout", "run", "failure"])
    definite(
      "src/builder.rs",
      'Test::new().arg("--list").stdout("x").run().failure()',
      method,
      "src/builder.rs",
    );
  // redb tests/integration_tests.rs:5008 shape: `?` through a Result alias.
  definite("src/db.rs", "db.begin_write()", "begin_write", "src/db.rs");
  definite(
    "src/db.rs",
    "txn.persistent_savepoint()",
    "persistent_savepoint",
    "src/db.rs",
  );
  definite("src/db.rs", "txn.commit()", "commit", "src/db.rs");
  definite("src/db.rs", "db.find()", "find", "src/db.rs");
  // Fields, `&Self` results, `Self` constructors, async results.
  definite("src/lib.rs", "self.inner.tick()", "tick", "src/lib.rs");
  definite("src/lib.rs", "self.inner.peek()", "peek", "src/lib.rs");
  definite("src/lib.rs", "outer.run()", "run", "src/lib.rs");
  definite("src/lib.rs", "outer.label.width()", "width", "src/lib.rs");
  definite("src/lib.rs", "outer.inner().peek()", "inner", "src/lib.rs");
  definite("src/lib.rs", "outer.inner().peek()", "peek", "src/lib.rs");
  definite("src/lib.rs", "client.ping()", "ping", "src/lib.rs");
  definite("src/lib.rs", "literal.load()", "load", "src/lib.rs");
  definite("src/lib.rs", "typed.load()", "load", "src/lib.rs");
  // A shadowing `let` changes the receiver type.
  definite("src/negative.rs", "m.other()", "other", "src/negative.rs");
  // A standard receiver keeps its outcome and records the proved type.
  const clone = g.call("src/lib.rs", "literal.name.clone()", "clone");
  assert.equal(g.target(clone), undefined);
  assert.deepEqual(clone.data.receiverTyping, { outside: "String" });
  // A pattern binding without a written type is not typed.
  const other = g.call("src/db.rs", "other.commit()", "commit");
  assert.equal(g.target(other), undefined);
  assert.equal(other.data.receiverGap, "pattern-binding");
});

test("method calls whose source does not prove one target stay unresolved", async () => {
  const g = await graph("receivers");
  const file = "src/negative.rs";
  for (const [marker, method] of [
    // rustc selects `Into::into(self)` before the `&self` inherent method.
    ["c.into()", "into"],
    // rustc selects `Read::bytes(self)`; Read is imported and implemented.
    ["s.bytes()", "bytes"],
    // rustc selects the checkout trait's `measure(self)`.
    ["m.measure()", "measure"],
    // The callee differs between cfg configurations.
    ["made.other_or_measure()", "other_or_measure"],
    // A generic result and a standard smart pointer are not typed here.
    ["g.other()", "other"],
    ["boxed.other()", "other"],
  ]) {
    const link = g.call(file, marker, method);
    assert.equal(g.target(link), undefined, marker);
  }
});
