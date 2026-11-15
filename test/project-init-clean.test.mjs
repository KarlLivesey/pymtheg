import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  chmod,
  cp,
  stat,
} from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  readWorkspace,
  initializeWorkspace,
} from "../dist/project/workspace.js";
import { loadConfig } from "../dist/project/config.js";
const cliFile = resolve("dist/cli/main.js");
const model =
  "machine Ready { state done: Bool = false; event finish when !done { done = true; } invariant safe = true; }\n";
async function fixture(run) {
  const root = await mkdtemp(
    join(process.env.PYM_SCRATCH ?? tmpdir(), "r1b-init-"),
  );
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function cli(root, ...args) {
  const result = spawnSync(process.execPath, [cliFile, ...args], {
    cwd: root,
    encoding: "utf8",
  });
  assert.ifError(result.error);
  return result;
}
function ok(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}
function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function tree(root, excluded = new Set([".git"])) {
  const result = {};
  async function walk(path) {
    for (const entry of await readdir(join(root, path), {
      withFileTypes: true,
    })) {
      if (!path && excluded.has(entry.name)) continue;
      const key = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(key);
      else result[key] = await readFile(join(root, key), "utf8");
    }
  }
  await walk("");
  return result;
}
async function legacy(root) {
  const old = [".pymtheg-architecture", ".pymtheg-studio"];
  for (const name of old) {
    await mkdir(join(root, name));
    await writeFile(join(root, name, "poison.pym"), "INVALID DEAD DATA");
    await writeFile(join(root, name, "workspace.sqlite"), "NOT A DATABASE");
  }
  await writeFile(join(root, ".pymtheg.json"), "INVALID OLD SETTINGS");
  return old.concat(".pymtheg.json");
}
function notice(result, names) {
  const lines = result.stderr
    .split("\n")
    .filter((line) => line.includes("Unused legacy Pymtheg data"));
  assert.equal(lines.length, names.length ? 1 : 0, result.stderr);
  if (names.length) {
    for (const name of names) assert.equal(lines[0].split(name).length - 1, 1);
    assert.match(lines[0], /unused|Unused/);
    assert.match(lines[0], /safe to delete/);
  }
}
async function mcp(root, id) {
  const client = new Client({ name: "clean-init", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliFile, "mcp", root],
    cwd: root,
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (b) => {
    stderr += b;
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "project_info",
      arguments: {},
    });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const view = result.structuredContent ?? JSON.parse(result.content[0].text);
    assert.equal(view.root, root);
    assert.equal(view.workspace.id, id);
    assert.doesNotMatch(stderr, /Unused legacy/);
  } finally {
    await client.close();
  }
}
async function studio(root, id) {
  const child = spawn(
    process.execPath,
    [cliFile, "studio", root, "--port", "0"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "",
    stderr = "";
  const exited = new Promise((resolve) =>
    child.once("close", (code, signal) => resolve({ code, signal })),
  );
  child.stderr.on("data", (b) => {
    stderr += b;
  });
  try {
    const url = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () =>
        reject(Error(`Studio exited before readiness: ${output} ${stderr}`)),
      );
      child.stdout.on("data", (b) => {
        output += b;
        const match = /Open in Firefox: (http:\/\/[^\s]+)/.exec(output);
        if (match) resolve(new URL(match[1]));
      });
    });
    assert.match(output, /Pymtheg Studio/);
    const response = await fetch(new URL("/api/project", url), {
      headers: { Authorization: "Bearer " + url.hash.slice("#token=".length) },
    });
    assert.equal(response.status, 200);
    const view = await response.json();
    assert.equal(view.workspace.id, id);
    assert.equal(view.root, root);
    assert.doesNotMatch(stderr, /Unused legacy/);
  } finally {
    child.kill("SIGTERM");
    assert.equal((await exited).code, 0, stderr);
  }
}
async function diagnosis(root, id, old) {
  const result = ok(cli(root, "doctor", "--format", "json"));
  notice(result, old);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schema, "pymtheg.doctor/v1");
  assert.ok(Array.isArray(report.checks));
  for (const check of report.checks) {
    assert.equal(typeof check.name, "string");
    assert.ok(["ready", "missing", "incompatible"].includes(check.status));
    if (/project|metadata|storage/i.test(check.name))
      assert.equal(check.status, "ready", JSON.stringify(check));
  }
  // Doctor currently has tool checks only. Validate init's own state directly;
  // Java/TLC/Quint and built web assets are not initialization requirements.
  assert.equal((await readWorkspace(root)).id, id);
  assert.equal((await loadConfig(root)).config.version, 1);
}
async function graph(root, repository = false) {
  await writeFile(
    join(root, "init_probe.go"),
    "package probe\nfunc InitProbe() {}\n",
  );
  const run = (...args) => {
    const result = cli(root, "graph", ...args, "--root", root, "--json");
    // The repository contains deliberately malformed language fixtures. A partial
    // index is expected there and is never claimed as a clean analysis result.
    assert.ok(
      (repository ? [0, 2] : [0]).includes(result.status),
      result.stdout + result.stderr,
    );
    const report = JSON.parse(result.stdout);
    if (result.status === 2) {
      assert.equal(report.status, "incomplete");
      assert.ok(report.failedFiles.length > 0);
    } else assert.equal(report.status, "ok");
    return report;
  };
  const indexed = run("index");
  assert.equal(indexed.indexExists, true);
  const queried = run("search", "InitProbe", "--no-sync");
  assert.ok(
    queried.data.matches.some(
      (symbol) =>
        symbol.name === "InitProbe" && symbol.file === "init_probe.go",
    ),
  );
}
async function commands(root, id, old) {
  await writeFile(join(root, "ready.pym"), model);
  await diagnosis(root, id, old);
  await graph(root);
  for (const command of ["check", "verify", "simulate"]) {
    const result = ok(
      cli(root, command, "ready.pym", "--entry", "Ready", "--format", "json"),
    );
    assert.doesNotMatch(result.stderr, /Unused legacy/);
  }
  ok(
    cli(
      root,
      "check",
      "ready.pym",
      "--check-scope",
      "project",
      "--format",
      "json",
    ),
  );
  await mcp(root, id);
  await studio(root, id);
  assert.ok((await stat(join(root, ".pymtheg/shared"))).isDirectory());
  assert.ok((await stat(join(root, ".pymtheg/rebuildable"))).isDirectory());
}

