import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
async function fixture(fn, modern = false, plugins = []) {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-"));
  const original =
    "op save(value: Nat) -> Unit; flow main() -> Unit { call save(true); }";
  await writeFile(join(root, "main.pym"), original);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      resolve("dist/cli/main.js"),
      "mcp",
      root,
      ...plugins.flatMap((p) => ["--plugin", p]),
    ],
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (b) => {
    stderr += b;
  });
  const client = new Client(
    { name: "pym-acceptance", version: "1.0" },
    modern ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {},
  );
  try {
    await client.connect(transport);
    await fn(client, root, original);
    assert.equal(stderr, "");
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
}
const call = async (c, name, args = {}) => {
  const result = await c.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent ?? JSON.parse(result.content[0].text);
};
test("MCP summaries count source-replayed call and return failures as counterexamples", async () =>
  fixture(async (client, root) => {
    await writeFile(
      join(root, "main.pym"),
      "op r(q: Int) -> Unit requires q > 0; flow first() -> Unit { call r(0); return unit; } flow second(x: Int) -> Int requires x > 0 ensures result > 0 { return -1; }",
    );
    const run = await call(client, "check_design", { file: "main.pym" });
    const properties = await call(client, "read_run", {
      runId: run.runId,
      section: "properties",
    });
    const replayed = properties.items.filter(
      (p) =>
        p.witnessValidation === "source_replayed" &&
        p.outcome === "counterexample",
    );
    assert.equal(replayed.length, 2);
    assert.equal(run.results.counterexamples, 2);
    assert.equal(run.results.structuralFindings, 0);
  }));
test("agents can browse checked source targets before an architecture store exists", async () =>
  fixture(async (client, root) => {
    const page = await call(client, "read_architecture", {
      section: "source_contracts",
      query: "save",
    });
    assert.equal(page.total, 1);
    assert.equal(page.items[0].id, "source:main.pym#save");
    assert.equal(page.items[0].file, "main.pym");
    const detail = await call(client, "read_architecture", {
      section: "source_contract",
      id: "source:main.pym#save",
      sourceSnapshotId: page.snapshotId,
    });
    assert.equal(detail.current.symbolId, "main.pym#save");
    assert.match(detail.current.source, /op save\(value: Nat\)/);
    await writeFile(join(root, "main.pym"), "op replacement() -> Unit;");
    const old = await call(client, "read_architecture", {
      section: "source_contracts",
      query: "save",
      sourceSnapshotId: page.snapshotId,
    });
    assert.equal(old.total, 1);
    const current = await call(client, "read_architecture", {
      section: "source_contracts",
      query: "replacement",
    });
    assert.equal(current.total, 1);
    const { access } = await import("node:fs/promises");
    await assert.rejects(access(join(root, ".pymtheg/shared")));
  }));
