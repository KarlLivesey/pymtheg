// SPDX-License-Identifier: MIT
// C-44 (decision D22): init asks once whether the repository is trusted, and
// the answer belongs to this machine, never to Git. Prompt tests drive the
// question through controlled streams; no test depends on a real terminal or
// on time.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { executeGraph } from "../dist/graph/commands.js";
import {
  LanguageRegistry,
  SqliteGraphStore,
  indexProject,
} from "../dist/graph/index.js";
import go from "../dist/graph/languages/go/index.js";
import {
  initializeWorkspace,
  checkoutTrust,
} from "../dist/project/workspace.js";
import {
  readLocalTrust,
  writeLocalTrust,
} from "../dist/project/local-trust.js";
import { askTrust, TrustCancelled } from "../dist/project/trust.js";
import {
  committedToolPaths,
  graphConfig,
  graphToolchains,
  trustState,
} from "../dist/shared/config.js";
import { storeRows, compareRows } from "../scripts/reindex/dump.mjs";

const cli = resolve("dist/cli/main.js");
const GO_FIXTURE = fileURLToPath(
  new URL("./fixtures/graph-go-toolchain/basic", import.meta.url),
);
const haveGo = (process.env.PATH ?? "")
  .split(delimiter)
  .some((dir) => dir && existsSync(join(dir, "go")));
const needsGo = haveGo ? {} : { skip: "no go on PATH (toolchain route)" };
const settings = async (root) =>
  JSON.parse(await readFile(join(root, ".pymtheg/settings.json"), "utf8"));
const writeSettings = (root, graph) =>
  writeFile(
    join(root, ".pymtheg/settings.json"),
    JSON.stringify({ version: 1, scenarios: {}, ...(graph ? { graph } : {}) }),
  );
