// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  observationDocuments,
  decodeObservation,
} from "../dist/implementation/storage.js";
import { observeTypescript } from "../dist/implementation/typescript.js";
import {
  retainObservation,
  readImplementation,
} from "../dist/implementation/workspace.js";
import { ArchitectureStore } from "../dist/architecture/store.js";
import {
  documentCountsWithinLimits,
  isObservationPart,
} from "../dist/architecture/limits.js";
import { hash } from "../dist/shared/identity.js";
import { documentSetHash } from "../dist/architecture/history.js";
import { deflateRawSync } from "node:zlib";

const observe = (a, label = "First") =>
  observeTypescript(
    [
      { path: "a.ts", text: a, hash: hash(a) },
      {
        path: "b.ts",
        text: "import { f } from './a'; export function g() { return f(); }",
        hash: hash(
          "import { f } from './a'; export function g() { return f(); }",
        ),
      },
    ],
    { label, gitCommit: null, dirty: true },
  );

test("hash-consistent corrupt code is refused before history commit and existing versions remain usable", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-invalid-code-history-"));
  const store = await ArchitectureStore.open(root);
  try {
    const signal = new AbortController().signal;
    const first = await retainObservation(
      store,
      observe("export function f() { return 1; }"),
      null,
      signal,
    );
    const valid = store.exportHistory();
    const bad = structuredClone(valid);
    const snapshot = bad.snapshots[0];
    const manifestRef = snapshot.documents.find(
      (d) => d.path === ".pymtheg-observed-code.json",
    );
    const manifestBlob = bad.blobs.find((b) => b.hash === manifestRef.hash);
    const manifest = JSON.parse(manifestBlob.text);
    const partRef = manifest.parts[0];
    const partBlob = bad.blobs.find((b) => b.hash === partRef.hash);
    const oldPart = partBlob.hash,
      oldManifest = manifestBlob.hash;
    partBlob.text = JSON.stringify({
      schema: "pymtheg.observed-file/v3",
      encoding: "deflate-raw-base64",
      bytes: 1,
      content: deflateRawSync(Buffer.from(partBlob.text)).toString("base64"),
    });
    partBlob.hash = hash(partBlob.text);
    partRef.hash = partBlob.hash;
    manifestBlob.text = JSON.stringify(manifest);
    manifestBlob.hash = hash(manifestBlob.text);
    for (const record of bad.snapshots) {
      for (const doc of record.documents) {
        if (doc.hash === oldPart) doc.hash = partBlob.hash;
        if (doc.hash === oldManifest) doc.hash = manifestBlob.hash;
      }
      record.contentHash = documentSetHash(record.documents);
    }
    assert.throws(
      () => store.importHistory(bad, first.id),
      /invalid code version.*Nothing was imported/,
    );
    assert.equal((await readImplementation(store)).index.id, first.id);
    assert.deepEqual(store.exportHistory(), valid);
    const next = await retainObservation(
      store,
      observe("export function f() { return 2; }", "After refusal"),
      first.id,
      signal,
    );
    assert.notEqual(next.id, first.id);
    assert.equal(
      (await readImplementation(store, first.id)).graph.version.label,
      "First",
    );
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("file parts round-trip exact graph order; labels and local edits reuse unchanged parts", () => {
  const graph = observe("export function f() { return 1; }");
  const docs = observationDocuments(graph);
  assert.deepEqual(decodeObservation(docs), graph);
  assert.deepEqual(
    decodeObservation([{ path: docs[0].path, text: JSON.stringify(graph) }]),
    graph,
  );
  const relabelled = observationDocuments({
    ...graph,
    version: { ...graph.version, label: "Second" },
  });
  assert.notEqual(docs[0].text, relabelled[0].text);
  assert.deepEqual(docs.slice(1), relabelled.slice(1));
  const edited = observationDocuments(
    observe("export function f() { return 2; }"),
  );
  assert.notEqual(docs[1].text, edited[1].text);
  assert.equal(docs[2].text, edited[2].text);
  assert.throws(() => decodeObservation(docs.slice(0, 2)), /missing/);
  const corrupt = structuredClone(docs);
  corrupt[1].text += " ";
  assert.throws(() => decodeObservation(corrupt), /does not match/);
  const omitted = structuredClone(docs);
  const manifest = JSON.parse(omitted[0].text);
  manifest.order.edges.pop();
  omitted[0].text = JSON.stringify(manifest);
  assert.throws(() => decodeObservation(omitted), /omits/);
});

test("code parts have an independent bounded document budget", () => {
  const docs = Array.from({ length: 4096 }, (_, i) => ({
    path: `notes/${i}.md`,
  }));
  const parts = Array.from({ length: 10000 }, (_, i) => ({
    path: `.pymtheg-code-parts/${hash(String(i))}.json`,
  }));
  assert.equal(documentCountsWithinLimits([...docs, ...parts]), true);
  assert.equal(
    documentCountsWithinLimits([...docs, ...parts, { path: "extra.md" }]),
    false,
  );
  assert.equal(
    documentCountsWithinLimits([
      ...parts,
      { path: `.pymtheg-code-parts/${hash("extra")}.json` },
    ]),
    false,
  );
});

test("retained parts deduplicate repeated captures and survive portable history and scope removal", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-code-parts-"));
  const importedRoot = await mkdtemp(join(tmpdir(), "pym-code-parts-import-"));
  let store, imported;
  try {
    store = await ArchitectureStore.open(root);
    let current = null;
    const versions = [];
    for (let i = 0; i < 9; i++) {
      const graph = observe(
        `export function f() { return ${i === 8 ? 2 : 1}; }`,
        `Capture ${i}`,
      );
      const saved = await retainObservation(
        store,
        graph,
        current,
        new AbortController().signal,
      );
      assert.equal(saved.storage.newParts, i === 0 ? 3 : i === 8 ? 2 : 1);
      assert.equal(saved.storage.reusedParts, i === 0 ? 0 : i === 8 ? 1 : 2);
      current = saved.id;
      versions.push({ revision: current, graph });
    }
    const archive = store.exportHistory();
    const partHashes = new Set(
      archive.snapshots.flatMap((s) =>
        s.documents.filter((d) => isObservationPart(d.path)).map((d) => d.hash),
      ),
    );
    assert.equal(partHashes.size, 3, "two original files and one changed file");
    imported = await ArchitectureStore.open(importedRoot);
    imported.importHistory(archive);
    for (const version of versions)
      assert.deepEqual(
        (await readImplementation(imported, version.revision)).graph,
        version.graph,
      );
    const graph = observeTypescript([], {
      label: "Removed scope",
      gitCommit: null,
      dirty: true,
    });
    await retainObservation(
      store,
      graph,
      current,
      new AbortController().signal,
    );
    const final = await readImplementation(store);
    assert.equal(
      final.documents.some((d) => isObservationPart(d.path)),
      false,
    );
    const registry = JSON.parse(
      final.documents.find((d) => d.path === ".pymtheg-sources.json").text,
    );
    assert.equal(registry.nativeDocuments.some(isObservationPart), false);
    assert.deepEqual(
      (await readImplementation(store, versions[0].revision)).graph,
      versions[0].graph,
    );
  } finally {
    store?.close();
    imported?.close();
    await rm(root, { recursive: true, force: true });
    await rm(importedRoot, { recursive: true, force: true });
  }
});

test("legacy damaged active code does not block plan metadata, healthy historical code or recapture", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-legacy-damaged-code-"));
  const store = await ArchitectureStore.open(root);
  try {
    const signal = new AbortController().signal;
    const graph = observe("export function f() { return 1; }");
    const first = await retainObservation(store, graph, null, signal);
    const healthy = await readImplementation(store);
    const damaged = healthy.documents.map((d) =>
      d.path === ".pymtheg-observed-code.json"
        ? { ...d, text: '{"schema":"broken"}' }
        : d,
    );
    const bad = store.save("Legacy damaged version", "old importer", damaged);
    await assert.rejects(readImplementation(store), /./);
    assert.equal((await readImplementation(store, bad.id, false)).graph, null);
    assert.equal(
      (await readImplementation(store, first.id)).graph.snapshotId,
      graph.snapshotId,
    );
    const next = await retainObservation(
      store,
      observe("export function f() { return 2; }"),
      bad.id,
      signal,
    );
    assert.equal((await readImplementation(store)).index.id, next.id);
    assert.equal(
      (await readImplementation(store)).graph.nodes.find((n) => n.name === "f")
        .body,
      "present",
    );
  } finally {
    await store.closeReadWorkers();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("bundle previews reject valid-checksum corrupt observations before saving", async () => {
  const { StudioService } = await import("../dist/studio/service.js");
  const { indexArchitecture } = await import("../dist/architecture/model.js");
  const root = await mkdtemp(join(tmpdir(), "pym-corrupt-bundle-"));
  const service = new StudioService(root);
  try {
    const documents = [
      { path: ".pymtheg-observed-code.json", text: '{"schema":"broken"}' },
    ];
    const bundle = {
      schema: "pymtheg.architecture-bundle/v3",
      contentHash: documentSetHash(
        documents.map((d) => ({ path: d.path, hash: hash(d.text) })),
      ),
      index: indexArchitecture(documents),
      documents,
    };
    await assert.rejects(
      service.previewArchitectureImport(
        "Bad",
        { bundle },
        new AbortController().signal,
      ),
      (e) => e.status === 400 && /invalid code version/.test(e.message),
    );
    await assert.rejects(
      service.importArchitectureBundle(
        "Bad",
        bundle,
        new AbortController().signal,
      ),
      (e) => e.status === 400 && /invalid code version/.test(e.message),
    );
    assert.equal((await service.architectureOverview()).index, null);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
