// SPDX-License-Identifier: MIT
import "./isolated-config.mjs";
// C-43 review B3 (the Rust route; C-54 has the Go route): cancelling a graph job over MCP ends the toolchain's
// processes. The production job manager and graph worker run an index with
// the Rust route on; a fake rust-analyzer starts a "build script" in its
// process group that can never finish, writes both pids (the readiness
// handshake) and waits. No test asserts a time.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GraphJobs } from "../dist/mcp/graph-jobs.js";
import { executeGraph } from "../dist/graph/commands.js";
import { initializeWorkspace } from "../dist/project/workspace.js";
import {
  toolchainWorkDirectory,
  trustFile,
} from "../dist/project/local-trust.js";

const PROJECT = {
  "Cargo.toml":
    '[package]\nname = "hang"\nversion = "0.1.0"\nedition = "2021"\n',
  "src/lib.rs": "pub fn f() {}\n",
};

/** A fake toolchain whose rust-analyzer starts a grandchild and never finishes. */
function fakeToolchain(dir) {
  mkdirSync(join(dir, "sysroot", "lib", "rustlib", "src", "rust", "library"), {
    recursive: true,
  });
  const head = `#!${process.execPath}\nconst fs = require("fs"), path = require("path"), cp = require("child_process");\nconst a = process.argv.slice(2);\n`;
  const scripts = {
    rustc: `if (a[0] === "--print") { console.log(${JSON.stringify(join(dir, "sysroot"))}); process.exit(0); }
if (a[0] === "-vV") { console.log("rustc 1.98.1 (fake)\\nhost: x86_64-unknown-linux-gnu\\nrelease: 1.98.1"); process.exit(0); }
process.exit(2);`,
    cargo: `if (a[0] === "metadata") { console.log(JSON.stringify({ packages: [], workspace_members: [], resolve: { nodes: [] } })); process.exit(0); }
process.exit(2);`,
    "rust-analyzer": `if (a[0] === "--version") { console.log("rust-analyzer 1.98.1 (fake)"); process.exit(0); }
if (a[0] === "scip") {
  const script = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  // Written whole, then renamed: a reader never sees it half-written.
  fs.writeFileSync(path.join(__dirname, "ready.json.tmp"), JSON.stringify({ analyzer: process.pid, script: script.pid }));
  fs.renameSync(path.join(__dirname, "ready.json.tmp"), path.join(__dirname, "ready.json"));
  setInterval(() => {}, 1000);
  return;
}
process.exit(2);`,
  };
  for (const [name, body] of Object.entries(scripts)) {
    writeFileSync(join(dir, name), head + body);
    chmodSync(join(dir, name), 0o755);
  }
  return join(dir, "rust-analyzer");
}

/** Whether a process is running (a zombie is not). */
function running(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return false;
  }
}
/** Waits until a condition holds, by turns of the event loop (no time limit decides). */
async function until(condition, what) {
  for (let i = 0; !condition(); i++) {
    assert.ok(i < 20_000, what);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function trustedProject(root) {
  const project = join(root, "project");
  for (const [path, text] of Object.entries(PROJECT)) {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), text);
  }
  await initializeWorkspace(project, undefined, { trust: "trusted" });
  const analyzer = fakeToolchain(join(root, "tools"));
  const file = trustFile();
  const answers = JSON.parse(readFileSync(file, "utf8"));
  answers.checkouts[realpathSync(project)].toolchain = {
    go: false,
    rust: analyzer,
  };
  writeFileSync(file, JSON.stringify(answers));
  process.env.CARGO_HOME = join(root, "cargo-home");
  return {
    project: realpathSync(project),
    ready: join(root, "tools", "ready.json"),
  };
}
const runFolders = (project) => {
  const dir = join(toolchainWorkDirectory(project), "rust");
  return existsSync(dir)
    ? readdirSync(dir).filter((n) => /^run-[0-9a-f-]{36}$/.test(n))
    : [];
};

test("review B3: cancelling an MCP index ends rust-analyzer and the build script it started, and removes the run folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-children-"));
  try {
    const { project, ready } = await trustedProject(root);
    const jobs = new GraphJobs(project);
    const job = jobs.start({ command: "index" });
    await until(
      () => existsSync(ready),
      "the fake rust-analyzer did not start",
    );
    const pids = JSON.parse(readFileSync(ready, "utf8"));
    assert.ok(running(pids.analyzer) && running(pids.script));
    await jobs.cancel(job.id);
    assert.equal(job.state, "cancelled");
    await until(
      () => !running(pids.analyzer) && !running(pids.script),
      "a toolchain process is still running",
    );
    // The worker answered the abort after the route cleaned up.
    assert.deepEqual(runFolders(project), []);
    await jobs.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("review B3: a server that exits with a job running kills its toolchain processes; the next run sweeps the folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-children-"));
  try {
    const { project, ready } = await trustedProject(root);
    // The server script is a file: a worker inherits the process's flags,
    // and --input-type applies only to -e.
    const script = join(root, "server.mjs");
    writeFileSync(
      script,
      `import { existsSync } from "node:fs";
const { GraphJobs } = await import(${JSON.stringify(new URL("../dist/mcp/graph-jobs.js", import.meta.url).href)});
const jobs = new GraphJobs(${JSON.stringify(project)});
const job = jobs.start({ command: "index" });
const wait = () => existsSync(${JSON.stringify(ready)}) ? process.exit(0) : job.state !== "running" ? (console.error("job " + job.state + ": " + JSON.stringify(job.error)), process.exit(3)) : setTimeout(wait, 5);
wait();`,
    );
    const server = spawn(
      process.execPath,
      [
        "--import",
        fileURLToPath(new URL("./isolated-config.mjs", import.meta.url)),
        script,
      ],
      { stdio: ["ignore", "inherit", "inherit"], env: process.env },
    );
    const code = await new Promise((resolve) => server.once("exit", resolve));
    assert.equal(code, 0);
    const pids = JSON.parse(readFileSync(ready, "utf8"));
    await until(
      () => !running(pids.analyzer) && !running(pids.script),
      "a toolchain process outlived the server",
    );
    // The killed run left its folder; its lock died with the server, so the
    // next run removes it.
    assert.equal(runFolders(project).length, 1);
    await rm(ready);
    const answers = JSON.parse(readFileSync(trustFile(), "utf8"));
    answers.checkouts[project].toolchain = {
      go: false,
      rust: join(root, "none", "rust-analyzer"),
    };
    writeFileSync(trustFile(), JSON.stringify(answers));
    await executeGraph({ command: "index", root: project });
    assert.deepEqual(runFolders(project), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
