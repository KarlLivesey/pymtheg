// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LinkJobs } from "../dist/mcp/links-jobs.js";
import { makeLinkView } from "../dist/mcp/links-view.js";
import { registerLinkTools } from "../dist/mcp/links.js";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";

test("owned link workers: busy, cancellation, disconnect cleanup and session retention use explicit readiness", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-link-jobs-"));
  const jobs = new LinkJobs(
    root,
    () =>
      new Worker(
        `const {parentPort}=require('node:worker_threads');parentPort.on('message',()=>parentPort.close());parentPort.postMessage({kind:'progress',phase:'ready'});`,
        { eval: true },
      ),
  );
  const ready = async (job) => {
    if (!job.progress)
      await new Promise((r) => {
        const f = () => {
          job.listeners.delete(f);
          r();
        };
        job.listeners.add(f);
      });
    assert.equal(job.progress.phase, "ready");
  };
  try {
    const first = jobs.start("history", {});
    await ready(first);
    assert.throws(() => jobs.start("history", {}), /running/);
    await jobs.cancel(first.id);
    assert.equal(first.exited, true);
    assert.equal(first.state, "cancelled");
    for (let i = 0; i < 3; i++) {
      const job = jobs.start("history", {});
      await ready(job);
      await jobs.cancel(job.id);
    }
    assert.throws(() => jobs.get(first.id), /expired/);
    const held = jobs.start("history", {});
    await ready(held);
    await jobs.close();
    assert.equal(held.exited, true);
    assert.equal(held.state, "cancelled");
    assert.throws(() => jobs.start("history", {}), /closed/);
  } finally {
    await jobs.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("link pages stay within the wire cap, expose clipping/counts, and keep incomplete checks false", async () => {
  const result = {
    links: [],
    counts: { ok: 0, changed: 0, moved: 0, missing: 0, unverifiable: 0 },
    passed: true,
    graph: {
      complete: false,
      syncMode: "disabled",
      failedFiles: [{ path: "broken.go", language: "go", reason: "failed" }],
      staleFiles: [],
      warnings: [],
    },
  };
  const incomplete = makeLinkView("check", result);
  assert.equal(incomplete.summary.passed, false);
  assert.equal(incomplete.summary.libraryPassed, true);
  assert.equal(incomplete.summary.verificationComplete, false);
  const data = makeLinkView("unlinked", {
    requirements: Array.from({ length: 100 }, (_, i) => ({
      id: `plan:R${i}`,
      title: "é😀".repeat(5000),
    })),
    symbols: [],
    symbolsTruncated: true,
  });
  assert.equal(data.summary.textClipped, true);
  assert.equal(data.summary.sourceTruncated, true);
  const job = {
    id: "job",
    state: "complete",
    exited: true,
    progress: null,
    view: data,
  };
  const server = new McpServer({ name: "bounded-links", version: "1" });
  registerLinkTools(server, { links: { get: () => job } });
  const client = new Client({ name: "agent", version: "1" });
  const [left, right] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(left);
    await client.connect(right);
    const reply = await client.callTool({
      name: "link_result",
      arguments: { jobId: "job", limit: 100 },
    });
    assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 65536);
    const body = reply.structuredContent;
    assert.equal(body.truncated, true);
    assert.equal(body.total, 100);
    assert.ok(body.items.length < 100);
    assert.ok(body.nextOffset > 0);
    assert.match(body.items[0].title, /truncated/);
    assert.equal(body.items[0].title.isWellFormed(), true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("database collision errors have structured retry guidance instead of raw SQLite text", async () => {
  const { operationError } = await import("../dist/mcp/operation-errors.js");
  for (const message of [
    "database is locked",
    "UNIQUE constraint failed: graph_links.id",
    "FOREIGN KEY constraint failed",
    "Invalid or duplicate added link origin/key",
  ]) {
    const reply = operationError(Error(message), "GRAPH_REQUEST_FAILED");
    assert.equal(reply.retryable, true);
    assert.match(reply.action, /retry/i);
    assert.doesNotMatch(reply.message, /SQLITE|constraint failed|origin\/key/);
    assert.deepEqual(operationError(reply), reply);
  }
  const library = operationError(
    Object.assign(Error("Planning ID exists"), { code: "record-conflict" }),
  );
  assert.equal(library.code, "record-conflict");
  const named = operationError(
    Object.assign(Error("Record SQLITE_BUSY already exists"), {
      code: "record-conflict",
    }),
  );
  assert.equal(named.code, "record-conflict");
  assert.equal(named.retryable, false);
});