async function scratch(use) {
  const root = await mkdtemp(join(tmpdir(), "pym-trust-"));
  try {
    return await use(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const config = (graph) => ({
  version: 1,
  scenarios: {},
  ...(graph ? { graph: graphConfig(graph) } : {}),
});
const trusted = { trust: "trusted" };
const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
/** The project's Go-route decisions, the Go route's own counters. */
function decided(root) {
  const store = new SqliteGraphStore(
    join(root, ".pymtheg/rebuildable/graph.sqlite"),
    undefined,
    { readOnly: true },
  );
  try {
    return store
      .links()
      .filter((l) => l.data?.toolchain?.origin === "toolchain").length;
  } finally {
    store.close();
  }
}

test("only this machine's trusted answer turns routes on; committed settings can only turn them off", () => {
  // No local answer: nothing runs, whatever the committed settings say.
  assert.deepEqual(graphToolchains(config(), undefined), {});
  assert.deepEqual(
    graphToolchains(config({ trust: "trusted" }), undefined),
    {},
  );
  assert.deepEqual(
    graphToolchains(config({ toolchain: { go: true } }), undefined),
    {},
  );
  assert.equal(
    trustState(config({ trust: "trusted" }), undefined),
    "unanswered",
  );
  // The local answer.
  assert.deepEqual(graphToolchains(config(), trusted), { go: true });
  assert.deepEqual(graphToolchains(config(), { trust: "source-only" }), {});
  assert.equal(trustState(config(), trusted), "trusted");
  // A committed source-only binds over a local trusted.
  assert.deepEqual(
    graphToolchains(config({ trust: "source-only" }), trusted),
    {},
  );
  assert.equal(
    trustState(config({ trust: "source-only" }), trusted),
    "source-only",
  );
  // A committed false turns Go off; a committed path is never used.
  assert.deepEqual(
    graphToolchains(config({ toolchain: { go: false } }), trusted),
    {},
  );
  const committedPath = config({ toolchain: { go: "/repo/tools/go" } });
  assert.deepEqual(graphToolchains(committedPath, trusted), { go: true });
  assert.deepEqual(committedToolPaths(committedPath), ["go"]);
  // A tool path, or false, from the local answer.
  assert.deepEqual(
    graphToolchains(config(), {
      ...trusted,
      toolchain: { go: "/opt/go/bin/go" },
    }),
    { go: "/opt/go/bin/go" },
  );
  assert.deepEqual(
    graphToolchains(config(), { ...trusted, toolchain: { go: false } }),
    {},
  );
  assert.throws(() => graphConfig({ trust: "yes" }), /graph.trust must be/);
});

test("the prompt: Enter trusts, n is source only, other answers ask again, ended input trusts nothing", async () => {
  const ask = async (...lines) => {
    const input = new PassThrough();
    const output = new PassThrough();
    let shown = "";
    output.on("data", (chunk) => (shown += chunk));
    const answer = askTrust(input, output);
    for (const line of lines) input.write(line + "\n");
    input.end();
    return { answer: await answer, shown };
  };
  const enter = await ask("");
  assert.equal(enter.answer, "trusted");
  assert.match(enter.shown, /^Do you trust this repository\?/);
  assert.match(enter.shown, /\[Y\/n\]/);
  assert.equal((await ask("n")).answer, "source-only");
  assert.equal((await ask("NO")).answer, "source-only");
  assert.equal((await ask("yes")).answer, "trusted");
  const retried = await ask("maybe", "n");
  assert.equal(retried.answer, "source-only");
  assert.match(retried.shown, /Answer "y" \(trusted\) or "n" \(source only\)/);
  assert.equal((await ask()).answer, "source-only");
});

test("init records the answer for this checkout in .pymtheg/local, untracked and ignored by Git, never in the settings", async () => {
  await scratch(async (root) => {
    git(root, "init", "--quiet");
    const first = await initializeWorkspace(root, undefined, trusted);
    assert.equal(first.trust, "trusted");
    assert.equal(first.trustRecorded, true);
    assert.deepEqual(await settings(root), { version: 1, scenarios: {} });
    const local = JSON.parse(
      await readFile(join(root, ".pymtheg/local/trust.json"), "utf8"),
    );
    assert.equal(local.trust, "trusted");
    assert.equal(
      local.project,
      JSON.parse(await readFile(join(root, ".pymtheg/project.json"), "utf8"))
        .id,
    );
    // Git: the answer is ignored and untracked; what init commits holds none.
    git(root, "add", "-A");
    const tracked = git(root, "ls-files").split("\n").filter(Boolean);
    assert.ok(tracked.includes(".pymtheg/settings.json"));
    assert.equal(
      tracked.some((path) => path.startsWith(".pymtheg/local/")),
      false,
    );
    assert.match(
      git(root, "status", "--porcelain", "--ignored", ".pymtheg/local"),
      /^!! \.pymtheg\/local\/$/m,
    );
    assert.equal(
      git(root, "check-ignore", ".pymtheg/local/trust.json").trim(),
      ".pymtheg/local/trust.json",
    );
    // Re-running init keeps it; the same answer is a no-op; a different one is refused.
    const again = await initializeWorkspace(root);
    assert.equal(again.trust, "trusted");
    assert.equal(again.trustRecorded, false);
    assert.equal(
      (await initializeWorkspace(root, undefined, trusted)).trustRecorded,
      false,
    );
    await assert.rejects(
      initializeWorkspace(root, undefined, { trust: "source-only" }),
      /already "trusted"\. Init does not change it/,
    );
    // A nested folder uses the checkout's answer.
    const nested = join(root, "sub", "dir");
    await mkdir(nested, { recursive: true });
    const inner = await initializeWorkspace(nested);
    assert.equal(inner.root, root);
    assert.equal(inner.trust, "trusted");
    await assert.rejects(
      initializeWorkspace(nested, undefined, { trust: "source-only" }),
      /whose trust answer on this machine is "trusted"/,
    );
  });
});

test("a copied or moved checkout, or another project's file, is unanswered", async () => {
  await scratch(async (root) => {
    const a = join(root, "a");
    await initializeWorkspace(a, undefined, trusted);
    // A full copy (including .pymtheg/local): same project id, another path.
    cpSync(a, join(root, "copy"), { recursive: true });
    assert.equal(await readLocalTrust(join(root, "copy")), undefined);
    assert.equal(await checkoutTrust(join(root, "copy")), "unanswered");
    // Another project's answer file.
    const b = join(root, "b");
    await initializeWorkspace(b);
    cpSync(
      join(a, ".pymtheg/local/trust.json"),
      join(b, ".pymtheg/local/trust.json"),
    );
    assert.equal(await checkoutTrust(b), "unanswered");
    // Answering the copy records its own answer.
    await initializeWorkspace(join(root, "copy"), undefined, {
      trust: "source-only",
    });
    assert.equal(await checkoutTrust(join(root, "copy")), "source-only");
    assert.equal(await checkoutTrust(a), "trusted");
  });
});

test("a committed source-only binds: init cannot trust it and nothing runs whatever the local answer", async () => {
  await scratch(async (root) => {
    await initializeWorkspace(root);
    await writeSettings(root, { trust: "source-only" });
    await assert.rejects(
      initializeWorkspace(root, undefined, trusted),
      /says graph.trust "source-only": the repository allows no build tools/,
    );
    await writeLocalTrust(root, "trusted");
    assert.equal(await checkoutTrust(root), "source-only");
  });
});

test("command-line init: flags answer, no terminal records source only and says so, a clone is asked once", async () => {
  const init = (args) =>
    spawnSync(process.execPath, [cli, "init", ...args], {
      encoding: "utf8",
      input: "",
    });
  await scratch(async (root) => {
    const piped = init([join(root, "a")]);
    assert.equal(piped.status, 0, piped.stderr);
    assert.match(
      piped.stdout,
      /No terminal to ask whether you trust this repository, so recorded source only\./,
    );
    assert.match(piped.stdout, /\.pymtheg\/local\/trust\.json, never in Git/);
    assert.equal(await checkoutTrust(join(root, "a")), "source-only");
    const flagged = init([join(root, "b"), "--trust"]);
    assert.equal(flagged.status, 0, flagged.stderr);
    assert.match(
      flagged.stdout,
      /Trusted: the languages' official build tools/,
    );
    assert.equal(await checkoutTrust(join(root, "b")), "trusted");
    assert.equal((await settings(join(root, "b"))).graph, undefined);
    const both = init([join(root, "d"), "--trust", "--source-only"]);
    assert.notEqual(both.status, 0);
    assert.match(both.stderr, /Choose one of --trust and --source-only/);
    assert.equal(existsSync(join(root, "d", ".pymtheg")), false);
    // Re-running keeps the answer and asks nothing.
    const again = init([join(root, "b")]);
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(again.stdout, /No terminal/);
    const changed = init([join(root, "b"), "--source-only"]);
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /already "trusted"/);
    // A clone of an initialised project (its tracked files): init answers it and changes nothing else.
    const clone = join(root, "clone");
    for (const file of [
      ".pymtheg/project.json",
      ".pymtheg/settings.json",
      ".pymtheg/.gitignore",
    ])
      cpSync(join(root, "b", file), join(clone, file), { recursive: true });
    const before = await readFile(
      join(clone, ".pymtheg/settings.json"),
      "utf8",
    );
    assert.equal(await checkoutTrust(clone), "unanswered");
    const answered = init([clone, "--trust"]);
    assert.equal(answered.status, 0, answered.stderr);
    assert.match(answered.stdout, /Already initialized/);
    assert.equal(await checkoutTrust(clone), "trusted");
    assert.equal(
      await readFile(join(clone, ".pymtheg/settings.json"), "utf8"),
      before,
    );
  });
});

test("Studio setup records the dialog's answer on this machine and returns it", async () => {
  const { startStudio } = await import("../dist/studio/server.js");
  await scratch(async (root) => {
    const studio = await startStudio({ path: root });
    try {
      const post = (body) =>
        fetch(new URL("/api/project/initialize", studio.url), {
          method: "POST",
          headers: {
            Authorization: "Bearer " + studio.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      const response = await post({ name: "Trusted", trust: "trusted" });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.trust, "trusted");
      assert.equal(body.trustRecorded, true);
      assert.equal(await checkoutTrust(root), "trusted");
      assert.equal((await settings(root)).graph, undefined);
    } finally {
      await studio.close();
    }
  });
});

test("graph answers report the trust on this machine: unanswered says how to answer", async () => {
  await scratch(async (root) => {
    for (const [name, answer] of [
      ["none", null],
      ["unanswered", undefined],
      ["source", "source-only"],
    ]) {
      const project = join(root, name);
      cpSync(GO_FIXTURE, project, { recursive: true });
      if (answer !== null)
        await initializeWorkspace(
          project,
          undefined,
          answer ? { trust: answer } : {},
        );
      const response = await executeGraph({ command: "index", root: project });
      assert.equal(response.toolchain, undefined);
      if (answer === null) assert.equal("trust" in response, false);
      else if (answer === undefined) {
        assert.equal(response.trust, "unanswered");
        assert.match(
          response.trustAnswer,
          /^No trust answer on this machine, so nothing from this repository is run\./,
        );
      } else {
        assert.equal(response.trust, "source-only");
        assert.equal(response.trustAnswer, undefined);
      }
    }
  });
});

test(
  "a clone whose committed settings say trusted runs no toolchain and reports unanswered",
  needsGo,
  async () => {
    await scratch(async (root) => {
      const origin = join(root, "origin");
      cpSync(GO_FIXTURE, origin, { recursive: true });
      await initializeWorkspace(origin, undefined, trusted);
      await writeSettings(origin, {
        trust: "trusted",
        toolchain: { go: true },
      });
      // The author's own checkout runs the route.
      const own = await executeGraph({ command: "index", root: origin });
      assert.equal(own.toolchain.go.state, "used");
      assert.ok(decided(origin) > 0);
      // A clone: the tracked files only.
      git(origin, "init", "--quiet");
      git(origin, "add", "-A");
      const clone = join(root, "clone");
      for (const file of git(origin, "ls-files").split("\n").filter(Boolean))
        cpSync(join(origin, file), join(clone, file), { recursive: true });
      assert.equal(existsSync(join(clone, ".pymtheg/local")), false);
      const response = await executeGraph({ command: "index", root: clone });
      assert.equal(response.trust, "unanswered");
      assert.equal(response.toolchain, undefined);
      assert.equal(decided(clone), 0);
    });
  },
);

test("a committed tool path is never run", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    cpSync(GO_FIXTURE, project, { recursive: true });
    await initializeWorkspace(project, undefined, trusted);
    // A "go" inside the repository that would leave a marker if run.
    const marker = join(root, "ran.txt");
    const tool = join(project, "tools", "go");
    mkdirSync(dirname(tool), { recursive: true });
    await writeFile(tool, `#!/bin/sh\necho ran > '${marker}'\nexit 1\n`);
    chmodSync(tool, 0o755);
    await writeSettings(project, { toolchain: { go: tool } });
    const response = await executeGraph({ command: "index", root: project });
    assert.equal(existsSync(marker), false, "the committed tool path was run");
    assert.ok(
      response.warnings.some((w) => w.code === "committed-tool-path-ignored"),
    );
    // The route itself stays on with the user's own go (or says it has none).
    assert.equal(response.toolchain.setting.go, true);
  });
});

test("local trusted with a committed toolchain.go false keeps Go off; a committed source-only overrides local trusted", async () => {
  await scratch(async (root) => {
    for (const [name, graph, trust] of [
      ["off", { toolchain: { go: false } }, "trusted"],
      ["binding", { trust: "source-only" }, "source-only"],
    ]) {
      const project = join(root, name);
      cpSync(GO_FIXTURE, project, { recursive: true });
      await initializeWorkspace(project, undefined, trusted);
      await writeSettings(project, graph);
      const response = await executeGraph({ command: "index", root: project });
      assert.equal(response.trust, trust);
      assert.equal(response.toolchain, undefined);
      assert.equal(decided(project), 0);
    }
  });
});

test(
  "trusted on this machine runs the Go route with its existing policy, as the direct opt-in does",
  needsGo,
  async () => {
    await scratch(async (root) => {
      const run = async (name, toolchains) => {
        const store = new SqliteGraphStore(join(root, `${name}.sqlite`), "tc");
        try {
          const report = await indexProject(
            GO_FIXTURE,
            new LanguageRegistry([go]),
            store,
            {
              toolchainDirectory: join(root, `${name}-toolchain`),
              toolchains,
            },
          );
          const count = store
            .links()
            .filter(
              (link) => link.data?.toolchain?.origin === "toolchain",
            ).length;
          return { report, decided: count };
        } finally {
          store.close();
        }
      };
      const local = await run("trusted", graphToolchains(config(), trusted));
      const explicit = await run("explicit", { go: true });
      const source = await run(
        "source",
        graphToolchains(config(), { trust: "source-only" }),
      );
      assert.ok(local.decided > 0);
      assert.equal(local.decided, explicit.decided);
      assert.equal(source.decided, 0);
      assert.deepEqual(
        compareRows(
          storeRows(join(root, "trusted.sqlite")),
          storeRows(join(root, "explicit.sqlite")),
        ),
        [],
      );
    });
  },
);

test("over MCP, code_graph's trust parameter answers an initialised checkout that has none", async () => {
  const { AgentWorkspace } = await import("../dist/mcp/workspace.js");
  await scratch(async (root) => {
    await initializeWorkspace(root);
    const workspace = await AgentWorkspace.open(root);
    await workspace.answerTrust("source-only");
    assert.equal(await checkoutTrust(root), "source-only");
    await workspace.answerTrust("source-only");
    await assert.rejects(
      workspace.answerTrust("trusted"),
      /already "source-only"/,
    );
  });
  await scratch(async (fresh) => {
    await assert.rejects(
      (await AgentWorkspace.open(fresh)).answerTrust("trusted"),
      /not initialised/,
    );
  });
});

test("Ctrl-C at the trust prompt closes it and rejects: nothing is answered", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const controller = new AbortController();
  // Handshake: abort once the prompt line has been written.
  output.on("data", (chunk) => {
    if (String(chunk).includes("[Y/n]")) controller.abort();
  });
  await assert.rejects(
    askTrust(input, output, controller.signal),
    TrustCancelled,
  );
  // A later Enter answers nothing.
  input.write("\n");
  await assert.rejects(askTrust(input, output, controller.signal), /aborted/i);
});

