// Real private tarball install; never publishes or changes global packages.
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
const root = await mkdtemp(join(tmpdir(), "pym-current-package-"));
let client;
function command(bin, args, cwd = process.cwd()) {
  const result = spawnSync(bin, args, { cwd, encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}
try {
  const packedOutput = JSON.parse(
    command("npm", [
      "pack",
      "--ignore-scripts",
      "--json",
      "--pack-destination",
      root,
    ]),
  );
  const packed = Array.isArray(packedOutput)
    ? packedOutput[0]
    : Object.values(packedOutput)[0];
  assert.equal(typeof packed?.filename, "string");
  const installation = join(root, "install");
  await mkdir(installation);
  await writeFile(
    join(installation, "package.json"),
    JSON.stringify({ private: true }),
  );
  command(
    "npm",
    [
      "install",
      ...(process.argv.includes("--allow-network")
        ? ["--prefer-offline", "--fetch-retries=0", "--fetch-timeout=15000"]
        : ["--offline"]),
      "--ignore-scripts",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      join(root, packed.filename),
    ],
    installation,
  );
  const packageRoot = join(installation, "node_modules", "pymtheg"),
    entry = join(packageRoot, "dist", "cli", "main.js");
  const notices = await readFile(
    join(packageRoot, "dist-web", "third-party-notices.txt"),
    "utf8",
  );
  assert.match(notices, /react@19\.2\.0/);
  assert.match(notices, /react-markdown@10\.1\.0/);
  const report = JSON.parse(
    command(
      process.execPath,
      [
        entry,
        "check",
        join(packageRoot, "examples", "mvp", "library.pym"),
        "--format",
        "json",
      ],
      installation,
    ),
  );
  assert.ok(report.results.length);
  assert.equal(report.diagnostics.length, 0);
  const plugin = JSON.parse(
    command(
      process.execPath,
      [
        entry,
        "scaffold",
        join(packageRoot, "examples", "mvp", "library.pym"),
        "--target",
        "javascript",
        "--plugin",
        join(packageRoot, "examples", "plugins", "javascript.mjs"),
        "--format",
        "json",
      ],
      installation,
    ),
  );
  assert.match(plugin.source, /function/);
  const project = join(root, "design");
  await mkdir(project);
  const initialized = JSON.parse(
    command(
      process.execPath,
      [
        entry,
        "init",
        project,
        "--name",
        "Installed project",
        "--format",
        "json",
      ],
      installation,
    ),
  );
  assert.equal(initialized.workspace.name, "Installed project");
  await writeFile(
    join(project, "main.pym"),
    "flow main(flag: Bool) -> Unit { assert flag; }",
  );
  const { ArchitectureStore } = await import(
    pathToFileURL(join(packageRoot, "dist", "architecture", "store.js")).href
  );
  const store = await ArchitectureStore.open(project);
  const document = {
    path: "plan.json",
    text: JSON.stringify({
      schema: "pymtheg.plan/v1",
      items: [
        {
          id: "durability",
          title: "Keep accepted writes",
          kind: "requirement",
          owner: "storage",
          status: "proposed",
          detail: "Acknowledge only durable data",
          acceptance: "Read after restart",
          evidence: "",
          evidenceRevision: "",
          links: [],
        },
      ],
    }),
  };
  store.save("Packaged plan", "installed-package", [document]);
  store.close();
  client = new Client({ name: "current-package-smoke", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      entry,
      "mcp",
      project,
      "--plugin",
      "javascript=" +
        join(packageRoot, "examples", "plugins", "javascript.mjs"),
    ],
    stderr: "pipe",
  });
  await client.connect(transport);
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, undefined, JSON.stringify(r));
    return r.structuredContent ?? JSON.parse(r.content[0].text);
  };
  const info = await call("project_info");
  assert.equal(info.tools, undefined);
  assert.equal(info.workspace.id, initialized.workspace.id);
  const guide = await client.readResource({ uri: "pymtheg://language/guide" });
  assert.match(guide.contents[0].text, /design_recipe/);
  const architecture = await call("read_architecture");
  assert.equal(architecture.measurements.documents, 0);
  assert.equal(architecture.measurements.storedDocuments, 1);
  assert.equal(
    (
      await call("read_architecture", {
        section: "document",
        path: "plan.json",
      })
    ).text,
    document.text,
  );
  const recipe = await call("design_recipe", {
    action: "generate",
    recipe: "decision",
  });
  const checked = await call("check_design", {
    file: "main.pym",
    buffers: { "main.pym": recipe.source },
  });
  const creation = await call("design_interface", {
    action: "creation",
    runId: checked.runId,
    file: "main.pym",
  });
  const created = await call("design_interface", {
    action: "create",
    runId: checked.runId,
    file: "main.pym",
    sourceHash: creation.sourceHash,
    edit: {
      kind: "type",
      definition: {
        kind: "record",
        name: "PackageRequest",
        fields: [{ name: "id", type: "Nat" }],
      },
    },
  });
  assert.match(created.text, /type PackageRequest =/);
  assert.equal(created.affectedComplete, false);

  const operationForm = await call("design_interface", {
    action: "creation",
    runId: checked.runId,
    file: "main.pym",
    declarationKind: "operation",
  });
  Object.assign(operationForm.template.edit, {
    signature: {
      name: "packagedOperation",
      inputs: [{ name: "amount", type: "Nat" }],
      output: "Nat",
      effects: [],
    },
    requires: ["amount > 9007199254740993123456789"],
    ensures: ["result >= amount"],
  });
  const operationPreview = await call("design_interface", {
    action: "create",
    runId: checked.runId,
    file: "main.pym",
    sourceHash: operationForm.sourceHash,
    edit: operationForm.template.edit,
  });
  assert.ok(
    operationPreview.notices.some((notice) =>
      notice.includes("guarantees are assumptions"),
    ),
  );
  const operationFile = join(root, "operation-rules.pym");
  await writeFile(operationFile, operationPreview.text);
  const operationText = command(
    process.execPath,
    [entry, "check", operationFile],
    installation,
  );
  assert.match(operationText, /9007199254740993123456790/);
  assert.match(operationText, /packagedOperation\/feasibility: established/);

  const eventForm = await call("design_interface", {
    action: "creation",
    runId: checked.runId,
    file: "main.pym",
    declarationKind: "machine",
  });
  assert.equal(eventForm.template.schema, "pymtheg.declaration-template/v1");
  eventForm.template.edit.name = "PackagedEvents";
  eventForm.template.edit.events.push({
    name: "advance",
    guard: "",
    updates: [],
  });
  const eventPreview = await call("design_interface", {
    action: "create",
    runId: checked.runId,
    file: "main.pym",
    sourceHash: eventForm.sourceHash,
    edit: eventForm.template.edit,
  });
  assert.match(eventPreview.text, /machine PackagedEvents/);
  assert.match(
    eventPreview.text,
    /unknown "When advance may happen is not decided"/,
  );
  assert.ok(eventPreview.notices.some((n) => n.includes("No safety rules")));

  assert.equal(
    (
      await call("try_inputs", {
        runId: checked.runId,
        entry: "main",
        inputs: { age: "17" },
      })
    ).result.output,
    false,
  );
  for (const target of ["typescript", "rust", "go", "javascript"]) {
    const output = await call("emit_scaffold", {
      runId: checked.runId,
      target,
    });
    assert.match(output.source, /main/);
    assert.match(output.source, /Not implemented/);
    assert.equal(output.implementation, "fail-fast");
    const empty = await call("emit_scaffold", {
      runId: checked.runId,
      target,
      body: "empty",
    });
    assert.equal(empty.implementation, "empty");
    assert.doesNotMatch(empty.source, /Not implemented/);
    if (target !== "javascript") {
      const compilerInput = await call("emit_implementation_check", {
        runId: checked.runId,
        target,
        ...(target !== "go"
          ? {
              contractsModule:
                target === "rust" ? "crate::contracts" : "./contracts",
            }
          : {}),
        ...(target === "typescript"
          ? { implementationModule: "./implementation" }
          : {}),
        implementationType:
          target === "rust"
            ? "crate::Implementation"
            : target === "go"
              ? "*Implementation"
              : "Implementation",
      });
      assert.equal(compilerInput.guarantee, "compiler-input-only");
      assert.match(compilerInput.source, /Implementation/);
    }
  }
  const explored = await call("explore_behaviour", {
    file: "main.pym",
    entry: "main",
    method: "simulate",
    maxSteps: 6,
    maxSamples: 100,
  });
  assert.ok(explored.results.counterexamples > 0);
  const promises = await call("check_design", {
    file: "main.pym",
    buffers: {
      "main.pym":
        "op fetch() -> Unit effects(remote.Store) cost remote_calls exact 1 stable atomic; flow main() -> Bool effects(remote.Store) { call fetch(); return true; }",
    },
  });
  const promiseOutput = await call("emit_scaffold", {
    runId: promises.runId,
    target: "typescript",
  });
  assert.match(promiseOutput.source, /cost remote_calls exact: 1/);
  assert.match(promiseOutput.source, /Stable: declared/);
  assert.match(promiseOutput.source, /Atomic: declared/);
  const assumedTrial = await call("try_inputs", {
    runId: promises.runId,
    entry: "main",
    inputs: {},
  });
  assert.equal(assumedTrial.result.output, true);
  assert.ok(
    assumedTrial.result.assumptions.some(
      (value) =>
        value.includes("environment contracts") && value.includes("atomic"),
    ),
  );
  const broken = join(root, "broken.pym");
  await writeFile(broken, "flow broken(input: Nat -> Bool {");
  const partial = spawnSync(
    process.execPath,
    [entry, "scaffold", broken, "--format", "json"],
    { encoding: "utf8", cwd: installation },
  );
  assert.equal(partial.status, 2, partial.stderr);
  const partialOutput = JSON.parse(partial.stdout);
  assert.equal(partialOutput.omitted[0].name, "broken.pym");
  assert.equal(partialOutput.contractManifest.omitted[0].name, "broken.pym");
  await writeFile(
    join(project, "observed.ts"),
    "export function observed(): boolean { return true; }",
  );
  const observed = JSON.parse(
    command(
      process.execPath,
      [entry, "observe", "observed.ts", "--root", project, "--format", "json"],
      installation,
    ),
  );
  assert.equal(observed.coverage.declarations, "complete");
  assert.equal(
    observed.nodes.find((node) => node.name === "observed").body,
    "present",
  );
  const retained = JSON.parse(
    command(
      process.execPath,
      [
        entry,
        "observe",
        "observed.ts",
        "--root",
        project,
        "--retain",
        "--label",
        "Packaged code",
        "--format",
        "json",
      ],
      installation,
    ),
  );
  assert.equal(retained.snapshotId, observed.snapshotId);
  const versions = await call("read_implementation", {});
  assert.ok(versions.observations.some((v) => v.label === "Packaged code"));
  const codeGraph = await call("read_implementation", {
    section: "graph",
    mode: "existing",
    query: "observed",
  });
  assert.equal(codeGraph.items[0].name, "observed");
  console.log(
    "Private installed tarball: CLI check, shipped JavaScript plugin, hoisted Quint, architecture reads, workflow resource, recipe/input trial, all three built-ins, implementation-check generation, registered JavaScript target, real source counterexample, preserved contract/trial assumptions, portable incomplete output and real code observation passed.",
  );
} finally {
  await client?.close();
  await rm(root, { recursive: true, force: true });
}