for (const kind of [
  "empty-git",
  "non-git",
  "mixed-code",
  "legacy-ignored",
  "legacy-untracked",
  "path with spaces",
]) {
  test(`clean init and live commands: ${kind}`, { timeout: 180000 }, () =>
    fixture(async (scratch) => {
      const root = join(scratch, kind);
      await mkdir(root);
      if (kind !== "non-git") git(root, "init", "--quiet");
      if (kind === "mixed-code") {
        await mkdir(join(root, "src"));
        await mkdir(join(root, "docs"));
        await writeFile(
          join(root, "src/main.go"),
          "package main\nfunc main() {}\n",
        );
        await writeFile(join(root, "src/lib.rs"), "pub fn ready() {}\n");
        await writeFile(
          join(root, "src/main.ts"),
          "export function ready() {}\n",
        );
        await writeFile(
          join(root, "docs/design.md"),
          "# Requirements\nStart cleanly.\n",
        );
      }
      const old = kind.startsWith("legacy") ? await legacy(root) : [];
      const ignore =
        kind === "legacy-ignored"
          ? ".pymtheg-architecture/\n.pymtheg-studio/\n"
          : "# existing rules\n*.build\n";
      await writeFile(join(root, ".gitignore"), ignore);
      const before = await tree(root);
      const initialized = ok(cli(root, "init", ".", "--format", "json"));
      notice(initialized, old);
      const value = JSON.parse(initialized.stdout);
      assert.equal(value.created, true);
      const after = await tree(root);
      for (const key of Object.keys(before))
        assert.equal(after[key], before[key]);
      assert.deepEqual(
        Object.keys(after)
          .filter((key) => !(key in before))
          .sort(),
        [
          ".pymtheg/.gitignore",
          ".pymtheg/project.json",
          ".pymtheg/settings.json",
        ],
      );
      const second = ok(cli(root, "init", "."));
      notice(second, old);
      assert.match(second.stdout, /Already initialized/);
      assert.match(second.stdout, /no metadata changes/);
      assert.deepEqual(await tree(root), after);
      assert.match(second.stdout, /Commit .*project.json.*settings.json/);
      assert.match(second.stdout, /Planning\/history.*stay local and ignored/);
      for (const command of ["doctor", "studio", "mcp"])
        assert.match(second.stdout, new RegExp(`pymtheg ${command}`));
      if (kind !== "non-git") {
        for (const path of [
          "shared/architecture.sqlite",
          "rebuildable/runs.sqlite",
          ".orphan.tmp",
        ])
          git(root, "check-ignore", ".pymtheg/" + path);
        assert.equal(
          spawnSync(
            "git",
            ["check-ignore", ".pymtheg/project.json", ".pymtheg/settings.json"],
            { cwd: root },
          ).status,
          1,
        );
      }
      await commands(root, value.workspace.id, old);
      for (const name of old) {
        if (name.endsWith("json"))
          assert.equal(await readFile(join(root, name), "utf8"), before[name]);
        else
          for (const file of ["poison.pym", "workspace.sqlite"])
            assert.equal(
              await readFile(join(root, name, file), "utf8"),
              before[`${name}/${file}`],
            );
      }
    }),
  );
}