test("real MCP discovery and check-fix-recheck preserve disk and evidence", async () =>
  fixture(async (client, root, original) => {
    const tools = await client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "check_design"));
    const resources = await client.listResources();
    assert.ok(
      resources.resources.some((r) => r.uri === "pymtheg://language/guide"),
    );
    const guide = await client.readResource({
      uri: "pymtheg://language/guide",
    });
    assert.match(guide.contents[0].text, /Result/);
    const project = await call(client, "project_info");
    assert.equal(project.files[0].path, "main.pym");
    const bad = await call(client, "check_design", { file: "main.pym" });
    assert.equal(bad.findings.errors, 1);
    assert.equal(bad.results.counterexamples, 0);
    assert.ok(bad.results.structuralFindings > 0);
    const details = await call(client, "read_run", {
      runId: bad.runId,
      section: "findings",
    });
    assert.equal(details.items[0].code, "T002");
    assert.ok(details.items[0].related.length);
    assert.match(details.items[0].why, /caller/i);
    assert.equal(details.items[0].location.line, 1);
    assert.ok(details.items[0].relatedLocations[0].excerpt.includes("op save"));
    const properties = await call(client, "read_run", {
      runId: bad.runId,
      section: "properties",
    });
    const invalid = properties.items.find((p) =>
      p.diagnostics.some((d) => d.code === "T002"),
    );
    assert.ok(invalid.propertyId.startsWith("main.pym#"));
    assert.equal(invalid.diagnostics[0].span.file, "main.pym");
    assert.equal(invalid.diagnostics[0].related[0].file, "main.pym");
    const selected = await call(client, "read_run", {
      runId: bad.runId,
      section: "properties",
      propertyId: invalid.propertyId,
    });
    assert.equal(selected.total, 1);
    assert.equal(selected.items[0].propertyId, invalid.propertyId);
    const partial = await call(client, "emit_scaffold", {
      runId: bad.runId,
      mode: "contracts",
    });
    assert.equal(partial.baseline.complete, false);
    assert.match(partial.baseline.meaning, /Partial contract baseline/);
    assert.ok(
      partial.symbols.every(
        (symbol) =>
          symbol.symbolId.startsWith("main.pym#") &&
          symbol.span.file === "main.pym",
      ),
    );
    const good = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": original.replace("save(true)", "save(1)") },
    });
    assert.equal(good.findings.errors, 0);
    assert.notEqual(good.snapshotId, bad.snapshotId);
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
    assert.equal(
      (await call(client, "read_run", { runId: bad.runId })).findings.errors,
      1,
    );
  }));
test("MCP refuses escaped paths and invalid tool arguments", async () =>
  fixture(async (client, root) => {
    await symlink("/tmp", join(root, "escape"));
    for (const file of ["../outside.pym", "escape/outside.pym"]) {
      const r = await client.callTool({
        name: "check_design",
        arguments: { file },
      });
      assert.equal(r.isError, true);
    }
    const invalid = await client.callTool({
      name: "check_design",
      arguments: { file: 12 },
    });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /invalid|validation|string/i);
  }));

test("modern MCP discovery supports scaffolds and preserves incomplete independent results", async () =>
  fixture(async (client, root) => {
    const source =
      'flow unfinished() -> Unit { unknown "payment decision"; } rule ready(n: Nat) -> Bool = n > 0;';
    const run = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": source },
    });
    assert.ok(run.results.unresolved > 0);
    const properties = await call(client, "read_run", {
      runId: run.runId,
      section: "properties",
    });
    assert.ok(
      properties.items.some(
        (p) =>
          p.propertyId.endsWith("#ready/types-effects-outcomes") &&
          p.outcome === "established",
      ),
    );
    assert.ok(
      properties.items.some(
        (p) =>
          p.propertyId.endsWith("#unfinished/types-effects-outcomes") &&
          p.completion === "incomplete",
      ),
    );
    const contractOnly = await call(client, "emit_scaffold", {
      runId: run.runId,
      mode: "contracts",
    });
    assert.equal(contractOnly.implementation, "declarations");
    assert.match(contractOnly.source, /interface PymthegContracts/);
    assert.equal(
      contractOnly.contractManifest.schema,
      "pymtheg.contract-manifest/v1",
    );
    const generated = await call(client, "emit_scaffold", { runId: run.runId });
    assert.equal(generated.implementation, "fail-fast");
    assert.match(generated.source, /function ready/);
    assert.ok(!generated.omitted.some((d) => d.name === "unfinished"));
    assert.match(generated.source, /function unfinished/);
    assert.match(generated.source, /Open decision/);
  }, true));
test("old MCP results remain source-scoped after a file edit", async () =>
  fixture(async (client, root, source) => {
    const run = await call(client, "check_design", { file: "main.pym" });
    await writeFile(join(root, "main.pym"), source + "\n// external edit");
    const reread = await call(client, "read_run", { runId: run.runId });
    assert.equal(reread.snapshotId, run.snapshotId);
    assert.deepEqual(reread.session.staleFiles, ["main.pym"]);
  }));
