import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Ajv2020Module from "ajv/dist/2020.js";

const Ajv2020 = Ajv2020Module.default ?? Ajv2020Module;
// The formats defined by JSON Schema 2020-12 (Validation, section 7.3). Strict
// ajv without a format plugin rejects every format it does not know, standard
// or not; clients that validate formats load a plugin covering these. They are
// declared known (not checked), so only a non-standard format fails.
const standardFormats = Object.fromEntries(
  [
    "date-time",
    "date",
    "time",
    "duration",
    "email",
    "idn-email",
    "hostname",
    "idn-hostname",
    "ipv4",
    "ipv6",
    "uri",
    "uri-reference",
    "iri",
    "iri-reference",
    "uuid",
    "uri-template",
    "json-pointer",
    "relative-json-pointer",
    "regex",
  ].map((name) => [name, true]),
);

// MCP clients and gateways may compile tool schemas with a strict JSON Schema
// validator. Every schema the real server lists must compile under ajv's
// default (strict) settings: a non-standard keyword or format, such as zod's
// `format: "starts_with"`, fails here.
test("every MCP tool schema compiles with strict Ajv2020", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-tool-schemas-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/cli/main.js"), "mcp", root],
    stderr: "pipe",
  });
  const client = new Client({ name: "tool-schemas", version: "1.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0);
    const compiled = new Map();
    for (const tool of tools)
      for (const kind of ["inputSchema", "outputSchema"]) {
        const schema = tool[kind];
        if (schema === undefined) continue;
        let validate;
        assert.doesNotThrow(() => {
          validate = new Ajv2020({ formats: standardFormats }).compile(schema);
        }, `${tool.name}.${kind}`);
        compiled.set(`${tool.name}.${kind}`, validate);
      }
    // The source-target rule still reaches clients, as a pattern.
    const read = compiled.get("read_architecture.inputSchema");
    assert.ok(read);
    assert.equal(read({ sourceTargets: ["source:a.ts#f"] }), true);
    assert.equal(read({ sourceTargets: ["a.ts#f"] }), false);
  } finally {
    await client.close();
    await rm(root, { recursive: true, force: true });
  }
});
