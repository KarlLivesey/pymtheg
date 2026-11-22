// SPDX-License-Identifier: MIT
// C-44 (decision D22): init asks once whether the repository is trusted.
// Prompt tests drive the question through controlled streams; no test
// depends on a real terminal or on time.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
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
import { initializeWorkspace } from "../dist/project/workspace.js";
import { askTrust } from "../dist/project/trust.js";
import { graphConfig, graphToolchains } from "../dist/shared/config.js";
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

test("trust: trusted runs the Go route, source-only and absent run nothing, and a per-language setting wins", () => {
  assert.deepEqual(graphToolchains(config()), {});
  assert.deepEqual(graphToolchains(config({ trust: "source-only" })), {});
  assert.deepEqual(graphToolchains(config({ trust: "trusted" })), {
    go: true,
  });
  assert.deepEqual(
    graphToolchains(config({ trust: "trusted", toolchain: { go: false } })),
    {},
  );
  assert.deepEqual(
    graphToolchains(
      config({ trust: "source-only", toolchain: { go: "/usr/lib/go/bin/go" } }),
    ),
    { go: "/usr/lib/go/bin/go" },
  );
  assert.deepEqual(
    graphToolchains(config({ trust: "source-only", toolchain: { go: true } })),
    { go: true },
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

test("init records the answer once: new, re-init, explicit answer for an unanswered project, nested folders", async () => {
  await scratch(async (root) => {
    const first = await initializeWorkspace(root, undefined, {
      trust: "trusted",
    });
    assert.equal(first.trust, "trusted");
    assert.equal(first.trustRecorded, true);
    assert.deepEqual(await settings(root), {
      version: 1,
      scenarios: {},
      graph: { trust: "trusted" },
    });
    // Re-running init keeps it; the same answer is a no-op.
    const again = await initializeWorkspace(root);
    assert.equal(again.trust, "trusted");
    assert.equal(again.trustRecorded, false);
    assert.equal(
      (await initializeWorkspace(root, undefined, { trust: "trusted" }))
        .trustRecorded,
      false,
    );
    // A different answer is refused, never changed silently.
    await assert.rejects(
      initializeWorkspace(root, undefined, { trust: "source-only" }),
      /already "trusted"\. Init does not change it/,
    );
    assert.equal((await settings(root)).graph.trust, "trusted");
    // A nested folder uses the project's answer.
    const nested = join(root, "sub", "dir");
    await mkdir(nested, { recursive: true });
    const inner = await initializeWorkspace(nested);
    assert.equal(inner.root, root);
    assert.equal(inner.trust, "trusted");
    await assert.rejects(
      initializeWorkspace(nested, undefined, { trust: "source-only" }),
      /whose trust answer is "trusted"/,
    );
  });
  await scratch(async (root) => {
    // An existing project without an answer: only an explicit answer records
    // it, keeping everything else in the file.
    await initializeWorkspace(root);
    await writeFile(
      join(root, ".pymtheg/settings.json"),
      JSON.stringify({ version: 1, scenarios: {}, defaultFile: "a.pym" }),
    );
    assert.equal((await initializeWorkspace(root)).trust, null);
    const unanswered = await initializeWorkspace(root, undefined, {
      trust: "source-only",
      defaulted: true,
    });
    assert.equal(unanswered.trust, null);
    assert.equal((await settings(root)).graph, undefined);
    const answered = await initializeWorkspace(root, undefined, {
      trust: "source-only",
    });
    assert.equal(answered.trustRecorded, true);
    assert.deepEqual(await settings(root), {
      version: 1,
      scenarios: {},
      defaultFile: "a.pym",
      graph: { trust: "source-only" },
    });
  });
});

test("command-line init: flags answer, no terminal records source only and says so, re-init does not change it", async () => {
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
    assert.equal((await settings(join(root, "a"))).graph.trust, "source-only");
    const flagged = init([join(root, "b"), "--trust"]);
    assert.equal(flagged.status, 0, flagged.stderr);
    assert.match(flagged.stdout, /Trusted: the languages' official tools/);
    assert.equal((await settings(join(root, "b"))).graph.trust, "trusted");
    const source = init([join(root, "c"), "--source-only"]);
    assert.equal((await settings(join(root, "c"))).graph.trust, "source-only");
    assert.equal(source.status, 0, source.stderr);
    const both = init([join(root, "d"), "--trust", "--source-only"]);
    assert.notEqual(both.status, 0);
    assert.match(both.stderr, /Choose one of --trust and --source-only/);
    assert.equal(existsSync(join(root, "d", ".pymtheg")), false);
    // Re-running without a flag keeps the answer and asks nothing.
    const again = init([join(root, "b")]);
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(again.stdout, /No terminal/);
    assert.equal((await settings(join(root, "b"))).graph.trust, "trusted");
    const changed = init([join(root, "b"), "--source-only"]);
    assert.notEqual(changed.status, 0);
    assert.match(changed.stderr, /already "trusted"/);
    assert.equal((await settings(join(root, "b"))).graph.trust, "trusted");
  });
});

test("Studio setup records the dialog's answer and returns it", async () => {
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
          body: JSON.stringify({ name: "Trusted", trust: "trusted" }),
        },
      );
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.trust, "trusted");
      assert.equal(body.trustRecorded, true);
      assert.equal((await settings(root)).graph.trust, "trusted");
    } finally {
      await studio.close();
    }
  });
});

test("graph answers report the recorded answer, and only when there is one", async () => {
  await scratch(async (root) => {
    for (const [name, graph] of [
      ["absent", undefined],
      ["source", { trust: "source-only" }],
    ]) {
      const project = join(root, name);
      cpSync(GO_FIXTURE, project, { recursive: true });
      await mkdir(join(project, ".pymtheg"), { recursive: true });
      if (graph)
        await writeFile(
          join(project, ".pymtheg/settings.json"),
          JSON.stringify({ version: 1, scenarios: {}, graph }),
        );
      const response = await executeGraph({ command: "index", root: project });
      assert.equal(response.toolchain, undefined);
      assert.equal(response.trust, graph?.trust);
      assert.equal("trust" in response, !!graph);
    }
  });
});

test(
  "trusted runs the Go route with its existing policy, as the explicit opt-in does",
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
            { toolchainDirectory: join(root, `${name}-toolchain`), toolchains },
          );
          const decided = store
            .links()
            .filter(
              (link) => link.data?.toolchain?.origin === "toolchain",
            ).length;
          return { report, decided };
        } finally {
          store.close();
        }
      };
      const trusted = await run(
        "trusted",
        graphToolchains(config({ trust: "trusted" })),
      );
      const explicit = await run("explicit", { go: true });
      const source = await run(
        "source",
        graphToolchains(config({ trust: "source-only" })),
      );
      assert.ok(trusted.decided > 0);
      assert.equal(trusted.decided, explicit.decided);
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

test(
  "a trusted project's graph answers use the Go route",
  needsGo,
  async () => {
    await scratch(async (root) => {
      const project = join(root, "trusted");
      cpSync(GO_FIXTURE, project, { recursive: true });
      await mkdir(join(project, ".pymtheg"), { recursive: true });
      await writeFile(
        join(project, ".pymtheg/settings.json"),
        JSON.stringify({
          version: 1,
          scenarios: {},
          graph: { trust: "trusted" },
        }),
      );
      const response = await executeGraph({ command: "index", root: project });
      assert.equal(response.trust, "trusted");
      assert.equal(response.toolchain.go.state, "used");
      assert.ok(
        response.toolchain.go.upgradedLinks +
          response.toolchain.go.confirmedLinks >
          0,
      );
    });
  },
);