test("MCP cancellation reaches the production CPU-worker coordinator", async () => {
  const { InMemoryTransport } = await import("@modelcontextprotocol/server");
  const { createAgentServer } = await import("../dist/mcp/server.js");
  const { AgentWorkspace } = await import("../dist/mcp/workspace.js");
  const { analyseInWorker } = await import("../dist/cli/coordinator.js");
  const { pathToFileURL } = await import("node:url");
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-cancel-"));
  await writeFile(join(root, "main.pym"), "flow main() -> Unit {}");
  const worker = join(root, "busy.mjs");
  await writeFile(
    worker,
    `import {parentPort} from 'node:worker_threads';parentPort.postMessage({kind:'snapshot',value:{id:'controlled',sources:[],diagnostics:[],measurements:{bytes:0,files:0,tokens:0,parses:0}}});while(true){}`,
  );
  let observed = false;
  let resolveObserved;
  const cancelled = new Promise((r) => (resolveObserved = r));
  const workspace = new AgentWorkspace(root, (options) => {
    options.signal.addEventListener(
      "abort",
      () => {
        observed = true;
        resolveObserved();
      },
      { once: true },
    );
    return analyseInWorker({ ...options, workerURL: pathToFileURL(worker) });
  });
  const server = createAgentServer(workspace),
    client = new Client({ name: "cancel-test", version: "1" }),
    [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left);
    await client.connect(right);
    const controller = new AbortController();
    let ready = false;
    const request = client.callTool(
      { name: "check_design", arguments: { file: "main.pym" } },
      {
        signal: controller.signal,
        onprogress: () => {
          ready = true;
          controller.abort();
        },
      },
    );
    await assert.rejects(request);
    await cancelled;
    await workspace.waitForIdle();
    assert.equal(ready, true);
    assert.equal(observed, true);
    const project = await call(client, "project_info");
    assert.equal(project.runIds.length, 1);
    const result = await call(client, "read_run", { runId: project.runIds[0] });
    assert.equal(result.session.state, "Cancelled");
    assert.equal(result.exitStatus, 130);
  } finally {
    await workspace.close();
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("MCP verify needs no installed integration and still reports an unsupported design slice", async () =>
  fixture(async (client) => {
    const source = "flow main() -> Unit { assert true; }";
    const verified = await call(client, "explore_behaviour", {
      file: "main.pym",
      buffers: { "main.pym": source },
      entry: "main",
      method: "verify",
    });
    assert.equal(verified.exitStatus, 0);
    const retained = await call(client, "read_run", {
      runId: verified.runId,
      section: "properties",
    });
    const behaviour = retained.items.filter(
      (p) => p.analysisKind === "behaviour",
    );
    assert.ok(behaviour.length > 0);
    assert.ok(
      behaviour.every(
        (p) =>
          p.completion === "complete" &&
          p.outcome === "no_counterexample" &&
          p.method === "finite_model_check",
      ),
      JSON.stringify(retained.items),
    );
    const unsupported = await call(client, "explore_behaviour", {
      file: "main.pym",
      buffers: {
        "main.pym":
          "op send() -> Unit effects(remote.Queue); flow main() -> Unit effects(remote.Queue) { call send(); assert true; }",
      },
      entry: "main",
      method: "simulate",
    });
    assert.equal(unsupported.exitStatus, 2);
    assert.ok(unsupported.results.unresolved > 0);
  }));

test("MCP emits all installed language targets without allowing executable plugin paths", () =>
  fixture(async (client, root, original) => {
    const checked = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": original.replace("save(true)", "save(1)") },
    });
    for (const target of ["typescript", "rust", "go"]) {
      const output = await call(client, "emit_scaffold", {
        runId: checked.runId,
        target,
      });
      assert.equal(output.format, target);
      assert.equal(output.implementation, "fail-fast");
      assert.ok(output.source.length);
    }
    const refused = await client.callTool({
      name: "emit_scaffold",
      arguments: {
        runId: checked.runId,
        target: "go",
        plugin: "/tmp/unsafe.mjs",
      },
    });
    assert.equal(refused.isError, true);
  }));

