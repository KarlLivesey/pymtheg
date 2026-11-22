// SPDX-License-Identifier: MIT
import "./isolated-config.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  rm,
  rename,
  mkdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { initializeWorkspace } from "../dist/project/workspace.js";
const sources = {
  "go.mod": "module example.test/links\n\ngo 1.22\n",
  "a.go":
    "package p\nfunc SaveGo(n int) int { return n + 1 }\nfunc CallerGo() int { return SaveGo(1) }\n",
  "a.rs":
    "pub fn save_rs(n: u32) -> u32 { n + 1 }\npub fn caller_rs() -> u32 { save_rs(1) }\n",
  "a.ts":
    "export function SaveTS(n: number): number { return n + 1; }\nexport function CallerTS() { return SaveTS(1); }\n",
};
async function session(run) {
  const root = await mkdtemp(join(tmpdir(), "pym-mcp-links-"));
  let client;
  try {
    await initializeWorkspace(root, "MCP links");
    for (const [path, text] of Object.entries(sources))
      await writeFile(join(root, path), text);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/cli/main.js"), "mcp", root],
      stderr: "pipe",
      env: { ...process.env },
    });
    client = new Client({ name: "links-agent", version: "1" });
    await client.connect(transport);
    const raw = async (name, args) => {
      const r = await client.callTool(
        { name, arguments: args },
        { timeout: 3600000 },
      );
      assert.ok(
        Buffer.byteLength(JSON.stringify(r)) <= 65536 ||
          !["requirement_links", "link_result"].includes(name),
      );
      return r;
    };
    const call = async (name, args) => {
      const r = await raw(name, args);
      assert.equal(r.isError, undefined, JSON.stringify(r));
      return r.structuredContent;
    };
    const link = async (action, args = {}) => {
      const first = await call("requirement_links", { action, ...args });
      return first.state === "running"
        ? call("link_result", {
            jobId: first.jobId,
            wait: true,
            section: args.section ?? "items",
            limit: args.limit ?? 20,
          })
        : first;
    };
    await run({ root, client, transport, raw, call, link });
  } finally {
    await client?.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("real stdio links: Go/Rust/TS edit-check-refresh, rename suggestions, failures, move confirmation, queries, history and graph rebuild", async () =>
  session(async ({ root, link, call, raw }) => {
    const graph = async (action, query) => {
      const first = await call("code_graph", {
        action,
        ...(query ? { query } : {}),
      });
      return first.state === "running"
        ? call("graph_result", { jobId: first.jobId, wait: true })
        : first;
    };
    assert.equal((await graph("index")).summary.sync.complete, true);
    const ids = [];
    for (const [i, path, selector] of [
      [1, "a.go", "SaveGo"],
      [2, "a.rs", "save_rs"],
      [3, "a.ts", "SaveTS"],
    ]) {
      const requirement = await link("requirement", {
        id: `R${i}`,
        title: `Store values ${i}`,
      });
      assert.equal(requirement.items[0].id, `plan:R${i}`);
      const selected = await graph("symbol", selector);
      const ref = selected.items[0].ref;
      assert.match(ref, /^symbol:[0-9a-f]{64}$/);
      const added = await link("add", { record: `R${i}`, selector: ref });
      assert.equal(added.items[0].symbol.ref, ref);
      assert.equal(added.summary.status, "created");
      const id = added.items[0].id;
      ids.push(id);
      assert.match(added.items[0].symbol.ref, /^symbol:[0-9a-f]{64}$/);
      assert.equal((await link("check")).summary.passed, true);
      let text = sources[path].replace("n + 1", "n + 2");
      await writeFile(join(root, path), text);
      const stale = await link("check", { noSync: true });
      assert.equal(stale.summary.passed, false);
      assert.equal(stale.summary.verificationComplete, false);
      assert.ok(stale.summary.graph.staleFiles.includes(path));
      const changed = await link("check");
      assert.equal(changed.summary.passed, false);
      assert.equal(changed.items[0].id, id);
      assert.equal(changed.items[0].state, "changed");
      assert.ok(changed.items[0].differs.includes("body"));
      assert.match(changed.items[0].next, /Review/);
      assert.equal(
        (await link("refresh", { link: id })).summary.status,
        "refreshed",
      );
      assert.equal((await link("check")).summary.passed, true);
      const renamed = text.replaceAll(selector, selector + "Renamed");
      await writeFile(join(root, path), renamed);
      const missing = await link("check");
      assert.equal(missing.items[0].state, "missing");
      assert.ok(
        missing.items[0].suggestions.some(
          (s) => s.name === selector + "Renamed",
        ),
      );
      assert.equal(
        (await link("refresh", { link: id })).summary.status,
        "refused",
      );
      await writeFile(join(root, path), "this is { broken code\n");
      const broken = await link("check");
      assert.equal(broken.summary.passed, false);
      assert.equal(broken.summary.verificationComplete, false);
      assert.equal(broken.items[0].state, "unverifiable");
      assert.equal(broken.items[0].unverifiableFile.path, path);
      assert.equal(broken.failedFiles.items[0].path, path);
      const refused = await link("add", {
        record: `R${i}`,
        selector: path + ":1",
      });
      assert.notEqual(refused.summary.status, "created");
      assert.equal(refused.failedFiles.items[0].path, path);
      await writeFile(join(root, path), text);
      assert.equal((await link("check")).summary.passed, true);
    }
    await writeFile(join(root, "ambiguous.rs"), "pub fn Same() {}\n");
    await writeFile(join(root, "ambiguous.ts"), "export function Same() {}\n");
    const ambiguous = await link("add", {
      record: "R1",
      selector: "Same",
    });
    assert.equal(ambiguous.summary.status, "ambiguous-selector");
    assert.equal(ambiguous.total, 2);
    assert.ok(ambiguous.items.every((m) => m.path && m.line));
    assert.equal((await link("list")).total, 3);
    const one = await link("list", { record: "R1", limit: 1 });
    assert.equal(one.total, 1);
    assert.equal((await link("list", { symbol: "SaveGo" })).total, 1);
    assert.equal((await link("list", { file: "a.go" })).total, 1);
    const touched = await link("requirements_for", {
      symbol: "SaveGo",
      impact: true,
    });
    assert.ok(
      touched.items.some((r) => r.record === "plan:R1" && r.via === "direct"),
    );
    assert.equal(
      (await link("requirements_for", { file: "a.ts" })).items[0].record,
      "plan:R3",
    );
    const paged = await link("list", { limit: 1 });
    assert.equal(paged.truncated, true);
    assert.equal(paged.total, 3);
    const next = await call("link_result", {
      jobId: paged.jobId,
      offset: paged.nextOffset,
      limit: 1,
    });
    assert.equal(next.offset, 1);
    await rename(join(root, "a.go"), join(root, "moved.go"));
    const moved = await link("check");
    assert.equal(moved.items[0].state, "moved");
    assert.equal(moved.summary.passed, false);
    assert.equal(
      (await link("check", { allowMoved: true })).summary.passed,
      true,
    );
    assert.equal(
      (await link("refresh", { link: ids[0] })).summary.status,
      "refreshed",
    );
    const history = await link("history");
    const own = history.items.filter((e) => e.link === ids[0]);
    assert.equal(own[0].symbol.path, "a.go");
    assert.equal(own.at(-1).symbol.path, "moved.go");
    assert.ok(own.every((e) => e.pathKnown));
    await rm(join(root, ".pymtheg", "rebuildable"), {
      recursive: true,
      force: true,
    });
    const rebuilt = await link("check");
    assert.equal(rebuilt.summary.passed, true);
    assert.deepEqual(rebuilt.items.map((i) => i.id).sort(), ids.slice().sort());
    await link("remove", { link: ids[2] });
    const unlinked = await link("unlinked", { symbols: true });
    assert.ok(unlinked.items.some((i) => i.id === "plan:R3"));
    const syms = await call("link_result", {
      jobId: unlinked.jobId,
      section: "symbols",
    });
    assert.ok(syms.items.some((s) => s.name === "SaveTS"));
    const conflict = await raw("requirement_links", {
      action: "requirement",
      id: "R1",
      title: "Conflict",
    });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error.code, "record-conflict");
  }));

