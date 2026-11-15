// In-container acceptance driver. Runs inside a fresh node:*-bookworm-slim
// container as the unprivileged `node` user, with only the packed tarball, the
// sample project and these harness files copied in. The host orchestrator
// (run.mjs) calls it once per phase:
//
//   node /acc/driver.mjs SCENARIO install   network on: install the tarball
//   node /acc/driver.mjs SCENARIO run       network off: every other step
//
// Each step appends one JSON line to /acc/out/results.jsonl. Nothing here
// asserts on elapsed time; durations and sizes are observations only.
// Uses only Node built-ins (the container has nothing else).
import { spawn } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { BACKEND_ARGUMENT, BACKEND_PROGRAM, TOOLCHAIN_PROGRAM, wordingHits } from "./wording.mjs";

const [scenario, phase] = process.argv.slice(2);
const ACC = "/acc";
const OUT = join(ACC, "out");
const RESULTS = join(OUT, "results.jsonl");
const SHIM_LOG = join(OUT, "shim.log");
const SPAWN_LOG = join(OUT, "spawn.log");
const HOME = process.env.HOME ?? "/home/node";
const PROJECT = join(HOME, "project");
const DESIGN = join(PROJECT, "designs/order.pym");
const BROKEN = join(PROJECT, "designs/broken.pym");
const BROKEN_DIAGNOSTIC = `${BROKEN}:7:27 error N002: Unknown value or variant charge; did you mean charges?`;
const TGZ = join(
  ACC,
  "pkg",
  readdirSync(join(ACC, "pkg")).find((f) => f.endsWith(".tgz")),
);
const GLOBAL_PREFIX = join(HOME, ".npm-global");
const APP = join(HOME, "app");
const NODE_VERSION = process.version;
/** Source files in the sample project: web 3 (TypeScript), service 4 (Go), engine 2 (Rust). */
const SAMPLE_SOURCE_FILES = 9;

const baseEnv = {
  ...process.env,
  PATH: `${ACC}/shims:${GLOBAL_PREFIX}/bin:${process.env.PATH}`,
  ACC_SHIM_LOG: SHIM_LOG,
  ACC_SPAWN_LOG: SPAWN_LOG,
  NODE_OPTIONS: `--require ${ACC}/spawn-trace.cjs`,
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
  npm_config_audit: "false",
  npm_config_prefix: GLOBAL_PREFIX,
  NO_COLOR: "1",
};

// ---------------------------------------------------------------- running

function killGroup(child, signal) {
  // npx does not forward signals, so signal the whole process group, as a
  // terminal's Ctrl-C does.
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function run(cmd, { cwd = PROJECT, env = baseEnv, timeoutMs = 900_000 } = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(cmd[0], cmd.slice(1), { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const out = [],
      err = [];
    let timedOut = false;
    const peak = watchMemory(child.pid);
    // A safety stop for a hung step, never a speed assertion.
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, "SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => err.push(Buffer.from(String(e))));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        signal,
        timedOut,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        peakRssKiB: peak.stop(),
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      });
    });
  });
}

/** Peak resident memory of a process tree, sampled from /proc (observation; a lower bound). */
function watchMemory(rootPid) {
  let peak = 0;
  const sample = () => {
    const children = new Map();
    for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
        if (!children.has(ppid)) children.set(ppid, []);
        children.get(ppid).push(Number(pid));
      } catch {}
    }
    const queue = [rootPid];
    while (queue.length) {
      const pid = queue.pop();
      try {
        const m = /VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"));
        if (m) peak = Math.max(peak, Number(m[1]));
      } catch {}
      queue.push(...(children.get(pid) ?? []));
    }
  };
  const timer = setInterval(sample, 200);
  sample();
  return {
    stop() {
      clearInterval(timer);
      return peak || null;
    },
  };
}

function resetTraces() {
  writeFileSync(SHIM_LOG, "");
  writeFileSync(SPAWN_LOG, "");
}

/** Every backend or toolchain process started during the step, from the PATH shims and the spawn trace. */
function readTraces() {
  const calls = [];
  for (const line of readFileSync(SHIM_LOG, "utf8").split("\n").filter(Boolean))
    calls.push({ tool: line.split(" ")[0], detail: `shim: ${line}` });
  for (const line of readFileSync(SPAWN_LOG, "utf8").split("\n").filter(Boolean)) {
    let s;
    try {
      s = JSON.parse(line);
    } catch {
      continue;
    }
    const file = s.file.split("/").pop();
    const args = s.args.join(" ");
    const tool = BACKEND_PROGRAM.test(file) || TOOLCHAIN_PROGRAM.test(file)
      ? file
      : s.args.some((a) => BACKEND_ARGUMENT.test(a))
        ? /quint/i.test(args)
          ? "quint"
          : "java"
        : null;
    if (tool) calls.push({ tool, detail: `spawn: ${file} ${s.args.slice(0, 3).join(" ")}`.trim() });
  }
  return calls;
}