test("agents can start from a recipe and see an actual returned value", async () =>
  fixture(async (client) => {
    const list = await call(client, "design_recipe");
    assert.ok(list.recipes.some((r) => r.id === "retry"));
    const recipe = await call(client, "design_recipe", {
      action: "generate",
      recipe: "decision",
    });
    const checked = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": recipe.source },
    });
    const trial = await call(client, "try_inputs", {
      runId: checked.runId,
      entry: "main",
      inputs: { age: "17" },
    });
    assert.equal(trial.result.completion, "complete");
    assert.equal(trial.result.output, false);
  }));
test("agents can inspect retained architecture and page its complete documents", async () =>
  fixture(async (client, root) => {
    const { ArchitectureStore } = await import("../dist/architecture/store.js");
    const store = await ArchitectureStore.open(root);
    const text = JSON.stringify({
      schema: "pymtheg.plan/v1",
      items: [
        {
          id: "durable",
          kind: "requirement",
          title: "Retain acknowledged writes",
          owner: "store",
          status: "proposed",
          detail: "Acknowledge after durable storage",
          acceptance: "Read after restart",
          evidence: "",
          evidenceRevision: "",
          links: [],
        },
      ],
    });
    const revision = store.save("Design", "test", [
      { path: "plan.json", text },
    ]).id;
    store.close();
    const summary = await call(client, "read_architecture");
    assert.equal(summary.revision, revision);
    const records = await call(client, "read_architecture", {
      section: "records",
      owner: "store",
    });
    assert.ok(records.items.some((e) => e.id === "plan:durable"));
    const document = await call(client, "read_architecture", {
      section: "document",
      path: "plan.json",
    });
    assert.equal(document.text, text);
    assert.match(document.boundary, /not semantic verification/);
  }));

test("agents can check new virtual source files and imports without creating files or folders", () =>
  fixture(async (client, root) => {
    const report = await call(client, "check_design", {
      file: "planned/main.pym",
      checkScope: "entry",
      buffers: {
        "planned/main.pym":
          'import "./types.pym"; flow decide(input: Input) -> Bool { return input.allowed; }',
        "planned/types.pym": "type Input = { allowed: Bool };",
      },
    });
    assert.equal(report.findings.errors, 0);
    assert.ok(report.usedUnsavedBuffers.includes("planned/main.pym"));
    const tried = await call(client, "try_inputs", {
      runId: report.runId,
      entry: "decide",
      inputs: { input: { allowed: true } },
    });
    assert.equal(tried.result.output, true);
    await assert.rejects(readFile(join(root, "planned", "main.pym")), {
      code: "ENOENT",
    });
    const missing = await client.callTool({
      name: "check_design",
      arguments: {
        file: "not-supplied.pym",
        buffers: { "other.pym": "flow other() -> Unit {}" },
      },
    });
    assert.equal(missing.isError, true);
  }));

test("agents preview standalone shape changes, see affected callers and retain source", () =>
  fixture(async (client, root, original) => {
    const main =
      'import "types.pym"; flow create() -> Request { return Request { id: 1 }; }';
    const checked = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": main, "types.pym": "type Request = { id: Nat };" },
    });
    assert.equal(checked.findings.errors, 0);
    const type = await call(client, "design_interface", {
      action: "type",
      runId: checked.runId,
      symbolId: "types.pym#Request",
    });
    const preview = await call(client, "design_interface", {
      action: "preview_type",
      runId: checked.runId,
      symbolId: type.symbolId,
      sourceHash: type.sourceHash,
      edit: {
        ...type.definition,
        fields: [...type.definition.fields, { name: "label", type: "String" }],
      },
    });
    assert.equal(preview.files[0].file, "types.pym");
    assert.ok(preview.affected.some((entry) => entry.name === "create"));
    const changed = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": main, "types.pym": preview.text },
    });
    assert.ok(changed.findings.errors > 0);
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
    await assert.rejects(readFile(join(root, "types.pym")), { code: "ENOENT" });
  }));

