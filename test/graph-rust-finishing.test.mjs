// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { executeGraph } from "../dist/graph/commands.js";
import { SqliteGraphStore } from "../dist/graph/store.js";

async function project(t, files) {
  const root = await mkdtemp(join(tmpdir(), "pym-rust-finishing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  return root;
}

const cargo = '[package]\nname="app"\nedition="2021"\n';
const cli = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));

function graphCli(root, ...args) {
  const result = spawnSync(
    process.execPath,
    [cli, "graph", ...args, "--json", "--root", root],
    { encoding: "utf8" },
  );
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  const response = JSON.parse(result.stdout);
  assert.equal(result.status, response.exitCode, result.stderr);
  return response;
}

async function graph(t, files) {
  const root = await project(t, files);
  const response = await executeGraph({ command: "index", root });
  assert.deepEqual(response.sync.report.analysisErrors, []);
  assert.deepEqual(response.sync.report.resolutionErrors, []);
  const store = new SqliteGraphStore(
    join(root, ".pymtheg", "rebuildable", "graph.sqlite"),
    undefined,
    { readOnly: true },
  );
  t.after(() => store.close());
  return store;
}

test("overlapping globs stay bounded during derive-helper and call lookup", async (t) => {
  const modules = [
    "mod a0 { pub use outside::*; }",
    "mod b0 { pub use outside::*; }",
  ];
  for (let level = 1; level <= 22; level++) {
    const uses = `pub use crate::a${level - 1}::*; pub use crate::b${level - 1}::*;`;
    modules.push(`mod a${level} { ${uses} }\nmod b${level} { ${uses} }`);
  }
  const store = await graph(t, {
    "Cargo.toml": cargo + '[dependencies]\noutside="1"\nthiserror="2"\n',
    "src/lib.rs": [
      ...modules,
      "use a22::*;",
      '#[derive(Debug, thiserror::Error)] #[error("could not convert message")]',
      "pub struct FromMessageError;",
      "fn local() {}",
      "pub fn entry() { unavailable(); local(); }",
    ].join("\n"),
  });
  const calls = store.links().filter((link) => link.kind === "calls");
  assert.deepEqual(
    calls.map((call) => [call.targetName, call.resolution]).sort(),
    [
      ["local", "resolved"],
      ["unavailable", "unresolved"],
    ],
  );
  const local = calls.find((call) => call.targetName === "local");
  assert.equal(store.findSymbols({ name: "local" })[0].id, local.targetId);
  assert.ok(
    calls.find((call) => call.targetName === "unavailable").data.uncertainty,
  );
});

test("serde's alternate internals path with an uncaptured arm stays unproved", async (t) => {
  // The two cfg_attr paths and glob re-export are from serde_derive_internals/lib.rs:50–54.
  const store = await graph(t, {
    "serde_derive_internals/Cargo.toml": cargo + '[lib]\npath="lib.rs"\n',
    "serde_derive_internals/lib.rs": `
#[cfg_attr(serde_build_from_git, path = "../serde_derive/src/internals/mod.rs")]
#[cfg_attr(not(serde_build_from_git), path = "src/mod.rs")]
mod internals;
pub use internals::*;
pub fn entry() { helper(); crate::local(); }
fn local() {}
`,
    "serde_derive/src/internals/mod.rs": "pub fn helper() {}\n",
  });
  const calls = store.links().filter((link) => link.kind === "calls");
  assert.deepEqual(
    calls.map((call) => [call.targetName, call.resolution]).sort(),
    [
      ["crate::local", "resolved"],
      ["helper", "unresolved"],
    ],
  );
  assert.equal(
    calls.find((call) => call.targetName === "helper").targetId,
    null,
  );
});