test("nested folders and monorepo packages open their parent; a nested Git root is independent", () =>
  fixture(async (root) => {
    const parent = await initializeWorkspace(root, "Monorepo");
    const packageRoot = join(root, "packages/api");
    await mkdir(packageRoot, { recursive: true });
    const result = ok(cli(packageRoot, "init", "."));
    assert.match(result.stdout, /opened Monorepo at /);
    assert.ok(result.stdout.includes(root));
    assert.deepEqual(await readdir(packageRoot), []);
    const nested = join(root, "nested-repo");
    await mkdir(nested);
    git(nested, "init", "--quiet");
    const own = JSON.parse(
      ok(cli(nested, "init", ".", "--format", "json")).stdout,
    );
    assert.equal(own.root, nested);
    assert.notEqual(own.workspace.id, parent.workspace.id);
  }));

test("init recovers from interrupted publication steps without changing existing metadata", () =>
  fixture(async (root) => {
    const complete = join(root, "complete");
    await mkdir(complete);
    await initializeWorkspace(complete);
    const marker = await readFile(
      join(complete, ".pymtheg/project.json"),
      "utf8",
    );
    for (const phase of ["directory", "settings", "marker", "ignore"]) {
      const project = join(root, phase);
      await mkdir(join(project, ".pymtheg"), { recursive: true });
      const file =
        phase === "settings"
          ? "settings.json"
          : phase === "marker"
            ? "project.json"
            : phase === "ignore"
              ? ".gitignore"
              : null;
      const text =
        file === "settings.json"
          ? '{"version":1,"scenarios":{},"sources":{"include":["src/**/*.pym"]}}\n'
          : file === "project.json"
            ? marker
            : "shared/\nrebuildable/\n*.tmp\n";
      if (file) await writeFile(join(project, ".pymtheg", file), text);
      await writeFile(
        join(project, ".pymtheg/.project.json.interrupted.tmp"),
        "unpublished partial bytes",
      );
      ok(cli(project, "init", ".", "--format", "json"));
      if (file)
        assert.equal(
          await readFile(join(project, ".pymtheg", file), "utf8"),
          text,
        );
      const before = await tree(project);
      ok(cli(project, "init", "."));
      assert.deepEqual(await tree(project), before);
    }
  }));

test("read-only and invalid metadata errors identify the path and corrective action", () =>
  fixture(async (root) => {
    const readonly = join(root, "readonly");
    await mkdir(readonly);
    await chmod(readonly, 0o555);
    try {
      const result = cli(readonly, "init", ".");
      assert.equal(result.status, 3);
      assert.ok(result.stderr.includes(readonly));
      assert.match(result.stderr, /writable|write permission/);
    } finally {
      await chmod(readonly, 0o700);
    }
    const invalid = join(root, "invalid");
    await mkdir(join(invalid, ".pymtheg"), { recursive: true });
    await writeFile(join(invalid, ".pymtheg/settings.json"), "broken JSON");
    const result = cli(invalid, "init", ".");
    assert.equal(result.status, 3);
    assert.ok(result.stderr.includes(invalid));
    assert.match(result.stderr, /Repair invalid metadata/);
  }));

test("help and no-argument first run direct users to init", () =>
  fixture(async (root) => {
    for (const args of [[], ["--help"]])
      assert.match(
        ok(cli(root, ...args)).stdout,
        /Start here: pymtheg init \./,
      );
  }));