test("agents can emit only the extra targets explicitly pinned at launch", () =>
  fixture(
    async (client) => {
      const info = await call(client, "project_info");
      assert.ok(info.capabilities.scaffolds.includes("javascript"));
      const checked = await call(client, "check_design", {
        file: "main.pym",
        buffers: { "main.pym": "flow main() -> Bool { return true; }" },
      });
      const emitted = await call(client, "emit_scaffold", {
        runId: checked.runId,
        target: "javascript",
      });
      assert.equal(emitted.implementation, "fail-fast");
      assert.match(emitted.source, /throw new Error/);
      const empty = await call(client, "emit_scaffold", {
        runId: checked.runId,
        target: "javascript",
        body: "empty",
      });
      assert.equal(empty.implementation, "empty");
      const denied = await client.callTool({
        name: "emit_scaffold",
        arguments: {
          runId: checked.runId,
          target: "arbitrary",
          plugin: "/tmp/other.mjs",
        },
      });
      assert.equal(denied.isError, true);
    },
    false,
    ["javascript=" + resolve("examples/plugins/javascript.mjs")],
  ));

test("MCP builds rich interfaces and rejects malformed type shapes without saving", async () =>
  fixture(async (client) => {
    const recipe = await call(client, "design_recipe", {
      action: "generate",
      recipe: "component",
      options: {
        name: "quote",
        inputs: [
          {
            name: "items",
            type: {
              kind: "list",
              element: {
                kind: "record",
                name: "Item",
                fields: [{ name: "sku", type: "String" }],
              },
            },
          },
        ],
        output: {
          kind: "result",
          ok: "Nat",
          error: {
            kind: "choice",
            name: "Failure",
            variants: [{ name: "Unavailable" }],
          },
        },
        effects: [{ kind: "remote", target: "Pricing" }],
      },
    });
    assert.match(recipe.source, /items: List<Item>/);
    assert.match(recipe.source, /Result<Nat, Failure>/);
    assert.match(recipe.source, /effects\(remote.Pricing\)/);
    const checked = await call(client, "check_design", {
      file: "new-quote.pym",
      checkScope: "entry",
      buffers: { "new-quote.pym": recipe.source },
    });
    assert.equal(checked.findings.errors, 0);
    const malformed = await client.callTool({
      name: "design_recipe",
      arguments: {
        action: "generate",
        recipe: "component",
        options: { output: { kind: "list", element: 5 } },
      },
    });
    assert.equal(malformed.isError, true);
  }));

test("MCP reuses checked project types with explicit imports and previews body-preserving edits", async () =>
  fixture(async (client, root) => {
    const source =
      "type Customer = {name:String};\nflow quote(customer: Customer) -> Bool { return true; }";
    const checked = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": source },
    });
    const types = await call(client, "design_interface", {
      action: "types",
      runId: checked.runId,
    });
    assert.equal(types.types[0].name, "Customer");
    const generated = await call(client, "design_recipe", {
      action: "generate",
      recipe: "component",
      contextRunId: checked.runId,
      file: "new.pym",
      options: {
        name: "newQuote",
        inputs: [
          {
            name: "customer",
            type: {
              kind: "named",
              name: "Customer",
              symbolId: types.types[0].symbolId,
            },
          },
        ],
        output: "Bool",
      },
    });
    assert.match(generated.source, /import "\.\/main.pym";/);
    assert.doesNotMatch(generated.source, /type Customer/);
    const verify = await call(client, "check_design", {
      file: "new.pym",
      buffers: { "main.pym": source, "new.pym": generated.source },
    });
    assert.equal(verify.findings.errors, 0);
    const d = await call(client, "design_interface", {
      action: "describe",
      runId: checked.runId,
      symbolId: join(root, "main.pym") + "#quote",
    });
    const preview = await call(client, "design_interface", {
      action: "preview",
      runId: checked.runId,
      symbolId: d.symbolId,
      sourceHash: d.sourceHash,
      edit: { ...d, inputs: [...d.inputs, { name: "urgent", type: "Bool" }] },
    });
    assert.match(preview.text, /urgent: Bool/);
    assert.match(preview.text, /return true;/);
    const updated = await call(client, "check_design", {
      file: "main.pym",
      buffers: { "main.pym": source.replace("return true;", "return false;") },
    });
    const resumed = await call(client, "design_interface", {
      action: "resume",
      runId: updated.runId,
      draft: {
        file: "main.pym",
        symbolId: d.symbolId,
        snapshotId: d.snapshotId,
        edit: { ...d, inputs: [...d.inputs, { name: "urgent", type: "Bool" }] },
        baseline: { signature: d, headerHash: d.headerHash, types: [] },
      },
    });
    assert.deepEqual(resumed.conflicts, []);
    const updatedPreview = await call(client, "design_interface", {
      action: "preview",
      runId: updated.runId,
      symbolId: d.symbolId,
      sourceHash: resumed.description.sourceHash,
      edit: resumed.draft.edit,
    });
    assert.match(updatedPreview.text, /return false;/);
    assert.match(updatedPreview.text, /urgent: Bool/);
    assert.equal(
      await readFile(join(root, "main.pym"), "utf8"),
      "op save(value: Nat) -> Unit; flow main() -> Unit { call save(true); }",
    );
  }));

