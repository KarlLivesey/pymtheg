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
    assert.equal(ambiguous.status, "ambiguous-selector");
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
      "already-linked",
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
    assert.equal(ambiguous.status, "ambiguous-selector");
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

// ---- round 1 review: continuity, fingerprints, concurrency, codes ----

async function goProject(files) {
  const root = await mkdtemp(join(tmpdir(), "pym-code-links-go-"));
  await writeFile(join(root, "go.mod"), "module example.com/m\n\ngo 1.22\n");
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  }
  const init = await pym(root, "init", ".", "--format", "json");
  assert.equal(init.code, 0, init.stdout + init.stderr);
  await createRequirement({ root, id: "R1", title: "First" });
  return root;
}
const goSave = (pkg, body = "return x + 1") =>
  `package ${pkg}\n\nfunc Save(x int) int {\n\t${body}\n}\n`;
const only = async (root, allowMoved = false) => {
  const check = await checkCodeLinks({ root, writer, allowMoved });
  assert.equal(check.links.length, 1);
  return { check, link: check.links[0] };
};

test("rename in place with a same-named symbol in another package is missing, never moved", async () => {
  const root = await goProject({
    "one/a.go": goSave("one"),
    "two/b.go": goSave("two", "return x * 9"),
  });
  try {
    const made = await createCodeLink({
      root,
      writer,
      record: "R1",
      selector: "one/a.go:3",
    });
    assert.equal(made.status, "created");
    assert.deepEqual(
      made.link.twins.map((t) => t.path),
      ["two/b.go"],
    );
    await writeFile(
      join(root, "one", "a.go"),
      goSave("one").replace("Save", "Store"),
    );
    const { check, link } = await only(root);
    assert.equal(link.state, "missing");
    assert.equal(check.passed, false);
    const reasons = Object.fromEntries(
      link.suggestions.map((s) => [s.path + ":" + s.identity, s.reason]),
    );
    assert.match(reasons["one/a.go:Store"], /renamed/);
    assert.match(reasons["two/b.go:Save"], /already existed/);
    const refreshed = await refreshCodeLink({
      root,
      writer,
      link: made.link.id,
    });
    assert.equal(refreshed.status, "refused");
    // Same text moved into another file while the linked file still exists:
    // a rename-or-copy, not a proven move.
    await writeFile(join(root, "one", "a.go"), "package one\n");
    await writeFile(join(root, "one", "c.go"), goSave("one"));
    const again = await only(root);
    assert.equal(again.link.state, "missing");
    assert.match(
      again.link.suggestions.find((s) => s.path === "one/c.go").reason,
      /linked file still exists/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("deleting the linked file with an identical twin elsewhere is missing and fails the check", async () => {
  const root = await goProject({
    "one/a.go": goSave("one"),
    "two/a.go": goSave("two"),
  });
  try {
    await createCodeLink({
      root,
      writer,
      record: "R1",
      selector: "one/a.go:3",
    });
    await rm(join(root, "one"), { recursive: true });
    const { check, link } = await only(root);
    assert.equal(link.state, "missing");
    assert.equal(check.passed, false);
    assert.deepEqual(
      link.suggestions.map((s) => s.path),
      ["two/a.go"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a genuine file move is moved; check fails until refreshed unless --allow-moved", async () => {
  const root = await goProject({ "one/a.go": goSave("one") });
  try {
    const made = await createCodeLink({
      root,
      writer,
      record: "R1",
      selector: "Save",
    });
    await mkdir(join(root, "three"));
    await writeFile(join(root, "three", "c.go"), goSave("three"));
    await rm(join(root, "one"), { recursive: true });
    let { check, link } = await only(root);
    assert.equal(link.state, "moved");
    assert.equal(link.current.path, "three/c.go");
    assert.equal(check.passed, false);
    assert.equal((await only(root, true)).check.passed, true);
    const out = await pym(root, "link", "check");
    assert.equal(out.code, 1, out.stdout);
    assert.equal((await pym(root, "link", "check", "--allow-moved")).code, 0);
    assert.equal(
      (await refreshCodeLink({ root, writer, link: made.link.id })).status,
      "refreshed",
    );
    ({ check, link } = await only(root));
    assert.equal(link.state, "ok");
    assert.equal(link.link.id, made.link.id);
    assert.equal(link.link.symbol.path, "three/c.go");
    // Same name but different text at the only new path: never moved.
    await rm(join(root, "three"), { recursive: true });
    await mkdir(join(root, "four"));
    await writeFile(join(root, "four", "d.go"), goSave("four", "return 0"));
    ({ link } = await only(root));
    assert.equal(link.state, "missing");
    assert.match(link.suggestions[0].reason, /different text/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const route =
  'export async function GET() {\n  return new Response("ok");\n}\n';
test("identical-text twins on record: moved is never claimed (swap case from review)", async () => {
  const root = await goProject({ "a/route.ts": route, "b/route.ts": route });
  try {
    const made = await createCodeLink({
      root,
      writer,
      record: "R1",
      selector: "a/route.ts:1",
    });
    assert.deepEqual(
      made.link.twins.map((t) => t.path),
      ["b/route.ts"],
    );
    // Move the twin b → d, then the linked file a → b.
    await mkdir(join(root, "d"));
    await rename(join(root, "b", "route.ts"), join(root, "d", "route.ts"));
    await rename(join(root, "a", "route.ts"), join(root, "b", "route.ts"));
    await rm(join(root, "a"), { recursive: true });
    const { check, link } = await only(root, true);
    assert.equal(link.state, "missing");
    assert.equal(check.passed, false); // even with allowMoved
    assert.deepEqual(link.suggestions.map((s) => s.path).sort(), [
      "b/route.ts",
      "d/route.ts",
    ]);
    for (const suggestion of link.suggestions)
      assert.match(suggestion.reason, /identical copies existed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a genuine move with only different-text twins on record is moved", async () => {
  const root = await goProject({
    "one/a.go": goSave("one"),
    "two/b.go": goSave("two", "return x * 9"),
  });
  try {
    await createCodeLink({
      root,
      writer,
      record: "R1",
      selector: "one/a.go:3",
    });
    await mkdir(join(root, "three"));
    await writeFile(join(root, "three", "a.go"), goSave("three"));
    await rm(join(root, "one"), { recursive: true });
    const { link } = await only(root, true);
    assert.equal(link.state, "moved");
    assert.equal(link.current.path, "three/a.go");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("defined behaviour: an identical twin moved onto the recorded path is the linked symbol (ok)", async () => {
  // A link is identified by project-relative path + qualified name + kind and
  // verified by its text fingerprint. File provenance is not part of a link, so
  // identical text with the same identity at the recorded path is `ok` (ruling,
  // PR 38 round 2). This test pins that definition.
  const root = await goProject({ "a/route.ts": route, "b/route.ts": route });
  try {
    await createCodeLink({
      root,
      writer,
      record: "R1",
      selector: "a/route.ts:1",
    });
    await mkdir(join(root, "c"));
    await rename(join(root, "a", "route.ts"), join(root, "c", "route.ts"));
    await rename(join(root, "b", "route.ts"), join(root, "a", "route.ts"));
    const { check, link } = await only(root);
    assert.equal(link.state, "ok");
    assert.equal(link.current.path, "a/route.ts");
    assert.equal(check.passed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fingerprint: only line endings and trailing spaces are ignored", async () => {
  const root = await goProject({
    "one/a.go": 'package one\n\nfunc Name() string {\n\treturn "a b"\n}\n',
  });
  try {
    await createCodeLink({ root, writer, record: "R1", selector: "Name" });
    await writeFile(
      join(root, "one", "a.go"),
      'package one\r\n\r\nfunc Name() string {   \r\n\treturn "a b"\t\r\n}\r\n',
    );
    assert.equal((await only(root)).link.state, "ok");
    await writeFile(
      join(root, "one", "a.go"),
      'package one\n\nfunc Name() string {\n\treturn "a  b"\n}\n',
    );
    let { link } = await only(root);
    assert.equal(link.state, "changed");
    assert.deepEqual(link.differs, ["body"]);
    await writeFile(
      join(root, "one", "a.go"),
      'package one\n\nfunc Name() string {\n    return "a b"\n}\n',
    );
    ({ link } = await only(root));
    assert.equal(link.state, "changed"); // reformatting is a change (refresh it)
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two link writers wait for a held planning lock and both succeed", async () => {
  const root = await goProject({
    "one/a.go": goSave("one") + "\nfunc Load() int { return Save(1) }\n",
  });
  const { spawn } = await import("node:child_process");
  const { readdir, readlink } = await import("node:fs/promises");
  try {
    await listCodeLinks({ root, writer }); // graph synced before the race
    const database = join(root, ".pymtheg", "shared", "architecture.sqlite");
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync(process.argv[1]);d.exec("BEGIN EXCLUSIVE");process.stdout.write("ready\\n");process.stdin.once("data",()=>{d.exec("COMMIT");d.close();process.exit(0)});`,
        database,
      ],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    await new Promise((done) => holder.stdout.once("data", done));
    const adds = ["Save", "Load"].map((selector) => {
      const child = spawn(
        process.execPath,
        [cli, "link", "add", "R1", selector, "--json"],
        { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      child.stdout.on("data", (d) => (out += d));
      return {
        child,
        done: new Promise((resolve) =>
          child.on("exit", (code) => resolve({ code, out })),
        ),
      };
    });
    // Readiness: both writers have the locked database open.
    const opened = async (pid) => {
      try {
        for (const fd of await readdir(`/proc/${pid}/fd`))
          if (
            (await readlink(`/proc/${pid}/fd/${fd}`).catch(() => "")) ===
            database
          )
            return true;
      } catch {
        return true; // exited already (reported by its result below)
      }
      return false;
    };
    for (const { child } of adds)
      while (!(await opened(child.pid)))
        await new Promise((next) => setImmediate(next));
    holder.stdin.write("go\n");
    const results = await Promise.all(adds.map((a) => a.done));
    for (const { code, out } of results) {
      assert.equal(code, 0, out);
      assert.equal(JSON.parse(out).status, "created");
    }
    assert.equal((await listCodeLinks({ root, writer })).links.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unlinked --symbols lists public methods of exported TypeScript classes", async () => {
  const root = await project();
  try {
    await writeFile(
      join(root, "ts", "repo.ts"),
      "export class Repo {\n  load() { return 1; }\n  private hidden() { return 2; }\n}\nclass Inner {\n  run() {}\n}\n",
    );
    const result = await unlinkedWork({ root, writer, symbols: true });
    const names = result.symbols.map((s) => s.identity);
    assert.ok(names.includes("Repo.load"), names.join());
    assert.ok(!names.includes("Repo.hidden"));
    assert.ok(!names.includes("Inner.run"));
    assert.ok(names.includes("(*Repo).Load")); // Go exported method
    assert.ok(names.includes("impl Index::lookup")); // Rust pub fn in impl
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("errors carry machine-readable codes; impact names callers it did not follow", async () => {
  const root = await goProject({
    "one/a.go": `package one

type Putter interface{ Put() }
type A struct{}

func (A) Put() {}

type B struct{}

func (B) Put() {}

func Use(p Putter) { p.Put() }
`,
  });
  try {
    await assert.rejects(
      removeCodeLink({ root, writer, link: "00000000-nope" }),
      (e) => e.code === "link-not-found",
    );
    await assert.rejects(
      requirementsFor({ root, writer }),
      (e) => e.code === "invalid-input",
    );
    const out = await pym(root, "link", "remove", "deadbeef-x", "--json");
    assert.equal(out.code, 3);
    assert.equal(JSON.parse(out.stdout).error.code, "link-not-found");
    await assert.rejects(
      createRequirement({ root, id: "R1", title: "Again" }),
      (e) => e.code === "record-conflict",
    );
    await createCodeLink({ root, writer, record: "R1", selector: "Use" });
    const impact = await requirementsFor({
      root,
      writer,
      symbol: "(A).Put",
      impact: true,
    });
    assert.equal(impact.impactIncomplete, true);
    assert.ok(impact.notFollowedCount >= 1, JSON.stringify(impact));
    assert.ok(
      impact.notFollowed.some((c) => c.identity === "Use"),
      JSON.stringify(impact.notFollowed),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---- round 3 review: attributes and directives above a symbol ----

const rustAttributes = `#[repr(C)]
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct Header {
    pub len: u32,
}

#[no_mangle]
pub extern "C" fn ffi_entry() -> u32 {
    1
}

#[cfg(unix)]
pub fn platform() -> u32 {
    2
}

pub struct Disk;
impl Disk {
    /// Reads.
    #[cfg(unix)]
    #[inline(always)]
    pub fn read(&self) -> u32 {
        3
    }
}

#[inline] pub fn same_line() -> u32 { 4 }

/// Multi-line attribute with brackets inside a string.
#[cfg_attr(
    feature = "f",
    allow(unused, reason = "has ] and ( inside")
)]
pub fn multi() -> u32 {
    5
}

pub mod m {
    #![allow(dead_code)]
    pub fn h() -> u32 {
        6
    }
}
`;
const goDirectiveSource = `package one

// Fast adds one.
func Fast(x int) int {
	return x + 1
}
`;
test("attributes above a symbol are fingerprinted (Rust #[...], Go //go:), doc comments are not", async () => {
  const root = await goProject({
    "one/a.go": goDirectiveSource,
    "rs/Cargo.toml":
      '[package]\nname = "attrs"\nversion = "0.1.0"\nedition = "2021"\n',
    "rs/src/lib.rs": rustAttributes,
  });
  const file = join(root, "rs", "src", "lib.rs");
  const goFile = join(root, "one", "a.go");
  const states = async () =>
    Object.fromEntries(
      (await listCodeLinks({ root, writer })).links.map((r) => [
        r.link.symbol.name,
        r.state === "changed" ? r.differs.join("+") : r.state,
      ]),
    );
  const allOk = {
    Header: "ok",
    ffi_entry: "ok",
    platform: "ok",
    read: "ok",
    same_line: "ok",
    multi: "ok",
    h: "ok",
    Fast: "ok",
  };
  const only = (name, value) => ({ ...allOk, [name]: value });
  const edit = async (
    from,
    to,
    expected,
    path = file,
    base = rustAttributes,
  ) => {
    assert.ok(base.includes(from), from);
    await writeFile(path, base.replace(from, to));
    assert.deepEqual(await states(), expected, `${from} → ${to}`);
    await writeFile(path, base);
  };
  try {
    for (const selector of [
      "Header",
      "ffi_entry",
      "platform",
      "impl Disk::read",
      "same_line",
      "multi",
      "h",
      "Fast",
    ]) {
      const made = await createCodeLink({
        root,
        writer,
        record: "R1",
        selector,
      });
      assert.equal(made.status, "created", `${selector}: ${made.message}`);
    }
    assert.deepEqual(await states(), allOk);
    // The five cases from review.
    await edit("#[repr(C)]\n", "", only("Header", "attributes"));
    await edit(
      "#[derive(Clone, PartialEq, Eq, Hash)]",
      "#[derive(Clone)]",
      only("Header", "attributes"),
    );
    await edit("#[no_mangle]\n", "", only("ffi_entry", "attributes"));
    await edit(
      "#[cfg(unix)]\npub fn platform",
      "#[cfg(windows)]\npub fn platform",
      only("platform", "attributes"),
    );
    await edit(
      "    #[cfg(unix)]\n    #[inline(always)]",
      "    #[cfg(windows)]\n    #[inline(always)]",
      only("read", "attributes"),
    );
    await edit(
      "#[inline(always)]",
      "#[inline(never)]",
      only("read", "attributes"),
    );
    // Added, reordered; same-line attribute; multi-line attribute string.
    await edit(
      "#[cfg(unix)]\npub fn platform",
      "#[cfg(unix)]\n#[must_use]\npub fn platform",
      only("platform", "attributes"),
    );
    await edit(
      "#[repr(C)]\n#[derive(Clone, PartialEq, Eq, Hash)]",
      "#[derive(Clone, PartialEq, Eq, Hash)]\n#[repr(C)]",
      only("Header", "attributes"),
    );
    await edit(
      "#[inline] pub fn same_line",
      "#[inline(never)] pub fn same_line",
      only("same_line", "attributes"),
    );
    await edit(
      '"has ] and ( inside"',
      '"has ] and ( inside!"',
      only("multi", "attributes"),
    );
    // Doc comments stay outside the fingerprint.
    await edit("/// Reads.", "/// Reads bytes from disk.", allOk);
    await edit(
      "/// Multi-line attribute with brackets inside a string.",
      "/// Changed doc.",
      allOk,
    );
    // An inner attribute belongs to its module (inside the module's own range),
    // not to the item that follows it.
    await edit("#![allow(dead_code)]", "#![allow(unused)]", allOk);
    // Go: directives directly above the declaration count; doc comments do not.
    await edit(
      "// Fast adds one.\n",
      "// Fast adds one.\n//go:noinline\n",
      only("Fast", "attributes"),
      goFile,
      goDirectiveSource,
    );
    await edit(
      "// Fast adds one.",
      "// Fast adds one to x.",
      allOk,
      goFile,
      goDirectiveSource,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
