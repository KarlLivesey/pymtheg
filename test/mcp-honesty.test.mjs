// SPDX-License-Identifier: MIT
// R1-J: honest MCP surfaces. Each test drives the built product over real
// stdio MCP (and the CLI where the CLI shares the behaviour).
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  rm,
  mkdir,
  readdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { connect } from "./fixtures/mcp-graph/client.mjs";
import { initializeWorkspace } from "../dist/project/workspace.js";

const cli = (root, ...args) =>
  spawnSync(process.execPath, [resolve("dist/cli/main.js"), ...args], {
    cwd: root,
    encoding: "utf8",
  });
async function project(files, run) {
  const root = await mkdtemp(join(tmpdir(), "pym-r1j-"));
  let s;
  try {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), text);
    }
    s = await connect(root);
    await run(s, root);
  } finally {
    await s?.close();
    await rm(root, { recursive: true, force: true });
  }
}
const errorText = async (s, name, args) => {
  const { result, body } = await s.raw(name, args);
  assert.equal(result.isError, true, JSON.stringify(body));
  return body.error?.message ?? result.content[0].text;
};
const links = async (s, action, args = {}) => {
  const first = await s.call("requirement_links", { action, ...args });
  return first.state === "running"
    ? s.call("link_result", { jobId: first.jobId, wait: true })
    : first;
};
const machine =
  "machine Counter {\n  state n: Nat in 0..2 = 0;\n  event inc when n < 2 { n = n + 1; }\n  invariant small = n <= 2;\n}\n";

test("C: read_source says it reads design files only and refuses code with that reason", async () =>
  project({ "main.go": "package main\n", "d.pym": machine }, async (s) => {
    const { tools } = await s.client.listTools();
    const tool = tools.find((t) => t.name === "read_source");
    assert.match(tool.description, /design file \(\.pym\)/);
    assert.match(tool.description, /does not read code/);
    const message = await errorText(s, "read_source", { file: "main.go" });
    assert.match(message, /design files \(\.pym\) only/);
    assert.match(message, /your own file tools/);
    const ok = await s.call("read_source", { file: "d.pym", limit: 1 });
    assert.deepEqual(ok.lines, ["machine Counter {"]);
  }));

test("D and H: refusals name the accepted arguments; project_info says files are design files", async () =>
  project({ "d.pym": machine }, async (s) => {
    const { tools } = await s.client.listTools();
    const links_ = tools.find((t) => t.name === "requirement_links");
    assert.match(links_.description, /refresh link;/);
    assert.match(links_.description, /unlinked symbols, symbolLimit;/);
    const refresh = await errorText(s, "requirement_links", {
      action: "refresh",
      link: "x",
      note: "n",
    });
    assert.equal(
      refresh,
      "note is not accepted by refresh. refresh accepts link, plus wait, section, limit and noSync.",
    );
    const unlinked = await errorText(s, "requirement_links", {
      action: "unlinked",
      file: "a.go",
    });
    assert.match(
      unlinked,
      /^file is not accepted by unlinked\. unlinked accepts symbols, symbolLimit,/,
    );
    const history = await errorText(s, "requirement_links", {
      action: "history",
      record: "R1",
    });
    assert.match(history, /history accepts no action-specific arguments/);
    const info = tools.find((t) => t.name === "project_info");
    assert.match(
      info.description,
      /count Pymtheg design files \(\.pym\) only, never code/,
    );
  }));

test("E: the first MCP planning write initialises the project exactly as pymtheg init would", async () => {
  const reference = await mkdtemp(join(tmpdir(), "pym-r1j-init-"));
  try {
    await initializeWorkspace(reference);
    await project(
      {
        "a.go": "package p\nfunc Save(n int) int { return n }\n",
        "go.mod": "module example.test/p\n\ngo 1.22\n",
        ".pymtheg-architecture/old.json": "{}",
      },
      async (s, root) => {
        const before = await s.call("project_info", {});
        assert.equal(before.initialised, false);
        assert.equal(before.workspace, null);
        assert.match(before.initialisation, /not initialised/);
        // A graph index alone does not initialise the project.
        const index = await s.call("code_graph", { action: "index" });
        if (index.state === "running")
          await s.call("graph_result", { jobId: index.jobId, wait: true });
        assert.equal((await s.call("project_info", {})).initialised, false);
        const created = await links(s, "requirement", {
          id: "R1",
          title: "Save",
        });
        assert.equal(created.summary.status, "created");
        const after = await s.call("project_info", {});
        assert.equal(after.initialised, true);
        assert.equal(after.initialisation, undefined);
        assert.equal(after.workspace.name, root.split("/").at(-1));
        for (const file of [".gitignore", "settings.json"])
          assert.equal(
            await readFile(join(root, ".pymtheg", file), "utf8"),
            await readFile(join(reference, ".pymtheg", file), "utf8"),
            file,
          );
        const top = (await readdir(join(root, ".pymtheg"))).sort();
        assert.deepEqual(top, [
          ".gitignore",
          "local",
          "project.json",
          "rebuildable",
          "settings.json",
          "shared",
        ]);
        const add = await links(s, "add", { record: "R1", selector: "Save" });
        assert.equal(add.summary.status, "created");
      },
    );
  } finally {
    await rm(reference, { recursive: true, force: true });
  }
});