test("MCP source reads refuse malformed UTF-8 without returning replacement text", async () =>
  fixture(async (client, root) => {
    const bytes = Buffer.concat([
      Buffer.from("// "),
      Buffer.from([0xc3, 0x28]),
      Buffer.from("\n"),
    ]);
    await writeFile(join(root, "main.pym"), bytes);
    const response = await client.callTool({
      name: "read_source",
      arguments: { file: "main.pym" },
    });
    assert.equal(response.isError, true, JSON.stringify(response));
    assert.match(JSON.stringify(response.content), /not valid UTF-8/);
    assert.deepEqual(await readFile(join(root, "main.pym")), bytes);
  }));

test("MCP pages a thousand types and callable IDs, then previews an edit with reverse callers", async () =>
  fixture(async (client, root) => {
    const source =
      Array.from(
        { length: 1000 },
        (_, i) => `type Item${i} = {value: Nat};`,
      ).join("\n") + "\nflow calculate(x: Item0) -> Nat {return x.value;}";
    await writeFile(join(root, "types.pym"), source);
    await writeFile(
      join(root, "consumer.pym"),
      'import "types.pym"; flow consumer(x: Item0) -> Nat { call calculate(x) as n; return n; }',
    );
    const checked = await call(client, "check_design", { file: "types.pym" });
    let offset = 0,
      ids = [];
    do {
      const page = await call(client, "design_interface", {
        action: "types",
        runId: checked.runId,
        offset,
        limit: 100,
      });
      assert.equal(page.total, 1000);
      assert.ok(page.types.length <= 100);
      assert.ok(Buffer.byteLength(JSON.stringify(page)) < 262144);
      ids.push(...page.types.map((t) => t.symbolId));
      offset = page.nextOffset;
    } while (offset !== null);
    assert.equal(new Set(ids).size, 1000);
    const creation = await call(client, "design_interface", {
      action: "creation",
      runId: checked.runId,
      offset: 975,
      limit: 25,
    });
    assert.equal(creation.total, 1000);
    assert.equal(creation.types.length, 25);
    assert.equal(creation.nextOffset, null);
    assert.equal(typeof creation.sourceHash, "string");
    const found = await call(client, "design_interface", {
      action: "symbols",
      runId: checked.runId,
      query: "calculate",
    });
    assert.equal(found.symbols.length, 1);
    const symbolId = found.symbols[0].symbolId;
    const description = await call(client, "design_interface", {
      action: "describe",
      runId: checked.runId,
      symbolId,
    });
    assert.equal(description.typeCount, 1000);
    assert.equal(description.types, undefined);
    const selected = await call(client, "design_interface", {
      action: "types",
      runId: checked.runId,
      query: "Item999",
    });
    assert.equal(selected.total, 1);
    const detail = await call(client, "design_interface", {
      action: "type",
      runId: checked.runId,
      symbolId: selected.types[0].symbolId,
    });
    assert.equal(detail.definition.fields[0].name, "value");
    const preview = await call(client, "design_interface", {
      action: "preview",
      runId: checked.runId,
      symbolId,
      sourceHash: description.sourceHash,
      edit: { ...description, name: "count" },
    });
    assert.ok(preview.affected.some((a) => a.name === "consumer"));
    const broken = await call(client, "check_design", {
      file: "types.pym",
      buffers: { "types.pym": preview.text },
    });
    const findings = await call(client, "read_run", {
      runId: broken.runId,
      section: "consumer_findings",
    });
    assert.ok(
      findings.items.some((f) => JSON.stringify(f).includes("consumer.pym")),
    );
    assert.equal(await readFile(join(root, "types.pym"), "utf8"), source);
  }));

