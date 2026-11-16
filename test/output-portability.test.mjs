// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { contractDocument } from "../dist/contracts/document.js";
import { scaffold } from "../dist/contracts/scaffold.js";
import { emitPlugin } from "../dist/contracts/plugins.js";
test("output documents, named references and plugin mappings share portable coordinates", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-portable-output-"));
  try {
    await mkdir(join(root, "nested"));
    const file = join(root, "nested/design.pym");
    await writeFile(
      file,
      "type Input = { name: String }; op send(input: Input) -> Bool;",
    );
    const ir = analyseFile(file).ir,
      doc = contractDocument(ir);
    assert.ok(
      doc.declarations.every(
        (d) => !d.symbolId.startsWith("/") && !d.span.file.startsWith("/"),
      ),
    );
    const input = doc.declarations.find((d) => d.name === "Input"),
      send = doc.declarations.find((d) => d.name === "send");
    assert.equal(send.parameters[0].type.symbolId, input.symbolId);
    for (const target of ["typescript", "rust", "go"]) {
      const out = scaffold(ir, target);
      assert.deepEqual(
        out.symbols.map((s) => s.symbolId),
        doc.declarations.map((d) => d.symbolId),
      );
      assert.ok(out.symbols.every((s) => !s.span.file.startsWith("/")));
      assert.deepEqual(
        out.contractManifest.entries.map((e) => e.id).sort(),
        out.symbols.map((s) => s.symbolId).sort(),
      );
    }
    const plugin = join(root, "inspect.mjs");
    await writeFile(
      plugin,
      `export const apiVersion='pymtheg.emitter/v1',target='inspect',extension='.txt';export function emit(d){return {source:JSON.stringify(d),bodyPolicy:d.bodyPolicy,symbols:d.declarations.map(x=>({name:x.name,symbolId:x.symbolId})),notes:[],dependencies:[]};}`,
    );
    const output = await emitPlugin(
      doc,
      plugin,
      "inspect",
      new AbortController().signal,
    );
    const received = JSON.parse(output.source);
    assert.equal(received.sourceRoot, ".");
    assert.deepEqual(received.declarations, doc.declarations);
    assert.ok(!output.source.includes(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
