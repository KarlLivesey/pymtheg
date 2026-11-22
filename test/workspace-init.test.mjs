// SPDX-License-Identifier: MIT
import "./isolated-config.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
  mkdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initializeWorkspace,
  findWorkspace,
} from "../dist/project/workspace.js";
test("blank initialization is idempotent, portable and discoverable from a child directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-init-"));
  try {
    const first = await initializeWorkspace(root, "New project");
    assert.equal(first.created, true);
    const bytes = await readFile(join(root, ".pymtheg/project.json"), "utf8");
    assert.deepEqual(
      JSON.parse(await readFile(join(root, ".pymtheg/settings.json"), "utf8")),
      { version: 1, scenarios: {} },
    );
    assert.equal((await initializeWorkspace(root)).created, false);
    assert.equal(
      await readFile(join(root, ".pymtheg/project.json"), "utf8"),
      bytes,
    );
    await mkdir(join(root, "src"));
    assert.equal(
      (await findWorkspace(join(root, "src"))).workspace.id,
      first.workspace.id,
    );
    assert.ok(!(await readdir(root)).some((f) => f.endsWith(".pym")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("initialization preserves existing configuration and concurrent initializers publish one identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-init-concurrent-"));
  try {
    const config =
      '{"version":1,"scenarios":{},"sources":{"include":["design/**/*.pym"]}}';
    await mkdir(join(root, ".pymtheg"), { recursive: true });
    await writeFile(join(root, ".pymtheg/settings.json"), config);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => initializeWorkspace(root)),
    );
    assert.equal(new Set(results.map((r) => r.workspace.id)).size, 1);
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(
      await readFile(join(root, ".pymtheg/settings.json"), "utf8"),
      config,
    );
    assert.deepEqual((await readdir(join(root, ".pymtheg"))).sort(), [
      ".gitignore",
      "project.json",
      "settings.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("invalid markers and metadata symlinks are refused without replacing data", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-init-invalid-")),
    outside = await mkdtemp(join(tmpdir(), "pym-init-outside-"));
  try {
    await symlink(outside, join(root, ".pymtheg"));
    await assert.rejects(initializeWorkspace(root), /symbolic link/);
    assert.deepEqual(await readdir(outside), []);
    await rm(join(root, ".pymtheg"));
    await mkdir(join(root, ".pymtheg"));
    await writeFile(join(root, ".pymtheg/project.json"), "broken");
    await assert.rejects(initializeWorkspace(root), /Invalid project marker/);
    assert.equal(
      await readFile(join(root, ".pymtheg/project.json"), "utf8"),
      "broken",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("MCP and Studio resolve an initialized project from a nested directory and expose the same identity", async () => {
  const { AgentWorkspace } = await import("../dist/mcp/workspace.js");
  const { startStudio } = await import("../dist/studio/server.js");
  const root = await mkdtemp(join(tmpdir(), "pym-init-discovery-"));
  let agent, studio;
  try {
    const initialized = await initializeWorkspace(root, "A new design");
    await mkdir(join(root, "src"));
    agent = await AgentWorkspace.open(join(root, "src"));
    const info = await agent.project();
    assert.equal(info.root, root);
    assert.equal(info.workspace.id, initialized.workspace.id);
    assert.equal(info.totalFiles, 0);
    studio = await startStudio({ path: join(root, "src") });
    const project = await studio.service.project();
    assert.equal(project.root, root);
    assert.equal(project.workspace.id, initialized.workspace.id);
    assert.equal(project.files.length, 0);
    assert.equal(
      project.architectureAvailable,
      false,
      "An ignore file alone is not a saved architecture",
    );
  } finally {
    await agent?.close();
    await studio?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the CLI initializes an empty directory without generating example source", async () => {
  const { spawnSync } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "pym-init-cli-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        "dist/cli/main.js",
        "init",
        root,
        "--name",
        "Empty design",
        "--format",
        "json",
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const info = JSON.parse(result.stdout);
    assert.equal(info.workspace.name, "Empty design");
    assert.deepEqual((await readdir(root)).sort(), [".pymtheg"]);
    assert.deepEqual((await readdir(join(root, ".pymtheg"))).sort(), [
      ".gitignore",
      "project.json",
      "settings.json",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("moving an initialized project preserves its identity without storing the old absolute root", async () => {
  const { rename } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "pym-init-move-"));
  try {
    const old = join(root, "original"),
      next = join(root, "renamed");
    const initial = await initializeWorkspace(old, "Portable design");
    await rename(old, next);
    const discovered = await findWorkspace(next);
    assert.equal(discovered.workspace.id, initial.workspace.id);
    assert.equal(discovered.root, next);
    assert.ok(
      !(await readFile(join(next, ".pymtheg/project.json"), "utf8")).includes(
        old,
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reinitialization does not hide invalid configuration or replace the project identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-init-config-"));
  try {
    await initializeWorkspace(root);
    const marker = await readFile(join(root, ".pymtheg/project.json"), "utf8");
    await mkdir(join(root, ".pymtheg"), { recursive: true });
    await writeFile(join(root, ".pymtheg/settings.json"), "not json");
    await assert.rejects(initializeWorkspace(root));
    assert.equal(
      await readFile(join(root, ".pymtheg/project.json"), "utf8"),
      marker,
    );
    assert.equal(
      await readFile(join(root, ".pymtheg/settings.json"), "utf8"),
      "not json",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an already open MCP workspace sees initialization on its next fresh inventory", async () => {
  const { AgentWorkspace } = await import("../dist/mcp/workspace.js");
  const root = await mkdtemp(join(tmpdir(), "pym-live-init-"));
  let agent;
  try {
    agent = await AgentWorkspace.open(root);
    assert.equal((await agent.project()).workspace, null);
    const initialized = await initializeWorkspace(root, "Live project");
    assert.equal(
      (await agent.project()).workspace.id,
      initialized.workspace.id,
    );
  } finally {
    await agent?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Studio project setup uses the same identity and imports documentation only after explicit request", async () => {
  const { startStudio } = await import("../dist/studio/server.js");
  const root = await mkdtemp(join(tmpdir(), "pym-setup-api-"));
  let studio;
  try {
    await writeFile(
      join(root, "README.md"),
      "# Architecture\nNo production code yet.",
    );
    studio = await startStudio({ path: root });
    const call = (body) =>
      fetch(new URL("/api/project/initialize", studio.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + studio.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await call({ root: "/tmp/outside", name: "Wrong" })).status,
      400,
    );
    const initial = await call({ name: "GUI project" });
    assert.equal(initial.status, 200);
    const preview = await initial.json();
    assert.equal(preview.documentation.status, "preview");
    assert.equal(
      (await studio.service.project()).workspace.id,
      preview.workspace.id,
    );
    assert.equal((await studio.service.architectureOverview()).index, null);
    const imported = await call({
      name: "GUI project",
      importDocuments: true,
      previewToken: preview.documentation.previewToken,
    });
    assert.equal(imported.status, 200);
    assert.equal((await imported.json()).documentation.status, "imported");
    assert.equal(
      (await studio.service.architectureOverview()).index.documents.some(
        (d) => d.path === "README.md",
      ),
      true,
    );
  } finally {
    await studio?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Studio setup refuses to import documentation changed after its displayed preview", async () => {
  const { startStudio } = await import("../dist/studio/server.js");
  const root = await mkdtemp(join(tmpdir(), "pym-setup-stale-"));
  let studio;
  try {
    const doc = join(root, "README.md");
    await writeFile(doc, "# Before");
    studio = await startStudio({ path: root });
    const call = (body) =>
      fetch(new URL("/api/project/initialize", studio.url), {
        method: "POST",
        headers: {
          Authorization: "Bearer " + studio.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    const preview = await (await call({ name: "Previewed project" })).json();
    await writeFile(doc, "# Changed after preview");
    const response = await call({
      name: "Previewed project",
      importDocuments: true,
      previewToken: preview.documentation.previewToken,
    });
    assert.equal(response.status, 409);
    assert.equal((await studio.service.architectureOverview()).index, null);
  } finally {
    await studio?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("nested init reuses the parent identity and keeps SQLite out of Git", async () => {
  const { spawnSync } = await import("node:child_process");
  const root = await mkdtemp(join(tmpdir(), "pym-init-sharing-"));
  try {
    const first = await initializeWorkspace(root, "Team design");
    const nested = join(root, "src");
    await mkdir(nested);
    const again = await initializeWorkspace(nested);
    assert.equal(again.root, root);
    assert.equal(again.workspace.id, first.workspace.id);
    assert.deepEqual(await readdir(nested), []);
    await assert.rejects(
      initializeWorkspace(nested, "Different project"),
      /belongs to/,
    );
    assert.equal(spawnSync("git", ["init", "--quiet", root]).status, 0);
    const ignored = spawnSync(
      "git",
      [
        "check-ignore",
        ".pymtheg/shared/architecture.sqlite",
        ".pymtheg/shared/architecture.sqlite-wal",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(ignored.status, 0, ignored.stderr);
    assert.equal(ignored.stdout.trim().split("\n").length, 2);
    assert.equal(
      spawnSync("git", ["check-ignore", ".pymtheg/project.json"], { cwd: root })
        .status,
      1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
