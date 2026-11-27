// SPDX-License-Identifier: MIT
import "./isolated-config.mjs";
// W3-L2: the Go toolchain opt-in through `pymtheg graph` (commands.ts).
// Fixtures: test/fixtures/graph-go-toolchain/ (compiler-checked, see
// test/graph-go-toolchain.test.mjs). These tests need the user's `go`; without
// one on PATH the toolchain cases are skipped, and say so.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { executeGraph } from "../dist/graph/commands.js";
import { formatGraph } from "../dist/cli/graph.js";
import { LanguageRegistry } from "../dist/graph/registry.js";
import { SqliteGraphStore } from "../dist/graph/store.js";
import go from "../dist/graph/languages/go/index.js";
import { initializeWorkspace } from "../dist/project/workspace.js";
import { trustFile } from "../dist/project/local-trust.js";

const FIXTURES = fileURLToPath(
  new URL("./fixtures/graph-go-toolchain/", import.meta.url),
);
const haveGo = (process.env.PATH ?? "")
  .split(delimiter)
  .some((dir) => dir && existsSync(join(dir, "go")));
const needsGo = haveGo ? {} : { skip: "no go on PATH (toolchain route)" };

/** A copy of a fixture as a project; `setting` undefined writes no settings file. */
async function project(fixture, setting) {
  const dir = await mkdtemp(join(tmpdir(), "pymtheg-command-toolchain-"));
  const root = join(dir, "project");
  await cp(join(FIXTURES, fixture), root, { recursive: true });
  if (setting !== undefined) await settings(root, setting);
  return { dir, root };
}
/**
 * D22 (C-44): the route is on only with the user's trusted answer, kept
 * outside the checkout (here an isolated configuration folder). `true` answers trusted; a path answers
 * trusted and names the local tool path; `false` answers trusted and turns
 * Go off in the committed settings; null writes settings with neither.
 */
async function settings(root, go) {
  await mkdir(join(root, ".pymtheg"), { recursive: true });
  if (go !== null && !existsSync(join(root, ".pymtheg", "project.json")))
    await initializeWorkspace(root, undefined, { trust: "trusted" });
  await writeFile(
    join(root, ".pymtheg", "settings.json"),
    JSON.stringify({
      version: 1,
      scenarios: {},
      ...(go === false ? { graph: { toolchain: { go: false } } } : {}),
    }),
  );
  if (go === null) return;
  // A tool path is the user's own setting, in the same file. These are
  // Go-route tests: the Rust route (C-43) stays off.
  const file = trustFile();
  const answers = JSON.parse(await readFile(file, "utf8"));
  const entry = answers.checkouts[await realpath(root)];
  entry.toolchain =
    typeof go === "string" ? { go, rust: false } : { rust: false };
  await writeFile(file, JSON.stringify(answers));
}
const run = (root, command, args = [], extra = {}) =>
  executeGraph(
    { command, args, root, ...extra },
    { registry: new LanguageRegistry([go]) },
  );
/** Every stored link, readable (the graph, not the answer). */
function stored(root) {
  const store = new SqliteGraphStore(
    join(root, ".pymtheg", "rebuildable", "graph.sqlite"),
    undefined,
    { readOnly: true },
  );
  try {
    const symbols = new Map(
      store.findSymbols().map((s) => [s.id, `${s.file}:${s.identity}`]),
    );
    return store
      .links()
      .map((l) =>
        JSON.stringify({
          file: l.file,
          range: l.range,
          kind: l.kind,
          name: l.targetName,
          target: symbols.get(l.targetId) ?? null,
          candidates: l.candidates.map((c) => symbols.get(c.id)).sort(),
          data: l.data ?? null,
        }).replace(/(symbol|link):[0-9a-f]{64}/g, "<id>"),
      )
      .sort();
  } finally {
    store.close();
  }
}
/**
 * An answer without what differs between two copies of one project: times,
 * the root, and symbol ids (which also order links and candidates).
 */
const withoutTimes = (response) => ({
  status: response.status,
  exitCode: response.exitCode,
  syncMode: response.sync.mode,
  complete: response.sync.complete,
  counts: response.counts,
  warnings: response.warnings,
  toolchain: response.toolchain,
  links: (response.data?.links ?? [])
    .map((link) =>
      JSON.stringify({
        file: link.file,
        range: link.range,
        kind: link.kind,
        name: link.targetName,
        certainty: link.certainty,
        decidedBy: link.decidedBy,
        target: link.target?.identity ?? null,
        candidates: link.candidates.map((c) => c.symbol?.identity).sort(),
        data: link.data,
      }).replace(/(symbol|link):[0-9a-f]{64}/g, "<id>"),
    )
    .sort(),
});

