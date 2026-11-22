// SPDX-License-Identifier: MIT
import "./isolated-config.mjs";
// C-44 (decision D22): init asks once whether the repository is trusted, and
// the answer belongs to this machine, never to Git. Prompt tests drive the
// question through controlled streams; no test depends on a real terminal or
// on time.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
  revokeTrust,
  trustFile,
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

test("init records the answer in the user's own configuration, user-only, never under the checkout", async () => {
  await scratch(async (root) => {
    git(root, "init", "--quiet");
    const first = await initializeWorkspace(root, undefined, trusted);
    assert.equal(first.trust, "trusted");
    assert.equal(first.trustRecorded, true);
    assert.deepEqual(await settings(root), { version: 1, scenarios: {} });
    // Nothing new under the checkout but what init always writes.
    git(root, "add", "-A");
    assert.deepEqual(git(root, "ls-files").split("\n").filter(Boolean).sort(), [
      ".pymtheg/.gitignore",
      ".pymtheg/project.json",
      ".pymtheg/settings.json",
    ]);
    assert.equal(
      git(root, "status", "--porcelain", "--ignored").includes("local"),
      false,
    );
    // The user's file: outside the checkout, user-only, keyed by the real path.
    const file = trustFile();
    assert.equal(file.startsWith(process.env.PYMTHEG_CONFIG_HOME), true);
    assert.equal(file.startsWith(root), false);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(dirname(file)).mode & 0o077, 0);
    const answers = JSON.parse(await readFile(file, "utf8"));
    const entry = answers.checkouts[realpathSync(root)];
    assert.equal(entry.trust, "trusted");
    assert.equal(
      entry.project,
      JSON.parse(await readFile(join(root, ".pymtheg/project.json"), "utf8"))
        .id,
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
      /already "trusted"\. Init does not change it; run pymtheg trust --revoke/,
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

test("a copied or moved checkout, a symlinked path, another project at the path: keyed by real path and project id", async () => {
  await scratch(async (root) => {
    const a = join(root, "a");
    await initializeWorkspace(a, undefined, trusted);
    // A copy: same project id, another real path.
    cpSync(a, join(root, "copy"), { recursive: true });
    assert.equal(await readLocalTrust(join(root, "copy")), undefined);
    assert.equal(await checkoutTrust(join(root, "copy")), "unanswered");
    // A symlink to the checkout is the same real path: the same answer.
    symlinkSync(a, join(root, "link"));
    assert.equal(await checkoutTrust(join(root, "link")), "trusted");
    // Another project now at the recorded path (same path, new id): unanswered.
    const b = join(root, "b");
    await initializeWorkspace(b, undefined, trusted);
    await rm(b, { recursive: true });
    await initializeWorkspace(b);
    assert.equal(await checkoutTrust(b), "unanswered");
    // Answering the copy records its own answer and leaves the original alone.
    await initializeWorkspace(join(root, "copy"), undefined, {
      trust: "source-only",
    });
    assert.equal(await checkoutTrust(join(root, "copy")), "source-only");
    assert.equal(await checkoutTrust(a), "trusted");
  });
});

test("an unreadable, corrupt or wrong-typed answer file is unanswered, never trusted", async () => {
  await scratch(async (root) => {
    await initializeWorkspace(root, undefined, trusted);
    const file = trustFile();
    const good = await readFile(file, "utf8");
    const real = realpathSync(root);
    const id = JSON.parse(good).checkouts[real].project;
    for (const bad of [
      "{ not json",
      JSON.stringify({ schema: "other", checkouts: {} }),
      JSON.stringify({
        schema: "pymtheg.trust/v1",
        checkouts: { [real]: { project: id, trust: "yes" } },
      }),
      JSON.stringify({
        schema: "pymtheg.trust/v1",
        checkouts: {
          [real]: {
            project: id,
            trust: "trusted",
            toolchain: { go: "relative/go" },
          },
        },
      }),
      JSON.stringify({
        schema: "pymtheg.trust/v1",
        checkouts: { [real]: { project: 7, trust: "trusted" } },
      }),
    ]) {
      await writeFile(file, bad);
      assert.equal(await checkoutTrust(root), "unanswered", bad);
    }
    await writeFile(file, good);
    chmodSync(file, 0o000);
    try {
      // Root can read anything; the check holds for ordinary users.
      if (process.getuid?.() !== 0)
        assert.equal(await checkoutTrust(root), "unanswered");
    } finally {
      chmodSync(file, 0o600);
    }
    assert.equal(await checkoutTrust(root), "trusted");
  });
});

test("concurrent writers keep each other's answers", async () => {
  await scratch(async (root) => {
    const projects = Array.from({ length: 8 }, (_, i) => join(root, `p${i}`));
    for (const project of projects) await initializeWorkspace(project);
    await Promise.all(
      projects.map((project, i) =>
        writeLocalTrust(project, i % 2 ? "trusted" : "source-only"),
      ),
    );
    // And two processes at once.
    const [x, y] = [join(root, "x"), join(root, "y")];
    for (const project of [x, y]) await initializeWorkspace(project);
    const spawnInit = (dir) =>
      new Promise((done, fail) => {
        const child = spawn(process.execPath, [cli, "init", dir, "--trust"], {
          stdio: "ignore",
        });
        child.on("exit", (code) =>
          code === 0 ? done() : fail(Error(`init exited ${code}`)),
        );
      });
    await Promise.all([spawnInit(x), spawnInit(y)]);
    for (const [i, project] of projects.entries())
      assert.equal(
        await checkoutTrust(project),
        i % 2 ? "trusted" : "source-only",
      );
    assert.equal(await checkoutTrust(x), "trusted");
    assert.equal(await checkoutTrust(y), "trusted");
  });
});

test("pymtheg trust lists answers and --revoke removes one, also for a deleted checkout", async () => {
  await scratch(async (root) => {
    const run = (...args) =>
      spawnSync(process.execPath, [cli, "trust", ...args], {
        encoding: "utf8",
      });
    const a = join(root, "a");
    await initializeWorkspace(a, undefined, trusted);
    const listed = run("--list", "--format", "json");
    assert.equal(listed.status, 0, listed.stderr);
    assert.ok(
      JSON.parse(listed.stdout).answers.some(
        (entry) => entry.root === realpathSync(a) && entry.trust === "trusted",
      ),
    );
    assert.match(run().stdout, /trusted\s+.*\/a$/m);
    const revoked = run("--revoke", a);
    assert.match(revoked.stdout, /Removed the trust answer/);
    assert.equal(await checkoutTrust(a), "unanswered");
    // A deleted checkout leaves a stale entry that --revoke removes by its path.
    await initializeWorkspace(a, undefined, trusted);
    const real = realpathSync(a);
    await rm(a, { recursive: true });
    assert.ok(
      JSON.parse(run("--list", "--format", "json").stdout).answers.some(
        (entry) => entry.root === real,
      ),
    );
    assert.match(run("--revoke", real).stdout, /Removed/);
    assert.equal(
      JSON.parse(run("--list", "--format", "json").stdout).answers.some(
        (entry) => entry.root === real,
      ),
      false,
    );
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
    assert.match(
      piped.stdout,
      /your own Pymtheg configuration, never in the repository/,
    );
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
          /^No trust answer on this machine, so Pymtheg starts no program on this repository's behalf/,
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
      // The author also force-adds forged answers for the predictable
      // clone path: in the place C-44's first version read, and in the
      // user-file format. Nothing under a checkout is read as an answer.
      const clone = join(realpathSync(root), "clone");
      const id = JSON.parse(
        await readFile(join(origin, ".pymtheg/project.json"), "utf8"),
      ).id;
      const forged = {
        schema: "pymtheg.trust/v1",
        project: id,
        root: clone,
        trust: "trusted",
        checkouts: { [clone]: { project: id, trust: "trusted" } },
      };
      mkdirSync(join(origin, ".pymtheg/local"), { recursive: true });
      await writeFile(
        join(origin, ".pymtheg/local/trust.json"),
        JSON.stringify(forged),
      );
      await writeFile(
        join(origin, ".pymtheg/trust.json"),
        JSON.stringify(forged),
      );
      // A clone: the tracked files only, forged answers included.
      git(origin, "init", "--quiet");
      git(origin, "add", "-A");
      git(origin, "add", "-f", ".pymtheg/local/trust.json");
      const tracked = git(origin, "ls-files").split("\n").filter(Boolean);
      assert.ok(tracked.includes(".pymtheg/local/trust.json"));
      for (const file of tracked)
        cpSync(join(origin, file), join(clone, file), { recursive: true });
      assert.ok(existsSync(join(clone, ".pymtheg/local/trust.json")));
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
      assert.equal(await readLocalTrust(root), undefined);
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

test("the reviewer's attack: a force-committed in-tree answer with an in-repository tool path at the clone's path runs nothing", async () => {
  await scratch(async (root) => {
    const origin = join(root, "origin");
    cpSync(GO_FIXTURE, origin, { recursive: true });
    await initializeWorkspace(origin);
    const id = JSON.parse(
      await readFile(join(origin, ".pymtheg/project.json"), "utf8"),
    ).id;
    const clone = join(realpathSync(root), "clone");
    // An in-repository "go" that would leave a marker, and a spy go first on PATH.
    const marker = join(root, "repo-script-ran.txt");
    const spyMarker = join(root, "spy-go-started.txt");
    mkdirSync(join(origin, "tools"));
    await writeFile(
      join(origin, "tools", "go"),
      `#!/bin/sh\necho ran >> '${marker}'\nexit 1\n`,
    );
    chmodSync(join(origin, "tools", "go"), 0o755);
    const bin = join(root, "bin");
    mkdirSync(bin);
    await writeFile(
      join(bin, "go"),
      `#!/bin/sh\necho started >> '${spyMarker}'\nexit 1\n`,
    );
    chmodSync(join(bin, "go"), 0o755);
    mkdirSync(join(origin, ".pymtheg/local"), { recursive: true });
    await writeFile(
      join(origin, ".pymtheg/local/trust.json"),
      JSON.stringify({
        schema: "pymtheg.trust/v1",
        project: id,
        root: clone,
        trust: "trusted",
        toolchain: { go: join(clone, "tools", "go") },
      }),
    );
    git(origin, "init", "--quiet");
    git(origin, "add", "-A");
    git(origin, "add", "-f", ".pymtheg/local/trust.json");
    for (const file of git(origin, "ls-files").split("\n").filter(Boolean))
      cpSync(join(origin, file), join(clone, file), { recursive: true });
    chmodSync(join(clone, "tools", "go"), 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}${delimiter}${path}`;
    try {
      const response = await executeGraph({ command: "index", root: clone });
      assert.equal(response.trust, "unanswered");
      assert.equal(response.toolchain, undefined);
    } finally {
      process.env.PATH = path;
    }
    assert.equal(existsSync(spyMarker), false, "the spy go was started");
    assert.equal(existsSync(marker), false, "the repository's script ran");
  });
});

test("a tool path inside the checkout is refused even from the user's own answer", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    cpSync(GO_FIXTURE, project, { recursive: true });
    await initializeWorkspace(project, undefined, trusted);
    const marker = join(root, "ran.txt");
    mkdirSync(join(project, "bin"));
    await writeFile(
      join(project, "bin", "go"),
      `#!/bin/sh\necho ran > '${marker}'\nexit 1\n`,
    );
    chmodSync(join(project, "bin", "go"), 0o755);
    // Through a symlink outside the checkout too: the real path decides.
    symlinkSync(join(project, "bin", "go"), join(root, "go-link"));
    for (const tool of [join(project, "bin", "go"), join(root, "go-link")]) {
      const answers = JSON.parse(await readFile(trustFile(), "utf8"));
      answers.checkouts[realpathSync(project)].toolchain = { go: tool };
      await writeFile(trustFile(), JSON.stringify(answers));
      const response = await executeGraph({ command: "index", root: project });
      assert.ok(
        response.warnings.some((w) => w.code === "tool-path-inside-checkout"),
        tool,
      );
      assert.equal(response.toolchain?.go, undefined);
      assert.equal(existsSync(marker), false, tool);
    }
  });
});

test("a hostile committed .pymtheg/local/.gitignore is rewritten before anything is written there", async () => {
  const { localHistoryWriter } = await import("../dist/storage/writer.js");
  await scratch(async (root) => {
    git(root, "init", "--quiet");
    await initializeWorkspace(root);
    mkdirSync(join(root, ".pymtheg/local"), { recursive: true });
    await writeFile(
      join(root, ".pymtheg/local/.gitignore"),
      "# ignores nothing\n!*\n",
    );
    git(root, "add", "-f", ".pymtheg/local/.gitignore");
    localHistoryWriter(root);
    assert.equal(
      await readFile(join(root, ".pymtheg/local/.gitignore"), "utf8"),
      "*\n",
    );
    assert.equal(
      git(root, "check-ignore", ".pymtheg/local/writer.json").trim(),
      ".pymtheg/local/writer.json",
    );
  });
});

test("a failed first link write (an unknown record) on a never-initialised project creates nothing", async () => {
  const { createCodeLink, removeCodeLink } = await import(
    "../dist/architecture/code-links.js"
  );
  await scratch(async (root) => {
    await writeFile(join(root, "a.go"), "package p\nfunc Save() {}\n");
    const added = await createCodeLink({
      root,
      record: "R9",
      selector: "Save",
    });
    assert.equal(added.status, "record-not-found");
    await assert.rejects(removeCodeLink({ root, link: "deadbeef-x" }));
    assert.equal(existsSync(join(root, ".pymtheg")), false);
  });
});

test("a test process that lost its isolated configuration folder refuses to write the real trust answers", async () => {
  await scratch(async (root) => {
    await initializeWorkspace(root);
    const { PYMTHEG_CONFIG_HOME: _home, ...env } = process.env;
    const result = spawnSync(process.execPath, [cli, "init", root, "--trust"], {
      encoding: "utf8",
      input: "",
      env: { ...env, PYMTHEG_TEST: "1" },
    });
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr + result.stdout,
      /refusing to write the real trust answers from a test run/,
    );
    // Every test process here runs isolated, and MCP servers inherit it.
    assert.equal(process.env.PYMTHEG_TEST, "1");
    const { DEFAULT_INHERITED_ENV_VARS } = await import(
      "@modelcontextprotocol/client/stdio"
    );
    assert.ok(DEFAULT_INHERITED_ENV_VARS.includes("PYMTHEG_CONFIG_HOME"));
  });
});

test("a corrupt answers file is moved aside, user-only, not silently replaced; the folder is kept user-only", async () => {
  await scratch(async (base) => {
    const root = join(base, "a");
    await initializeWorkspace(root);
    const file = trustFile();
    mkdirSync(dirname(file), { recursive: true });
    await writeFile(file, "{ not json");
    chmodSync(dirname(file), 0o755);
    await writeLocalTrust(root, "trusted");
    const aside = readdirSync(dirname(file)).filter((n) =>
      n.startsWith("trust.json.corrupt-"),
    );
    assert.ok(aside.length >= 1);
    const kept = join(dirname(file), aside.at(-1));
    assert.equal(await readFile(kept, "utf8"), "{ not json");
    assert.equal(statSync(kept).mode & 0o777, 0o600);
    // A folder the user named (PYMTHEG_CONFIG_HOME) is left as it is.
    assert.equal(statSync(dirname(file)).mode & 0o777, 0o755);
    assert.equal(await checkoutTrust(root), "trusted");
    // A wrong-typed entry is set aside the same way; the valid entries stay.
    const answers = JSON.parse(await readFile(file, "utf8"));
    answers.checkouts["/somewhere/else"] = { project: 1, trust: "maybe" };
    await writeFile(file, JSON.stringify(answers));
    const other = join(base, "b");
    await initializeWorkspace(other, undefined, { trust: "source-only" });
    assert.equal(await checkoutTrust(root), "trusted");
    assert.equal(await checkoutTrust(other), "source-only");
    assert.ok(
      readdirSync(dirname(file)).filter((n) =>
        n.startsWith("trust.json.corrupt-"),
      ).length > aside.length,
    );
  });
});

test("a tool path reaching the checkout through a symlink chain, or a checkout opened through a symlinked parent, is refused", async () => {
  await scratch(async (root) => {
    const real = join(root, "real");
    const project = join(real, "project");
    cpSync(GO_FIXTURE, project, { recursive: true });
    await initializeWorkspace(project, undefined, trusted);
    const marker = join(root, "ran.txt");
    mkdirSync(join(project, "bin"));
    await writeFile(
      join(project, "bin", "go"),
      `#!/bin/sh\necho ran > '${marker}'\nexit 1\n`,
    );
    chmodSync(join(project, "bin", "go"), 0o755);
    // A chain of links outside the checkout ending in its bin folder.
    symlinkSync(join(project, "bin"), join(root, "hop1"));
    symlinkSync(join(root, "hop1"), join(root, "hop2"));
    // The same checkout opened through a symlinked parent.
    symlinkSync(real, join(root, "alias"));
    const answers = JSON.parse(await readFile(trustFile(), "utf8"));
    answers.checkouts[realpathSync(project)].toolchain = {
      go: join(root, "hop2", "go"),
    };
    await writeFile(trustFile(), JSON.stringify(answers));
    for (const opened of [project, join(root, "alias", "project")]) {
      const response = await executeGraph({ command: "index", root: opened });
      assert.ok(
        response.warnings.some((w) => w.code === "tool-path-inside-checkout"),
        opened,
      );
      assert.equal(existsSync(marker), false);
    }
  });
});

// ---------------------------------------------------------------- the answers-file lock (round 4)

/** A promise and its resolver. */
const gate = () => {
  let open;
  const promise = new Promise((resolve) => (open = resolve));
  return { promise, open };
};

test("the lock under contention: twelve inits at once, three rounds, and a revoke racing them, lose nothing", async () => {
  await scratch(async (root) => {
    const spawnCli = (args) =>
      new Promise((done, fail) => {
        const child = spawn(process.execPath, [cli, ...args], {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        child.on("exit", (code) =>
          code === 0
            ? done(out)
            : fail(Error(`${args.join(" ")} exited ${code}`)),
        );
      });
    const victim = join(root, "victim");
    await initializeWorkspace(victim, undefined, trusted);
    for (let round = 0; round < 3; round++) {
      const dirs = Array.from({ length: 12 }, (_, i) =>
        join(root, `r${round}-${i}`),
      );
      for (const dir of dirs) await initializeWorkspace(dir);
      const [revoked] = await Promise.all([
        spawnCli(["trust", "--revoke", victim]),
        ...dirs.map((dir) => spawnCli(["init", dir, "--trust"])),
      ]);
      for (const dir of dirs)
        assert.equal(await checkoutTrust(dir), "trusted", dir);
      assert.match(revoked, /Removed the trust answer/);
      assert.equal(await checkoutTrust(victim), "unanswered");
      await writeLocalTrust(victim, "trusted");
    }
  });
});

test("pymtheg trust: --revoke json revokes the folder named json, and --format text works", async () => {
  await scratch(async (root) => {
    const folder = join(root, "json");
    await initializeWorkspace(folder, undefined, trusted);
    const run = (...args) =>
      spawnSync(process.execPath, [cli, "trust", ...args], {
        encoding: "utf8",
        cwd: root,
      });
    assert.match(run("--format", "text").stdout, /^Trust answers/);
    const revoked = run("--revoke", "json");
    assert.match(revoked.stdout, /Removed the trust answer for .*json/);
    assert.equal(await checkoutTrust(folder), "unanswered");
    assert.notEqual(run("--format", "yaml").status, 0);
  });
});

test("a configuration home inside the checkout is refused", async () => {
  await scratch(async (root) => {
    await initializeWorkspace(root);
    const inside = join(root, "cfg");
    const result = spawnSync(process.execPath, [cli, "init", root, "--trust"], {
      encoding: "utf8",
      env: { ...process.env, PYMTHEG_CONFIG_HOME: inside },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /lies inside this checkout/);
    assert.equal(await checkoutTrust(root), "unanswered");
  });
});

test("the tool's own configuration folder (…/pymtheg) is tightened to user-only on a write", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    await initializeWorkspace(project);
    const xdg = join(root, "xdg");
    mkdirSync(join(xdg, "pymtheg"), { recursive: true, mode: 0o755 });
    chmodSync(join(xdg, "pymtheg"), 0o755);
    const {
      PYMTHEG_CONFIG_HOME: _home,
      PYMTHEG_TEST: _test,
      ...env
    } = process.env;
    const result = spawnSync(
      process.execPath,
      [cli, "init", project, "--trust"],
      {
        encoding: "utf8",
        env: { ...env, XDG_CONFIG_HOME: xdg },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(statSync(join(xdg, "pymtheg")).mode & 0o777, 0o700);
    assert.equal(statSync(xdg).mode & 0o777, statSync(xdg).mode & 0o777);
  });
});

// ---------------------------------------------------------------- the answers lock (round 5: SQLite)

/** A child process with its output lines as a queue of awaited events. */
function child(args) {
  const proc = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./trust-lock-child.mjs", import.meta.url)),
      ...args,
    ],
    {
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  const lines = [];
  const waiting = [];
  let buffer = "";
  proc.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (let i; (i = buffer.indexOf("\n")) >= 0; ) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      lines.push(line);
      waiting.splice(0).forEach((wake) => wake());
    }
  });
  const exited = new Promise((resolve) => proc.on("exit", resolve));
  // Resolves when the child has printed `line`; a child that exits first fails.
  const saw = async (line) => {
    for (;;) {
      if (lines.includes(line)) return;
      const more = new Promise((wake) => waiting.push(wake));
      const ended = await Promise.race([
        more.then(() => false),
        exited.then(() => true),
      ]);
      if (ended && !lines.includes(line))
        throw Error(`child exited before "${line}" (${lines.join(", ")})`);
    }
  };
  return { proc, lines, saw, exited };
}

test(
  "the lock: a holder makes another writer wait until it releases; a holder killed while holding releases at once",
  { timeout: 120_000 },
  async () => {
    await scratch(async (root) => {
      const [a, b, c] = ["a", "b", "c"].map((n) => join(root, n));
      for (const project of [a, b, c]) await initializeWorkspace(project);
      const events = [];
      const holder = child(["hold", a]);
      await holder.saw("held");
      const writer = child(["write", b, "source-only"]);
      await writer.saw("start");
      writer.exited.then(() => events.push("writer done"));
      events.push("releasing");
      holder.proc.stdin.write("go\n");
      await holder.saw("released");
      await writer.saw("done");
      assert.deepEqual(
        events.slice(0, 1),
        ["releasing"],
        "the writer finished while the lock was held",
      );
      await Promise.all([holder.exited, writer.exited]);
      assert.equal(await checkoutTrust(a), "trusted");
      assert.equal(await checkoutTrust(b), "source-only");
      // A holder killed with SIGKILL while holding: the next writer proceeds.
      const killed = child(["hold", c]);
      await killed.saw("held");
      killed.proc.kill("SIGKILL");
      await killed.exited;
      await writeLocalTrust(c, "trusted");
      assert.equal(await checkoutTrust(c), "trusted");
    });
  },
);

test(
  "the lock under contention with a killed holder each round: twelve inits and a revoke race, nothing lost",
  { timeout: 300_000 },
  async () => {
    await scratch(async (root) => {
      const victim = join(root, "victim");
      await initializeWorkspace(victim, undefined, trusted);
      const run = (args) =>
        new Promise((done, fail) => {
          const proc = spawn(process.execPath, [cli, ...args], {
            stdio: ["ignore", "pipe", "pipe"],
          });
          let out = "";
          proc.stdout.on("data", (d) => (out += d));
          proc.on("exit", (code) =>
            code === 0
              ? done(out)
              : fail(Error(`${args.join(" ")} exited ${code}`)),
          );
        });
      for (let round = 0; round < 3; round++) {
        const dirs = Array.from({ length: 12 }, (_, i) =>
          join(root, `r${round}-${i}`),
        );
        for (const dir of [...dirs, join(root, `k${round}`)])
          await initializeWorkspace(dir);
        const killed = child(["hold", join(root, `k${round}`)]);
        await killed.saw("held");
        const all = Promise.all([
          run(["trust", "--revoke", victim]),
          ...dirs.map((dir) => run(["init", dir, "--trust"])),
        ]);
        killed.proc.kill("SIGKILL");
        const [revoked] = await all;
        for (const dir of dirs)
          assert.equal(await checkoutTrust(dir), "trusted", dir);
        assert.match(revoked, /Removed the trust answer/);
        assert.equal(await checkoutTrust(victim), "unanswered");
        await writeLocalTrust(victim, "trusted");
      }
    });
  },
);

test(
  "a Go helper planted at the name the code computes, in the checkout, is never run",
  needsGo,
  async () => {
    const { createHash } = await import("node:crypto");
    const { HELPER_SOURCE, installation } = await import(
      "../dist/graph/languages/go/toolchain.js"
    );
    await scratch(async (root) => {
      const project = join(root, "project");
      cpSync(GO_FIXTURE, project, { recursive: true });
      await initializeWorkspace(project, undefined, trusted);
      const install = await installation(true, process.env, join(root, "env"));
      assert.ok(!("unavailable" in install), JSON.stringify(install));
      const sha = (...parts) => {
        const hash = createHash("sha256");
        for (const part of parts) hash.update(part).update("\u0000");
        return hash.digest("hex");
      };
      const name = `golinks-${sha(readFileSync(HELPER_SOURCE), install.go, install.version).slice(0, 16)}`;
      const marker = join(root, "planted-ran.txt");
      const plant = (dir) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, name),
          `#!/bin/sh\necho ran >> '${marker}'\nexit 1\n`,
        );
        chmodSync(join(dir, name), 0o755);
      };
      // The place C-44's first rounds built the helper.
      plant(join(project, ".pymtheg/rebuildable/toolchain/go"));
      await executeGraph({ command: "index", root: project });
      assert.equal(existsSync(marker), false, "the planted helper ran");
      // Control: a work folder inside the checkout, as before the fix, does run it.
      const store = new SqliteGraphStore(join(root, "control.sqlite"), "tc");
      try {
        await indexProject(project, new LanguageRegistry([go]), store, {
          toolchains: { go: true },
          toolchainDirectory: join(project, ".pymtheg/rebuildable/toolchain"),
        });
      } finally {
        store.close();
      }
      assert.equal(
        existsSync(marker),
        true,
        "the control did not reach the planted name",
      );
    });
  },
);

test("a cache home inside the checkout turns the routes off", async () => {
  await scratch(async (root) => {
    const project = join(root, "project");
    cpSync(GO_FIXTURE, project, { recursive: true });
    await initializeWorkspace(project, undefined, trusted);
    const result = spawnSync(
      process.execPath,
      [cli, "graph", "index", "--root", project, "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, PYMTHEG_CACHE_HOME: join(project, "cache") },
      },
    );
    const response = JSON.parse(result.stdout);
    assert.ok(
      response.warnings.some((w) => w.code === "cache-home-inside-checkout"),
    );
    assert.equal(response.toolchain, undefined);
    assert.equal(existsSync(join(project, "cache")), false);
  });
});

test("the test guards: no real configuration or cache from a test run, whatever XDG says", async () => {
  await scratch(async (base) => {
    const root = join(base, "p");
    await initializeWorkspace(root);
    const {
      PYMTHEG_CONFIG_HOME: _c,
      PYMTHEG_CACHE_HOME: _k,
      ...env
    } = process.env;
    const answer = spawnSync(process.execPath, [cli, "init", root, "--trust"], {
      encoding: "utf8",
      input: "",
      env: { ...env, PYMTHEG_TEST: "1", XDG_CONFIG_HOME: join(base, "xdg") },
    });
    assert.notEqual(answer.status, 0);
    assert.match(
      answer.stderr + answer.stdout,
      /refusing to write the real trust answers/,
    );
    const { toolchainWorkDirectory } = await import(
      "../dist/project/local-trust.js"
    );
    const saved = process.env.PYMTHEG_CACHE_HOME;
    delete process.env.PYMTHEG_CACHE_HOME;
    try {
      assert.throws(
        () => toolchainWorkDirectory(root),
        /refusing to use the real cache/,
      );
    } finally {
      process.env.PYMTHEG_CACHE_HOME = saved;
    }
    // Cache folders are user-only.
    const work = toolchainWorkDirectory(root);
    assert.equal(statSync(work).mode & 0o777, 0o700);
    assert.equal(statSync(dirname(work)).mode & 0o777, 0o700);
  });
});

/**
 * A folder that arrives with Git configuration naming a script: core.fsmonitor,
 * a clean/smudge filter whose driver name contains "=" (`x=y`), diff.external,
 * and an included file of 30,000 keys ahead of a second filter.
 */
async function hostileRepository(project, script) {
  mkdirSync(project, { recursive: true });
  git(project, "init", "--quiet");
  await writeFile(join(project, "a.ts"), "export const a = 1;\n");
  git(project, "add", "a.ts");
  git(
    project,
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "a",
  );
  await writeFile(
    join(project, ".gitattributes"),
    "a.ts filter=x=y\n*.ts filter=late\n",
  );
  const big = join(project, ".git", "big.config");
  await writeFile(
    big,
    "[padding]\n" +
      Array.from({ length: 30000 }, (_, i) => `\tkey${i} = value${i}\n`).join(
        "",
      ) +
      `[filter "late"]\n\tclean = ${script}\n\tsmudge = ${script}\n`,
  );
  const config = join(project, ".git", "config");
  await writeFile(
    config,
    (await readFile(config, "utf8")) +
      `[core]\n\tfsmonitor = ${script}\n[filter "x=y"]\n\tclean = ${script}\n\tsmudge = ${script}\n[diff]\n\texternal = ${script}\n[include]\n\tpath = big.config\n`,
  );
  await writeFile(join(project, "a.ts"), "export const a = 2;\n");
}

test("untrusted (source only, unanswered): no Git process is started at all; the commit is read from files and changes are unknown", async () => {
  await scratch(async (root) => {
    const bin = join(root, "bin");
    mkdirSync(bin);
    const starts = join(root, "git-starts.txt");
    // A spy git first on PATH records every start (and then fails).
    await writeFile(
      join(bin, "git"),
      `#!/bin/sh\necho "$@" >> '${starts}'\nexit 1\n`,
    );
    chmodSync(join(bin, "git"), 0o755);
    const marker = join(root, "script-ran.txt");
    const script = join(root, "evil.sh");
    await writeFile(script, `#!/bin/sh\necho ran >> '${marker}'\ncat\n`);
    chmodSync(script, 0o755);
    for (const answer of ["source-only", undefined]) {
      const project = join(root, answer ?? "unanswered");
      await hostileRepository(project, script);
      const head = git(project, "rev-parse", "HEAD").trim();
      if (existsSync(starts)) await rm(starts);
      const env = {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
      };
      const init = spawnSync(
        process.execPath,
        [cli, "init", project, ...(answer ? ["--source-only"] : [])],
        { encoding: "utf8", input: "", env },
      );
      assert.equal(init.status, 0, init.stderr);
      if (!answer) await revokeTrust(project);
      const observed = spawnSync(
        process.execPath,
        [cli, "observe", "a.ts", "--root", project, "--format", "json"],
        { encoding: "utf8", env },
      );
      assert.equal(observed.status, 0, observed.stderr);
      assert.equal(
        existsSync(starts),
        false,
        `git was started: ${existsSync(starts) ? readFileSync(starts, "utf8") : ""}`,
      );
      assert.equal(existsSync(marker), false);
      const { version } = JSON.parse(observed.stdout);
      assert.equal(version.gitCommit, head);
      assert.equal(version.dirty, "unknown");
    }
  });
});

test("trusted: Git runs, and nothing from the folder's configuration (a driver named x=y, a 30,000-key include) starts", async () => {
  await scratch(async (root) => {
    const marker = join(root, "script-ran.txt");
    const script = join(root, "evil.sh");
    await writeFile(script, `#!/bin/sh\necho ran >> '${marker}'\ncat\n`);
    chmodSync(script, 0o755);
    const project = join(root, "trusted");
    await hostileRepository(project, script);
    await initializeWorkspace(project, undefined, trusted);
    const observed = spawnSync(
      process.execPath,
      [cli, "observe", "a.ts", "--root", project, "--format", "json"],
      { encoding: "utf8" },
    );
    assert.equal(observed.status, 0, observed.stderr);
    assert.equal(
      existsSync(marker),
      false,
      "the folder's Git configuration started a program",
    );
  });
});

test("the commit is read from files: a .git file naming the git folder, a worktree, packed refs and a detached HEAD", async () => {
  const { gitCommitFromFiles } = await import("../dist/shared/safe-git.js");
  await scratch(async (root) => {
    const repo = join(root, "repo");
    mkdirSync(repo);
    git(repo, "init", "--quiet");
    await writeFile(join(repo, "a.txt"), "a\n");
    git(repo, "add", "a.txt");
    git(
      repo,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "a",
    );
    const head = git(repo, "rev-parse", "HEAD").trim();
    assert.equal(await gitCommitFromFiles(repo), head);
    mkdirSync(join(repo, "sub", "dir"), { recursive: true });
    assert.equal(await gitCommitFromFiles(join(repo, "sub", "dir")), head);
    git(repo, "pack-refs", "--all");
    assert.equal(await gitCommitFromFiles(repo), head);
    git(repo, "worktree", "add", "--quiet", join(root, "wt"));
    assert.equal(await gitCommitFromFiles(join(root, "wt")), head);
    git(repo, "checkout", "--quiet", "--detach");
    assert.equal(await gitCommitFromFiles(repo), head);
    const plain = join(root, "plain");
    mkdirSync(plain);
    assert.equal(await gitCommitFromFiles(plain), null);
  });
});

test("the commit reader reads only bounded regular files: a FIFO or an endless device as HEAD, a loose ref, packed-refs or an outside git folder's HEAD gives no commit, never a hang", async () => {
  const { gitCommitFromFiles } = await import("../dist/shared/safe-git.js");
  await scratch(async (root) => {
    const fifo = (path) => execFileSync("mkfifo", [path]);
    const repo = async (name) => {
      const dir = join(root, name);
      mkdirSync(join(dir, ".git", "refs", "heads"), { recursive: true });
      await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
      return dir;
    };
    // 1. HEAD is a FIFO.
    const a = await repo("head-fifo");
    await rm(join(a, ".git", "HEAD"));
    fifo(join(a, ".git", "HEAD"));
    assert.equal(await gitCommitFromFiles(a), null);
    // 2. A loose ref is a link to an endless device (outside the git folder).
    const b = await repo("ref-device");
    symlinkSync("/dev/zero", join(b, ".git", "refs", "heads", "main"));
    assert.equal(await gitCommitFromFiles(b), null);
    // 3. packed-refs is a FIFO (and the loose ref is missing).
    const c = await repo("packed-fifo");
    fifo(join(c, ".git", "packed-refs"));
    assert.equal(await gitCommitFromFiles(c), null);
    // 4. A .git file names an outside git folder whose HEAD is a FIFO.
    const outside = join(root, "outside-gitdir");
    mkdirSync(outside);
    fifo(join(outside, "HEAD"));
    const d = join(root, "linked");
    mkdirSync(d);
    await writeFile(join(d, ".git"), `gitdir: ${outside}\n`);
    assert.equal(await gitCommitFromFiles(d), null);
    // A packed-refs over the cap is not read either.
    const e = await repo("packed-big");
    await writeFile(
      join(e, ".git", "packed-refs"),
      "x".repeat(33 * 1024 * 1024),
    );
    assert.equal(await gitCommitFromFiles(e), null);
    // An aborted signal stops the read.
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(gitCommitFromFiles(e, controller.signal));
    // A regular repository still gives its commit.
    const ok = await repo("ok");
    const sha = "a".repeat(40);
    await writeFile(join(ok, ".git", "refs", "heads", "main"), sha + "\n");
    assert.equal(await gitCommitFromFiles(ok), sha);
  });
});