test("a spy go first on PATH starts only for a checkout trusted on this machine", async () => {
  await scratch(async (root) => {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const marker = join(root, "go-started.txt");
    await writeFile(
      join(bin, "go"),
      `#!/bin/sh\necho started >> '${marker}'\nexit 1\n`,
    );
    chmodSync(join(bin, "go"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}${path}`;
    try {
      for (const [name, answer, starts] of [
        ["unanswered", undefined, false],
        ["source", "source-only", false],
        ["trusted", "trusted", true],
      ]) {
        const project = join(root, name);
        cpSync(GO_FIXTURE, project, { recursive: true });
        await initializeWorkspace(
          project,
          undefined,
          answer ? { trust: answer } : {},
        );
        await rm(marker, { force: true });
        await executeGraph({ command: "index", root: project });
        assert.equal(existsSync(marker), starts, name);
      }
    } finally {
      process.env.PATH = path;
    }
  });
});

test("observe_implementation that fails on a project never initialised creates no .pymtheg", async () => {
  const { AgentWorkspace } = await import("../dist/mcp/workspace.js");
  await scratch(async (root) => {
    const workspace = await AgentWorkspace.open(root);
    await assert.rejects(
      workspace.writeWithTrust("trusted", () =>
        workspace.access.observeImplementation(
          { files: ["missing.ts"], label: "Missing", expectedRevision: null },
          new AbortController().signal,
        ),
      ),
    );
    assert.equal(existsSync(join(root, ".pymtheg")), false);
    // Without the answer: the question, and nothing written.
    await assert.rejects(
      workspace.writeWithTrust(undefined, async () =>
        assert.fail("must not write"),
      ),
      /Do you trust this repository\?/,
    );
    assert.equal(existsSync(join(root, ".pymtheg")), false);
    // A write that proceeds initialises with the answer.
    await writeFile(join(root, "a.ts"), "export const a = 1;\n");
    await workspace.writeWithTrust("trusted", () =>
      workspace.access.observeImplementation(
        { files: ["a.ts"], label: "A", expectedRevision: null },
        new AbortController().signal,
      ),
    );
    assert.equal(await checkoutTrust(root), "trusted");
  });
});

test("Studio setup without trust records no answer and reports unanswered", async () => {
  const { startStudio } = await import("../dist/studio/server.js");
  await scratch(async (root) => {
    const studio = await startStudio({ path: root });
    try {
      const response = await fetch(
        new URL("/api/project/initialize", studio.url),
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + studio.token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: "No answer" }),
        },
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.trust, "unanswered");
      assert.equal(body.trustRecorded, false);
      assert.equal(existsSync(join(root, ".pymtheg/local/trust.json")), false);
      // The project view says so, and the dialog asks when it next opens.
      const view = await (
        await fetch(new URL("/api/project", studio.url), {
          headers: { Authorization: "Bearer " + studio.token },
        })
      ).json();
      assert.equal(view.trust, "unanswered");
    } finally {
      await studio.close();
    }
  });
});
