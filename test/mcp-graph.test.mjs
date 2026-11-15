import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, cp, rm, writeFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connect } from "./fixtures/mcp-graph/client.mjs";
async function project(run) {
  const root = await mkdtemp(join(tmpdir(), "pym-r1c-graph-"));
  let session;
  try {
    await cp(new URL("./fixtures/mcp-graph/mixed/", import.meta.url), root, {
      recursive: true,
    });
    session = await connect(root);
    await run(session, root);
    assert.equal(session.stderr(), "");
  } finally {
    await session?.close();
    await rm(root, { recursive: true, force: true });
  }
}
test("stdio mixed init-free graph: every action, certainty classes, failures, paging and auto-sync", async () =>
  project(async (s, root) => {
    const index = await s.graph("index");
    assert.equal(index.answer.state, "complete");
    assert.equal(index.answer.failedFiles.items[0].path, "broken/bad.go");
    const failed = await index.page("failed_files");
    assert.equal(failed.total, 1);
    assert.equal(failed.items[0].path, "broken/bad.go");
    assert.ok(failed.items[0].reasons.length);
    assert.equal(index.answer.summary.exitCode, 2);
    await assert.rejects(access(join(root, ".pymtheg/project.json")));
    const status = await s.graph("status");
    assert.equal(status.answer.summary.counts.files, 4);
    const search = await s.graph("search", "leaf");
    const symbols = await search.page("symbols");
    assert.equal(symbols.items.length, 3);
    for (const symbol of symbols.items) {
      assert.match(symbol.at, /:\d+:\d+$/);
      assert.match(symbol.ref, /^symbol:[a-f0-9]{64}$/);
    }
    const selected = await s.graph("symbol", "go/code.go:8");
    const leaf = selected.answer.items[0];
    assert.equal(leaf.name, "LeafGo");
    assert.equal(
      (await s.graph("symbol", leaf.ref)).answer.items[0].ref,
      leaf.ref,
    );
    const ambiguous = await s.graph("symbol", "Shared");
    assert.equal(ambiguous.answer.summary.status, "ambiguous");
    assert.equal(ambiguous.answer.items.length, 3);
    const callers = await s.graph("callers", leaf.ref);
    assert.equal(
      (await callers.page("links")).failedFiles.items[0].path,
      "broken/bad.go",
    );
    assert.equal((await callers.page("links")).items[0].certainty, "definite");
    const candidates = await s.graph("callers", "(A).Run");
    const links = await candidates.page("links");
    assert.ok(links.items.some((l) => l.certainty === "candidate-set"));
    const candidateLink = links.items.find(
      (l) => l.certainty === "candidate-set",
    );
    assert.equal(candidateLink.target, null);
    assert.equal(candidateLink.candidateCount, 3);
    const members = await candidates.page("candidates", {
      ref: candidateLink.ref,
      limit: 1,
    });
    assert.equal(members.total, 3);
    assert.equal(members.nextOffset, 1);
    const dispatch = await s.graph("callees", "DispatchGo");
    assert.equal(
      (await dispatch.page("links")).items[0].certainty,
      "candidate-set",
    );
    const possible = await s.graph("callers", "step");
    assert.equal(possible.answer.summary.query.hasPossibleCallers, true);
    const hints = await possible.page("possible_callers");
    assert.ok(
      hints.items.some(
        (l) => l.matchKind === "target-hint" && l.certainty === "unresolved",
      ),
    );
    assert.ok(hints.items.some((l) => l.reasons.length));
    const legend = await possible.page("legend");
    assert.ok(
      legend.items.some((r) => ["reason", "uncertainty"].includes(r.field)),
    );
    const detail = await possible.page("detail", {
      ref: hints.items[0].detailRef,
      limit: 100,
    });
    assert.ok(detail.contentHash);
    assert.equal(detail.offsetUnit, "UTF-16 code units");
    const impact = await s.graph("impact", "LeafGo");
    assert.equal(
      impact.answer.items.filter((i) => i.type === "impact").length,
      2,
    );
    const path = await s.graph("path", "TopGo", { to: "LeafGo" });
    assert.equal(path.answer.summary.query.found, true);
    assert.equal(path.answer.summary.query.certainty, "definite");
    const file = await s.graph("file", "go/code.go", { limit: 1 });
    assert.equal(file.answer.summary.truncated, true);
    await writeFile(
      join(root, "go/new.go"),
      "package g\nfunc NewAfterEdit() {}\n",
    );
    const edited = await s.graph("search", "NewAfterEdit");
    assert.equal(edited.answer.summary.sync.mode, "updated");
    assert.equal(edited.answer.items[0].name, "NewAfterEdit");
    await writeFile(
      join(root, "go/new.go"),
      "package g\nfunc Different() {}\n",
    );
    const stale = await s.graph("search", "NewAfterEdit", { noSync: true });
    assert.equal(stale.answer.items[0].name, "NewAfterEdit");
    assert.ok(stale.answer.summary.staleFileCount > 0);
    assert.ok(stale.answer.summary.warnings.includes("stale-files"));
    for (const entry of s.log)
      if (["code_graph", "graph_result"].includes(entry.name))
        assert.ok(entry.bytes <= 65536);
  }));

