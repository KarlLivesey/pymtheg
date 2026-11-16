// SPDX-License-Identifier: MIT
// R1-H: Studio and MCP stop cleanly on SIGINT/SIGTERM and leave no process
// behind; only node:sqlite's ExperimentalWarning is filtered, every other
// warning still prints; node:sqlite is never loaded by a static import.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve("dist/cli/main.js");
const groupGone = (pgid) => {
  try {
    process.kill(-pgid, 0);
    return false;
  } catch (error) {
    return error.code === "ESRCH";
  }
};
async function stopsCleanly(mode, signal) {
  const root = await mkdtemp(join(tmpdir(), `pym-r1h-${mode}-`));
  try {
    await writeFile(
      join(root, "main.pym"),
      "flow f() -> Unit { return unit; }\n",
    );
    // Own process group, so "nothing left" is checkable for the whole group.
    const child = spawn(
      process.execPath,
      [cli, mode, root, ...(mode === "studio" ? ["--port", "0"] : [])],
      { stdio: ["pipe", "pipe", "pipe"], detached: true },
    );
    let stdout = "",
      stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    const closed = new Promise((r) =>
      child.on("close", (code, sig) => r({ code, sig })),
    );
    await new Promise((ready) => {
      child.stdout.on("data", (c) => {
        stdout += c;
        if (
          mode === "studio"
            ? /Open in Firefox: \S+/.test(stdout)
            : /"id":1/.test(stdout)
        )
          ready();
      });
      if (mode === "mcp")
        child.stdin.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "t", version: "1" },
            },
          }) + "\n",
        );
    });
    child.kill(signal);
    const { code, sig } = await closed;
    assert.equal(
      sig,
      null,
      `${mode} ${signal} ended by signal; stderr: ${stderr}`,
    );
    assert.equal(code, 0, `${mode} ${signal} exit; stderr: ${stderr}`);
    assert.ok(
      groupGone(child.pid),
      `${mode} ${signal} left a process in its group`,
    );
    assert.doesNotMatch(stderr, /Warning/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
for (const mode of ["studio", "mcp"])
  for (const signal of ["SIGINT", "SIGTERM"])
    test(`${mode} stops cleanly on ${signal} with nothing left running`, () =>
      stopsCleanly(mode, signal));

test("only Node's exact SQLite and glob ExperimentalWarnings are filtered, on every emitWarning overload", () => {
  const sqlite =
    "SQLite is an experimental feature and might change at any time";
  const glob = "glob is an experimental feature and might change at any time";
  const script = `
    await import(${JSON.stringify(resolve("dist/cli/quiet-warnings.js"))});
    const sqlite = ${JSON.stringify(sqlite)}, glob = ${JSON.stringify(glob)};
    const error = (name, message) => Object.assign(new Error(message), { name });
    // Suppressed: Node's own form, a string with the type as string or options.
    process.emitWarning(sqlite, "ExperimentalWarning");
    process.emitWarning(sqlite, { type: "ExperimentalWarning" });
    process.emitWarning(glob, "ExperimentalWarning");
    process.emitWarning(glob, { type: "ExperimentalWarning", code: "X" });
    // Printed: an Error uses its own name; Node ignores the other arguments.
    process.emitWarning(error("DeprecationWarning", sqlite), "ExperimentalWarning");
    process.emitWarning(error("DeprecationWarning", glob), { type: "ExperimentalWarning" });
    process.emitWarning(error("ExperimentalWarning", sqlite));
    process.emitWarning(error("Error", "plain error warning"));
    // Printed: deprecations in every form.
    process.emitWarning("string deprecation", "DeprecationWarning", "DEP_TEST_1");
    process.emitWarning("options deprecation", { type: "DeprecationWarning", code: "DEP_TEST_2" });
    process.emitWarning(sqlite, "DeprecationWarning");
    process.emitWarning(sqlite, { type: "DeprecationWarning" });
    // Printed: other experimental warnings and near misses.
    process.emitWarning("fetch is an experimental feature and might change at any time", "ExperimentalWarning");
    process.emitWarning("SQLite is an experimental feature", "ExperimentalWarning");
    process.emitWarning(sqlite + ".", { type: "ExperimentalWarning" });
    process.emitWarning(sqlite);
    process.emitWarning(sqlite, { code: "NO_TYPE" });
    // Printed: custom warnings.
    process.emitWarning("custom warning", "MyWarning");
    process.emitWarning("custom options warning", { type: "MyWarning", detail: "d" });
    process.emitWarning("default type warning");`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
  });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stderr
    .split("\n")
    .map((l) => l.replace(/^\(node:\d+\) (\[\w+\] )?/, ""))
    .filter((l) => /^\w+: /.test(l) && !l.startsWith("(Use"));
  const count = (line) => lines.filter((l) => l === line).length;
  assert.equal(count(`ExperimentalWarning: ${glob}`), 0, r.stderr);
  // Only the Error-object form of the exact SQLite text prints as experimental.
  assert.equal(count(`ExperimentalWarning: ${sqlite}`), 1, r.stderr);
  assert.equal(count(`DeprecationWarning: ${sqlite}`), 3, r.stderr);
  assert.equal(count(`DeprecationWarning: ${glob}`), 1, r.stderr);
  for (const line of [
    "Error: plain error warning",
    "DeprecationWarning: string deprecation",
    "DeprecationWarning: options deprecation",
    "ExperimentalWarning: fetch is an experimental feature and might change at any time",
    "ExperimentalWarning: SQLite is an experimental feature",
    `ExperimentalWarning: ${sqlite}.`,
    "MyWarning: custom warning",
    "MyWarning: custom options warning",
    "Warning: default type warning",
  ])
    assert.equal(count(line), 1, `${line}\n${r.stderr}`);
  assert.equal(count(`Warning: ${sqlite}`), 2, r.stderr);
  assert.equal(lines.length, 16, r.stderr);
});
test("node:sqlite is loaded lazily, never by a static import in src", async () => {
  const offenders = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (p.endsWith(".ts")) {
        const text = await readFile(p, "utf8");
        if (/^import\s+(?!type\b)[^;]*from\s+["']node:sqlite["']/m.test(text))
          offenders.push(p);
      }
    }
  };
  await walk("src");
  assert.deepEqual(offenders, []);
  const main = await readFile("src/cli/main.ts", "utf8");
  assert.match(
    main.split("\n").slice(0, 4).join("\n"),
    /^import "\.\/quiet-warnings\.js";$/m,
  );
});