test("a path beyond the existing import depth boundary has an explicit reason", async (t) => {
  const aliases = Array.from(
    { length: 140 },
    (_, i) => `type Link${i + 1} = Link${i};`,
  );
  const store = await graph(t, {
    "Cargo.toml": cargo,
    "src/lib.rs": [
      "enum Link0 { Variant }",
      ...aliases,
      "pub fn entry() { let _ = Link140::Variant; }",
    ].join("\n"),
  });
  const value = store
    .links()
    .find((link) => link.targetName === "Link140::Variant");
  assert.equal(value.resolution, "unresolved");
  assert.match(value.data.uncertainty, /import-lookup-depth-unverified/);
});

for (const [phase, signal] of [
  ["analyze", "SIGINT"],
  ["analyze", "SIGTERM"],
  ["resolve", "SIGINT"],
  ["resolve", "SIGTERM"],
]) {
  test(`graph index handles ${signal} during a CPU-bound Rust ${phase} worker`, async (t) => {
    const file = "src/lib.rs";
    const sources = {
      "Cargo.toml": cargo,
      [file]: "fn helper() {}\npub fn entry() { helper(); }\n",
    };
    const root = await project(t, {
      ...sources,
      [file]: "fn previous() {}\npub fn entry() { previous(); }\n",
    });
    assert.equal(graphCli(root, "index").sync.complete, true);
    await writeFile(join(root, file), sources[file]);

    const preload = new URL(
      "./fixtures/graph-rust/busy-phase.mjs",
      import.meta.url,
    );
    const child = spawn(
      process.execPath,
      [
        "--import",
        preload.href,
        cli,
        "graph",
        "index",
        "--json",
        "--root",
        root,
      ],
      {
        env: { ...process.env, PYM_TEST_BUSY_RUST_PHASE: phase },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    t.after(() => child.kill("SIGKILL"));
    let ready = false;
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (text) => {
      stdout += text;
    });
    const stderr = createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      if (line !== "rust cancellation fixture ready") return;
      ready = true;
      child.kill(signal);
    });
    assert.deepEqual(await once(child, "close"), [130, null]);
    assert.ok(ready);
    assert.equal(JSON.parse(stdout).exitCode, 130);

    const status = graphCli(root, "status");
    assert.equal(status.indexExists, true);
    assert.equal(status.sync.complete, false);
    assert.ok(
      status.warnings.some((warning) => warning.code === "index-incomplete"),
    );
    const partial = graphCli(root, "file", file, "--no-sync");
    // C-36: an incremental module's edited records are written after its
    // analysis, so a run stopped during analysis has written no records: the
    // stored rows are still the previous complete graph's. C-38A: the run
    // claims the store before that analysis, so another run that begins
    // meanwhile takes over; a run stopped during analysis therefore leaves
    // its unfinished mark too, as one stopped later does.
    assert.equal(partial.status, "incomplete");
    assert.equal(partial.exitCode, 2);
    assert.equal(partial.sync.complete, false);
    assert.ok(
      partial.warnings.some((warning) => warning.code === "index-incomplete"),
    );

    const retried = graphCli(root, "file", file);
    assert.equal(retried.status, "ok");
    assert.equal(retried.sync.complete, true);
    assert.equal(retried.sync.mode, "updated");
    assert.equal(retried.truncated, false);
    assert.equal(
      retried.data.links.find((link) => link.kind === "calls").target.name,
      "helper",
    );

    // Use the same project identity so the query can compare IDs as stored.
    const database = ".pymtheg/rebuildable/graph.sqlite";
    const recovered = new SqliteGraphStore(join(root, database), undefined, {
      readOnly: true,
    });
    const projectId = recovered.projectId;
    recovered.close();
    const cleanRoot = await project(t, sources);
    const cleanPath = join(cleanRoot, database);
    await mkdir(dirname(cleanPath), { recursive: true });
    new SqliteGraphStore(cleanPath, projectId).close();
    assert.equal(graphCli(cleanRoot, "index").sync.complete, true);
    const clean = graphCli(cleanRoot, "file", file, "--no-sync");
    assert.equal(clean.sync.complete, true);
    assert.deepEqual(retried.counts, clean.counts);
    assert.deepEqual(retried.data, clean.data);
  });
}
