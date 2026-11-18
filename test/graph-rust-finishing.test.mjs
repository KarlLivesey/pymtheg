// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
    [["local", "resolved"], ["unavailable", "unresolved"]],
  );
  const local = calls.find((call) => call.targetName === "local");
  assert.equal(store.findSymbols({ name: "local" })[0].id, local.targetId);
  assert.ok(calls.find((call) => call.targetName === "unavailable").data.uncertainty);
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
    [["crate::local", "resolved"], ["helper", "unresolved"]],
  );
  assert.equal(calls.find((call) => call.targetName === "helper").targetId, null);
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
  ["resolve", "SIGTERM"],
]) {
  test(`graph index handles ${signal} during a CPU-bound Rust ${phase} worker`, async (t) => {
    const root = await project(t, { "Cargo.toml": cargo, "src/lib.rs": "pub fn entry() {}" });
    const cli = fileURLToPath(new URL("../dist/cli/main.js", import.meta.url));
    const preload = new URL("./fixtures/graph-rust/busy-phase.mjs", import.meta.url);
    const child = spawn(process.execPath, [
      "--import", preload.href, cli, "graph", "index", "--json", "--root", root,
    ], {
      env: { ...process.env, PYM_TEST_BUSY_RUST_PHASE: phase },
      stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(() => child.kill("SIGKILL"));
    let ready = false;
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (text) => { stdout += text; });
    const stderr = createInterface({ input: child.stderr });
    stderr.on("line", (line) => {
      if (line !== "rust cancellation fixture ready") return;
      ready = true;
      child.kill(signal);
    });
    assert.deepEqual(await once(child, "close"), [130, null]);
    assert.ok(ready);
    assert.equal(JSON.parse(stdout).exitCode, 130);
    const retried = await executeGraph({ command: "index", root });
    assert.equal(retried.status, "ok");
    assert.equal(retried.counts.failed, 0);
  });
}
