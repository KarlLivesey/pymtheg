// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  initializeWorkspace,
  findWorkspace,
} from "../dist/project/workspace.js";
import { findConfig } from "../dist/project/config.js";
import { storagePath } from "../dist/storage/local.js";
import { openProjectGraph } from "../dist/storage/graph.js";
import { RecoveryStore } from "../dist/studio/recovery.js";
import { startStudio } from "../dist/studio/server.js";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "pymtheg-storage-review-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function cli(root, ...args) {
  return spawnSync(process.execPath, [resolve("dist/cli/main.js"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
}
function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
async function contents(root) {
  const files = {};
  async function walk(path) {
    for (const entry of await readdir(join(root, path), {
      withFileTypes: true,
    })) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files[child] = "directory";
        await walk(child);
      } else files[child] = await readFile(join(root, child));
    }
  }
  await walk("");
  return files;
}
const machine =
  "machine Bit { state flag: Bool = false; event flip when !flag { flag = true; } invariant safe = true; }";
for (const old of [false, true]) {
  test(`file-scope check/verify/simulate leave ${old ? "old" : "new"} storage untouched; project-scope runs`, () =>
    fixture(async (root) => {
      await writeFile(join(root, "main.pym"), machine);
      if (old) {
        await writeFile(
          join(root, ".pymtheg.json"),
          '{"version":1,"scenarios":{}}',
        );
        await mkdir(join(root, ".pymtheg-architecture"));
        await writeFile(
          join(root, ".pymtheg-architecture/architecture.sqlite"),
          "old data",
        );
      } else await initializeWorkspace(root);
      const before = await contents(root);
      for (const command of ["check", "verify", "simulate"]) {
        const result = cli(
          root,
          command,
          "main.pym",
          "--entry",
          "Bit",
          "--format",
          "json",
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.deepEqual(await contents(root), before);
      }
      const project = cli(
        root,
        "check",
        "main.pym",
        "--check-scope",
        "project",
        "--format",
        "json",
      );
      assert.equal(project.status, 0, project.stdout + project.stderr);
      assert.deepEqual(await contents(root), before);
    }));
}

for (const item of ["graph", "runs"]) {
  test(`${item} cache creation without init installs its own Git ignore rule`, () =>
    fixture(async (root) => {
      git(root, "init", "--quiet");
      if (item === "graph") openProjectGraph(root, "test").close();
      else await writeFile(storagePath(root, item, true), "cache");
      assert.equal(
        (await readdir(join(root, ".pymtheg"))).includes("project.json"),
        false,
      );
      const relative = `.pymtheg/rebuildable/${item === "graph" ? "graph" : "runs"}.sqlite`;
      assert.equal(git(root, "check-ignore", relative).trim(), relative);
      assert.equal(
        git(
          root,
          "status",
          "--porcelain",
          "--untracked-files=all",
          "--",
          ".pymtheg/rebuildable",
        ),
        "",
      );
    }));
}

test(
  "Studio in an uninitialized Git repo keeps a completed run cache out of Git status",
  { timeout: 30000 },
  () =>
    fixture(async (root) => {
      git(root, "init", "--quiet");
      await writeFile(join(root, "main.pym"), "flow main() -> Unit {}");
      const app = await startStudio({ path: root });
      try {
        const finished = new Promise((resolve) => {
          const off = app.service.subscribe((event) => {
            if (event.kind === "run" && event.run.status !== "running") {
              off();
              resolve(event.run);
            }
          });
        });
        await app.service.start({
          clientId: "storage",
          revision: 0,
          file: "main.pym",
          buffers: {},
          kind: "check",
          entry: "main",
          seed: "42",
          maxSteps: 6,
          maxSamples: 10,
        });
        assert.equal((await finished).status, "completed");
        await readFile(join(root, ".pymtheg/rebuildable/runs.sqlite"));
        assert.equal(
          git(
            root,
            "status",
            "--porcelain",
            "--untracked-files=all",
            "--",
            ".pymtheg",
          ),
          "",
        );
        assert.equal(await findWorkspace(root), null);
      } finally {
        await app.close();
      }
    }),
);

test("a garbage run cache leaves unsaved Studio drafts readable and writable", () =>
  fixture(async (root) => {
    const draft = {
      drafts: [
        {
          path: "unsaved.pym",
          text: "flow unsaved() -> Unit {}",
          baseHash: null,
        },
      ],
      context: null,
    };
    const store = await RecoveryStore.openOrCreate(root);
    store.save(0, draft);
    store.close();
    const draftsBefore = await readFile(storagePath(root, "drafts"));
    await writeFile(storagePath(root, "runs"), "garbage cache");
    const app = await startStudio({ path: root });
    try {
      const view = app.service.readRecovery();
      assert.equal(view.enabled, true);
      assert.deepEqual(view.drafts, draft.drafts);
      assert.match(
        view.error,
        /Run history unavailable at \.pymtheg\/rebuildable\/runs\.sqlite/,
      );
      assert.doesNotMatch(view.error, /Recovery unavailable/);
      assert.deepEqual(
        await readFile(storagePath(root, "drafts")),
        draftsBefore,
      );
      const project = await app.service.project();
      assert.equal(project.runs.length, 0);
      assert.equal(project.recovery.enabled, true);
      assert.equal(project.recovery.error, view.error);
      const saved = await app.service.saveRecovery(view.revision, {
        ...draft,
        drafts: [{ ...draft.drafts[0], text: "edited unsaved draft" }],
      });
      assert.equal(saved.enabled, true);
      assert.equal(saved.drafts[0].text, "edited unsaved draft");
      assert.equal(
        await readFile(storagePath(root, "runs"), "utf8"),
        "garbage cache",
      );
    } finally {
      await app.close();
    }
  }));

test("project discovery ignores stray old storage above new, Git and metadata-only roots", () =>
  fixture(async (home) => {
    await writeFile(join(home, ".pymtheg.json"), "stray old config");
    for (const kind of ["new", "git", "metadata"]) {
      const root = join(home, kind),
        nested = join(root, "src");
      await mkdir(nested, { recursive: true });
      if (kind === "new") await initializeWorkspace(root);
      else if (kind === "git") git(root, "init", "--quiet");
      else await mkdir(join(root, ".pymtheg"));
      // Only the resolved project root owns old-layout detection.
      await writeFile(join(nested, ".pymtheg.json"), "unrelated nested file");
      assert.equal((await findConfig(nested)).root, root);
      const workspace = await findWorkspace(nested);
      if (kind === "new") assert.equal(workspace.root, root);
      else assert.equal(workspace, null);
    }
    assert.equal(
      await readFile(join(home, ".pymtheg.json"), "utf8"),
      "stray old config",
    );
  }));