test("off: no settings file, no graph setting, or go: false give the same answers and graph", async () => {
  const answers = [];
  const graphs = [];
  for (const setting of [undefined, null, false]) {
    const { dir, root } = await project("basic", setting);
    try {
      const index = await run(root, "index");
      assert.equal(index.toolchain, undefined);
      const callers = await run(root, "callers", ["(*File).Write"]);
      assert.equal(callers.toolchain, undefined);
      for (const answer of [
        await run(root, "status"),
        await run(root, "callers", ["(*File).Write"], { noSync: true }),
      ])
        assert.ok(
          !answer.warnings.some(
            (w) => w.code === "toolchain-inputs-not-rechecked",
          ),
        );
      assert.doesNotMatch(JSON.stringify(callers), /decidedBy|"toolchain"/);
      answers.push(withoutTimes(callers));
      graphs.push(stored(root));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  assert.deepEqual(answers[1], answers[0]);
  assert.deepEqual(answers[2], answers[0]);
  assert.deepEqual(graphs[1], graphs[0]);
  assert.deepEqual(graphs[2], graphs[0]);
});

test(
  "on: graph index reports the route; graph callers shows an upgraded link and its origin",
  needsGo,
  async () => {
    const { dir, root } = await project("basic", true);
    try {
      const index = await run(root, "index");
      assert.equal(index.exitCode, 0, JSON.stringify(index.warnings));
      const state = index.toolchain.go;
      assert.equal(state.state, "used");
      assert.match(state.version, /^go1\./);
      assert.match(state.configuration, /cgo off/);
      assert.ok(state.upgradedLinks >= 2, JSON.stringify(state));
      assert.ok(state.verifiedSets >= 1, JSON.stringify(state));
      assert.equal(state.disagreements, 0);
      const status = await run(root, "status");
      assert.deepEqual(status.toolchain, index.toolchain);
      // store.First(files).Write (a generic function's result) is unresolved
      // source-only; the toolchain makes it definite.
      const callers = await run(root, "callers", ["(*File).Write"]);
      const upgraded = callers.data.links.filter(
        (link) => link.targetName === "store.First(files).Write",
      );
      assert.equal(upgraded.length, 1, JSON.stringify(callers.data.links));
      assert.equal(upgraded[0].certainty, "definite");
      assert.equal(upgraded[0].decidedBy, "toolchain");
      assert.equal(upgraded[0].source.identity, "Use");
      // Nothing changed: the warm query recomputes the toolchain key (the
      // helper's fingerprint pass) and answers from the index, unchanged.
      const warm = await run(root, "callers", ["(*File).Write"]);
      assert.equal(warm.sync.mode, "unchanged");
      assert.equal(warm.sync.complete, true);
      assert.deepEqual(warm.toolchain, callers.toolchain);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  "toggling the setting on -> off -> on re-syncs each time",
  needsGo,
  async () => {
    const { dir, root } = await project("basic", true);
    try {
      const decided = (answer) =>
        answer.data.links.some((link) => link.decidedBy === "toolchain");
      const first = await run(root, "callers", ["(*File).Write"]);
      assert.equal(first.toolchain.go.state, "used");
      assert.ok(decided(first));
      await settings(root, false);
      const off = await run(root, "callers", ["(*File).Write"]);
      assert.equal(off.sync.mode, "updated");
      assert.equal(off.toolchain, undefined);
      assert.ok(!decided(off));
      assert.equal(off.sync.complete, true);
      await settings(root, true);
      const again = await run(root, "callers", ["(*File).Write"]);
      assert.equal(again.sync.mode, "updated");
      assert.equal(again.toolchain.go.state, "used");
      assert.ok(decided(again));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("go missing: the index succeeds source-only and says why", async () => {
  const { dir, root } = await project("basic", "/nonexistent-dir/go");
  try {
    const index = await run(root, "index");
    assert.equal(index.exitCode, 0, JSON.stringify(index.warnings));
    assert.equal(index.toolchain.go.state, "unavailable");
    assert.match(
      index.toolchain.go.reason,
      /\/nonexistent-dir\/go does not exist/,
    );
    const callers = await run(root, "callers", ["(*File).Write"]);
    assert.ok(!callers.data.links.some((link) => link.decidedBy));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "an edit only the toolchain sees (a replace target outside the project) shows in the next query",
  needsGo,
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "pymtheg-command-toolchain-"));
    try {
      await cp(join(FIXTURES, "replace"), join(dir, "replace"), {
        recursive: true,
      });
      const root = join(dir, "replace", "app");
      await settings(root, true);
      const pairOf = (answer) =>
        answer.data.links.some(
          (link) =>
            link.kind === "implements" &&
            link.certainty === "definite" &&
            link.decidedBy === "toolchain" &&
            link.target?.identity === "I",
        );
      const implementsA = async (extra = {}) =>
        pairOf(await run(root, "file", ["use/use.go"], extra));
      assert.equal(await implementsA(), true);
      // A synced query re-checked the inputs: no warning.
      const synced = await run(root, "file", ["use/use.go"]);
      assert.ok(
        !synced.warnings.some(
          (w) => w.code === "toolchain-inputs-not-rechecked",
        ),
      );
      // dep is outside the project: the inventory does not change.
      await writeFile(
        join(dir, "replace", "dep", "dep.go"),
        "package dep\n\ntype Marker interface {\n\tMark()\n\tClose() error\n}\n",
      );
      // status and --no-sync do not run go: they answer as recorded, and say so.
      const status = await run(root, "status");
      const noSync = await run(root, "file", ["use/use.go"], { noSync: true });
      assert.equal(pairOf(noSync), true);
      for (const answer of [status, noSync]) {
        const warning = answer.warnings.find(
          (w) => w.code === "toolchain-inputs-not-rechecked",
        );
        assert.ok(warning, answer.command);
        assert.match(warning.message, /as recorded at the last sync/);
        assert.match(
          formatGraph(answer),
          /Warning \[toolchain-inputs-not-rechecked\]: Toolchain-backed facts are as recorded/,
        );
      }
      // A synced query re-checks them and sees the edit.
      assert.equal(await implementsA(), false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