test("interface search ignores workspace names and relative IDs survive opening the same design elsewhere", async () => {
  const ids = [];
  for (let i = 0; i < 2; i++)
    await fixture(async (client, root) => {
      await writeFile(
        join(root, "main.pym"),
        "type Order = {id: Nat}; op ship(order: Order) -> Unit;",
      );
      const checked = await call(client, "check_design", { file: "main.pym" });
      const noise = await call(client, "design_interface", {
        action: "types",
        runId: checked.runId,
        query: root.split("/").at(-1),
      });
      assert.equal(noise.total, 0);
      const selected = await call(client, "design_interface", {
        action: "types",
        runId: checked.runId,
        query: "Order",
      });
      assert.equal(selected.total, 1);
      assert.equal(selected.types[0].symbolId, "main.pym#Order");
      assert.equal(selected.types[0].file, "main.pym");
      const symbols = await call(client, "design_interface", {
        action: "symbols",
        runId: checked.runId,
        query: "ship",
      });
      ids.push(symbols.symbols[0].symbolId);
      const described = await call(client, "design_interface", {
        action: "describe",
        runId: checked.runId,
        symbolId: "main.pym#ship",
      });
      assert.equal(described.inputs[0].type.symbolId, "main.pym#Order");
      const preview = await call(client, "design_interface", {
        action: "preview",
        runId: checked.runId,
        symbolId: described.symbolId,
        sourceHash: described.sourceHash,
        edit: { ...described, name: "dispatch" },
      });
      assert.equal(preview.file, "main.pym");
      assert.match(preview.text, /op dispatch/);
    });
  assert.deepEqual(ids, ["main.pym#ship", "main.pym#ship"]);
});

test("agents page every concurrent withdrawal without downloading the whole review history", async () =>
  fixture(async (client, root) => {
    const { ArchitectureStore } = await import("../dist/architecture/store.js");
    const { mkdir } = await import("node:fs/promises");
    const peerRoot = join(root, ".peer");
    await mkdir(peerRoot);
    let store, peer;
    try {
      store = await ArchitectureStore.open(root);
      peer = await ArchitectureStore.open(peerRoot);
      store.save("Base", "test", [{ path: "decision.md", text: "base" }]);
      peer.importHistory(store.exportHistory());
      const current = store.save("Local", "test", [
        { path: "decision.md", text: "local" },
      ]);
      const branch = peer.save("Remote", "test", [
        { path: "decision.md", text: "remote" },
      ]);
      store.importHistory(peer.exportHistory());
      store.reviewBranch(branch.id, current.id, {
        reviewer: "Owner",
        reason: "initial review",
      });
      const archive = store.exportHistory();
      const acknowledgement = archive.revisions.find((r) => r.id === branch.id)
        .reviewRecords[0];
      store.withdrawBranchReview(acknowledgement.id, current.id, {
        reviewer: "Alice",
        reason: "Durability changed",
      });
      const remote = structuredClone(archive);
      remote.revisions.find(
        (r) => r.id === branch.id,
      ).reviewRecords[0].withdrawal = {
        reviewer: "Bob",
        reason: "Availability changed",
      };
      remote.revisions.find((r) => r.id === branch.id).reviewedAgainst = [];
      store.importHistory(remote);
      const reviews = await call(client, "read_architecture", {
        section: "branch_reviews",
        id: branch.id,
        limit: 1,
      });
      assert.equal(reviews.items[0].withdrawalCount, 2);
      assert.equal(reviews.items[0].additionalWithdrawals, undefined);
      const first = await call(client, "read_architecture", {
        section: "branch_withdrawals",
        id: acknowledgement.id,
        limit: 1,
      });
      assert.equal(first.total, 2);
      assert.equal(first.items.length, 1);
      assert.equal(first.nextOffset, 1);
      const second = await call(client, "read_architecture", {
        section: "branch_withdrawals",
        id: acknowledgement.id,
        limit: 1,
        offset: first.nextOffset,
      });
      assert.deepEqual(
        [...first.items, ...second.items].map((w) => w.reviewer).sort(),
        ["Alice", "Bob"],
      );
      assert.equal(second.nextOffset, null);
    } finally {
      peer?.close();
      store?.close();
    }
  }));

