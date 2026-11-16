// SPDX-License-Identifier: MIT
// R1-J: shipped documentation must not name an MCP tool or a CLI command the
// product does not have. Reads the package's real doc list and tools/list.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "./fixtures/mcp-graph/client.mjs";
import { commandNames, help } from "../dist/cli/help.js";

const pkg = JSON.parse(await readFile("package.json", "utf8"));
const shipped = [
  "README.md",
  ...pkg.files.filter((f) => f.startsWith("docs/") && f.endsWith(".md")),
];
const texts = new Map(
  await Promise.all(shipped.map(async (f) => [f, await readFile(f, "utf8")])),
);
// The guides written for agents name tools in backticks without saying "tool".
const agentGuides = [
  "docs/agent-workflow.md",
  "docs/code-guide.md",
  "docs/mcp.md",
];

// Values tools return (not take), named in docs: emit_scaffold's `assurance`.
const outputValues = new Set(["builtin_scaffold", "plugin_declared"]);
const sentences = (text) => text.split(/(?<=[.!?:;])\s+|\n\n/);
/**
 * Tool references in one document: call("x"), refuse("x"), **x_y**, `x_y`
 * next to the word tool(s) or after "MCP", and — in the agent guides — every
 * backticked snake_case word unless it is an action value, a schema property,
 * or a section value in a sentence that says "section".
 */
function toolReferences(file, text, schema) {
  const found = new Set();
  for (const m of text.matchAll(/(?:call|refuse)\("([a-z_]+)"/g))
    found.add(m[1]);
  for (const m of text.matchAll(/\*\*([a-z]+(?:_[a-z]+)+)\*\*/g))
    found.add(m[1]);
  for (const m of text.matchAll(/`([a-z]+(?:_[a-z]+)+)`\s+tools?\b/g))
    found.add(m[1]);
  for (const m of text.matchAll(
    /\b(?:MCP|tools?)\s+((?:`[a-z_]+`(?:,\s*|\s+and\s+|\/|\s+or\s+)?)+)/g,
  ))
    for (const t of m[1].matchAll(/`([a-z_]+)`/g))
      if (t[1].includes("_")) found.add(t[1]);
  // "the x_y tool", with or without backticks.
  for (const m of text.matchAll(/\bthe `?([a-z]+(?:_[a-z]+)+)`? tool\b/g))
    found.add(m[1]);
  // In any shipped doc, a backticked snake_case word that looks like a tool
  // (it shares its first or last word with a tool name) must be a tool or a
  // value the tools take (an action, section, property or other enum value).
  for (const m of text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
    const word = m[1],
      parts = word.split("_");
    if (
      (schema.firstWords.has(parts[0]) || schema.lastWords.has(parts.at(-1))) &&
      !schema.values.has(word) &&
      !outputValues.has(word)
    )
      found.add(word);
  }
  if (agentGuides.includes(file))
    for (const sentence of sentences(text))
      for (const m of sentence.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
        const word = m[1];
        if (schema.actions.has(word) || schema.properties.has(word)) continue;
        if (schema.sections.has(word) && /\bsections?\b/i.test(sentence))
          continue;
        found.add(word);
      }
  return found;
}

async function toolSchema() {
  const root = await mkdtemp(join(tmpdir(), "pym-r1j-doc-names-"));
  const s = await connect(root);
  try {
    const { tools } = await s.client.listTools();
    const schema = {
      tools: new Set(tools.map((t) => t.name)),
      actions: new Set(),
      sections: new Set(),
      properties: new Set(),
    };
    schema.firstWords = new Set(tools.map((t) => t.name.split("_")[0]));
    schema.lastWords = new Set(tools.map((t) => t.name.split("_").at(-1)));
    // Every property name and enum value anywhere in the tool schemas.
    schema.values = new Set();
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      for (const v of node.enum ?? []) schema.values.add(v);
      for (const key of Object.keys(node.properties ?? {}))
        schema.values.add(key);
      Object.values(node).forEach(walk);
    };
    tools.forEach((t) => walk(t.inputSchema));
    for (const tool of tools)
      for (const [key, value] of Object.entries(
        tool.inputSchema.properties ?? {},
      )) {
        schema.properties.add(key);
        const values = value.enum ?? value.anyOf?.flatMap((v) => v.enum ?? []);
        for (const v of values ?? [])
          (key === "section" ? schema.sections : schema.actions).add(v);
      }
    return schema;
  } finally {
    await s.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("every MCP tool a shipped doc names is in tools/list", async () => {
  const schema = await toolSchema();
  const missing = [];
  for (const [file, text] of texts)
    for (const name of toolReferences(file, text, schema))
      if (!schema.tools.has(name)) missing.push(`${file}: ${name}`);
  assert.deepEqual(missing, []);
  // The check catches the fault the R1-G trial met: the agent guide sent
  // agents to a `source_contract` tool that is a read_architecture section.
  const old =
    "For a missing source link, capture the current `source_contracts` catalogue,\nthen pass that `sourceSnapshotId` and `planId` to `source_contract` to inspect\nbounded replacement suggestions.";
  assert.ok(
    toolReferences("docs/agent-workflow.md", old, schema).has(
      "source_contract",
    ),
  );
  // And the cheap misses review round 1 named: a misspelt tool in any doc, and
  // "the x tool" without backticks.
  const misses = toolReferences(
    "docs/support.md",
    "Page with `graph_results`. Then the requirement_link tool records it.",
    schema,
  );
  assert.ok(misses.has("graph_results") && misses.has("requirement_link"));
});

test("every CLI command and graph/link action a shipped doc names exists", async () => {
  // The graph actions, as the CLI's own help states them.
  const graphLine = help()
    .split("\n")
    .find((line) => line.startsWith("pymtheg graph "));
  const graphActions = graphLine
    .slice("pymtheg graph ".length)
    .split(" [")[0]
    .split("|")
    .map((part) => part.split(" ")[0]);
  assert.ok(graphActions.includes("callers") && graphActions.includes("index"));
  const { linkUsage } = await import("../dist/cli/link.js");
  const linkActions = [...linkUsage.matchAll(/^ {2}([a-z]+) /gm)].map(
    (m) => m[1],
  );
  assert.ok(
    linkActions.includes("requirement") && linkActions.includes("check"),
  );
  const missing = [];
  for (const [file, text] of texts)
    for (const m of text.matchAll(
      /(?:^|[\s`(])(?:\.\/)?pymtheg ([a-z][a-z-]*)(?: ([a-z][a-z_-]*))?/gm,
    )) {
      const [, command, sub] = m;
      if (!commandNames.includes(command)) missing.push(`${file}: ${command}`);
      else if (command === "graph" && sub && !graphActions.includes(sub))
        missing.push(`${file}: graph ${sub}`);
      else if (command === "link" && sub && !linkActions.includes(sub))
        missing.push(`${file}: link ${sub}`);
    }
  assert.deepEqual(missing, []);
});

test("no shipped doc states a graph module version number (it goes stale)", () => {
  // Every graph answer reports the versions (`modules`); docs point there.
  const stated = [];
  for (const [file, text] of texts)
    for (const m of text.matchAll(/module version \d+/gi))
      stated.push(`${file}: ${m[0]}`);
  assert.deepEqual(stated, []);
});