test("MCP graph jobs are nonblocking, cancellable, bounded, session-owned and confined", async () =>
  project(async (s, root) => {
    const job = await s.call("code_graph", { action: "index" });
    assert.equal(job.state, "running");
    // The server can service another tool while the worker indexes; no elapsed-time assertion.
    const tools = await s.client.listTools();
    assert.ok(tools.tools.some((t) => t.name === "graph_result"));
    const cancel = await s.raw("graph_result", {
      jobId: job.jobId,
      action: "cancel",
    });
    assert.ok(["cancelled", "complete"].includes(cancel.body.state));
    const unknown = await s.raw("graph_result", {
      jobId: "00000000-0000-4000-8000-000000000000",
    });
    assert.equal(unknown.result.isError, true);
    assert.ok(unknown.body.error.action);
    const bad = await s.raw("code_graph", { action: "path", query: "LeafGo" });
    assert.equal(bad.result.isError, true);
    assert.ok(bad.body.error.message.includes("to"));
    // Finish another run before closing this session, then ensure handles do not transfer.
    const complete = await s.graph("index");
    const other = await connect(root);
    try {
      assert.equal(
        (await other.raw("graph_result", { jobId: complete.jobId })).result
          .isError,
        true,
      );
    } finally {
      await other.close();
    }
  }));

test("graph MCP confines uninitialized subdirectories rather than indexing their parent", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-r1c-boundary-"));
  let s;
  try {
    await mkdir(join(root, ".git"));
    await mkdir(join(root, "child"));
    s = await connect(join(root, "child"));
    const r = await s.raw("code_graph", { action: "index" });
    assert.equal(r.result.isError, true);
    assert.match(r.body.error.message, /boundary/);
  } finally {
    await s?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("oversized names are explicitly clipped, exact details page, and wire responses stay bounded", async () =>
  project(async (s, root) => {
    const names = Array.from(
      { length: 120 },
      (_, i) => `Long${i}_${"x".repeat(3000)}`,
    );
    await writeFile(
      join(root, "ts/long.ts"),
      names.map((name) => `export function ${name}() {}`).join("\n"),
    );
    const q = await s.graph("search", "Long", { limit: 100 });
    assert.equal(q.answer.summary.truncated, true);
    const page = await q.page("symbols", { limit: 100 });
    assert.ok(page.nextOffset);
    assert.ok(page.items.length < 100);
    assert.match(page.items[0].name, /see detail/);
    const detail = await q.page("detail", {
      ref: page.items[0].ref,
      limit: 100,
    });
    assert.equal(detail.nextOffset, 100);
    for (const entry of s.log) assert.ok(entry.bytes <= 65536);
  }));