test("MCP impact names candidate callers it did not follow, and does not promote them", async () =>
  session(async ({ root, link, call }) => {
    await writeFile(
      join(root, "a.go"),
      "package p\ntype Putter interface{ Put() }\ntype A struct{}\nfunc (A) Put() {}\ntype B struct{}\nfunc (B) Put() {}\nfunc Use(p Putter) { p.Put() }\n",
    );
    await link("requirement", { id: "CALLER", title: "Caller requirement" });
    await link("add", { record: "CALLER", selector: "Use" });
    const impact = await link("requirements_for", {
      symbol: "(A).Put",
      impact: true,
    });
    assert.equal(impact.summary.impactIncomplete, true);
    assert.ok(impact.summary.notFollowedCount >= 1);
    assert.ok(!impact.items.some((r) => r.record === "plan:CALLER"));
    const skipped = await call("link_result", {
      jobId: impact.jobId,
      section: "not_followed",
    });
    assert.ok(
      skipped.items.some(
        (s) =>
          s.identity === "Use" &&
          ["candidate", "possible"].includes(s.certainty),
      ),
    );
  }));

test("SQLite lock waits stay in an owned worker: MCP discovery remains responsive until a readiness-controlled release", async () =>
  session(async ({ root, link, call, client, transport }) => {
    const { Worker } = await import("node:worker_threads");
    const { readdir, readlink } = await import("node:fs/promises");
    const { setImmediate: turn } = await import("node:timers/promises");
    await link("requirement", { id: "LOCK1", title: "First" });
    const database = join(root, ".pymtheg", "shared", "architecture.sqlite");
    const holder = new Worker(
      `const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(workerData);db.exec('BEGIN EXCLUSIVE');parentPort.on('message',()=>{db.exec('ROLLBACK');db.close();parentPort.close();});parentPort.postMessage('locked');`,
      { eval: true, workerData: database },
    );
    const exited = new Promise((r, reject) => {
      holder.once("exit", r);
      holder.once("error", reject);
    });
    try {
      await new Promise((r, reject) => {
        holder.once("message", r);
        holder.once("error", reject);
      });
      const pending = await call("requirement_links", {
        action: "requirement",
        id: "LOCK2",
        title: "Second",
        wait: false,
      });
      assert.equal(pending.state, "running");
      // Readiness is an actual open descriptor in the MCP process, not a sleep or elapsed bound.
      for (;;) {
        const names = await readdir(`/proc/${transport.pid}/fd`);
        const targets = await Promise.all(
          names.map((n) =>
            readlink(`/proc/${transport.pid}/fd/${n}`).catch(() => ""),
          ),
        );
        if (targets.includes(database)) break;
        await turn();
      }
      const tools = await client.listTools();
      assert.ok(tools.tools.some((t) => t.name === "requirement_links"));
      const recipe = await call("design_recipe", { action: "list" });
      assert.ok(recipe.recipes.length);
      const still = await call("link_result", { jobId: pending.jobId });
      assert.equal(still.state, "running");
      holder.postMessage("release");
      await exited;
      const done = await call("link_result", {
        jobId: pending.jobId,
        wait: true,
      });
      assert.equal(done.summary.status, "created");
      assert.equal(done.items[0].id, "plan:LOCK2");
    } finally {
      holder.postMessage("release");
      await holder.terminate();
      await exited;
    }
  }));

