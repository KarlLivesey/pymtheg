import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  cp,
  rm,
  writeFile,
  readFile,
  mkdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { executeGraph } from "../dist/graph/commands.js";
import { SqliteGraphStore } from "../dist/graph/store.js";

async function project(run) {
  const scratch = await mkdtemp(join(tmpdir(), "pymtheg-graph-command-"));
  const root = join(scratch, "project");
  await cp(new URL("./fixtures/graph-command/mixed/", import.meta.url), root, {
    recursive: true,
  });
  try {
    await run(root);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
const cli = (root, ...args) => {
  const run = spawnSync(
    process.execPath,
    ["dist/cli/main.js", "graph", ...args, "--root", root],
    { encoding: "utf8" },
  );
  assert.ok([0, 1, 2, 3].includes(run.status), run.stderr);
  return run;
};
const broken = (answer) => {
  assert.deepEqual(
    answer.failedFiles.map((f) => f.path),
    ["broken/bad.go"],
  );
  assert.ok(answer.failedFiles[0].reason.length > 0);
  assert.ok(
    answer.warnings.some(
      (w) => w.code === "failed-files" && w.files.includes("broken/bad.go"),
    ),
  );
};

test("mixed graph commands expose exact selections, certainty, failed files and JSON/text for every subcommand", async () => {
  await project(async (root) => {
    const progress = [];
    const index = await executeGraph(
      { command: "index", root },
      { progress: (p) => progress.push(p) },
    );
    broken(index);
    assert.deepEqual(
      index.modules.map((m) => m.id),
      ["go", "rust", "typescript"],
    );
    assert.ok(index.counts.symbols > 0);
    assert.equal(typeof index.sync.durationMs, "number"); // field presence only; timings are observations
    assert.ok(
      progress.some(
        (p) => p.phase === "parse" && p.done > 0 && p.total >= p.done,
      ),
    );
    assert.ok(
      progress.some((p) => p.phase === "complete" && p.done === p.total),
    );
    const run = (command, ...args) => executeGraph({ command, args, root });
    const status = await run("status");
    broken(status);
    assert.deepEqual(status.staleFiles, []);
    const search = await run("search", "Leaf");
    broken(search);
    assert.deepEqual(search.data.matches.map((s) => s.name).sort(), [
      "LeafGo",
      "LeafTs",
      "leaf_rust",
    ]);
    const selected = await run("symbol", "LeafGo");
    broken(selected);
    assert.equal(selected.data.symbol.file, "go/code.go");
    const id = selected.data.symbol.id;
    assert.equal((await run("symbol", id)).data.symbol.id, id);
    const ambiguous = await run("symbol", "Shared");
    broken(ambiguous);
    assert.equal(ambiguous.status, "ambiguous");
    assert.equal(ambiguous.data.inputs[0].matches.length, 3);
    const callers = await run("callers", "LeafGo");
    broken(callers);
    assert.equal(
      callers.data.links.find((l) => l.source.name === "MidGo").certainty,
      "definite",
    );
    const callees = await run("callees", "MidGo");
    broken(callees);
    assert.equal(
      callees.data.links.find((l) => l.target?.name === "LeafGo").certainty,
      "definite",
    );
    const candidates = await run("callees", "DispatchGo");
    broken(candidates);
    assert.equal(candidates.data.links[0].certainty, "candidate-set");
    assert.equal(candidates.data.links[0].target, null);
    assert.deepEqual(
      candidates.data.links[0].candidates.map((c) => c.symbol.identity).sort(),
      ["(A).Run", "(B).Run", "Runner.Run"],
    );
    assert.ok(candidates.data.links[0].data);
    const unknown = await run("callees", "UnknownGo");
    broken(unknown);
    assert.equal(unknown.data.links[0].certainty, "unresolved");
    assert.equal(unknown.data.links[0].target, null);
    const path = await run("path", "TopGo", "LeafGo");
    broken(path);
    assert.equal(path.data.found, true);
    assert.equal(path.data.certainty, "definite");
    assert.deepEqual(
      path.data.symbols.map((s) => s.name),
      ["TopGo", "MidGo", "LeafGo"],
    );
    const impact = await run("impact", "LeafGo");
    broken(impact);
    assert.deepEqual(impact.data.callers.map((s) => s.symbol.name).sort(), [
      "MidGo",
      "TopGo",
    ]);
    assert.equal(impact.data.depth, 5);
    const file = await run("file", "go/code.go");
    broken(file);
    assert.ok(file.data.symbols.some((s) => s.name === "LeafGo"));
    assert.ok(file.data.links.some((l) => l.certainty === "candidate-set"));
    for (const [command, ...args] of [
      ["index"],
      ["status"],
      ["search", "Leaf"],
      ["symbol", "Shared"],
      ["callers", "LeafGo"],
      ["callees", "DispatchGo"],
      ["path", "TopGo", "LeafGo"],
      ["impact", "LeafGo"],
      ["file", "go/code.go"],
    ]) {
      const json = cli(root, command, ...args, "--json");
      const response = JSON.parse(json.stdout);
      assert.equal(response.schema, "pymtheg.graph/v1");
      broken(response);
      assert.equal(response.command, command);
      if (command === "index")
        assert.match(json.stderr, /graph (inventory|parse|complete).*\d+\/\d+/);
      const text = cli(root, command, ...args);
      assert.match(text.stdout, /Failed files \(1\):/);
      assert.match(text.stdout, /broken\/bad.go/);
      assert.match(text.stdout, new RegExp(`Graph ${command}:`));
    }
  });
});

test("queries sync content changes; no-sync and status report hashes, additions, removals, context and version changes", async () => {
  await project(async (root) => {
    await executeGraph({ command: "index", root });
    const path = join(root, "go/code.go");
    const before = await stat(path);
    const source = await readFile(path, "utf8");
    await writeFile(path, source.replace("LeafGo", "NewGo!")); // same byte length, invalid syntax
    const fs = await import("node:fs/promises");
    await fs.utimes(path, before.atime, before.mtime);
    const stale = await executeGraph({
      command: "symbol",
      args: ["LeafGo"],
      root,
      noSync: true,
    });
    assert.ok(stale.staleFiles.some((f) => f.path === "go/code.go"));
    assert.equal(stale.data.symbol.name, "LeafGo");
    await writeFile(path, source.replaceAll("LeafGo", "NewGoX"));
    const fresh = await executeGraph({
      command: "symbol",
      args: ["NewGoX"],
      root,
    });
    assert.equal(fresh.sync.mode, "updated");
    assert.equal(fresh.data.symbol.name, "NewGoX");
    assert.deepEqual(fresh.staleFiles, []);
    await writeFile(join(root, "ts/extra.ts"), "export function Added() {}\n");
    await rm(join(root, "src/lib.rs"));
    await writeFile(
      join(root, "go.mod"),
      "module example.com/new\n\ngo 1.23\n",
    );
    const status = await executeGraph({ command: "status", root });
    assert.ok(
      status.staleFiles.some(
        (f) => f.path === "ts/extra.ts" && f.change === "added",
      ),
    );
    assert.ok(
      status.staleFiles.some(
        (f) => f.path === "src/lib.rs" && f.change === "removed",
      ),
    );
    assert.ok(
      status.staleFiles.some(
        (f) => f.path === "go.mod" && f.change === "context",
      ),
    );
    assert.equal(status.sync.mode, "status");
  });
});

test("warm queries use no full graph snapshot APIs, do not parse, and preserve index bytes", async (t) => {
  await project(async (root) => {
    await rm(join(root, "broken/bad.go"));
    await executeGraph({ command: "index", root });
    const db = join(root, ".pymtheg/rebuildable/graph.sqlite");
    const bytes = await readFile(db);
    const fail = () => {
      throw Error("full snapshot read on a warm query");
    };
    const mocks = [
      "files",
      "getFile",
      "contexts",
      "links",
      "fileInventory",
      "contextInventory",
      "counts",
    ].map((method) => t.mock.method(SqliteGraphStore.prototype, method, fail));
    try {
      const result = await executeGraph({
        command: "symbol",
        args: ["LeafGo"],
        root,
      });
      assert.equal(result.sync.mode, "unchanged");
      assert.equal(result.data.symbol.name, "LeafGo");
      for (const [command, ...args] of [
        ["search", "Leaf"],
        ["callers", "LeafGo"],
        ["callees", "MidGo"],
        ["path", "TopGo", "LeafGo"],
        ["impact", "LeafGo"],
        ["file", "go/code.go"],
        ["status"],
      ]) {
        const answer = await executeGraph({ command, args, root });
        assert.equal(
          answer.sync.mode,
          command === "status" ? "status" : "unchanged",
        );
      }
      assert.deepEqual(await readFile(db), bytes);
    } finally {
      for (const mock of mocks) mock.mock.restore();
    }
  });
});

test("missing index is read-only for status/no-sync; legacy state and invalid CLI invocations are explicit JSON errors", async () => {
  await project(async (root) => {
    const status = await executeGraph({ command: "status", root });
    assert.equal(status.indexExists, false);
    await assert.rejects(stat(join(root, ".pymtheg")), { code: "ENOENT" });
    const noSync = await executeGraph({
      command: "search",
      args: ["Leaf"],
      root,
      noSync: true,
    });
    assert.equal(noSync.indexExists, false);
    assert.equal(noSync.data, null);
    assert.equal(cli(root, "search", "--json").status, 3);
    assert.equal(
      JSON.parse(cli(root, "bad-command", "--json").stdout).status,
      "error",
    );
    await mkdir(join(root, ".pymtheg-architecture"));
    const result = cli(root, "index", "--json");
    assert.equal(result.status, 3);
    assert.match(
      JSON.parse(result.stdout).error.message,
      /Old Pymtheg storage layout/,
    );
    await assert.rejects(stat(join(root, ".pymtheg")), { code: "ENOENT" });
  });
});

test("bounds never turn candidate paths or a bounded absence into a definite result", async () => {
  await project(async (root) => {
    await executeGraph({ command: "index", root });
    const bounded = await executeGraph({
      command: "path",
      args: ["TopGo", "LeafGo"],
      root,
      depth: 1,
    });
    assert.equal(bounded.data.found, false);
    assert.equal(bounded.status, "bounded");
    assert.equal(bounded.truncated, true);
    assert.equal(bounded.data.depth, 1);
    const candidates = await executeGraph({
      command: "callees",
      args: ["DispatchGo"],
      root,
    });
    const target = candidates.data.links[0].candidates[0].id;
    const possible = await executeGraph({
      command: "path",
      args: ["DispatchGo", target],
      root,
    });
    assert.equal(possible.data.found, true);
    assert.equal(possible.data.certainty, "candidate");
    const impact = await executeGraph({
      command: "impact",
      args: ["LeafGo"],
      root,
      depth: 1,
    });
    assert.equal(impact.truncated, true);
    assert.deepEqual(
      impact.data.callers.map((c) => c.symbol.name),
      ["MidGo"],
    );
    const ambiguity = await executeGraph({
      command: "symbol",
      args: ["Shared"],
      root,
      limit: 1,
    });
    assert.equal(ambiguity.status, "ambiguous");
    assert.equal(ambiguity.truncated, true);
    assert.equal(ambiguity.data.inputs[0].matches.length, 1);
    const tinyPath = await executeGraph({
      command: "path",
      args: ["TopGo", "LeafGo"],
      root,
      limit: 1,
    });
    assert.equal(tinyPath.data.found, false);
    assert.ok(tinyPath.data.visited <= tinyPath.data.maxNodes);
    const search = await executeGraph({
      command: "search",
      args: [""],
      root,
      limit: 1,
    });
    assert.equal(search.truncated, true);
    assert.equal(search.data.matches.length, 1);
  });
});
