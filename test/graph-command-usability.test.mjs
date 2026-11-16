// SPDX-License-Identifier: MIT
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { executeGraph } from "../dist/graph/commands.js";
import { formatGraph } from "../dist/cli/graph.js";

async function project(run) {
  const root = await mkdtemp(join(tmpdir(), "pymtheg-graph-usability-"));
  try {
    await cp(
      new URL("./fixtures/graph-command/mixed/", import.meta.url),
      root,
      { recursive: true },
    );
    await rm(join(root, "broken/bad.go"));
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
function cli(root, ...args) {
  const result = spawnSync(
    process.execPath,
    ["dist/cli/main.js", "graph", ...args, "--root", root],
    { encoding: "utf8" },
  );
  assert.ok(result.status !== null, result.stderr);
  return result;
}
const unicodeLines = [
  "\uFEFF// 😀 préface",
  'export const café = "😀"; export function Écho() { return café; }',
  "export function Caller() { /* 😀 */ Écho(); }",
  "class Box {",
  "  method() { return café; }",
  "}",
  "",
];

test("locations use 1-based UTF-16 columns and CRLF lines for symbols, links and nested endpoints", async () => {
  await project(async (root) => {
    await writeFile(join(root, "ts/位置.ts"), unicodeLines.join("\r\n"));
    const symbol = await executeGraph({
      command: "symbol",
      args: ["Écho"],
      root,
    });
    assert.equal(symbol.exitCode, 0);
    const echo = symbol.data.symbol;
    assert.equal(echo.line, 2);
    assert.equal(echo.column, 27);
    assert.equal(echo.endLine, 2);
    assert.equal(echo.endColumn, unicodeLines[1].length + 1);
    assert.equal(echo.locationSource, "stored-snapshot");
    assert.equal(echo.snapshotHash.length, 64);
    const callees = await executeGraph({
      command: "callees",
      args: ["Caller"],
      root,
    });
    const link = callees.data.links.find((link) => link.target?.id === echo.id);
    assert.ok(link);
    assert.equal(link.line, 3);
    assert.equal(link.column, unicodeLines[2].indexOf("Écho") + 1);
    assert.equal(link.endLine, 3);
    assert.equal(link.endColumn, link.column + 4);
    assert.equal(link.source.line, 3);
    assert.equal(link.source.column, 1);
    assert.equal(link.target.line, 2);
    assert.equal(link.target.column, 27);
    const text = cli(root, "callees", "Caller");
    assert.equal(text.status, 0);
    assert.match(text.stdout, /ts\/位置\.ts:2:27/);
    assert.ok(
      text.stdout.includes(
        `ts/位置.ts:2:27-${echo.endLine}:${echo.endColumn} [UTF-16 ${echo.range.start}..${echo.range.end}]`,
      ),
    );
    assert.match(text.stdout, new RegExp(`ts/位置.ts:3:${link.column}`));
    const parsed = JSON.parse(cli(root, "symbol", "Écho", "--json").stdout);
    assert.equal(parsed.data.symbol.column, 27);
    const file = await executeGraph({
      command: "file",
      args: ["ts/位置.ts"],
      root,
    });
    for (const item of [...file.data.symbols, ...file.data.links]) {
      assert.ok(item.line >= 1);
      assert.ok(item.column >= 1);
      assert.ok(item.endLine >= item.line);
    }
  });
});

test("stale no-sync locations and position selectors refer to the stored snapshot, never current edited text", async () => {
  await project(async (root) => {
    const path = join(root, "ts/位置.ts");
    await writeFile(path, unicodeLines.join("\r\n"));
    const before = await executeGraph({
      command: "symbol",
      args: ["Écho"],
      root,
    });
    await writeFile(path, "\r\n" + unicodeLines.join("\r\n"));
    const stale = await executeGraph({
      command: "symbol",
      args: [before.data.symbol.id],
      root,
      noSync: true,
    });
    assert.equal(stale.exitCode, 0);
    assert.equal(stale.data.symbol.line, 2);
    assert.equal(stale.data.symbol.column, 27);
    assert.equal(
      stale.data.symbol.snapshotHash,
      before.data.symbol.snapshotHash,
    );
    assert.ok(
      stale.warnings.some(
        (w) =>
          w.code === "stale-files" && w.message.includes("stored snapshot"),
      ),
    );
    assert.match(formatGraph(stale), /ts\/位置\.ts:2:27/);
    const fresh = await executeGraph({
      command: "symbol",
      args: [before.data.symbol.id],
      root,
    });
    assert.equal(fresh.data.symbol.line, 3);
    assert.equal(fresh.data.symbol.column, 27);
    assert.notEqual(
      fresh.data.symbol.snapshotHash,
      before.data.symbol.snapshotHash,
    );
  });
});

test("search folds ASCII by default and ranks exact, prefix, then substring deterministically", async () => {
  await project(async (root) => {
    await writeFile(
      join(root, "ts/search.ts"),
      "export function read() {}\nexport function Read() {}\nexport function readMore() {}\nexport function threaded() {}\nexport function Écho() {}\n",
    );
    const query = (text, caseSensitive = false) =>
      executeGraph({ command: "search", args: [text], root, caseSensitive });
    const insensitive = await query("READ");
    assert.equal(insensitive.data.caseFolding, "ASCII");
    assert.deepEqual(
      insensitive.data.matches.map((s) => s.name),
      ["Read", "read", "readMore", "threaded"],
    );
    assert.deepEqual(
      (await query("READ")).data.matches.map((s) => s.id),
      insensitive.data.matches.map((s) => s.id),
    );
    assert.deepEqual(
      (await query("Read", true)).data.matches.map((s) => s.name),
      ["Read"],
    );
    assert.equal((await query("écho")).data.matches.length, 0);
    assert.equal((await query("ÉCHO")).data.matches[0].name, "Écho");
    const opt = cli(root, "search", "Read", "--case-sensitive", "--json");
    assert.equal(opt.status, 0);
    assert.deepEqual(
      JSON.parse(opt.stdout).data.matches.map((s) => s.name),
      ["Read"],
    );
    const ranked = await executeGraph({
      command: "search",
      args: ["read"],
      root,
      limit: 1,
    });
    assert.equal(ranked.truncated, true);
    assert.equal(ranked.exitCode, 0);
    assert.equal(ranked.resultCounts.matches, 1);
  });
});

test("all symbol-taking routes accept path:line and recorded qualified identities; same-line siblings remain ambiguous", async () => {
  await project(async (root) => {
    await writeFile(join(root, "ts/位置.ts"), unicodeLines.join("\r\n"));
    await writeFile(
      join(root, "src/lib.rs"),
      "pub struct Store;\nimpl Store { pub fn open(&self) {} }\n",
    );
    const run = (command, ...args) => executeGraph({ command, args, root });
    assert.equal(
      (await run("symbol", "go/code.go:8")).data.symbol.name,
      "LeafGo",
    );
    assert.equal(
      (await run("callers", "go/code.go:8")).data.links[0].source.name,
      "MidGo",
    );
    assert.equal(
      (await run("callees", "go/code.go:9")).data.links[0].target.name,
      "LeafGo",
    );
    assert.deepEqual(
      (await run("impact", "go/code.go:8")).data.callers
        .map((c) => c.symbol.name)
        .sort(),
      ["MidGo", "TopGo"],
    );
    assert.equal(
      (await run("path", "go/code.go:10", "go/code.go:8")).data.found,
      true,
    );
    assert.equal(
      (await run("symbol", "(A).Run")).data.symbol.identity,
      "(A).Run",
    );
    const rust = (await run("search", "open")).data.matches.find(
      (s) => s.module === "rust",
    );
    assert.ok(rust);
    assert.equal((await run("symbol", rust.identity)).data.symbol.id, rust.id);
    const method = await run("symbol", "ts/位置.ts:5");
    assert.equal(method.data.symbol.name, "method");
    assert.equal(method.data.symbol.column, 3);
    assert.equal(
      (await run("symbol", "ts/位置.ts:5:1")).data.symbol.name,
      "Box",
    );
    const siblings = await run("symbol", "ts/位置.ts:2");
    assert.equal(siblings.status, "ambiguous");
    assert.equal(siblings.exitCode, 0);
    assert.deepEqual(
      siblings.data.inputs[0].matches.map((s) => s.name).sort(),
      ["café", "Écho"],
    );
    const display = cli(root, "symbol", "ts/位置.ts:2");
    assert.equal(display.status, 0);
    assert.match(display.stdout, /ts\/位置\.ts:2:27/);
    assert.match(display.stdout, /\(function\)/);
    assert.equal(cli(root, "symbol", "go/code.go:0", "--json").status, 3);
  });
});

test("valid truncated, ambiguous, absent and bounded answers succeed, with explicit returned counts and final text notice", async () => {
  await project(async (root) => {
    for (const args of [
      ["search", "", "--limit", "1"],
      ["file", "go/code.go", "--limit", "1"],
      ["path", "TopGo", "LeafGo", "--depth", "1"],
      ["symbol", "Shared", "--limit", "1"],
    ]) {
      const result = cli(root, ...args, "--json");
      assert.equal(result.status, 0, result.stdout);
      const body = JSON.parse(result.stdout);
      assert.equal(body.truncated, true);
      assert.equal(
        body.limit,
        Number(args.at(-1)) === 1 && args.includes("--limit") ? 1 : 1000,
      );
      assert.ok(body.resultCounts);
      const text = cli(root, ...args);
      assert.equal(text.status, 0);
      assert.match(
        text.stdout.trimEnd().split("\n").at(-1),
        /^Truncated: returned .*limit /,
      );
    }
    assert.equal(cli(root, "symbol", "Absent", "--json").status, 0);
    assert.equal(
      JSON.parse(cli(root, "symbol", "Absent", "--json").stdout).status,
      "not-found",
    );
    assert.equal(cli(root, "search", "x", "--limit", "0", "--json").status, 3);
  });
  await project(async (root) => {
    const missing = cli(root, "search", "Leaf", "--no-sync", "--json");
    assert.equal(missing.status, 2);
  });
});