test("check_design first response includes bounded actionable findings, with read_run continuation", async () =>
  session(async ({ root, call, raw }) => {
    await writeFile(
      join(root, "bad.pym"),
      Array.from(
        { length: 35 },
        (_, i) => `flow broken${i}(n: Nat) -> Nat { return n - 1; }`,
      ).join("\n"),
    );
    const reply = await raw("check_design", { file: "bad.pym" });
    assert.equal(reply.isError, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 262144);
    const first = reply.structuredContent;
    assert.ok(first.findings.errors > 0);
    assert.ok(
      first.findings.items.length > 0 && first.findings.items.length <= 10,
    );
    assert.ok(first.findings.total > first.findings.items.length);
    assert.equal(first.findings.truncated, true);
    assert.equal(first.findings.nextOffset, first.findings.items.length);
    assert.ok(
      first.findings.items.some(
        (f) =>
          f.code === "T002" &&
          f.message &&
          f.why &&
          f.nextStep &&
          f.location.file === "bad.pym",
      ),
    );
    const more = await call("read_run", {
      runId: first.runId,
      section: "findings",
      offset: first.findings.nextOffset,
      limit: 10,
    });
    assert.ok(more.items.length > 0);
  }));

test("MCP Go toolchain decisions/state/warnings agree with CLI JSON", async () =>
  session(async ({ root, call }) => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const run = promisify(execFile);
    // D22 (C-44): the route runs on this machine's trusted answer, given
    // over MCP with code_graph's trust parameter.
    const answered = await call("code_graph", {
      action: "status",
      trust: "trusted",
    });
    assert.equal(answered.summary.trust, "trusted");
    const graph = async (action, query, extra = {}) => {
      const first = await call("code_graph", {
        action,
        ...(query ? { query } : {}),
        ...extra,
      });
      return first.state === "running"
        ? call("graph_result", {
            jobId: first.jobId,
            wait: true,
            section: extra.section ?? "answer",
          })
        : first;
    };
    const index = await graph("index");
    assert.equal(
      index.summary.toolchain.go.state,
      "used",
      JSON.stringify(index.summary),
    );
    const mcp = await graph("callees", "CallerGo", { section: "links" });
    const cli = JSON.parse(
      (
        await run(
          process.execPath,
          [
            resolve("dist/cli/main.js"),
            "graph",
            "callees",
            "CallerGo",
            "--root",
            root,
            "--json",
          ],
          { maxBuffer: 1024 * 1024 },
        )
      ).stdout,
    );
    assert.deepEqual(mcp.summary.toolchain, cli.toolchain);
    assert.ok(cli.data.links.some((l) => l.decidedBy === "toolchain"));
    for (const l of cli.data.links) {
      const row = mcp.items.find((r) => r.ref === l.id);
      assert.ok(row);
      assert.equal(row.certainty, l.certainty);
      assert.equal(row.decidedBy, l.decidedBy);
    }
    const stale = await graph("callees", "CallerGo", {
      noSync: true,
      section: "warnings",
    });
    const raw = JSON.parse(
      (
        await run(
          process.execPath,
          [
            resolve("dist/cli/main.js"),
            "graph",
            "callees",
            "CallerGo",
            "--root",
            root,
            "--no-sync",
            "--json",
          ],
          { maxBuffer: 1024 * 1024 },
        )
      ).stdout,
    );
    assert.deepEqual(stale.summary.toolchain, raw.toolchain);
    assert.ok(
      raw.warnings.some((w) => w.code === "toolchain-inputs-not-rechecked"),
    );
    assert.ok(
      stale.summary.warnings.includes("toolchain-inputs-not-rechecked"),
    );
    assert.ok(
      stale.items.some((w) => w.code === "toolchain-inputs-not-rechecked"),
    );
  }));

