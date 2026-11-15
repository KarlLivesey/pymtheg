import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkCodeLinks,
  codeLinkHistory,
  createCodeLink,
  createRequirement,
  listCodeLinks,
  refreshCodeLink,
  removeCodeLink,
  requirementsFor,
  unlinkedWork,
} from "../dist/architecture/code-links.js";

const run = promisify(execFile);
const cli = join(import.meta.dirname, "..", "dist", "cli", "main.js");
const pym = async (cwd, ...args) => {
  try {
    const { stdout } = await run(process.execPath, [cli, ...args], { cwd });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
};
let tick = 0;
const writer = {
  origin: { machine: "machine-1", actor: "actor-1", author: "Link Tester" },
  now: () => new Date(Date.UTC(2026, 10, 15, 12, 0, tick++)).toISOString(),
};
const goSource = `package gopkg

// Save writes.
func Save(x int) int {
	return x + 1
}

type Repo struct{}

func (r *Repo) Load() int { return Save(1) }
`;
const rustSource = `pub struct Index;
impl Index {
    pub fn lookup(&self, k: u32) -> u32 {
        k * 2
    }
}
fn helper() {}
`;
const tsSource = `export function start(n: number): number {
  return n + 1;
}
export class Index {}
function inner() { return start(2); }
`;
async function project() {
  const root = await mkdtemp(join(tmpdir(), "pym-code-links-"));
  await mkdir(join(root, "gopkg"));
  await mkdir(join(root, "rs", "src"), { recursive: true });
  await mkdir(join(root, "ts"));
  await writeFile(join(root, "go.mod"), "module example.com/demo\n\ngo 1.22\n");
  await writeFile(join(root, "gopkg", "store.go"), goSource);
  await writeFile(
    join(root, "rs", "Cargo.toml"),
    '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  await writeFile(join(root, "rs", "src", "lib.rs"), rustSource);
  await writeFile(join(root, "ts", "app.ts"), tsSource);
  const init = await pym(root, "init", ".", "--format", "json");
  assert.equal(init.code, 0, init.stdout + init.stderr);
  return root;
}
const byIdentity = (list, identity) =>
  list.links.find((r) => r.link.symbol.identity === identity);

test("requirement ↔ Go/Rust/TypeScript links: states, rebuild, removal and history", async () => {
  const root = await project();
  const options = { root, writer };
  try {
    // A planning record created without document import.
    const created = await createRequirement({
      root,
      id: "R1",
      title: "Saved values are readable",
      text: "Values written by Save can be found again.",
    });
    assert.equal(created.record.id, "plan:R1");

    // Ambiguous selector: Rust struct Index and TypeScript class Index.
    const ambiguous = await createCodeLink({
      ...options,
      record: "R1",
      selector: "Index",
    });
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.link, null);
    assert.deepEqual(ambiguous.matches.map((m) => m.language).sort(), [
      "rust",
      "typescript",
    ]);
    assert.equal((await listCodeLinks(options)).links.length, 0);
    assert.equal(
      (await createCodeLink({ ...options, record: "R9", selector: "Save" }))
        .status,
      "record-not-found",
    );

    const go = await createCodeLink({
      ...options,
      record: "R1",
      selector: "Save",
    });
    const rust = await createCodeLink({
      ...options,
      record: "plan:R1",
      selector: "impl Index::lookup",
    });
    const ts = await createCodeLink({
      ...options,
      record: "Saved values are readable",
      selector: "ts/app.ts:1",
    });
    for (const result of [go, rust, ts])
      assert.equal(result.status, "created", result.message);
    assert.deepEqual(
      [go, rust, ts].map((r) => [r.link.symbol.language, r.link.symbol.path]),
      [
        ["go", "gopkg/store.go"],
        ["rust", "rs/src/lib.rs"],
        ["typescript", "ts/app.ts"],
      ],
    );
    assert.equal(
      (await createCodeLink({ ...options, record: "R1", selector: "Save" }))
        .status,
      "exists",
    );
    let listed = await listCodeLinks(options);
    assert.deepEqual(
      listed.links.map((r) => r.state),
      ["ok", "ok", "ok"],
    );
    assert.equal((await checkCodeLinks(options)).passed, true);

    // Body edit → changed.
    await writeFile(
      join(root, "gopkg", "store.go"),
      goSource.replace("return x + 1", "return x + 2"),
    );
    listed = await listCodeLinks(options);
    assert.equal(byIdentity(listed, "Save").state, "changed");
    assert.deepEqual(byIdentity(listed, "Save").differs, ["body"]);
    let check = await checkCodeLinks(options);
    assert.equal(check.passed, false);
    assert.deepEqual(check.failing, [go.link.id]);
    // Explicit acceptance after review keeps the same link ID.
    const refreshed = await refreshCodeLink({ ...options, link: go.link.id });
    assert.equal(refreshed.status, "refreshed");
    assert.equal(refreshed.link.id, go.link.id);
    assert.equal(byIdentity(await listCodeLinks(options), "Save").state, "ok");

    // Rename → missing, with the renamed function as a suggestion only.
    await writeFile(
      join(root, "ts", "app.ts"),
      tsSource.replaceAll("start", "begin"),
    );
    listed = await listCodeLinks(options);
    const missing = byIdentity(listed, "start");
    assert.equal(missing.state, "missing");
    assert.equal(missing.current, null);
    assert.ok(
      missing.suggestions.some((s) => s.identity === "begin"),
      JSON.stringify(missing.suggestions),
    );
    assert.equal(missing.link.symbol.identity, "start"); // never retargeted

    // File move → moved (unique identity, no failed files).
    await rename(
      join(root, "gopkg", "store.go"),
      join(root, "gopkg", "persist.go"),
    );
    listed = await listCodeLinks(options);
    const moved = byIdentity(listed, "Save");
    assert.equal(moved.state, "moved");
    assert.equal(moved.current.path, "gopkg/persist.go");
    assert.deepEqual(moved.differs, ["path"]);

    // Broken syntax → unverifiable, naming the file.
    await writeFile(
      join(root, "rs", "src", "lib.rs"),
      rustSource.replace("k * 2", "k * * {"),
    );
    listed = await listCodeLinks(options);
    const broken = byIdentity(listed, "impl Index::lookup");
    assert.equal(broken.state, "unverifiable");
    assert.equal(broken.unverifiableFile.path, "rs/src/lib.rs");
    check = await checkCodeLinks(options);
    assert.ok(check.failing.includes(rust.link.id));
    await writeFile(join(root, "rs", "src", "lib.rs"), rustSource);

    // Deleting rebuildable data keeps the links and re-resolves them.
    const before = (await listCodeLinks(options)).links.map((r) => [
      r.link.id,
      r.state,
    ]);
    await rm(join(root, ".pymtheg", "rebuildable"), {
      recursive: true,
      force: true,
    });
    const after = await listCodeLinks(options);
    assert.deepEqual(
      after.links.map((r) => [r.link.id, r.state]),
      before,
    );
    assert.deepEqual(
      after.links.map((r) => r.state),
      ["moved", "ok", "missing"],
    );

    // Queries: requirements touched by a symbol, via definite callers, by file.
    await createRequirement({ root, id: "R2", title: "Repos load" });
    await createRequirement({ root, id: "R3", title: "Not built yet" });
    await createCodeLink({
      ...options,
      record: "R2",
      selector: "(*Repo).Load",
    });
    const direct = await requirementsFor({ ...options, symbol: "Save" });
    assert.deepEqual(direct.records, ["plan:R1"]);
    const impact = await requirementsFor({
      ...options,
      symbol: "Save",
      impact: true,
      depth: 3,
    });
    assert.deepEqual(impact.records, ["plan:R1", "plan:R2"]);
    assert.equal(
      impact.touched.find((t) => t.record === "plan:R2").via,
      "caller",
    );
    const inFile = await requirementsFor({
      ...options,
      file: "rs/src/lib.rs",
    });
    assert.deepEqual(inFile.records, ["plan:R1"]);
    const unlinked = await unlinkedWork({ ...options, symbols: true });
    assert.deepEqual(
      unlinked.requirements.map((r) => r.id),
      ["plan:R3"],
    );
    const publicNames = unlinked.symbols.map((s) => s.identity);
    assert.ok(publicNames.includes("Repo"), publicNames.join());
    assert.ok(publicNames.includes("begin"));
    assert.ok(!publicNames.includes("Save")); // linked
    assert.ok(!publicNames.includes("helper")); // private Rust
    assert.ok(!publicNames.includes("inner")); // not exported

    // Remove, then re-add: a new UUID with a previous reference.
    const removed = await removeCodeLink({
      ...options,
      link: ts.link.id.slice(0, 8),
    });
    assert.equal(removed.link.id, ts.link.id);
    assert.equal(
      (await listCodeLinks({ ...options, record: "R1" })).links.length,
      2,
    );
    await writeFile(join(root, "ts", "app.ts"), tsSource);
    const readded = await createCodeLink({
      ...options,
      record: "R1",
      selector: "start",
    });
    assert.equal(readded.status, "created");
    assert.notEqual(readded.link.id, ts.link.id);
    const history = await codeLinkHistory(options);
    const changes = history.entries.map((e) => [e.change, e.link]);
    assert.deepEqual(changes, [
      ["added", go.link.id],
      ["added", rust.link.id],
      ["added", ts.link.id],
      ["updated", go.link.id],
      ["added", history.entries[4].link],
      ["removed", ts.link.id],
      ["added", readded.link.id],
    ]);
    assert.equal(history.entries.at(-1).previous, ts.link.id);
    assert.ok(history.entries.every((e) => e.author === "Link Tester"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("link CLI: text and JSON shapes, exit codes, nothing created on ambiguity", async () => {
  const root = await project();
  try {
    let out = await pym(
      root,
      "link",
      "requirement",
      "R1",
      "--title",
      "Lookup doubles",
      "--json",
    );
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.equal(JSON.parse(out.stdout).record.id, "plan:R1");
    out = await pym(root, "link", "add", "R1", "Index", "--json");
    assert.equal(out.code, 1);
    const ambiguous = JSON.parse(out.stdout);
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.matches.length, 2);
    out = await pym(root, "link", "add", "R1", "rs/src/lib.rs:3");
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.match(
      out.stdout,
      /Linked plan:R1 to rust method impl Index::lookup/,
    );
    out = await pym(root, "link", "check");
    assert.equal(out.code, 0, out.stdout);
    assert.match(out.stdout, /1 code link: 1 ok/);
    await writeFile(
      join(root, "rs", "src", "lib.rs"),
      rustSource.replace("k * 2", "k * 3"),
    );
    out = await pym(root, "link", "check", "--json");
    assert.equal(out.code, 1);
    const check = JSON.parse(out.stdout);
    assert.equal(check.schema, "pymtheg.code-links/v1");
    assert.equal(check.passed, false);
    assert.equal(check.links[0].state, "changed");
    out = await pym(root, "link", "list");
    assert.match(out.stdout, /^CHANGED/m);
    out = await pym(root, "link", "history");
    assert.match(out.stdout, /1 recorded code-link change/);
    out = await pym(root, "link", "bogus", "--json");
    assert.equal(out.code, 3);
    assert.equal(JSON.parse(out.stdout).status, "error");
    assert.ok(
      (await readFile(join(root, ".pymtheg", "shared", "architecture.sqlite")))
        .length > 0,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