test("a B001 lowering preflight reports exhaustive: false", () => {
  const r = spawnSync(
    process.execPath,
    [
      cli,
      "verify",
      "examples/mvp/algorithm.pym",
      "--entry",
      "nestedScan",
      "--format",
      "json",
    ],
    { encoding: "utf8" },
  );
  const behaviour = JSON.parse(r.stdout).results.filter(
    (x) => x.analysisKind === "behaviour",
  );
  assert.ok(
    behaviour.length > 0 &&
      behaviour.every(
        (x) =>
          x.exhaustive === false &&
          x.diagnostics.some((d) => d.code === "B001"),
      ),
  );
});
const doctorChecks = (args, options = {}) => {
  const r = spawnSync(
    process.execPath,
    [...args, "doctor", "--format", "json"],
    { encoding: "utf8", ...options },
  );
  return {
    status: r.status,
    checks: Object.fromEntries(
      JSON.parse(r.stdout).checks.map((c) => [c.name, c]),
    ),
  };
};
test("doctor names a crashed engine worker as a worker failure", () => {
  const { status, checks } = doctorChecks([
    "--import",
    resolve("test/fixtures/r1a/fail-explore-worker.mjs"),
    cli,
  ]);
  assert.equal(status, 3);
  for (const name of ["Verifier", "Simulator"]) {
    assert.match(
      checks[name].detail,
      /^The built-in engine worker failed: .*controlled explore worker failure/,
    );
    assert.doesNotMatch(checks[name].detail, /verdicts were wrong/);
  }
});
test("doctor says how to restore a missing Studio build: reinstall a package, build a checkout", async () => {
  const { cp, mkdir, symlink } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "pym-r1h-doctor-"));
  try {
    await cp("dist", join(root, "dist"), { recursive: true });
    await cp("grammars", join(root, "grammars"), { recursive: true });
    await cp("package.json", join(root, "package.json"));
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    await mkdir(join(root, "project"));
    const copy = join(root, "dist/cli/main.js"),
      cwd = join(root, "project");
    const installed = doctorChecks([copy], { cwd });
    assert.equal(installed.checks.Studio.status, "missing");
    assert.match(
      installed.checks.Studio.detail,
      /installed package: reinstall Pymtheg/,
    );
    assert.equal(
      installed.status,
      0,
      "the Studio build is optional for the exit status",
    );
    await cp("tsconfig.json", join(root, "tsconfig.json"));
    await mkdir(join(root, "src/cli"), { recursive: true });
    await cp("src/cli/main.ts", join(root, "src/cli/main.ts"));
    const checkout = doctorChecks([copy], { cwd });
    assert.match(
      checkout.checks.Studio.detail,
      /run npm run build in this source checkout/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