test("graph and requirement-link selectors/file queries preview the requested failed file first", async () =>
  session(async ({ root, link, call }) => {
    for (const file of ["a-broken.go", "z-broken.go"])
      await writeFile(join(root, file), "package p\nfunc broken( {\n");
    for (const [action, query] of [
      ["file", "z-broken.go"],
      ["symbol", "z-broken.go:2"],
      ["callers", "z-broken.go:2"],
    ]) {
      const first = await call("code_graph", { action, query });
      const answer =
        first.state === "running"
          ? await call("graph_result", { jobId: first.jobId, wait: true })
          : first;
      assert.equal(answer.failedFiles.total, 2);
      assert.equal(answer.failedFiles.items[0].path, "z-broken.go");
    }
    await link("requirement", {
      id: "BROKEN",
      title: "Must name targeted broken file",
    });
    const refused = await link("add", {
      record: "BROKEN",
      selector: "z-broken.go:2",
    });
    assert.notEqual(refused.summary.status, "created");
    assert.equal(refused.failedFiles.items[0].path, "z-broken.go");
    const filtered = await link("list", { file: "z-broken.go" });
    assert.equal(filtered.failedFiles.items[0].path, "z-broken.go");
  }));

test("two stdio servers indexing the same project return completion or actionable retry, then recover", async () =>
  session(async ({ root, raw, call }) => {
    const second = new Client({ name: "second-agent", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve("dist/cli/main.js"), "mcp", root],
      env: { ...process.env },
      stderr: "pipe",
    });
    try {
      await second.connect(transport);
      const [left, right] = await Promise.all([
        raw("code_graph", { action: "index", wait: false }),
        second.callTool({
          name: "code_graph",
          arguments: { action: "index", wait: false },
        }),
      ]);
      const replies = await Promise.all([
        raw("graph_result", {
          jobId: left.structuredContent.jobId,
          wait: true,
        }),
        second.callTool(
          {
            name: "graph_result",
            arguments: { jobId: right.structuredContent.jobId, wait: true },
          },
          { timeout: 3600000 },
        ),
      ]);
      for (const r of replies)
        if (r.isError) {
          assert.equal(
            r.structuredContent.error.retryable,
            true,
            JSON.stringify(r),
          );
          assert.match(r.structuredContent.error.action, /retry/i);
          assert.doesNotMatch(
            r.structuredContent.error.message,
            /SQLITE|constraint failed/i,
          );
        } else assert.equal(r.structuredContent.state, "complete");
      const recovered = await call("code_graph", {
        action: "symbol",
        query: "SaveGo",
      });
      const answer =
        recovered.state === "running"
          ? await call("graph_result", { jobId: recovered.jobId, wait: true })
          : recovered;
      assert.equal(answer.summary.sync.complete, true);
      assert.ok(answer.items.length);
    } finally {
      await second.close();
    }
  }));
