import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileFacts, contentHash, validateResult } from "../dist/graph/index.js";
const rust = (
  await import(
    process.env.RUST_TEST_MODULE ?? "../dist/graph/languages/rust/index.js"
  )
).default;
async function graph(
  sources,
  manifests = { "Cargo.toml": '[package]\nname="app"\nedition="2024"\n' },
  replacements = {},
) {
  const files = [];
  for (const [path, text] of Object.entries(sources)) {
    const result = replacements[path] ?? (await rust.parse({ path, text }));
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
  const contextFiles = Object.entries(manifests).map(([path, text]) => ({
    path,
    text,
    hash: contentHash(text),
    status: "clean",
    diagnostics: [],
  }));
  for (const a of await rust.analyze({
    projectId: "review",
    files,
    contextFiles,
    changedFiles: files.map((f) => f.path),
    changedContextFiles: [],
  }))
    files.find((f) => f.path === a.path).result = a.result;
  const facts = files.map((f) => fileFacts("review", f));
  const symbols = facts.flatMap((f) => f.symbols);
  const links = facts.flatMap((f) => f.links);
  const decisions = await rust.resolve({
    projectId: "review",
    files,
    contextFiles,
    symbols,
    links,
  });
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const byLink = new Map(decisions.map((d) => [d.linkId, d]));
  function targets(name, kind = "calls") {
    const ls = links.filter((l) => l.targetName === name && l.kind === kind);
    assert.ok(ls.length, `${kind}: ${name}`);
    return ls.map((l) => {
      const d = byLink.get(l.id);
      return d?.targetId
        ? [byId.get(d.targetId)]
        : d?.candidateIds
          ? d.candidateIds.map((id) => byId.get(id))
          : [];
    });
  }
  function one(name, identity, kind = "calls") {
    const ts = targets(name, kind);
    for (const t of ts) {
      assert.equal(t.length, 1, name);
      assert.equal(t[0].identity, identity, name);
    }
  }
  function unknown(name, kind = "calls") {
    for (const t of targets(name, kind)) assert.equal(t.length, 0, name);
  }
  function would(name, kind = "calls") {
    return links
      .filter((l) => l.targetName === name && l.kind === kind)
      .map((l) => (l.data?.targets ?? []).map((id) => byId.get(id)));
  }
  function unverified(name, identity, kind = "calls") {
    unknown(name, kind);
    for (const ts of would(name, kind))
      assert.ok(
        ts.some((s) => s.identity === identity),
        `${name} retains ${identity}`,
      );
  }
  return {
    targets,
    would,
    unverified,
    one,
    unknown,
    files,
    contextFiles,
    symbols,
    links,
    decisions,
  };
}

const cases = JSON.parse(
  await readFile(
    new URL("./fixtures/rust-module-path-cases.json", import.meta.url),
    "utf8",
  ),
);
for (const c of cases)
  test("module path shape: " + c.name, async () => {
    // Native rustc control: proof() is u16 and prints 73; every decoy returns u8.
    const sources = Object.fromEntries(
      Object.entries(c.files).map(([p, t]) => [
        p,
        t.replaceAll("@ROOT@", "/uncaptured"),
      ]),
    );
    const g = await graph(sources);
    const call = /fn proof\(\)->u16\{([^}]+)\(\)\}/.exec(
      sources["src/main.rs"],
    )[1];
    const l = g.links.find((l) => l.kind === "calls" && l.targetName === call);
    assert.ok(l);
    const d = g.decisions.find((d) => d.linkId === l.id);
    if (c.definite) {
      assert.ok(d?.targetId);
      assert.equal(g.symbols.find((s) => s.id === d.targetId).file, c.target);
    } else {
      assert.equal(d?.targetId, undefined);
      assert.equal(d?.candidateIds, undefined);
      assert.ok(
        (l.data.targets ?? []).some(
          (id) => g.symbols.find((s) => s.id === id)?.file === c.target,
        ),
        JSON.stringify({
          link: l,
          hints: (l.data.targets ?? []).map(
            (id) => g.symbols.find((s) => s.id === id)?.file,
          ),
          symbols: g.symbols
            .filter((s) => s.name === "picked")
            .map((s) => ({ file: s.file, id: s.id })),
        }),
      );
    }
  });
test("backslash path never proves a module binding", async () => {
  const g = await graph({
    "src/lib.rs": '#[path="a\\\\b.rs"]mod child;fn run(){child::picked();}',
    "src/a/b.rs": "pub fn picked(){}",
    "src/child.rs": "pub fn picked(){}",
  });
  g.unknown("child::picked");
});
const macroCases = JSON.parse(
  await readFile(
    new URL("./fixtures/rust-path-macro-cases.json", import.meta.url),
    "utf8",
  ),
);
for (const c of macroCases)
  test("unverified layout propagates to " + c.name, async () => {
    // Native controls prove the selected child macro or older root fallback.
    const g = await graph(c.files);
    g.unknown(c.macro, "macros");
    const l = g.links.find(
      (l) => l.kind === "macros" && l.targetName === c.macro,
    );
    assert.ok(
      l.data.targets.some(
        (id) => g.symbols.find((s) => s.id === id)?.file === c.target,
      ),
    );
  });
test("an unverified file hint cannot establish a failed-module cause", async () => {
  const g = await graph({
    "src/lib.rs":
      "macro_rules! m{()=>{1u8}}#[macro_use]mod child;fn run(){child::nested::picked();m!();}",
    "src/child.rs": '#![path="custom/alternate.rs"]#[macro_use]pub mod nested;',
    "src/custom/nested.rs": "pub fn picked(){}macro_rules! m{()=>{2u16}}",
    "src/unrelated/nested.rs": "pub fn broken( {",
  });
  g.unverified("child::nested::picked", "picked");
  const l = g.links.find(
    (l) => l.kind === "calls" && l.targetName === "child::nested::picked",
  );
  assert.equal(l.data.cause, undefined);
  assert.ok(!l.data.uncertainty.includes("invalid-code"));
  const m = g.links.find((l) => l.kind === "macros" && l.targetName === "m");
  g.unknown("m", "macros");
  assert.ok(!m.data.uncertainty.includes("failed-file-unseen-declarations"));
});
