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
    new URL(
      "./fixtures/graph-rust/block-module-path-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
for (const c of cases.filter((c) => c.name !== "guessed-failure-not-reach"))
  test("block module layout: " + c.name, async () => {
    // rustc and cargo: accepted decoy controls print u16 16; no-path forms are rejected.
    const g = await graph(c.files);
    const ms = g.links.filter(
      (l) => l.kind === "modules" && l.targetName === "m",
    );
    assert.ok(ms.length);
    for (const l of ms) {
      const d = g.decisions.find((d) => d.linkId === l.id);
      if (c.definite) {
        assert.equal(
          g.symbols.find((s) => s.id === d?.targetId)?.file,
          c.target,
        );
      } else {
        assert.equal(d?.targetId, undefined, c.name);
        assert.equal(d?.candidateIds, undefined, c.name);
        if (c.accepted)
          assert.ok(
            (l.data.targets ?? []).some(
              (id) => g.symbols.find((s) => s.id === id)?.file === c.target,
            ),
            JSON.stringify(l),
          );
      }
    }
    const calls = g.links.filter(
      (l) => l.kind === "calls" && l.targetName.endsWith("m::f"),
    );
    assert.ok(calls.length, c.name);
    for (const l of calls) {
      const d = g.decisions.find((d) => d.linkId === l.id);
      if (c.definite)
        assert.equal(
          g.symbols.find((s) => s.id === d?.targetId)?.file,
          c.target,
        );
      else {
        assert.equal(d?.targetId, undefined, c.name);
        assert.equal(d?.candidateIds, undefined, c.name);
        if (c.accepted)
          assert.ok(
            (l.data.targets ?? []).some(
              (id) => g.symbols.find((s) => s.id === id)?.file === c.target,
            ),
            JSON.stringify(l),
          );
      }
    }
  });
test("a guessed failed file cannot establish reach inside a valid candidate", async () => {
  const c = cases.find((c) => c.name === "guessed-failure-not-reach");
  // Native cargo control prints 16: the unrelated broken file is never loaded.
  const g = await graph(c.files);
  const l = g.links.find(
    (l) =>
      l.file === "src/custom/nested.rs" &&
      l.kind === "calls" &&
      l.targetName === "drop",
  );
  assert.ok(l);
  assert.equal(l.data.cause, undefined);
  assert.ok(
    !(l.data.uncertainty ?? "").includes("invalid-code"),
    l.data.uncertainty,
  );
  assert.ok(
    !(l.data.uncertainty ?? "").includes("failed-file-unseen-declarations"),
    l.data.uncertainty,
  );
});
