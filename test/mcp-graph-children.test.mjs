// SPDX-License-Identifier: MIT
import "./isolated-config.mjs";
// C-54: cancelling a graph job over MCP ends the toolchain's processes. The
// production job manager and graph worker run an index with the Go route
// on; a fake `go` starts a child in its process group that can never finish
// while it "builds" the helper, writes both pids (the readiness handshake)
// and waits. No test asserts a time.
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
import { initializeWorkspace } from "../dist/project/workspace.js";
import {
  toolchainWorkDirectory,
  trustFile,
} from "../dist/project/local-trust.js";

const PROJECT = {
  "go.mod": "module example.com/hang\n\ngo 1.22\n",
  "a.go": "package hang\n\nfunc F() {}\n",
};

/** A fake `go` at <dir>/goroot/bin/go whose `go build` starts a child and never finishes. */
function fakeGo(dir) {
  const goroot = join(dir, "goroot");
  mkdirSync(join(goroot, "bin"), { recursive: true });
  const go = join(goroot, "bin", "go");
  writeFileSync(
    go,
    `#!${process.execPath}
const fs = require("fs"), cp = require("child_process");
const a = process.argv.slice(2);
if (a[0] === "env") {
  console.log(JSON.stringify({ GOVERSION: "go1.22.0", GOROOT: ${JSON.stringify(join(realpathSync(dir), "goroot"))}, GOHOSTOS: "linux", GOHOSTARCH: "amd64" }));
  process.exit(0);
}
if (a[0] === "build") {
  const child = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  fs.writeFileSync(${JSON.stringify(join(dir, "ready.json"))}, JSON.stringify({ go: process.pid, child: child.pid }));
  setInterval(() => {}, 1000);
  return;
}
process.exit(2);
`,
  );
  chmodSync(go, 0o755);
  return realpathSync(go);
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
  const go = fakeGo(join(root, "tools"));
  const file = trustFile();
  const answers = JSON.parse(readFileSync(file, "utf8"));
  answers.checkouts[realpathSync(project)].toolchain = { go, rust: false };
  writeFileSync(file, JSON.stringify(answers));
  process.env.GOPATH = join(root, "gopath");
  return {
    project: realpathSync(project),
    ready: join(root, "tools", "ready.json"),
  };
}
const buildFolders = (project) => {
  const dir = join(toolchainWorkDirectory(project), "go");
  return existsSync(dir)
    ? readdirSync(dir).filter((n) => n.startsWith("build-"))
    : [];
};

test("C-54: cancelling an MCP index ends the Go toolchain and the child it started, and its folder is removed", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-children-"));
  try {
    const { project, ready } = await trustedProject(root);
    const jobs = new GraphJobs(project);
    const job = jobs.start({ command: "index" });
    await until(
      () => existsSync(ready) || job.state !== "running",
      "the fake go did not start",
    );
    assert.ok(
      existsSync(ready),
      `job ${job.state}: ${JSON.stringify(job.error)}`,
    );
    const pids = JSON.parse(readFileSync(ready, "utf8"));
    assert.ok(running(pids.go) && running(pids.child));
    await jobs.cancel(job.id);
    assert.equal(job.state, "cancelled");
    await until(
      () => !running(pids.go) && !running(pids.child),
      "a toolchain process is still running",
    );
    // The worker answered the abort after the route removed its folder.
    assert.deepEqual(buildFolders(project), []);
    await jobs.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("C-54: a server that exits with a job running kills its toolchain processes", async () => {
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
      () => !running(pids.go) && !running(pids.child),
      "a toolchain process outlived the server",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const signal of ["SIGTERM", "SIGINT"])
  test(`C-54: a CLI graph index stopped by ${signal} kills its toolchain children`, async () => {
    const root = await mkdtemp(join(tmpdir(), "pym-cli-children-"));
    try {
      const { project, ready } = await trustedProject(root);
      const cli = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("../dist/cli/main.js", import.meta.url)),
          "graph",
          "index",
          "--root",
          project,
          "--json",
        ],
        { stdio: ["ignore", "ignore", "inherit"], env: process.env },
      );
      let exited = false;
      const exit = new Promise((resolve) =>
        cli.once("exit", (code, sig) => {
          exited = true;
          resolve({ code, sig });
        }),
      );
      await until(
        () => existsSync(ready) || exited,
        "the fake go did not start",
      );
      assert.ok(
        existsSync(ready),
        "the CLI ended before the fake go was ready",
      );
      const pids = JSON.parse(readFileSync(ready, "utf8"));
      cli.kill(signal);
      const { code } = await exit;
      // An interrupted graph command exits 130.
      assert.equal(code, 130);
      await until(
        () => !running(pids.go) && !running(pids.child),
        "a toolchain process outlived the CLI",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
