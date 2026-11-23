// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { GraphJobs } from "../dist/mcp/graph-jobs.js";
import { registerGraphTools } from "../dist/mcp/graph.js";

/** Production GraphJobs and tools over an in-memory transport; the worker uses the toy registry. */
async function session(run) {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-library-"));
  await cp(
    new URL("./fixtures/graph-library-targets/", import.meta.url),
    root,
    {
      recursive: true,
    },
  );
  const jobs = new GraphJobs(root, {
    launch: (control) =>
      new Worker(
        new URL("./fixtures/mcp-graph/toy-worker.mjs", import.meta.url),
        {
          workerData: { control },
          stdout: true,
          stderr: true,
        },
      ),
  });
  const server = new McpServer({ name: "library-graph", version: "1" });
  registerGraphTools(server, { graph: jobs });
  const client = new Client({ name: "library-agent", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left);
    await client.connect(right);
    const call = async (args) => {
      const result = await client.callTool({
        name: "code_graph",
        arguments: args,
      });
      let body = result.structuredContent;
      if (body?.state === "running") {
        const waited = await client.callTool({
          name: "graph_result",
          arguments: {
            jobId: body.jobId,
            wait: true,
            section: args.section ?? "answer",
          },
        });
        return {
          isError: waited.isError ?? false,
          body: waited.structuredContent,
        };
      }
      return {
        isError: result.isError ?? false,
        body: body ?? { text: result.content[0].text },
      };
    };
    await run(call);
  } finally {
    await client.close();
    await jobs.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}
const strip = ({
  ref,
  detailRef,
  source,
  at,
  line,
  column,
  endLine,
  endColumn,
  range,
  file,
  sourceStatus,
  targetStatus,
  reasons,
  ...row
}) => row;

test("MCP code_graph uses: unit, unit and symbol, and argument rules", async () =>
  session(async (call) => {
    assert.equal((await call({ action: "index" })).body.state, "complete");
    const unit = await call({ action: "uses", query: "zod", section: "links" });
    assert.equal(unit.isError, false);
    assert.deepEqual(unit.body.summary.query.classCounts, {
      library: 2,
      candidateSet: 0,
    });
    assert.deepEqual(
      unit.body.items.map(strip).sort((a, b) => (a.kind < b.kind ? -1 : 1)),
      [
        {
          kind: "calls",
          certainty: "library",
          target: null,
          targetName: "zod.string",
          candidateCount: 0,
          library: {
            ref: "library:e238bc0bfc0620108b21fe4ed43154516d67b90d35ba24f3e0b9fb31385a539d",
            ecosystem: "npm",
            unit: "zod",
            symbol: "string",
            evidence: "import-binding",
            place: "outside-project",
          },
        },
        {
          kind: "imports",
          certainty: "library",
          target: null,
          targetName: "zod",
          candidateCount: 0,
          library: {
            ref: "library:91067ac286c2964801b10009b40334c7c2abda63ced247c6c20a916628210f2e",
            ecosystem: "npm",
            unit: "zod",
            evidence: "import-path",
            place: "outside-project",
          },
        },
      ],
    );
    const symbol = await call({
      action: "uses",
      query: "lodash",
      symbol: "map",
    });
    assert.deepEqual(symbol.body.items, [
      {
        type: "library",
        unit: "lodash",
        symbol: "map",
        place: "outside-project",
      },
    ]);
    assert.deepEqual(symbol.body.summary.query.classCounts, {
      library: 0,
      candidateSet: 1,
    });
    const candidates = await call({
      action: "uses",
      query: "lodash",
      symbol: "map",
      section: "candidates",
    });
    assert.deepEqual(
      candidates.body.items.map((row) => row.library?.unit ?? "symbol"),
      ["symbol", "lodash"],
    );

    const misplaced = await call({
      action: "callees",
      query: "main",
      symbol: "map",
    });
    assert.equal(misplaced.isError, true);
    assert.match(misplaced.body.error.message, /only uses takes symbol/);
    const empty = await call({ action: "uses", query: "zod", symbol: "" });
    assert.equal(empty.isError, true);
    assert.match(JSON.stringify(empty.body), /symbol/);
  }));
