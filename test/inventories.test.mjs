import test from "node:test";
import assert from "node:assert/strict";
import { ProjectInventories } from "../dist/mcp/inventories.js";
import { hash } from "../dist/shared/identity.js";
const project = (count = 250) => ({
  root: "/workspace/Order",
  files: Array.from({ length: count }, (_, i) => ({
    path: `file${String(i).padStart(3, "0")}.pym`,
    hash: "hash",
    text: "body",
    loaded: true,
  })),
  inventoryWarnings: [],
  tools: { quint: false, tlc: false },
  config: { version: 1, scenarios: {} },
  configHash: null,
});
test("captured inventory pages are stable and do not search the absolute project path", () => {
  const store = new ProjectInventories(),
    input = project(),
    id = store.capture(input);
  input.files[0].path = "changed.pym";
  const first = store.read(id);
  assert.equal(first.files.length, 100);
  assert.equal(first.totalFiles, 250);
  assert.equal(first.files[0].path, "file000.pym");
  const second = store.read(id, { section: "files", offset: first.nextOffset }),
    last = store.read(id, { section: "files", offset: second.nextOffset });
  assert.equal(
    new Set([...first.files, ...second.files, ...last.files].map((f) => f.path))
      .size,
    250,
  );
  assert.equal(last.nextOffset, null);
  assert.equal(store.read(id, { query: "Order" }).matchingFiles, 0);
  const config = store.read(id, { section: "configuration" });
  assert.equal(hash(config.text), config.contentHash);
});
test("large configuration is retrieved as text pages, and inventory eviction is explicit", () => {
  const store = new ProjectInventories(),
    input = project(1);
  input.config.scenarios.large = { scope: { comment: "é".repeat(40000) } };
  const id = store.capture(input),
    summary = store.read(id);
  assert.equal(summary.configurationRequiresPaging, true);
  assert.equal(summary.scenarios, undefined);
  let text = "",
    offset = 0;
  for (;;) {
    const p = store.read(id, { section: "configuration", offset });
    text += p.text;
    if (p.nextOffset === null) break;
    offset = p.nextOffset;
  }
  assert.equal(JSON.parse(text).scenarios.large.scope.comment.length, 40000);
  store.capture(project());
  store.capture(project());
  store.capture(project());
  assert.throws(() => store.read(id), /expired/);
  store.clear();
  assert.equal(store.size, 0);
});

test("continuation pages reuse the captured inventory instead of reading all source text again", async () => {
  const { AgentWorkspace } = await import("../dist/mcp/workspace.js");
  const workspace = new AgentWorkspace("/project");
  let captures = 0;
  workspace.access.project = async () => {
    captures++;
    return project();
  };
  try {
    const first = await workspace.project();
    await workspace.project({
      inventoryId: first.inventoryId,
      section: "files",
      offset: first.nextOffset,
    });
    assert.equal(captures, 1);
    await assert.rejects(workspace.project({ offset: 100 }), /inventoryId/);
    await workspace.project();
    assert.equal(captures, 2);
  } finally {
    await workspace.close();
  }
});

test("a large valid scenario name cannot block initial inventory access", () => {
  const store = new ProjectInventories(),
    input = project(1),
    name = "Scenario😀".repeat(5000);
  input.config.scenarios[name] = {
    file: "file000.pym",
    entry: "main",
    scope: {},
  };
  const id = store.capture(input),
    summary = store.read(id);
  assert.equal(summary.totalScenarios, 1);
  assert.equal(summary.configurationRequiresPaging, true);
  assert.equal(summary.scenarioNamesTruncated, true);
  assert.ok(summary.scenarioNames[0].length <= 241);
  let text = "",
    offset = 0;
  for (;;) {
    const page = store.read(id, { section: "configuration", offset });
    text += page.text;
    if (page.nextOffset === null) break;
    offset = page.nextOffset;
  }
  assert.equal(Object.keys(JSON.parse(text).scenarios)[0], name);
});
