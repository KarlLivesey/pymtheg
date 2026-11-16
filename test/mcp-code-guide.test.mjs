// R1-J: the MCP resource pymtheg://code/guide (docs/code-guide.md) is a worked
// session. Every `// verified-mcp` block runs here, in order, over real stdio
// MCP, in a folder that was never initialised; every tool and action the guide
// names must exist in tools/list.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { connect } from "./fixtures/mcp-graph/client.mjs";

const guide = await readFile("docs/code-guide.md", "utf8");

test("the code guide resource is served and every example in it runs as written", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-r1j-guide-"));
  let s;
  try {
    execFileSync("git", ["init", "-q", root]);
    s = await connect(root);
    const { resources } = await s.client.listResources();
    assert.ok(resources.some((r) => r.uri === "pymtheg://code/guide"));
    const served = await s.client.readResource({
      uri: "pymtheg://code/guide",
    });
    assert.equal(served.contents[0].text, guide);
    const blocks = [
      ...guide.matchAll(/```js\n\/\/ verified-mcp\n([\s\S]*?)```/g),
    ].map((m) => m[1]);
    assert.ok(blocks.length >= 7);
    const AsyncFunction = Object.getPrototypeOf(
      async function () {},
    ).constructor;
    await new AsyncFunction("call", "write", "expect", blocks.join("\n"))(
      s.call,
      async (file, text) => {
        await mkdir(dirname(join(root, file)), { recursive: true });
        await writeFile(join(root, file), text);
      },
      (condition) => assert.ok(condition),
    );
    if (process.env.R1J_GUIDE_LOG)
      await writeFile(
        process.env.R1J_GUIDE_LOG,
        JSON.stringify(s.log, null, 1) + "\n",
      );
    // The first planning write left exactly what pymtheg init leaves for Git.
    const status = execFileSync(
      "git",
      ["-C", root, "status", "--porcelain", "-uall", ".pymtheg"],
      { encoding: "utf8" },
    );
    assert.deepEqual(status.trim().split("\n").sort(), [
      "?? .pymtheg/.gitignore",
      "?? .pymtheg/project.json",
      "?? .pymtheg/settings.json",
    ]);
  } finally {
    await s?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("every tool and action the code guide names exists in tools/list", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-r1j-guide-names-"));
  let s;
  try {
    s = await connect(root);
    const { tools } = await s.client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    const called = [...guide.matchAll(/call\("([a-z_]+)"/g)].map((m) => m[1]);
    assert.ok(called.length > 10);
    for (const name of called) assert.ok(byName.has(name), name);
    const actions = (tool) =>
      byName.get(tool).inputSchema.properties.action.enum;
    for (const m of guide.matchAll(/action: "([a-z_]+)"/g))
      assert.ok(
        actions("code_graph").includes(m[1]) ||
          actions("requirement_links").includes(m[1]),
        m[1],
      );
    for (const m of guide.matchAll(/links_\("([a-z_]+)"/g))
      assert.ok(actions("requirement_links").includes(m[1]), m[1]);
    // The argument table lists exactly the requirement_links actions.
    const table = [...guide.matchAll(/^\| `([a-z_]+)` +\|/gm)].map((m) => m[1]);
    assert.deepEqual(table.sort(), [...actions("requirement_links")].sort());
  } finally {
    await s?.close();
    await rm(root, { recursive: true, force: true });
  }
});