test("E: the CLI link commands initialise the same way (shared path)", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-r1j-cli-"));
  try {
    const r = cli(
      root,
      "link",
      "requirement",
      "R1",
      "--title",
      "Save",
      "--json",
    );
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).status, "created");
    const marker = JSON.parse(
      await readFile(join(root, ".pymtheg", "project.json"), "utf8"),
    );
    assert.equal(marker.schema, "pymtheg.workspace/v1");
    await readFile(join(root, ".pymtheg", ".gitignore"), "utf8");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("F: callers report the true possible-caller total over MCP, as the CLI does, with a bounded page", async () => {
  const many = 150;
  const lib = [
    "pub struct Engine;",
    "impl Engine { pub fn run(&self) -> u32 { 1 } }",
    "pub trait Runner { fn run(&self) -> u32; }",
    ...Array.from(
      { length: many },
      (_, i) => `pub fn caller${i}<E: Runner>(e: E) -> u32 { e.run() }`,
    ),
    "",
  ].join("\n");
  await project(
    {
      "Cargo.toml":
        '[package]\nname = "f"\nversion = "0.1.0"\nedition = "2021"\n',
      "src/lib.rs": lib,
    },
    async (s, root) => {
      const first = await s.call("code_graph", {
        action: "callers",
        query: "impl Engine::run",
        limit: 20,
      });
      const answer =
        first.state === "running"
          ? await s.call("graph_result", { jobId: first.jobId, wait: true })
          : first;
      assert.deepEqual(answer.summary.query.classCounts, {
        definite: 0,
        candidateSet: 0,
        unresolved: many,
      });
      assert.equal(answer.summary.query.countsTruncated, false);
      assert.equal(answer.summary.query.countBound, 1000);
      assert.equal(answer.summary.truncated, true);
      const page = await s.call("graph_result", {
        jobId: answer.jobId,
        section: "possible_callers",
        limit: 100,
      });
      assert.equal(page.total, 20);
      const text = cli(root, "graph", "callers", "impl Engine::run", "--json");
      assert.equal(text.status, 0, text.stderr);
      const data = JSON.parse(text.stdout).data;
      assert.equal(data.classCounts.unresolved, many);
      assert.equal(data.countsTruncated, false);
    },
  );
});

test("near matches: a selector that selects nothing suggests, never selects", async () =>
  project(
    {
      "Cargo.toml":
        '[package]\nname = "n"\nversion = "0.1.0"\nedition = "2021"\n',
      "src/lib.rs":
        "pub struct B;\nimpl B { pub fn new() -> B { B } }\npub struct W<T> { v: T }\nimpl<T: Clone> W<T> { pub fn get(&self) -> T { self.v.clone() } }\n",
    },
    async (s, root) => {
      const ask = async (query) => {
        const first = await s.call("code_graph", { action: "symbol", query });
        return first.state === "running"
          ? s.call("graph_result", { jobId: first.jobId, wait: true })
          : first;
      };
      const plain = await ask("B::new");
      assert.equal(plain.summary.status, "not-found");
      assert.deepEqual(
        plain.items.map((i) => [i.type, i.qualifiedName]),
        [["near-match", "impl B::new"]],
      );
      const generic = await ask("W::get");
      assert.deepEqual(
        generic.items.map((i) => i.qualifiedName),
        ["impl<T:Clone> W<T>::get"],
      );
      assert.deepEqual((await ask("nothing_like_it")).items, []);
      const text = cli(root, "graph", "symbol", "B::new");
      assert.match(
        text.stdout,
        /Near matches \(not selected\):\n {2}.*impl B::new/,
      );
    },
  ));

test("G: messages say what is true", async () =>
  project({ "d.pym": machine }, async (s) => {
    const run = await s.call("check_design", { file: "d.pym" });
    assert.equal(run.exitStatus, 0);
    const trial = await s.call("try_inputs", {
      runId: run.runId,
      entry: "Counter",
      inputs: {},
    });
    assert.equal(
      trial.result.message,
      "“Counter” is a machine. try_inputs runs one structured flow (a flow declaration) with its inputs; explore machines with explore_behaviour (simulate or verify).",
    );
    const missing = await s.call("try_inputs", {
      runId: run.runId,
      entry: "nope",
      inputs: {},
    });
    assert.match(missing.result.message, /^No flow is named “nope”\./);
    const scaffold = await s.call("emit_scaffold", {
      runId: run.runId,
      target: "go",
    });
    assert.equal(scaffold.baseline.complete, false);
    assert.equal(
      scaffold.baseline.meaning,
      "Partial contract baseline: 1 declaration is omitted from it (Counter: Behavioural machines are specifications, not callable implementation contracts.). Keep this limitation when comparing later versions.",
    );
    for (let i = 0; i < 3; i++) await s.call("check_design", { file: "d.pym" });
    assert.equal(
      await errorText(s, "emit_implementation_check", {
        runId: run.runId,
        target: "go",
        implementationType: "Impl",
      }),
      "The typed model for this run is no longer retained (only the three newest are kept). Check the design again and use the new runId.",
    );
    await links(s, "requirement", { id: "R1", title: "Count" });
    const versions = await s.call("read_implementation", {
      section: "versions",
    });
    const plan = await s.call("read_implementation", {
      section: "graph",
      mode: "planned",
      limit: 1,
    });
    assert.equal(
      await errorText(s, "unlink_implementation", {
        revision: versions.activeRevision,
        planId: "plan:R1",
        nodeId: "a.ts#function:f",
      }),
      "No implementation link joins plan:R1 to a.ts#function:f in the current revision; nothing was removed. List current links with read_implementation.",
    );
    assert.equal(
      await errorText(s, "link_implementation", {
        revision: versions.activeRevision,
        planId: plan.items[0].id,
        planHash: plan.items[0].planHash,
        nodeId: "a.ts#function:f",
        observationId: "0".repeat(64),
        reviewed: true,
      }),
      "No code observation is retained in this project yet. Capture code with observe_implementation, then choose a declaration from read_implementation before linking.",
    );
  }));
