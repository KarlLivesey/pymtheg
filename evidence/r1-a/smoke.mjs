// R1-A acceptance smoke, run under evidence/r1-a/no-java.sh from a built tree:
//   evidence/r1-a/no-java.sh node evidence/r1-a/smoke.mjs > evidence/r1-a/smoke.json
// check, verify and simulate every flow/machine entry under examples/, emit one
// machine and one flow model, run doctor, start Studio (HTTP only, no browser)
// and list the MCP server's tools. Waits on printed readiness, never on sleeps.
import { spawn, spawnSync } from "node:child_process";
import { readdirSync, statSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const cli = join(process.cwd(), "dist/cli/main.js");
const run = (args) => {
  const p = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  let report = null;
  try {
    report = JSON.parse(p.stdout);
  } catch {}
  return { status: p.status, report, stderr: p.stderr.slice(0, 400) };
};
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".pym")) files.push(path);
  }
};
walk("examples");

const summary = { files: [], totals: {} };
const count = (key) => (summary.totals[key] = (summary.totals[key] ?? 0) + 1);
for (const file of files) {
  const checked = run(["check", file, "--format", "json"]);
  const entry = { file, check: checked.status, entries: [] };
  const ir = checked.report;
  // Entries: the CLI lists them when --entry is missing.
  const listed = spawnSync(process.execPath, [cli, "verify", file], {
    encoding: "utf8",
  });
  const names =
    /Available entries: (.*)/
      .exec(listed.stderr + listed.stdout)?.[1]
      ?.split(", ")
      .filter((n) => n && !n.startsWith("none")) ?? [];
  for (const name of names) {
    const row = { entry: name };
    for (const command of ["verify", "simulate"]) {
      const r = run([command, file, "--entry", name, "--format", "json", "--timeout", "120s"]);
      const behaviour = (r.report?.results ?? []).filter(
        (x) => x.analysisKind === "behaviour",
      );
      const outcomes = {};
      for (const b of behaviour) {
        const key = `${b.outcome}/${b.completion}`;
        outcomes[key] = (outcomes[key] ?? 0) + 1;
      }
      const codes = [
        ...new Set((r.report?.diagnostics ?? []).map((d) => d.code)),
      ].filter((c) => /^B\d+/.test(c));
      row[command] = { exit: r.status, outcomes, codes };
      count(`${command}:exit${r.status}`);
      if (codes.includes("B104")) count("engineFailures");
      if (
        behaviour.some(
          (b) =>
            b.outcome === "counterexample" &&
            b.witnessValidation !== "source_replayed",
        )
      )
        count("unreplayedCounterexamples");
    }
    entry.entries.push(row);
  }
  summary.files.push(entry);
  count(`check:exit${checked.status}`);
  void ir;
}

const out = mkdtempSync(join(tmpdir(), "r1a-emit-"));
try {
  summary.emit = {};
  for (const [file, name] of [
    ["examples/mvp/task-buggy.pym", "TaskRunner"],
    ["examples/mvp/task-protocol.pym", "retryJob"],
  ]) {
    const target = join(out, name + ".json");
    const r = run(["emit", file, "--entry", name, "--target", "json", "--out", target, "--format", "json"]);
    const model = r.status === 0 ? JSON.parse(readFileSync(target, "utf8")) : null;
    summary.emit[`${file}#${name}`] = {
      exit: r.status,
      schema: model?.schema,
      events: model?.events.length,
      flowSourceStates: model?.flow?.sourceStates.length ?? null,
    };
  }
  const removed = run(["emit", "examples/mvp/task-buggy.pym", "--entry", "TaskRunner", "--target", "quint", "--out", join(out, "x.qnt")]);
  summary.emit.removedQuintTarget = { exit: removed.status, stderr: removed.stderr.trim() };
} finally {
  rmSync(out, { recursive: true, force: true });
}

const doctor = spawnSync(process.execPath, [cli, "doctor", "--format", "json"], { encoding: "utf8" });
summary.doctor = { exit: doctor.status, checks: JSON.parse(doctor.stdout).checks };

// Studio: start the real CLI server, wait for its printed URL, fetch it over HTTP.
summary.studio = await new Promise((resolve) => {
  const child = spawn(process.execPath, [cli, "studio", "examples/mvp", "--port", "0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let text = "";
  child.stdout.on("data", async (chunk) => {
    text += chunk;
    const url = /Open in Firefox: (\S+)/.exec(text)?.[1];
    if (!url || child.fetched) return;
    child.fetched = true;
    const page = await fetch(url);
    const html = await page.text();
    child.kill("SIGINT");
    child.on("close", (code) =>
      resolve({ httpStatus: page.status, servesApp: /<script/.test(html), exit: code }),
    );
  });
});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [cli, "mcp", "examples/mvp"],
  stderr: "pipe",
});
const client = new Client({ name: "r1a-smoke", version: "1" });
await client.connect(transport);
const tools = (await client.listTools()).tools.map((t) => t.name).sort();
const info = await client.callTool({ name: "project_info", arguments: {} });
const verified = await client.callTool({
  name: "explore_behaviour",
  arguments: { file: "task-buggy.pym", entry: "TaskRunner", method: "verify" },
});
summary.mcp = {
  tools: tools.length,
  toolNames: tools,
  projectInfoHasTools: "tools" in (info.structuredContent ?? {}),
  verify: {
    isError: verified.isError ?? false,
    exitStatus: verified.structuredContent?.exitStatus,
  },
  explainText: (
    await client.listTools()
  ).tools.find((t) => t.name === "explore_behaviour").description,
};
await client.close();
summary.files = summary.files.map((f) => ({ ...f, file: relative(".", f.file) }));
process.stdout.write(JSON.stringify(summary, null, 1) + "\n");