test("agents preview create-only declarations from checked source, including virtual files", () =>
  fixture(async (client, root, original) => {
    const checked = await call(client, "check_design", {
      file: "new.pym",
      buffers: { "new.pym": "flow main() -> Unit { return unit; }" },
    });
    const context = await call(client, "design_interface", {
      action: "creation",
      runId: checked.runId,
      file: "new.pym",
    });
    assert.equal(context.file, "new.pym");
    const preview = await call(client, "design_interface", {
      action: "create",
      runId: checked.runId,
      file: "new.pym",
      sourceHash: context.sourceHash,
      edit: {
        kind: "resource",
        name: "File",
        states: ["Open", "Closed"],
        initial: "Open",
        terminal: ["Closed"],
        transitions: [{ from: "Open", to: "Closed" }],
      },
    });
    assert.match(preview.text, /resource File/);
    assert.equal(preview.affectedComplete, false);
    const next = await call(client, "check_design", {
      file: "new.pym",
      buffers: { "new.pym": preview.text },
    });
    assert.equal(next.findings.errors, 0);
    await assert.rejects(readFile(join(root, "new.pym")), { code: "ENOENT" });
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), original);
  }));

test("agent findings include a replay-confirmed bad input and clear it after a guarded buffer-only fix", async () =>
  fixture(async (client, root) => {
    const source =
      "op charge(amount: Nat) -> Unit requires amount > 0; flow checkout(total: Nat) -> Unit { call charge(total); return unit; }";
    await writeFile(join(root, "main.pym"), source);
    const pending = await call(client, "check_design", { file: "main.pym" });
    const findings = await call(client, "read_run", {
      runId: pending.runId,
      section: "findings",
    });
    const review = findings.items.find((d) => d.code === "C004");
    assert.ok(review);
    assert.match(review.message, /source inputs.*total.*0.*replayed/);
    const properties = await call(client, "read_run", {
      runId: pending.runId,
      section: "properties",
    });
    const property = properties.items.find(
      (p) => p.witnessValidation === "source_replayed",
    );
    const example = property.witnessOrDerivation.examples[0];
    assert.equal(example.entry, "main.pym#checkout");
    const replay = await call(client, "try_inputs", {
      runId: pending.runId,
      entry: example.entry,
      inputs: example.inputs,
    });
    assert.equal(replay.result.completion, "violated");
    const fixed = await call(client, "check_design", {
      file: "main.pym",
      buffers: {
        "main.pym": source.replace(
          "call charge(total);",
          "if total == 0 { return unit; } call charge(total);",
        ),
      },
    });
    const clean = await call(client, "read_run", {
      runId: fixed.runId,
      section: "findings",
    });
    assert.equal(
      clean.items.some((d) => d.code === "C004"),
      false,
    );
    const retained = await call(client, "read_run", {
      runId: pending.runId,
      section: "findings",
    });
    assert.ok(retained.items.some((d) => d.code === "C004"));
    assert.equal(await readFile(join(root, "main.pym"), "utf8"), source);
  }));
