import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { StudioService } from "../dist/studio/service.js";
import { ArchitectureStore } from "../dist/architecture/store.js";
import { documentSetHash } from "../dist/architecture/history.js";
import { hash } from "../dist/shared/identity.js";
const storeModule = pathToFileURL(resolve("dist/architecture/store.js")).href;
const modelModule = pathToFileURL(resolve("dist/architecture/model.js")).href;
const docs = [
  { path: "ä.md", text: "A" },
  { path: "z.md", text: "Z" },
];
function child(locale, source, values = {}) {
  const run = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", source],
    {
      encoding: "utf8",
      env: { ...process.env, LANG: locale, LC_ALL: locale, ...values },
    },
  );
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
test("source identities and exported history are independent of locale; legacy IDs and no-op refresh survive", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-locale-"));
  try {
    const source = `import {indexArchitecture} from ${JSON.stringify(modelModule)}; console.log(JSON.stringify({locale:Intl.DateTimeFormat().resolvedOptions().locale,id:indexArchitecture(${JSON.stringify(docs)}).id}));`;
    const en = child("en_US.UTF-8", source),
      sv = child("sv_SE.UTF-8", source);
    assert.notEqual(en.locale, sv.locale);
    assert.equal(en.id, sv.id);
    await writeFile(
      join(root, "entry.pym"),
      'import "ä.pym"; import "z.pym"; flow main() -> Unit {}',
    );
    await writeFile(join(root, "ä.pym"), "rule first() -> Bool = true;");
    await writeFile(join(root, "z.pym"), "rule second() -> Bool = false;");
    const projectModule = pathToFileURL(
      resolve("dist/language/project.js"),
    ).href;
    const load = `import {loadProject} from ${JSON.stringify(projectModule)}; const s=loadProject(process.env.TEST_FILE); console.log(JSON.stringify({id:s.id,files:s.sources.map(s=>s.file)}));`;
    assert.deepEqual(
      child("en_US.UTF-8", load, { TEST_FILE: join(root, "entry.pym") }),
      child("sv_SE.UTF-8", load, { TEST_FILE: join(root, "entry.pym") }),
    );
    const dir = join(root, "legacy");
    await mkdir(dir);
    const ordered = docs.map((d) => ({ path: d.path, hash: hash(d.text) }));
    const oldSnapshot = hash(
      JSON.stringify(ordered.map((d) => [d.path, d.hash])),
    );
    assert.notEqual(
      oldSnapshot,
      en.id,
      "fixture retains a different old collation identity",
    );
    const checkpoint = hash("legacy checkpoint");
    const legacy = {
      schema: "pymtheg.architecture-history/v2",
      active: checkpoint,
      snapshots: [{ id: oldSnapshot, documents: ordered }],
      revisions: [
        {
          id: checkpoint,
          snapshot: oldSnapshot,
          label: "Original",
          created: "2026-01-01T00:00:00.000Z",
          source: "test",
          parentId: null,
        },
      ],
      blobs: docs.map((d) => ({ hash: hash(d.text), text: d.text })),
      draft: null,
    };
    const store = await ArchitectureStore.open(dir);
    store.importHistory(legacy);
    assert.equal(
      store.save("Unchanged", "test", docs, undefined, checkpoint, {
        skipUnchanged: true,
      }).id,
      checkpoint,
    );
    assert.equal(store.revisions().length, 1);
    store.close();
    const exportSource = `import {ArchitectureStore} from ${JSON.stringify(storeModule)}; const s=await ArchitectureStore.open(process.env.TEST_ROOT,{readOnly:true});try{console.log(JSON.stringify(s.exportHistory()));}finally{s.close();}`;
    const a = child("en_US.UTF-8", exportSource, { TEST_ROOT: dir }),
      b = child("sv_SE.UTF-8", exportSource, { TEST_ROOT: dir });
    assert.deepEqual(a, b);
    assert.equal(b.schema, "pymtheg.architecture-history/v3");
    assert.equal(b.snapshots[0].id, oldSnapshot);
    assert.equal(b.snapshots[0].contentHash, en.id);
    const bundle = child(
      "sv_SE.UTF-8",
      `import {ArchitectureStore} from ${JSON.stringify(storeModule)}; const s=await ArchitectureStore.open(process.env.TEST_ROOT,{readOnly:true});try{console.log(JSON.stringify(s.export(s.read().id)));}finally{s.close();}`,
      { TEST_ROOT: dir },
    );
    assert.equal(bundle.schema, "pymtheg.architecture-bundle/v3");
    const destination = join(root, "bundle");
    await mkdir(destination);
    const service = new StudioService(destination);
    try {
      const imported = await service.importArchitectureBundle(
        "Copied",
        bundle,
        new AbortController().signal,
      );
      assert.ok(imported.documents.some((d) => d.path === "ä.md"));
      const broken = structuredClone(bundle);
      broken.documents[0].text += "tampered";
      await assert.rejects(
        service.importArchitectureBundle(
          "Broken",
          broken,
          new AbortController().signal,
        ),
        /recorded identity/,
      );
      assert.equal(
        (await service.architectureOverview()).activeRevision,
        imported.id,
      );
    } finally {
      await service.close();
    }
    const copy = join(root, "copy");
    await mkdir(copy);
    const target = await ArchitectureStore.open(copy);
    try {
      target.importHistory(b);
      assert.deepEqual(target.exportHistory(), b);
    } finally {
      target.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("a valid alternate manifest cannot replace content already stored under the same snapshot identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-manifest-conflict-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    const original = store.save("Original", "test", docs);
    const archive = store.exportHistory();
    const text = "different";
    const d = archive.snapshots[0].documents[0];
    d.hash = hash(text);
    archive.snapshots[0].contentHash = documentSetHash(
      archive.snapshots[0].documents,
    );
    archive.blobs.push({ hash: d.hash, text });
    assert.throws(
      () => store.importHistory(archive),
      /matching snapshot has different document content/,
    );
    assert.equal(store.read().id, original.id);
    assert.deepEqual(store.document(original.id, "ä.md"), docs[0]);
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("stored content checksums reject a valid replacement blob under an unchanged snapshot ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-content-integrity-"));
  let store;
  try {
    store = await ArchitectureStore.open(root);
    store.save("Original", "test", docs);
    store.close();
    store = null;
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(
      join(root, ".pymtheg/shared", "architecture.sqlite"),
    );
    const replacement = "different but internally hashed";
    const digest = hash(replacement);
    db.prepare("INSERT INTO blobs(hash,text) VALUES(?,?)").run(
      digest,
      replacement,
    );
    db.prepare("UPDATE documents SET hash=? WHERE path=?").run(digest, "ä.md");
    db.close();
    store = await ArchitectureStore.open(root, { readOnly: true });
    assert.throws(() => store.read(), /document identity mismatch/);
    assert.throws(() => store.exportHistory(), /document identity mismatch/);
  } finally {
    store?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an unchanged folder refreshed under a different locale does not create a checkpoint", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-locale-refresh-"));
  try {
    const source = join(root, "source"),
      workspace = join(root, "workspace");
    await mkdir(source);
    await mkdir(workspace);
    for (const doc of docs) await writeFile(join(source, doc.path), doc.text);
    const cli = (locale) => {
      const run = spawnSync(
        process.execPath,
        [
          resolve("dist/cli/main.js"),
          "import-architecture",
          source,
          "--into",
          workspace,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, LANG: locale, LC_ALL: locale },
        },
      );
      assert.ifError(run.error);
      assert.equal(run.status, 0, run.stderr);
      return JSON.parse(run.stdout);
    };
    const original = cli("en_US.UTF-8"),
      refreshed = cli("sv_SE.UTF-8");
    assert.equal(refreshed.unchanged, true);
    assert.equal(refreshed.committed, false);
    assert.equal(refreshed.revision, original.revision);
    const store = await ArchitectureStore.open(workspace, { readOnly: true });
    try {
      assert.equal(store.revisions().length, 1);
    } finally {
      store.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