test(
  "this repository initializes and serves commands with fake legacy data, without touching the original checkout",
  { timeout: 180000 },
  () =>
    fixture(async (root) => {
      const project = join(root, "pymtheg repository");
      const excluded = new Set([
        ".git",
        "node_modules",
        "dist",
        "dist-web",
        ".pymtheg",
        ".pymtheg-architecture",
        ".pymtheg-studio",
        "evidence",
        "research",
      ]);
      await cp(resolve("."), project, {
        recursive: true,
        filter: (path) => {
          const name = relative(resolve("."), path).split("/")[0];
          return !excluded.has(name);
        },
      });
      await mkdir(join(project, ".pymtheg"));
      await cp(
        resolve("evidence/r1-b/repository-settings.json"),
        join(project, ".pymtheg/settings.json"),
      );
      git(project, "init", "--quiet");
      const old = await legacy(project);
      const before = await readFile(
        join(project, ".pymtheg/settings.json"),
        "utf8",
      );
      const initialized = ok(cli(project, "init", ".", "--format", "json"));
      notice(initialized, old);
      const value = JSON.parse(initialized.stdout);
      assert.equal(value.root, project);
      assert.equal(
        await readFile(join(project, ".pymtheg/settings.json"), "utf8"),
        before,
      );
      // Project-scope check here would intentionally include the repository's buggy modelling fixtures.
      await writeFile(join(project, "ready.pym"), model);
      await diagnosis(project, value.workspace.id, old);
      await graph(project, true);
      for (const command of ["check", "verify", "simulate"])
        ok(
          cli(
            project,
            command,
            "ready.pym",
            "--entry",
            "Ready",
            "--format",
            "json",
          ),
        );
      await mcp(project, value.workspace.id);
      await studio(project, value.workspace.id);
      for (const folder of old.filter((name) => !name.endsWith("json")))
        assert.equal(
          await readFile(join(project, folder, "poison.pym"), "utf8"),
          "INVALID DEAD DATA",
        );
    }),
);

test("name and ownership errors never suggest repairing valid metadata", () =>
  fixture(async (root) => {
    await initializeWorkspace(root, "Original");
    const nested = join(root, "nested");
    await mkdir(nested);
    const before = await tree(root);
    for (const [cwd, name, message] of [
      [
        root,
        "Different",
        "Project is already initialized as “Original”. Its identity and name were preserved.",
      ],
      [root, "   ", "Choose a project name of 1–160 characters"],
      [
        nested,
        "Other",
        `This folder belongs to “Original” at ${root}. Initialize outside that project to create a separate workspace.`,
      ],
    ]) {
      const result = cli(cwd, "init", ".", "--name", name);
      assert.equal(result.status, 3);
      assert.equal(result.stderr.trim(), "pymtheg: " + message);
      assert.doesNotMatch(result.stderr, /repair|Error:|project.json/);
    }
    assert.deepEqual(await tree(root), before);
  }));

test("read-only metadata reports the directory rather than a staging file", () =>
  fixture(async (root) => {
    const storage = join(root, ".pymtheg");
    await mkdir(storage);
    await chmod(storage, 0o555);
    try {
      const result = cli(root, "init", ".");
      assert.equal(result.status, 3);
      assert.ok(
        result.stderr.includes(storage + " is not writable"),
        result.stderr,
      );
      assert.doesNotMatch(result.stderr, /\.tmp|Cannot read|Error:/);
    } finally {
      await chmod(storage, 0o700);
    }
  }));

test("printed next commands quote shell metacharacters literally", () =>
  fixture(async (scratch) => {
    const root = join(scratch, "project $USER `id` 'quoted'");
    await mkdir(root);
    const output = ok(cli(root, "init", ".")).stdout;
    for (const command of ["studio", "mcp"]) {
      const line = output
        .split("\n")
        .find((line) => line.includes(`pymtheg ${command} `))
        .trim();
      // Replace only the executable with printf to inspect shell parsing without
      // launching another server or executing the quoted path's contents.
      const parsed = spawnSync(
        "sh",
        ["-c", line.replace(`pymtheg ${command}`, "printf '%s'")],
        { encoding: "utf8" },
      );
      assert.equal(parsed.status, 0, parsed.stderr);
      assert.equal(parsed.stdout, root);
    }
  }));
