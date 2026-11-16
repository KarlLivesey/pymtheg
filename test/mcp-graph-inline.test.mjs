// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { GraphJobs } from "../dist/mcp/graph-jobs.js";
import { registerGraphTools } from "../dist/mcp/graph.js";

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "pym-inline-"));
  const jobs = new GraphJobs(
    root,
    () =>
      new Worker(
        new URL("./fixtures/mcp-graph/controlled-worker.mjs", import.meta.url),
      ),
  );
  const deadlines = [];
  let announce;
  const created = () =>
    new Promise((resolve) => {
      announce = resolve;
    });
  const deadline = () => {
    let fire;
    let cleanupDone;
    const cleanup = new Promise((resolve) => {
      cleanupDone = resolve;
    });
    const value = {
      cleanup,
      expired: new Promise((resolve) => {
        fire = resolve;
      }),
      clear() {
        value.cleared = true;
        cleanupDone();
      },
      cleared: false,
      fire: () => fire(),
    };
    deadlines.push(value);
    announce?.();
    return value;
  };
  const server = new McpServer({ name: "controlled-graph", version: "1" });
  registerGraphTools(server, { graph: jobs }, { deadline });
  const client = new Client({ name: "controlled-agent", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  const ready = async () => {
    const job = jobs.get(jobs.activeId());
    if (!job.progress)
      await new Promise((resolve) => {
        const listener = () => {
          job.listeners.delete(listener);
          resolve();
        };
        job.listeners.add(listener);
      });
    assert.equal(job.progress.phase, "controlled-ready");
    return job;
  };
  try {
    await server.connect(left);
    await client.connect(right);
    await run({ client, jobs, created, ready, deadlines });
  } finally {
    await client.close();
    await jobs.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
}
const call = (client, name, args, options) =>
  client.callTool({ name, arguments: args }, options);

test("inline completion wins a controlled deadline and is exactly the graph_result first page", async () =>
  fixture(async ({ client, created, ready, deadlines }) => {
    const waiting = created();
    const response = call(client, "code_graph", {
      action: "search",
      query: "Ready",
    });
    await waiting;
    const job = await ready();
    job.worker.postMessage("complete");
    const inline = await response;
    assert.equal(inline.isError, undefined);
    assert.equal(inline.structuredContent.state, "complete");
    assert.equal(inline.structuredContent.items[0].name, "Ready");
    const paged = await call(client, "graph_result", { jobId: job.id });
    assert.deepEqual(inline, paged);
    assert.equal(deadlines[0].cleared, true);
    assert.equal(job.listeners.size, 0);
    assert.ok(Buffer.byteLength(JSON.stringify(inline)) <= 65536);
  }));

test("controlled deadline expiry returns a progress handle; later result is unchanged", async () =>
  fixture(async ({ client, jobs, created, ready, deadlines }) => {
    const waiting = created();
    const response = call(client, "code_graph", {
      action: "search",
      query: "Ready",
    });
    await waiting;
    const job = await ready();
    deadlines[0].fire();
    const pending = await response;
    assert.equal(pending.structuredContent.state, "running");
    assert.equal(pending.structuredContent.progress.phase, "controlled-ready");
    assert.equal(pending.structuredContent.summary, undefined);
    assert.match(pending.structuredContent.next, /graph_result/);
    assert.equal(job.exited, false);
    assert.equal(job.listeners.size, 0);
    assert.equal(deadlines[0].cleared, true);
    assert.throws(() => jobs.start({ command: "status" }), /running/);
    job.worker.postMessage("complete");
    const result = await call(client, "graph_result", {
      jobId: job.id,
      wait: true,
    });
    assert.equal(result.structuredContent.items[0].name, "Ready");
  }));

test("wait:false never starts a deadline and cancellation of an inline wait joins the worker", async () =>
  fixture(async ({ client, jobs, created, ready, deadlines }) => {
    const handle = await call(client, "code_graph", {
      action: "search",
      query: "Ready",
      wait: false,
    });
    assert.equal(handle.structuredContent.state, "running");
    assert.equal(deadlines.length, 0);
    const first = await ready();
    await call(client, "graph_result", { jobId: first.id, action: "cancel" });
    assert.equal(first.exited, true);
    const waiting = created();
    const controller = new AbortController();
    const response = call(
      client,
      "code_graph",
      { action: "search", query: "Ready" },
      { signal: controller.signal },
    );
    const rejected = assert.rejects(response);
    await waiting;
    const second = await ready();
    controller.abort();
    await rejected;
    await second.done;
    await deadlines[0].cleanup;
    assert.equal(second.state, "cancelled");
    assert.equal(second.exited, true);
    assert.equal(deadlines[0].cleared, true);
    assert.equal(jobs.activeId(), null);
  }));
