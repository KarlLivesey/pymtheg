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
    new URL("./fixtures/graph-rust/macro-recall-3.json", import.meta.url),
    "utf8",
  ),
);
for (const c of cases)
  test(c.name, async () => {
    const g = await graph(c.files, c.manifests, c.replacements);
    if (c.definite)
      g.one(c.definite.name, c.definite.identity, c.definite.kind ?? "calls");
    if (c.closed)
      for (const targets of g.targets(c.closed.name, c.closed.kind))
        assert.equal(targets.length, c.closed.count);
    if (c.absent) g.unknown(c.absent, c.kind ?? "calls");
    if (c.unknown) g.unverified(c.unknown, c.would, c.kind ?? "calls");
    if (c.targetFile)
      for (const targets of g.targets(c.definite.name, c.definite.kind))
        for (const target of targets) assert.equal(target.file, c.targetFile);
  });