/** Node's own process warnings on stderr, e.g. `(node:12) ExperimentalWarning: …`. */
function nodeWarnings(stderr) {
  return stderr.split("\n").filter((l) => /^\(node:\d+\) \w*Warning: /.test(l) || /^\(Use `node --trace-warnings/.test(l));
}
const SQLITE_WARNING = /^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time$/;
const TRACE_HINT = /^\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)$/;
/** R1-H: exactly the SQLite warning, on exactly Node 24.0.x and 25.x, is the one known warning gap. */
function isKnownSqliteWarning(lines) {
  return /^v24\.0\.|^v25\./.test(NODE_VERSION) && lines.length > 0 && lines.every((l) => SQLITE_WARNING.test(l) || TRACE_HINT.test(l)) && lines.some((l) => SQLITE_WARNING.test(l));
}

function excerpt(text, max = 360) {
  const t = String(text).replace(/\s+\n/g, "\n").trim();
  return t.length <= max ? t : t.slice(0, max / 2) + " … " + t.slice(-max / 2);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      return JSON.parse(String(text).trim().split("\n").pop());
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------- recording

const scenarioOptions = { reportOnly: false };

/** A note or fingerprint must never crash the run; a broken one reads as such. */
function safe(fn, r) {
  if (!fn) return undefined;
  try {
    return fn(r);
  } catch (e) {
    return `(note unavailable: ${e.message})`;
  }
}

/**
 * Classify one step. Statuses:
 *  pass          every expectation met; no backend or unrequested toolchain
 *                process; no Java/Quint/TLC wording; no Node process warning
 *  expected-fail the step must fail (a broken design) and failed exactly as specified
 *  known-gap     the ONLY problem is the expectation failure, and the step's own
 *                gap matcher recognises the exact output that chunk will change
 *                (exact exit code and message); or the R1-H SQLite warning on
 *                Node 24.0.x / 25.x and nothing else
 *  fail          anything else, including a crash, an unexpected exit code or
 *                an exception inside the harness
 *  observed      report-only step (sizes, timings)
 */
function record(def, r) {
  const problems = [];
  const text = (r.stdout ?? "") + "\n" + (r.stderr ?? "");
  if (r.harnessError) problems.push({ kind: "harness", reason: r.harnessError });
  const expectation = def.expect ? safe(def.expect, r) : null;
  if (expectation) problems.push({ kind: "expect", reason: expectation });
  const words = def.skipWording ? [] : wordingHits(text);
  if (words.length) problems.push({ kind: "wording", reason: `mentions Java/Quint/TLC: ${words[0]}` });
  for (const call of r.calls ?? []) {
    if (TOOLCHAIN_PROGRAM.test(call.tool) && def.allowToolchain) continue;
    problems.push({ kind: "process", reason: `started ${call.tool} (${call.detail})` });
  }
  const warnings = def.skipWarnings ? [] : nodeWarnings(r.stderr ?? "");
  if (warnings.length) problems.push({ kind: "node-warning", reason: `Node warning: ${warnings[0]}`, sqlite: isKnownSqliteWarning(warnings) });

  let status, reason, chunk;
  const gapOf = (p) => {
    if (p.kind === "node-warning" && p.sqlite) return "R1-H";
    if (p.kind === "expect" && def.gap && safe(def.gap.when, r) === true) return def.gap.chunk;
    return null;
  };
  if (def.observe || (scenarioOptions.reportOnly && def.observe !== false)) {
    status = "observed";
    reason = problems.length ? "problems: " + problems.map((p) => p.reason).join(" | ") : safe(def.note, r) ?? "ok";
  } else if (!problems.length) {
    status = def.expectFail ? "expected-fail" : "pass";
    reason = safe(def.note, r) ?? (def.expectFail ? "failed exactly as specified" : "ok");
  } else if (problems.every(gapOf)) {
    status = "known-gap";
    chunk = [...new Set(problems.map(gapOf))].join(", ");
    reason = problems.map((p) => (p.kind === "expect" && def.gap ? `${def.gap.reason} (${p.reason})` : p.reason)).join(" | ");
  } else {
    status = "fail";
    reason = problems.map((p) => p.reason).join(" | ");
  }
  const result = {
    scenario,
    step: def.id,
    command: def.display ?? (def.cmd ? def.cmd.join(" ") : def.id),
    network: phase === "install",
    required: !def.observe && def.required !== false,
    exitCode: r.exitCode ?? null,
    status,
    reason,
    ...(chunk ? { chunk } : {}),
    outputBytes: Buffer.byteLength(text) - 1,
    durationMs: r.durationMs === undefined ? null : Math.round(r.durationMs),
    ...(r.peakRssKiB ? { peakRssKiB: r.peakRssKiB } : {}),
    ...(r.timedOut ? { timedOut: true } : {}),
    ...(r.calls?.length ? { processes: r.calls.map((c) => c.detail) } : {}),
    excerpt: excerpt(text),
    ...(def.fingerprint ? { fingerprint: safe(def.fingerprint, r) } : {}),
    ...(def.observation ? { observation: safe(def.observation, r) } : {}),
  };
  appendFileSync(RESULTS, JSON.stringify(result) + "\n");
  process.stdout.write(`${status.padEnd(13)} ${scenario}/${def.id}: ${reason.slice(0, 220)}\n`);
  return result;
}

async function step(def) {
  resetTraces();
  let r;
  try {
    r = def.run ? await def.run() : await run(def.cmd, { cwd: def.cwd });
  } catch (e) {
    r = { exitCode: null, stdout: "", stderr: "", harnessError: `harness error: ${e?.stack ?? e}` };
  }
  r.stdout ??= "";
  r.stderr ??= "";
  r.calls = readTraces();
  r.json = r.json ?? parseJson(r.stdout);
  return record(def, r);
}

// ---------------------------------------------------------------- expectations

const exit =
  (...codes) =>
  (r) =>
    r.timedOut
      ? "timed out (safety stop)"
      : codes.includes(r.exitCode)
        ? null
        : `exit ${r.exitCode}${r.signal ? " (" + r.signal + ")" : ""}, expected ${codes.join(" or ")}`;
const all =
  (...checks) =>
  (r) => {
    for (const c of checks) {
      const p = c(r);
      if (p) return p;
    }
    return null;
  };
const includes = (needle, what = JSON.stringify(needle)) => (r) =>
  (r.stdout + "\n" + r.stderr).includes(needle) ? null : `output lacks ${what}`;
const json = (check) => (r) => (r.json ? check(r.json) : "stdout is not JSON");
const same = (actual, expected, what) =>
  JSON.stringify(actual) === JSON.stringify(expected) ? null : `${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`;

/** Exact callers: the set of (caller name, caller file, certainty) and the target name of every link. */
function callers(symbol, expected) {
  return all(exit(0), json((j) => {
    if (j.status !== "ok") return `status ${j.status}`;
    const links = j.data?.links ?? [];
    const got = links.map((l) => `${l.source?.name}@${l.source?.file}:${l.certainty}`).sort();
    const want = expected.map(([name, file]) => `${name}@${file}:definite`).sort();
    const targets = [...new Set(links.map((l) => l.target?.name))];
    return same(got, want, `callers of ${symbol}`) ?? same(targets, [symbol], "link targets");
  }));
}
const linkSummary = (r) => (r.json?.data?.links ?? []).map((l) => `${l.source?.name}@${l.source?.file}:${l.certainty}`).join(", ");

// ---------------------------------------------------------------- MCP client

class Mcp {
  constructor(cmd, cwd) {
    this.child = spawn(cmd[0], cmd.slice(1), { cwd, env: baseEnv, stdio: ["pipe", "pipe", "pipe"], detached: true });
    this.stdout = "";
    this.stderr = "";
    this.pending = new Map();
    this.nextId = 1;
    this.exited = new Promise((resolve) => this.child.on("close", (code) => resolve(code)));
    this.child.on("error", (e) => (this.stderr += String(e)));
    let buffer = "";
    this.child.stdout.on("data", (d) => {
      this.stdout += d;
      buffer += d;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          this.stderr += `[non-JSON on stdout] ${line}\n`;
          continue;
        }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          this.pending.get(msg.id)(msg);
          this.pending.delete(msg.id);
        }
      }
    });
    this.child.stderr.on("data", (d) => (this.stderr += d));
  }
  request(method, params, timeoutMs = 300_000) {
    const id = this.nextId++;
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: { message: `no response to ${method} (safety stop)` } });
      }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      this.exited.then(() => {
        clearTimeout(timer);
        resolve({ error: { message: `server exited before answering ${method}` } });
      });
    });
  }
  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  take() {
    const out = { stdout: this.stdout, stderr: this.stderr };
    this.stdout = "";
    this.stderr = "";
    return out;
  }
  async close() {
    this.child.stdin.end();
    const timer = setTimeout(() => killGroup(this.child, "SIGKILL"), 30_000);
    const code = await this.exited;
    clearTimeout(timer);
    return code;
  }
}

/** True when some object nested in `value` satisfies `predicate`. */
function hasDeep(value, predicate) {
  if (!value || typeof value !== "object") return false;
  if (!Array.isArray(value) && predicate(value)) return true;
  return Object.values(value).some((v) => hasDeep(v, predicate));
}

/** The JSON content of a tools/call answer: structuredContent, else the first text block parsed. */
function toolContent(response) {
  const result = response?.result;
  if (!result) return null;
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find((c) => c.type === "text")?.text;
  return text ? parseJson(text) : null;
}

async function mcpSteps(pym) {
  const mcp = new Mcp(pym(["mcp", PROJECT]), PROJECT);
  let tools = [];
  const call = (id, display, fn, def = {}) =>
    step({
      id,
      display,
      ...def,
      run: async () => {
        const value = await fn();
        return { ...mcp.take(), exitCode: null, json: value };
      },
    });
  const rpcError = (r) => (r.json?.error ? `JSON-RPC error: ${r.json.error.message}` : null);
  const toolError = (r) => rpcError(r) ?? (!r.json?.result ? "no result" : r.json.result.isError ? `tool returned isError: ${excerpt(JSON.stringify(r.json.result.content ?? ""), 200)}` : null);
  const toolCall = (name, args) => mcp.request("tools/call", { name, arguments: args });

  await call(
    "mcp-initialize",
    "pymtheg mcp PROJECT (stdio) → initialize",
    async () => {
      const response = await mcp.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "pymtheg-acceptance", version: "1" },
      });
      mcp.notify("notifications/initialized", {});
      return response;
    },
    { expect: (r) => rpcError(r) ?? (r.json?.result?.serverInfo?.name ? null : "no serverInfo in initialize result") },
  );
  await call(
    "mcp-tools-list",
    "tools/list (descriptions included in the wording check)",
    async () => {
      const response = await mcp.request("tools/list", {});
      tools = response.result?.tools ?? [];
      return response;
    },
    {
      expect: (r) => {
        const names = (r.json?.result?.tools ?? []).map((t) => t.name);
        const missing = ["check_design", "read_run", "explore_behaviour", "project_info"].filter((n) => !names.includes(n));
        return rpcError(r) ?? (missing.length ? `missing tools: ${missing.join(", ")}` : null);
      },
      note: (r) => `${r.json.result.tools.length} tools`,
    },
  );
  await call(
    "mcp-check-design",
    'tools/call check_design {file:"designs/order.pym"}',
    () => toolCall("check_design", { file: "designs/order.pym" }),
    {
      expect: (r) => {
        const s = toolContent(r.json);
        return (
          toolError(r) ??
          (!s ? "no structured result" : same({ exitStatus: s.exitStatus, errors: s.findings?.errors, warnings: s.findings?.warnings }, { exitStatus: 0, errors: 0, warnings: 0 }, "valid design verdict"))
        );
      },
    },
  );
  await call(
    "mcp-check-broken",
    'tools/call check_design {file:"designs/broken.pym"}, then read_run {section:"findings"}',
    async () => {
      const checked = await toolCall("check_design", { file: "designs/broken.pym" });
      const summary = toolContent(checked);
      const findings = summary?.runId ? await toolCall("read_run", { runId: summary.runId, section: "findings" }) : null;
      return { checked, summary, findings, findingsContent: toolContent(findings) };
    },
    {
      expect: (r) => {
        const { summary, findingsContent } = r.json;
        if (!summary) return "check_design gave no structured result";
        if (summary.exitStatus !== 1) return `exitStatus ${summary.exitStatus}, expected 1`;
        if (!(summary.findings?.errors >= 1)) return `errors ${summary.findings?.errors}, expected at least 1`;
        const items = findingsContent?.items ?? [];
        const hit = items.find((i) => {
          const s = JSON.stringify(i);
          return s.includes("Unknown value or variant charge") && hasDeep(i, (o) => o.line === 7 && o.column === 27);
        });
        return hit ? null : `no finding at line 7, column 27 with "Unknown value or variant charge" (got ${excerpt(JSON.stringify(items), 200)})`;
      },
    },
  );
  for (const method of ["verify", "simulate"])
    await call(
      `mcp-explore-${method}`,
      `tools/call explore_behaviour {entry:"Order", method:"${method}"}`,
      () => toolCall("explore_behaviour", { file: "designs/order.pym", entry: "Order", method, maxSteps: 6, maxSamples: 200 }),
      {
        expect: (r) => {
          const s = toolContent(r.json);
          if (toolError(r)) return toolError(r);
          if (!s) return "no structured result";
          return same(
            { exitStatus: s.exitStatus, exhaustive: s.results?.exhaustive, counterexamples: s.results?.counterexamples, unresolved: s.results?.unresolved },
            { exitStatus: 0, exhaustive: method === "verify", counterexamples: 0, unresolved: 0 },
            `${method} verdict`,
          );
        },
      },
    );
  // R1-C (PR 40): the code-graph tool. Until it is in the build, the only
  // accepted shortfall is its absence from tools/list.
  await call(
    "mcp-code-graph",
    'tools/call code_graph {action:"callers", query:"formatTotal"}',
    async () => {
      if (!tools.some((t) => t.name === "code_graph")) return { absent: true };
      let answer = await toolCall("code_graph", { action: "callers", query: "formatTotal" });
      let content = toolContent(answer);
      if (content?.jobId && content?.state !== "complete" && !JSON.stringify(content).includes("renderBasket")) {
        answer = await toolCall("graph_result", { jobId: content.jobId, wait: true });
        content = toolContent(answer);
      }
      return { answer, content };
    },
    {
      expect: (r) => {
        if (r.json.absent) return "tool code_graph is not in tools/list";
        if (r.json.answer?.result?.isError || r.json.answer?.error) return `code_graph error: ${excerpt(JSON.stringify(r.json.answer), 200)}`;
        const s = JSON.stringify(r.json.content ?? {});
        return s.includes("renderBasket") && s.includes("definite") ? null : `callers of formatTotal lack definite renderBasket: ${excerpt(s, 200)}`;
      },
      gap: { chunk: "R1-C", reason: "tool `code_graph` not in the tool list", when: (r) => r.json?.absent === true },
    },
  );
  // R1-D (PR 38) has no MCP tool yet. When one appears, this step fails until
  // the harness exercises it: a present-but-untested tool never passes.
  await call(
    "mcp-requirement-links",
    "tools/list has a requirement-to-symbol link tool",
    async () => ({ names: tools.map((t) => t.name) }),
    {
      expect: (r) => {
        const found = r.json.names.filter((n) => /code_link|requirement/.test(n));
        return found.length
          ? `requirement-link tool(s) ${found.join(", ")} present but not exercised by this harness: extend mcpSteps`
          : "no tool named *code_link* or *requirement* in the tool list";
      },
      gap: {
        chunk: "R1-D",
        reason: "no tool named *code_link* or *requirement* in the tool list",
        when: (r) => !r.json.names.some((n) => /code_link|requirement/.test(n)),
      },
    },
  );
  await step({
    id: "mcp-shutdown",
    display: "close stdin; server exits 0",
    expect: exit(0),
    run: async () => ({ exitCode: await mcp.close(), ...mcp.take() }),
  });
}

// ---------------------------------------------------------------- Studio

async function studioSteps(pym) {
  const cmd = pym(["studio", PROJECT, "--port", "0"]);
  const child = spawn(cmd[0], cmd.slice(1), { cwd: PROJECT, env: baseEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let stdout = "",
    stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
  const url = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 300_000);
    child.stdout.on("data", (d) => {
      stdout += d;
      const m = /(http:\/\/127\.0\.0\.1:\d+)\/#token=([0-9a-f]+)/.exec(stdout);
      if (m) {
        clearTimeout(timer);
        resolve({ origin: m[1], token: m[2] });
      }
    });
    exited.then(() => resolve(null));
  });
  const take = () => {
    const io = { stdout, stderr };
    stdout = "";
    stderr = "";
    return io;
  };
  const get = async (path, auth) => {
    const response = await fetch(url.origin + path, {
      headers: auth ? { authorization: "Bearer " + url.token } : {},
      signal: AbortSignal.timeout(120_000),
    });
    return { http: response.status, type: response.headers.get("content-type") ?? "", body: await response.text() };
  };
  await step({
    id: "studio-start",
    display: "pymtheg studio PROJECT --port 0 (prints session URL)",
    expect: () => (url ? null : "no session URL printed"),
    run: async () => ({ exitCode: null, ...take() }),
  });
  await step({
    id: "studio-status",
    display: "GET /api/project (Bearer session token)",
    run: async () => {
      if (!url) return { exitCode: null, ...take(), harnessError: "studio did not start" };
      const r = await get("/api/project", true);
      const io = take();
      return { exitCode: null, http: r.http, type: r.type, stdout: r.body + io.stdout, stderr: io.stderr, json: parseJson(r.body) };
    },
    expect: (r) =>
      r.http !== 200 || !/json/.test(r.type)
        ? `HTTP ${r.http} ${r.type}`
        : same(r.json?.workspace?.name, "Acceptance shop", "workspace name"),
  });
  await step({
    id: "studio-assets",
    display: "GET / and every script and stylesheet it references",
    skipWording: true, // minified web bundle bytes, not user-facing text
    run: async () => {
      if (!url) return { exitCode: null, ...take(), harnessError: "studio did not start" };
      const index = await get("/", false);
      const assets = [...index.body.matchAll(/<(?:script|link)[^>]+(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
      const statuses = [];
      for (const a of assets) statuses.push([a, (await get(a, false)).http]);
      return { exitCode: null, ...take(), http: index.http, statuses };
    },
    expect: (r) =>
      r.http !== 200
        ? `GET / HTTP ${r.http}`
        : !r.statuses.length
          ? "index.html references no assets"
          : r.statuses.filter(([, s]) => s !== 200).map(([a, s]) => `${a} HTTP ${s}`).join(", ") || null,
    note: (r) => `${r.statuses.length} assets HTTP 200`,
  });
  await step({
    id: "studio-stop",
    display: "SIGINT to the studio process group (Ctrl-C)",
    expect: (r) => (r.exitCode === 0 || r.exitCode === 130 || r.signal === "SIGINT" ? null : `exit ${r.exitCode} ${r.signal ?? ""}`),
    run: async () => {
      killGroup(child, "SIGINT");
      const timer = setTimeout(() => killGroup(child, "SIGKILL"), 60_000);
      const { code, signal } = await exited;
      clearTimeout(timer);
      return { exitCode: code, signal, ...take() };
    },
  });
}

// ---------------------------------------------------------------- core steps

function graphFingerprint(r) {
  const j = r.json;
  if (!j) return null;
  return {
    counts: j.counts,
    links: (j.data?.links ?? []).map((l) => `${l.source?.name}@${l.source?.file}->${l.target?.name}:${l.certainty}`).sort(),
    matches: (j.data?.matches ?? []).map((m) => m.name).sort(),
    found: j.data?.found,
  };
}

/** The steps every install shape must pass. */
async function coreSteps(pym) {
  const P = pym;
  await step({ id: "help", cmd: P(["--help"]), expect: all(exit(0), includes("graph index"), includes("init [DIRECTORY]")) });
  await step({
    id: "version",
    cmd: P(["--version"]),
    expect: all(exit(0), (r) => (/^\d+\.\d+\.\d+\n?$/.test(r.stdout) ? null : `version output ${JSON.stringify(r.stdout)}`)),
  });
  await step({
    id: "init",
    cmd: P(["init", PROJECT, "--name", "Acceptance shop"]),
    expect: all(
      exit(0),
      includes("3 existing documents found"),
      () => (existsSync(join(PROJECT, ".pymtheg/project.json")) ? null : "no .pymtheg/project.json"),
    ),
  });
  const snapshot = () =>
    ["project.json", "settings.json"].map((f) => {
      try {
        return readFileSync(join(PROJECT, ".pymtheg", f), "utf8");
      } catch {
        return null;
      }
    });
  const before = snapshot();
  await step({
    id: "init-repeat",
    cmd: P(["init", PROJECT]),
    expect: all(exit(0), () => (before.includes(null) ? "no metadata after init" : same(snapshot(), before, "metadata bytes after re-init"))),
  });
  for (const extra of coreSteps.afterInit ?? []) await step(extra);
  await step({
    id: "doctor",
    cmd: P(["doctor", "--format", "json"]),
    expect: all(exit(0), json((j) => {
      const checks = j.checks ?? [];
      const notReady = checks.filter((c) => c.status !== "ready").map((c) => `${c.name}: ${c.status}`);
      return !checks.length ? "no checks" : notReady.length ? `not ready: ${notReady.join(", ")}` : null;
    })),
    note: (r) => r.json.checks.map((c) => c.name).join(", ") + ": ready",
  });
  await step({
    id: "check-valid",
    cmd: P(["check", DESIGN, "--format", "json"]),
    expect: all(exit(0), json((j) => same((j.diagnostics ?? null)?.length, 0, "diagnostics"))),
  });
  const behaviour = (j) => (j.results ?? []).filter((p) => p.analysisKind === "behaviour");
  await step({
    id: "verify-valid",
    cmd: P(["verify", DESIGN, "--entry", "Order", "--format", "json"]),
    expect: all(exit(0), json((j) =>
      same(behaviour(j).map((p) => [p.propertyId.split("/").pop(), p.outcome, p.completion, p.exhaustive]).sort(), [
        ["chargedOnce", "no_counterexample", "complete", true],
        ["shippedOnlyWhenPaid", "no_counterexample", "complete", true],
        ["state-domains", "no_counterexample", "complete", true],
      ], "verify results"),
    )),
  });
  await step({
    id: "simulate-valid",
    cmd: P(["simulate", DESIGN, "--entry", "Order", "--seed", "42", "--max-steps", "6", "--max-samples", "200", "--format", "json"]),
    expect: all(exit(0), json((j) =>
      same(behaviour(j).map((p) => [p.propertyId.split("/").pop(), p.outcome, p.exhaustive]).sort(), [
        ["chargedOnce", "no_counterexample", false],
        ["shippedOnlyWhenPaid", "no_counterexample", false],
        ["state-domains", "no_counterexample", false],
      ], "simulate results"),
    )),
  });
  await step({
    id: "check-broken",
    expectFail: true,
    cmd: P(["check", BROKEN]),
    expect: all(exit(1), includes(BROKEN_DIAGNOSTIC)),
  });
  await step({
    id: "verify-broken",
    expectFail: true,
    cmd: P(["verify", BROKEN, "--entry", "BrokenOrder"]),
    expect: all(exit(1), includes(BROKEN_DIAGNOSTIC)),
  });
  await step({
    id: "graph-index",
    cmd: P(["graph", "index", "--root", PROJECT, "--json"]),
    expect: all(exit(0), json((j) =>
      j.status !== "ok"
        ? `status ${j.status}`
        : j.failedFiles?.length
          ? `failed files: ${j.failedFiles.map((f) => f.path).join(", ")}`
          : same(j.counts?.files, SAMPLE_SOURCE_FILES, "indexed files"),
    )),
    note: (r) => `${r.json.counts.files} files, ${r.json.counts.symbols} symbols, ${r.json.counts.links} links`,
    fingerprint: graphFingerprint,
  });
  await step({
    id: "graph-status",
    cmd: P(["graph", "status", "--root", PROJECT, "--json"]),
    expect: all(exit(0), json((j) =>
      j.status !== "ok"
        ? `status ${j.status}`
        : j.staleFiles?.length
          ? "stale files right after index"
          : same((j.modules ?? []).map((m) => m.id).sort(), ["go", "rust", "typescript"], "modules"),
    )),
  });
  // Five cross-file calls and one same-file call; each must be exactly this
  // caller, in this file, with definite certainty.
  const q = (id, symbol, expected) =>
    step({ id, cmd: P(["graph", "callers", symbol, "--root", PROJECT, "--json"]), expect: callers(symbol, expected), note: linkSummary, fingerprint: graphFingerprint });
  await q("graph-ts-callers", "formatTotal", [["renderBasket", "web/src/main.ts"]]);
  await q("graph-ts-callers-2", "roundCents", [["formatTotal", "web/src/format.ts"]]);
  await q("graph-go-callers", "ComputeTotal", [["main", "service/main.go"]]);
  await q("graph-go-same-package", "taxFor", [["ComputeTotal", "service/pricing/total.go"]]);
  await q("graph-rust-callers", "apply_discount", [["main", "engine/src/main.rs"]]);
  await q("graph-rust-same-file", "percent_of", [["apply_discount", "engine/src/discount.rs"]]);
  await step({
    id: "graph-ts-path",
    cmd: P(["graph", "path", "renderBasket", "roundCents", "--root", PROJECT, "--json"]),
    expect: all(exit(0), json((j) => same([j.data?.found, j.data?.certainty], [true, "definite"], "path renderBasket → roundCents"))),
    fingerprint: graphFingerprint,
  });
  await step({
    id: "graph-search",
    cmd: P(["graph", "search", "Total", "--root", PROJECT, "--json"]),
    expect: all(exit(0), json((j) => same((j.data?.matches ?? []).map((m) => m.name).sort(), ["ComputeTotal", "formatTotal", "total.go"], "matches for Total (two symbols, one file)"))),
    fingerprint: graphFingerprint,
  });
  await linkSteps(P);
  await mcpSteps(P);
  await studioSteps(P);
  await legacyInit(P);
}

/**
 * R1-D (PR 38): `pymtheg link`. Until it merges, the only accepted shortfall
 * is today's exact unknown-command answer: exit 3, that message on stderr,
 * nothing on stdout. Any other exit or message fails.
 */
const UNKNOWN_COMMAND = /^pymtheg: Unknown command or missing file\. Commands: [a-z, -]+\. See --help\.\n?$/;
const linkGap = {
  chunk: "R1-D",
  reason: "`pymtheg link` is an unknown command (exit 3, the unknown-command message)",
  when: (r) => r.exitCode === 3 && r.stdout === "" && UNKNOWN_COMMAND.test(r.stderr),
};
async function linkSteps(P) {
  const root = ["--root", PROJECT, "--json"];
  await step({
    id: "link-requirement",
    cmd: P(["link", "requirement", "R1", "--title", "An order is charged at most once", ...root]),
    expect: exit(0),
    gap: linkGap,
  });
  await step({
    id: "link-add",
    cmd: P(["link", "add", "R1", "ComputeTotal", ...root]),
    expect: all(exit(0), json((j) => same(j.status, "created", "link status"))),
    gap: linkGap,
  });
  await step({
    id: "link-check",
    cmd: P(["link", "check", ...root]),
    expect: all(exit(0), includes('"ComputeTotal"', "the linked symbol")),
    gap: linkGap,
  });
}

async function legacyInit(P) {
  const legacy = join(HOME, "legacy");
  rmSync(legacy, { recursive: true, force: true });
  cpSync(PROJECT, legacy, { recursive: true, filter: (src) => !src.includes("/.pymtheg") && !src.includes("/.git") });
  mkdirSync(join(legacy, ".pymtheg-studio"));
  writeFileSync(join(legacy, ".pymtheg-studio", "old.json"), "{}");
  await step({
    id: "init-with-legacy-folder",
    display: "pymtheg init (project with an old .pymtheg-studio/ folder)",
    cmd: P(["init", legacy]),
    cwd: legacy,
    expect: all(exit(0), includes(".pymtheg-studio", "a notice naming the old folder"), () =>
      existsSync(join(legacy, ".pymtheg-studio", "old.json")) ? null : "old folder was changed",
    ),
  });
}

async function networkOff() {
  await step({
    id: "network-off",
    display: "fetch https://registry.npmjs.org/ and http://1.1.1.1/ must both fail",
    skipWording: true,
    run: async () => {
      const reached = [];
      for (const target of ["https://registry.npmjs.org/", "http://1.1.1.1/"]) {
        try {
          await fetch(target, { signal: AbortSignal.timeout(15_000) });
          reached.push(target);
        } catch {}
      }
      return { exitCode: null, reached };
    },
    expect: (r) => (r.reached.length ? `still reachable: ${r.reached.join(", ")}` : null),
  });
  writeFileSync(join(OUT, ".marker"), "");
}

async function writesOutside() {
  await step({
    id: "writes-outside-project",
    display: "files written since the install, outside the project and harness",
    observe: true,
    skipWording: true,
    cmd: [
      "sh",
      "-c",
      `find / -xdev -newer ${OUT}/.marker -type f 2>/dev/null | grep -v -e '^/proc' -e '^/sys' -e '^/acc/' -e '^${HOME}/project/' -e '^${HOME}/legacy/' -e '^${HOME}/restic/' | sed -E 's#^(/[^/]+/[^/]+/[^/]+/[^/]+).*#\\1#' | sort | uniq -c | sort -rn | head -20`,
    ],
    note: (r) => r.stdout.trim().split("\n").filter(Boolean).map((l) => l.trim()).join("; ") || "nothing",
  });
}

function sizeOf(path) {
  let total = 0;
  const stack = [path];
  while (stack.length) {
    const p = stack.pop();
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) for (const e of readdirSync(p)) stack.push(join(p, e));
    else total += st.size;
  }
  return total;
}

function installedRoot(kind) {
  if (kind === "global") return join(GLOBAL_PREFIX, "lib/node_modules/pymtheg");
  if (kind === "local") return join(APP, "node_modules/pymtheg");
  const base = join(HOME, ".npm/_npx");
  for (const dir of existsSync(base) ? readdirSync(base) : []) {
    const candidate = join(base, dir, "node_modules/pymtheg");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function installSize() {
  return step({
    id: "install-size",
    observe: true,
    skipWording: true,
    run: async () => {
      const roots = [join(HOME, ".npm/_npx"), join(HOME, ".npm/_cacache"), GLOBAL_PREFIX, join(APP, "node_modules")].filter(existsSync);
      const sizes = roots.map((p) => `${p.replace(HOME, "~")} ${(sizeOf(p) / 1048576).toFixed(1)} MiB`);
      const pkg = ["npx", "global", "local"].map(installedRoot).find((p) => p && existsSync(p));
      // Nested node_modules for a global install, hoisted otherwise.
      const modules = pkg ? (existsSync(join(pkg, "node_modules")) ? join(pkg, "node_modules") : join(pkg, "..")) : null;
      const packages = [];
      if (modules)
        for (const e of readdirSync(modules)) {
          if (e.startsWith(".")) continue;
          const names = e.startsWith("@") ? readdirSync(join(modules, e)).map((n) => `${e}/${n}`) : [e];
          for (const n of names) packages.push([n, sizeOf(join(modules, n))]);
        }
      packages.sort((a, b) => b[1] - a[1]);
      return { exitCode: 0, stdout: sizes.join("; "), largest: packages.slice(0, 10).map(([n, b]) => `${n} ${(b / 1048576).toFixed(1)} MiB`), packageCount: packages.length };
    },
    note: (r) => `${r.stdout} (apparent file sizes)`,
    observation: (r) => ({ packages: r.packageCount, largestPackages: r.largest }),
  });
}

const npmWarnings = (r) => [...new Set((r.stdout + "\n" + r.stderr).split("\n").filter((l) => /npm (warn|WARN|error|ERR)/.test(l)).map((l) => l.trim().slice(0, 200)))].slice(0, 12);

function installStep(id, cmd, cwd, extraExpect = () => null) {
  return step({
    id,
    cmd,
    cwd,
    expect: all(exit(0), extraExpect),
    skipWarnings: true, // npm's own install output; Node warnings are checked on every later step
    note: (r) => `${(r.durationMs / 1000).toFixed(1)} s (observation); ${npmWarnings(r).length} npm warning lines`,
    observation: (r) => ({ npmWarnings: npmWarnings(r) }),
  });
}

async function npxAbsolute() {
  await step({
    id: "npx-absolute-path",
    display: "npx --yes /acc/pkg/pymtheg-*.tgz --help (absolute path)",
    cmd: ["npx", "--yes", TGZ, "--help"],
    cwd: HOME,
    observe: true,
    skipWording: true,
    note: (r) => (r.exitCode === 0 ? "works" : `exit ${r.exitCode}: ${excerpt(r.stdout + r.stderr, 120)}`),
  });
}

// ---------------------------------------------------------------- Go toolchain opt-in

/**
 * With graph.toolchain.go on, the index must actually run `go` and report the
 * route `used` with upgraded links. Until W3-L2 (PR 42) wires the setting into
 * `pymtheg graph`, the only accepted shortfall is exactly that: exit 0, status
 * ok, no `toolchain` field in the answer and no `go` process.
 */
async function goOptIn(pym) {
  const settingsFile = join(PROJECT, ".pymtheg/settings.json");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  writeFileSync(settingsFile, JSON.stringify({ ...settings, graph: { ...(settings.graph ?? {}), toolchain: { go: true } } }, null, 2) + "\n");
  await step({
    id: "go-toolchain-index",
    display: 'graph.toolchain.go = true; graph index --json',
    cmd: pym(["graph", "index", "--root", PROJECT, "--json"]),
    allowToolchain: true,
    expect: (r) => {
      const go = r.json?.toolchain?.go;
      const goCalls = r.calls.filter((c) => c.tool === "go").length;
      return (
        exit(0)(r) ??
        (go?.state !== "used"
          ? `toolchain state ${JSON.stringify(go?.state ?? r.json?.toolchain ?? "absent")}, expected "used"`
          : !(go.upgradedLinks > 0)
            ? `upgradedLinks ${go.upgradedLinks}, expected > 0`
            : goCalls === 0
              ? "reported used, but no go process ran"
              : null)
      );
    },
    gap: {
      chunk: "W3-L2",
      reason: "W3-L2 wiring not merged: the setting is ignored (no toolchain field, no go process)",
      when: (r) => r.exitCode === 0 && r.json?.status === "ok" && r.json && !("toolchain" in r.json) && !r.calls.some((c) => c.tool === "go"),
    },
    note: (r) => `go ${r.json.toolchain.go.version ?? ""}; ${r.json.toolchain.go.upgradedLinks} links upgraded; ${r.calls.filter((c) => c.tool === "go").length} go processes`,
  });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  await step({
    id: "go-toolchain-off-again",
    display: "setting removed; graph index --json runs no go",
    cmd: pym(["graph", "index", "--root", PROJECT, "--json"]),
    expect: all(exit(0), json((j) => (j.status === "ok" ? null : `status ${j.status}`))),
  });
}

// ---------------------------------------------------------------- restic

async function restic(pym) {
  const R = join(HOME, "restic");
  const q = (id, args) =>
    step({
      id,
      cmd: pym([...args, "--root", R, "--json"]),
      cwd: R,
      expect: all(exit(0), json((j) => (["ok", "ambiguous"].includes(j.status) ? null : `status ${j.status}`))),
      note: (r) =>
        `${r.json.status}; ${JSON.stringify(r.json.resultCounts)}; ${(r.durationMs / 1000).toFixed(1)} s, peak RSS ≥ ${((r.peakRssKiB ?? 0) / 1024).toFixed(0)} MiB (observations)`,
    });
  await step({ id: "restic-init", cmd: pym(["init", R]), cwd: R, expect: exit(0), note: (r) => `${(r.durationMs / 1000).toFixed(1)} s (observation)` });
  await step({
    id: "restic-graph-index",
    cmd: pym(["graph", "index", "--root", R, "--json"]),
    cwd: R,
    expect: all(exit(0), json((j) => (j.status !== "ok" ? `status ${j.status}` : j.failedFiles?.length ? `${j.failedFiles.length} failed files` : null))),
    note: (r) =>
      `${r.json.counts.files} files, ${r.json.counts.symbols} symbols, ${r.json.counts.links} links, 0 failed; ` +
      `${(r.durationMs / 1000).toFixed(1)} s, peak RSS ≥ ${((r.peakRssKiB ?? 0) / 1024).toFixed(0)} MiB (observations)`,
  });
  await q("restic-status", ["graph", "status"]);
  await q("restic-search", ["graph", "search", "Snapshot", "--limit", "20"]);
  await q("restic-callers", ["graph", "callers", "SaveBlob"]);
  await q("restic-callees", ["graph", "callees", "runBackup"]);
  await q("restic-impact", ["graph", "impact", "LoadIndex", "--depth", "2"]);
  await q("restic-path", ["graph", "path", "runBackup", "SaveBlob"]);
}

// ---------------------------------------------------------------- scenarios

// `npx /abs/path.tgz` runs the path as a command (exit 126); `./name.tgz` and
// `file:/abs/path.tgz` are package specs. The install step uses the documented
// relative form from the tarball's folder; later steps use the same tarball.
const npx = (args) => ["npx", "--yes", "file:" + TGZ, ...args];
const npxInstall = () =>
  installStep("install-npx", ["npx", "--yes", "./" + TGZ.split("/").pop(), "--help"], join(ACC, "pkg"), includes("graph index"));

const gitSteps = [
  {
    id: "git-status-after-init",
    cmd: ["git", "status", "--porcelain", "--untracked-files=all"],
    skipWording: true,
    expect: all(exit(0), (r) =>
      same(r.stdout.split("\n").filter(Boolean).sort(), ["?? .pymtheg/.gitignore", "?? .pymtheg/project.json", "?? .pymtheg/settings.json"], "untracked after init"),
    ),
  },
  { id: "git-tracked-unchanged", cmd: ["sh", "-c", "git diff --exit-code --stat && git diff --cached --exit-code --stat"], skipWording: true, expect: exit(0) },
];

const scenarios = {
  "a-node-only": {
    install: npxInstall,
    run: async () => {
      await networkOff();
      await installSize();
      await npxAbsolute();
      await coreSteps(npx);
      await writesOutside();
    },
  },
  "b-node-git": {
    install: npxInstall,
    run: async () => {
      await networkOff();
      await step({
        id: "git-setup",
        skipWording: true,
        cmd: ["sh", "-c", "git init -q -b main && git -c user.email=a@example.invalid -c user.name=acc add -A && git -c user.email=a@example.invalid -c user.name=acc commit -qm sample && git status --porcelain"],
        expect: all(exit(0), (r) => (r.stdout.trim() ? "tree not clean after commit" : null)),
      });
      coreSteps.afterInit = gitSteps;
      await coreSteps(npx);
      // After graph, MCP and Studio, only the same three files are visible.
      await step({ ...gitSteps[0], id: "git-status-end" });
      await writesOutside();
    },
  },
  "c-node-go-rust": {
    install: npxInstall,
    run: async () => {
      await networkOff();
      await step({
        id: "toolchains-present",
        observe: true,
        skipWording: true,
        cmd: ["sh", "-c", "PATH=$(echo $PATH | sed 's#/acc/shims:##'); go version && cargo --version && rustc --version"],
        note: (r) => r.stdout.trim().split("\n").join("; "),
      });
      await coreSteps(npx);
      await goOptIn(npx);
    },
  },
  "d-global": {
    install: () => installStep("install-global", ["npm", "install", "--global", TGZ], HOME),
    run: async () => {
      await networkOff();
      await installSize();
      await step({
        id: "bin-location",
        skipWording: true,
        cmd: ["sh", "-c", 'readlink -f "$(command -v pymtheg)"'],
        expect: all(exit(0), (r) => (r.stdout.trim() === GLOBAL_PREFIX + "/lib/node_modules/pymtheg/dist/cli/main.js" ? null : `resolves to ${r.stdout.trim()}`)),
      });
      await coreSteps((args) => ["pymtheg", ...args]);
    },
  },
  "d-local": {
    install: async () => {
      mkdirSync(APP, { recursive: true });
      writeFileSync(join(APP, "package.json"), JSON.stringify({ name: "acc-app", version: "1.0.0", private: true }) + "\n");
      await installStep("install-local", ["npm", "install", TGZ], APP);
    },
    run: async () => {
      await networkOff();
      await installSize();
      await coreSteps((args) => ["sh", "-c", `cd ${APP} && exec npx --no-install pymtheg "$@"`, "pymtheg", ...args]);
    },
  },
  "f-restic": {
    install: npxInstall,
    run: async () => {
      await networkOff();
      await restic(npx);
    },
  },
};

// e. Node version edges. engines is ">=24": all three are supported, so
// install, doctor and the core commands are required.
for (const edge of ["e-node-24.0.0", "e-node-25", "e-node-26"])
  scenarios[edge] = {
    install: npxInstall,
    run: async () => {
      await networkOff();
      await step({ id: "node-version", cmd: ["node", "--version"], cwd: HOME, observe: true, skipWording: true, note: (r) => r.stdout.trim() });
      await step({ id: "help", cmd: npx(["--help"]), expect: all(exit(0), includes("graph index")) });
      await step({ id: "init", cmd: npx(["init", PROJECT]), expect: exit(0) });
      await step({
        id: "doctor",
        cmd: npx(["doctor", "--format", "json"]),
        expect: all(exit(0), json((j) => {
          const bad = (j.checks ?? []).filter((c) => c.status !== "ready").map((c) => `${c.name}: ${c.status}`);
          return !j.checks?.length ? "no checks" : bad.length ? `not ready: ${bad.join(", ")}` : null;
        })),
      });
      await step({ id: "check-valid", cmd: npx(["check", DESIGN, "--format", "json"]), expect: all(exit(0), json((j) => same(j.diagnostics?.length, 0, "diagnostics"))) });
      await step({ id: "verify-valid", cmd: npx(["verify", DESIGN, "--entry", "Order"]), expect: exit(0) });
      await step({ id: "simulate-valid", cmd: npx(["simulate", DESIGN, "--entry", "Order", "--seed", "42"]), expect: exit(0) });
      await step({ id: "check-broken", expectFail: true, cmd: npx(["check", BROKEN]), expect: all(exit(1), includes(BROKEN_DIAGNOSTIC)) });
      await step({
        id: "graph-index",
        cmd: npx(["graph", "index", "--root", PROJECT, "--json"]),
        expect: all(exit(0), json((j) => (j.failedFiles?.length ? "failed files" : same(j.counts?.files, SAMPLE_SOURCE_FILES, "indexed files")))),
      });
      await step({ id: "graph-ts-callers", cmd: npx(["graph", "callers", "formatTotal", "--root", PROJECT, "--json"]), expect: callers("formatTotal", [["renderBasket", "web/src/main.ts"]]) });
    },
  };

const chosen = scenarios[scenario];
if (!chosen || !["install", "run"].includes(phase)) {
  console.error(`usage: driver.mjs (${Object.keys(scenarios).join("|")}) install|run`);
  process.exit(64);
}
mkdirSync(OUT, { recursive: true });
await chosen[phase]();
// Aggregate: every backend or toolchain process seen in any step of this phase.
if (phase === "run") {
  const rows = readFileSync(RESULTS, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const seen = rows.filter((r) => r.processes?.length && !r.step.startsWith("go-toolchain-index"));
  appendFileSync(
    RESULTS,
    JSON.stringify({
      scenario,
      step: "no-toolchain-processes",
      command: "PATH shims + spawn trace: java, javac, quint, tlc, go, cargo, rustc, rustup",
      network: false,
      required: true,
      exitCode: null,
      status: seen.length ? "fail" : "pass",
      reason: seen.length ? seen.map((r) => `${r.step}: ${r.processes.join("; ")}`).join(" | ") : "log empty in every step",
      outputBytes: 0,
      durationMs: null,
      excerpt: "",
    }) + "\n",
  );
}
