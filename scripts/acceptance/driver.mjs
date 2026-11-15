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
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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
const VIOLATION = join(PROJECT, "designs/overcharge.pym");
/** The complete expected diagnostic for the broken design: location, code, message and suggestion. */
const BROKEN_CODE = "N002";
const BROKEN_MESSAGE = "Unknown value or variant charge; did you mean charges?";
const BROKEN_DIAGNOSTIC = `${BROKEN}:7:27 error ${BROKEN_CODE}: ${BROKEN_MESSAGE}`;
const TGZ = join(ACC, "pkg", readdirSync(join(ACC, "pkg")).find((f) => f.endsWith(".tgz")));
const GLOBAL_PREFIX = join(HOME, ".npm-global");
const APP = join(HOME, "app");
const GO_PROJECT = join(HOME, "goproject");
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

function run(cmd, { cwd = PROJECT, timeoutMs = 900_000 } = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(cmd[0], cmd.slice(1), { cwd, env: baseEnv, stdio: ["ignore", "pipe", "pipe"], detached: true });
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
  for (const line of readFileSync(SHIM_LOG, "utf8").split("\n").filter(Boolean)) calls.push({ tool: line.split(" ")[0], detail: `shim: ${line}` });
  for (const line of readFileSync(SPAWN_LOG, "utf8").split("\n").filter(Boolean)) {
    let s;
    try {
      s = JSON.parse(line);
    } catch {
      continue;
    }
    const file = s.file.split("/").pop();
    const args = s.args.join(" ");
    const tool =
      BACKEND_PROGRAM.test(file) || TOOLCHAIN_PROGRAM.test(file)
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

// ---------------------------------------------------------------- output rules

/** Node's own process warnings, with or without a code: `(node:12) [DEP0040] DeprecationWarning: …`. */
const NODE_WARNING = /^\(node:\d+\) (?:\[[A-Z0-9_]+\] )?\w*Warning: /;
const TRACE_HINT = /^\(Use `node --trace-(?:warnings|deprecation) \.\.\.` to show where the warning was created\)$/;
const SQLITE_WARNING = /^\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time$/;
/**
 * The known warning gaps, one entry per chunk still in flight. An empty list is
 * the normal state: then any Node warning fails, and with no other gap the
 * harness exits 0. Delete R1-H's entry when PR 45 merges.
 */
const KNOWN_WARNING_GAPS = [{ chunk: "R1-H", versions: /^v24\.0\.|^v25\./, warning: SQLITE_WARNING }];
const STACK_LINE = /^\s+at .+:\d+:\d+\)?$/;
const ERROR_LINE = /^\s*\w*Error: /;
const UNHANDLED = /\bunhandled\b|\buncaught\b/i;

function nodeWarnings(stderr) {
  return stderr.split("\n").filter((l) => NODE_WARNING.test(l) || TRACE_HINT.test(l));
}
/** The chunk whose known gap covers exactly these warning lines on this Node version, or null. */
function knownWarningGap(lines) {
  const gap = KNOWN_WARNING_GAPS.find((g) => g.versions.test(NODE_VERSION) && lines.some((l) => g.warning.test(l)) && lines.every((l) => g.warning.test(l) || TRACE_HINT.test(l)));
  return gap?.chunk ?? null;
}

/** Internal-error signs: stack frames, `XError: ` lines not expected by the step, unhandled/uncaught rejections. */
function internalErrors(text, allowedErrorLines = []) {
  const found = [];
  for (const line of text.split("\n")) {
    if (STACK_LINE.test(line)) found.push(`stack frame: ${line.trim().slice(0, 140)}`);
    else if (ERROR_LINE.test(line) && !allowedErrorLines.includes(line.trim())) found.push(`error line: ${line.trim().slice(0, 140)}`);
    else if (UNHANDLED.test(line)) found.push(`unhandled: ${line.trim().slice(0, 140)}`);
    if (found.length >= 3) break;
  }
  return found;
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
 *                process; no Java/Quint/TLC wording; no Node process warning;
 *                no stack frame, unexpected `XError:` line or unhandled rejection
 *  expected-fail the step must fail (a broken design, a changed link) and
 *                failed exactly as specified
 *  known-gap     the ONLY problem is the expectation failure, and the step's own
 *                gap matcher recognises the exact output that chunk will change;
 *                or the R1-H SQLite warning on Node 24.0.x / 25.x and nothing else
 *  fail          anything else, including a crash, an unexpected exit code or
 *                an exception inside the harness
 *  observed      report-only step (sizes, timings)
 * `harnessOutput: true` marks steps whose output is the harness's own (git,
 * find, du): only their expectation is judged.
 */
function record(def, r) {
  const problems = [];
  const text = [r.stdout ?? "", r.stderr ?? "", r.extraText ?? ""].join("\n");
  if (r.harnessError) problems.push({ kind: "harness", reason: r.harnessError });
  const expectation = def.expect ? safe(def.expect, r) : null;
  if (expectation) problems.push({ kind: "expect", reason: expectation });
  if (!def.harnessOutput) {
    const words = def.skipWording ? [] : wordingHits(text);
    if (words.length) problems.push({ kind: "wording", reason: `mentions Java/Quint/TLC: ${words[0]}` });
    const internal = def.skipWording ? [] : internalErrors(text, def.allowedErrorLines ?? []);
    if (internal.length) problems.push({ kind: "internal", reason: `internal error output: ${internal.join("; ")}` });
    const warnings = def.skipWarnings ? [] : nodeWarnings(r.stderr ?? "");
    if (warnings.length) problems.push({ kind: "node-warning", reason: `Node warning: ${warnings.join(" / ").slice(0, 300)}`, gapChunk: knownWarningGap(warnings) });
  }
  for (const call of r.calls ?? []) {
    if (TOOLCHAIN_PROGRAM.test(call.tool) && def.allowToolchain) continue;
    problems.push({ kind: "process", reason: `started ${call.tool} (${call.detail})` });
  }

  let status, reason, chunk;
  const gapOf = (p) => {
    if (p.kind === "node-warning" && p.gapChunk) return p.gapChunk;
    if (p.kind === "expect" && def.gap && safe(def.gap.when, r) === true) return def.gap.chunk;
    return null;
  };
  if (def.observe) {
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
    reason: String(reason),
    ...(chunk ? { chunk } : {}),
    outputBytes: Buffer.byteLength(text) - 2,
    durationMs: r.durationMs === undefined ? null : Math.round(r.durationMs),
    ...(r.peakRssKiB ? { peakRssKiB: r.peakRssKiB } : {}),
    ...(r.timedOut ? { timedOut: true } : {}),
    ...(r.calls?.length ? { processes: r.calls.map((c) => c.detail) } : {}),
    excerpt: excerpt(text),
    ...(def.fingerprint ? { fingerprint: safe(def.fingerprint, r) } : {}),
    ...(def.observation ? { observation: safe(def.observation, r) } : {}),
  };
  appendFileSync(RESULTS, JSON.stringify(result) + "\n");
  process.stdout.write(`${status.padEnd(13)} ${scenario}/${def.id}: ${result.reason.slice(0, 220)}\n`);
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
    r.timedOut ? "timed out (safety stop)" : codes.includes(r.exitCode) ? null : `exit ${r.exitCode}${r.signal ? " (" + r.signal + ")" : ""}, expected ${codes.join(" or ")}`;
const all =
  (...checks) =>
  (r) => {
    for (const c of checks) {
      const p = c(r);
      if (p) return p;
    }
    return null;
  };
const includes =
  (needle, what = JSON.stringify(needle)) =>
  (r) =>
    (r.stdout + "\n" + r.stderr).includes(needle) ? null : `output lacks ${what}`;
/** Some output line equals `line` exactly (after trimming trailing spaces). */
const hasLine = (line) => (r) => ((r.stdout + "\n" + r.stderr).split("\n").some((l) => l.trimEnd() === line) ? null : `no output line equal to ${JSON.stringify(line)}`);
const json = (check) => (r) => (r.json ? check(r.json) : "stdout is not JSON");
const same = (actual, expected, what) => (JSON.stringify(actual) === JSON.stringify(expected) ? null : `${what}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

/** Exact callers: the set of (caller name, caller file, certainty) and the target name of every link. */
function callers(symbol, expected) {
  return all(
    exit(0),
    json((j) => {
      if (j.status !== "ok") return `status ${j.status}`;
      const links = j.data?.links ?? [];
      const got = links.map((l) => `${l.source?.name}@${l.source?.file}:${l.certainty}`).sort();
      const want = expected.map(([name, file]) => `${name}@${file}:definite`).sort();
      const targets = [...new Set(links.map((l) => l.target?.name))];
      return same(got, want, `callers of ${symbol}`) ?? same(targets, [symbol], "link targets");
    }),
  );
}
const linkSummary = (r) => (r.json?.data?.links ?? []).map((l) => `${l.source?.name}@${l.source?.file}:${l.certainty}`).join(", ");

/** Every file under `dir` (excluding .pymtheg and .git) with size and mtime. */
function snapshotTree(dir) {
  const files = {};
  const walk = (d, rel) => {
    for (const e of readdirSync(d)) {
      if (!rel && (e === ".pymtheg" || e === ".git")) continue;
      const p = join(d, e),
        r = rel ? `${rel}/${e}` : e,
        st = lstatSync(p);
      if (st.isDirectory()) walk(p, r);
      else files[r] = `${st.size}:${st.mtimeMs}`;
    }
  };
  walk(dir, "");
  return files;
}
function treeChanges(before, after) {
  const changed = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[k] !== after[k]) changed.push(k);
  return changed.sort();
}

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

/** The JSON content of a tools/call answer: structuredContent, else the first text block parsed. */
function toolContent(response) {
  const result = response?.result;
  if (!result) return null;
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find((c) => c.type === "text")?.text;
  return text ? parseJson(text) : null;
}
/** Decoded text blocks of every tools/call answer in a value, so stack traces inside JSON strings are seen. */
function decodedTexts(value) {
  const out = [];
  const walk = (v) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v.content)) for (const c of v.content) if (c?.type === "text" && typeof c.text === "string") out.push(c.text);
    for (const x of Object.values(v)) walk(x);
  };
  walk(value);
  return out.join("\n");
}


async function mcpSteps(pym) {
  const mcp = new Mcp(pym(["mcp", PROJECT]), PROJECT);
  let tools = null; // null until tools/list succeeds
  const called = new Set();
  const ctx = {};
  // Each MCP step: needs a successful tools/list and the tool(s) it uses listed.
  const call = (id, display, uses, fn, def = {}) =>
    step({
      id,
      display,
      ...def,
      run: async () => {
        if (tools === null) return { exitCode: null, ...mcp.take(), json: { unavailable: "tools/list did not succeed" } };
        const missing = uses.filter((u) => !tools.includes(u));
        if (missing.length) return { exitCode: null, ...mcp.take(), json: { unavailable: `not in tools/list: ${missing.join(", ")}` } };
        for (const u of uses) called.add(u);
        const value = await fn();
        return { ...mcp.take(), exitCode: null, json: value, extraText: decodedTexts(value) };
      },
      expect: (r) => (r.json?.unavailable ? r.json.unavailable : def.expect ? def.expect(r) : null),
    });
  const rpc = (response) => (response?.error ? `JSON-RPC error: ${response.error.message}` : !response?.result ? "no result" : response.result.isError ? `tool returned isError: ${excerpt(decodedTexts({ r: response.result }), 200)}` : null);
  const tool = async (name, args) => {
    const response = await mcp.request("tools/call", { name, arguments: args });
    const problem = rpc(response);
    if (problem) throw Object.assign(Error(`${name}: ${problem}`), { response });
    return toolContent(response);
  };
  // A thrown tool error is the step's expectation failure, not a harness error.
  const guarded = (fn) => async () => {
    try {
      return await fn();
    } catch (e) {
      if (e.response) return { toolError: e.message, response: e.response };
      throw e;
    }
  };
  const ok = (check) => (r) => (r.json?.toolError ? r.json.toolError : check(r.json));

  await step({
    id: "mcp-initialize",
    display: "pymtheg mcp PROJECT (stdio) → initialize",
    run: async () => {
      const response = await mcp.request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pymtheg-acceptance", version: "1" } });
      mcp.notify("notifications/initialized", {});
      return { exitCode: null, ...mcp.take(), json: response };
    },
    expect: (r) => (r.json?.error ? `JSON-RPC error: ${r.json.error.message}` : r.json?.result?.serverInfo?.name ? null : "no serverInfo in initialize result"),
  });
  await step({
    id: "mcp-tools-list",
    display: "tools/list (descriptions included in the output checks)",
    run: async () => {
      const response = await mcp.request("tools/list", {});
      if (!response.error && Array.isArray(response.result?.tools)) tools = response.result.tools.map((t) => t.name);
      return { exitCode: null, ...mcp.take(), json: response };
    },
    expect: (r) => (r.json?.error ? `JSON-RPC error: ${r.json.error.message}` : tools === null ? "tools/list returned no tool array" : tools.length ? null : "tools/list is empty"),
    note: () => `${tools.length} tools: ${tools.join(", ")}`,
  });

  // Start with project_info, as the server's instructions say.
  await call("mcp-project_info", "project_info {}", ["project_info"], guarded(() => tool("project_info", {})), {
    expect: ok((j) => same(j.totalFiles, 3, "project_info.totalFiles (.pym designs)")),
  });
  await call("mcp-design_recipe", 'design_recipe {action:"list"}', ["design_recipe"], guarded(() => tool("design_recipe", { action: "list" })), {
    expect: ok((j) => (j.recipes?.some((x) => x.id === "decision") ? null : `recipes: ${JSON.stringify(j.recipes?.map((x) => x.id))}`)),
  });
  await call("mcp-read_source", 'read_source {file:"designs/order.pym", startLine:2, limit:1}', ["read_source"], guarded(() => tool("read_source", { file: "designs/order.pym", startLine: 2, limit: 1 })), {
    expect: ok((j) => same(j.lines, ["machine Order {"], "line 2 of designs/order.pym")),
  });
  await call("mcp-check_design", 'check_design {file:"designs/order.pym"}', ["check_design"], guarded(() => tool("check_design", { file: "designs/order.pym" })), {
    expect: ok((s) => same({ exitStatus: s.exitStatus, errors: s.findings?.errors, warnings: s.findings?.warnings }, { exitStatus: 0, errors: 0, warnings: 0 }, "valid design verdict")),
  });
  await call(
    "mcp-check_design-broken",
    'check_design {file:"designs/broken.pym"}, then read_run {section:"findings"}',
    ["check_design", "read_run"],
    guarded(async () => {
      const summary = await tool("check_design", { file: "designs/broken.pym" });
      const findings = await tool("read_run", { runId: summary.runId, section: "findings" });
      return { summary, findings };
    }),
    {
      // The complete diagnostic on ONE finding: code, exact message, file, line, column; and nothing else.
      expect: ok(({ summary, findings }) => {
        if (summary.exitStatus !== 1) return `exitStatus ${summary.exitStatus}, expected 1`;
        const items = findings.items ?? [];
        const got = items.map((i) => ({ code: i.code, message: i.message, file: i.location?.file, line: i.location?.line, column: i.location?.column, severity: i.severity }));
        return same(got, [{ code: BROKEN_CODE, message: BROKEN_MESSAGE, file: "designs/broken.pym", line: 7, column: 27, severity: "error" }], "broken-design findings");
      }),
    },
  );
  for (const method of ["verify", "simulate"])
    await call(
      `mcp-explore_behaviour-${method}`,
      `explore_behaviour {entry:"Order", method:"${method}"}, then read_run {section:"properties"}`,
      ["explore_behaviour", "read_run"],
      guarded(async () => {
        const s = await tool("explore_behaviour", { file: "designs/order.pym", entry: "Order", method, maxSteps: 6, maxSamples: 200 });
        const properties = await tool("read_run", { runId: s.runId, section: "properties" });
        return { s, properties };
      }),
      {
        expect: ok(({ s, properties }) => {
          const behaviour = (properties.items ?? []).filter((p) => p.analysisKind === "behaviour" || p.method === "finite_model_check" || p.method === "simulation");
          return (
            same(
              { exitStatus: s.exitStatus, exhaustive: s.results?.exhaustive, counterexamples: s.results?.counterexamples, unresolved: s.results?.unresolved },
              { exitStatus: 0, exhaustive: method === "verify", counterexamples: 0, unresolved: 0 },
              `${method} summary`,
            ) ??
            same(
              [...new Set(behaviour.map((p) => `${p.method}/${p.outcome}/${p.completion}/${p.exhaustive}`))],
              [`${method === "verify" ? "finite_model_check" : "simulation"}/no_counterexample/complete/${method === "verify"}`],
              `${method} properties`,
            )
          );
        }),
      },
    );
  const FLOW = "designs/next.pym";
  const flowBuffers = { [FLOW]: "flow next(n: Nat) -> Nat { return n + 1; }\n" };
  await call("mcp-try_inputs", `try_inputs {file:"${FLOW}" (buffer only), entry:"next", inputs:{n:"41"}}`, ["try_inputs"], guarded(() => tool("try_inputs", { file: FLOW, buffers: flowBuffers, entry: "next", inputs: { n: "41" } })), {
    expect: ok((j) => same([j.result?.completion, String(j.result?.output)], ["complete", "42"], "try_inputs result")),
  });
  await call(
    "mcp-design_interface",
    'check_design (flow buffer), then design_interface {action:"symbols", query:"next"}',
    ["check_design", "design_interface"],
    guarded(async () => {
      const checked = await tool("check_design", { file: FLOW, buffers: flowBuffers });
      ctx.flowRun = checked.runId;
      const symbols = await tool("design_interface", { action: "symbols", runId: checked.runId, query: "next" });
      return { checked, symbols };
    }),
    { expect: ok(({ checked, symbols }) => (checked.exitStatus !== 0 ? `flow check exitStatus ${checked.exitStatus}` : symbols.symbols?.some((x) => x.name === "next") ? null : `symbols: ${JSON.stringify(symbols.symbols?.map((x) => x.name))}`)) },
  );
  await call("mcp-emit_scaffold", 'emit_scaffold {target:"typescript"}', ["emit_scaffold"], guarded(async () => (ctx.scaffold = await tool("emit_scaffold", { runId: ctx.flowRun, target: "typescript" }))), {
    expect: ok((j) => (typeof j.source === "string" && /function next\(/.test(j.source) && j.emissionId ? null : `scaffold: ${excerpt(JSON.stringify(j), 160)}`)),
  });
  // One page holding the whole source: it must equal what emit_scaffold returned.
  await call("mcp-read_scaffold", 'read_scaffold {section:"source", offset:0, limit:4096}', ["read_scaffold"], guarded(() => tool("read_scaffold", { emissionId: ctx.scaffold?.emissionId, section: "source", offset: 0, limit: 4096 })), {
    expect: ok((j) =>
      typeof j.text !== "string" || !/^[0-9a-f]{64}$/.test(j.contentHash ?? "")
        ? `page: ${excerpt(JSON.stringify(j), 200)}`
        : same([j.text === ctx.scaffold?.source, j.nextOffset ?? null, j.totalCharacters], [true, null, ctx.scaffold?.source?.length], "scaffold page (equals emitted source, complete)"),
    ),
  });
  await call(
    "mcp-emit_implementation_check",
    'emit_implementation_check {target:"go", implementationType:"*Worker"}',
    ["emit_implementation_check"],
    guarded(() => tool("emit_implementation_check", { runId: ctx.flowRun, target: "go", implementationType: "*Worker" })),
    { expect: ok((j) => (typeof j.source === "string" && j.source.includes("PymthegContracts") ? null : `source: ${excerpt(String(j.source), 160)}`)) },
  );

  // Code graph over MCP (R1-C): index, search and exact callers in all three languages.
  const graph = async (args) => {
    const first = await tool("code_graph", args);
    return first.state === "running" ? await tool("graph_result", { jobId: first.jobId, wait: true }) : first;
  };
  await call("mcp-code_graph-index", 'code_graph {action:"index"}', ["code_graph", "graph_result"], guarded(() => graph({ action: "index" })), {
    expect: ok((j) => same([j.state, j.summary?.status, j.summary?.failedFileCount], ["complete", "ok", 0], "index job")),
  });
  await call(
    "mcp-code_graph-search",
    'code_graph {action:"search", query:"Total"} (+ symbols page)',
    ["code_graph", "graph_result"],
    guarded(async () => {
      const answer = await graph({ action: "search", query: "Total" });
      const symbols = await tool("graph_result", { jobId: answer.jobId, section: "symbols" });
      return { answer, symbols };
    }),
    {
      expect: ok(({ answer, symbols }) => {
        const names = new Map((symbols.items ?? []).map((s) => [s.ref, `${s.name}@${s.file}`]));
        const got = (answer.items ?? []).filter((i) => i.type === "match").map((i) => names.get(i.ref) ?? `${i.name ?? "?"}@${i.file ?? "?"}`).sort();
        return answer.state !== "complete" ? `state ${answer.state}` : same(got, ["ComputeTotal@service/pricing/total.go", "formatTotal@web/src/format.ts", "total.go@service/pricing/total.go"], "search matches");
      }),
    },
  );
  const mcpCallers = (id, symbol, expected) =>
    call(
      id,
      `code_graph {action:"callers", query:"${symbol}", section:"links"} (+ symbols page)`,
      ["code_graph", "graph_result"],
      guarded(async () => {
        const links = await graph({ action: "callers", query: symbol, section: "links" });
        const symbols = await tool("graph_result", { jobId: links.jobId, section: "symbols" });
        return { links, symbols };
      }),
      {
        expect: ok(({ links, symbols }) => {
          const byRef = new Map((symbols.items ?? []).map((s) => [s.ref, s]));
          const got = (links.items ?? []).map((l) => `${byRef.get(l.source)?.name}@${byRef.get(l.source)?.file}->${byRef.get(l.target)?.name}:${l.certainty}`).sort();
          return same(got, expected.map(([name, file]) => `${name}@${file}->${symbol}:definite`).sort(), `MCP callers of ${symbol}`);
        }),
      },
    );
  await mcpCallers("mcp-code_graph-callers-ts", "formatTotal", [["renderBasket", "web/src/main.ts"]]);
  await mcpCallers("mcp-code_graph-callers-go", "ComputeTotal", [["main", "service/main.go"]]);
  await mcpCallers("mcp-code_graph-callers-rust", "apply_discount", [["main", "engine/src/main.rs"]]);

  // Requirement links over MCP only (R1-C2): plan:R1 linked to a Go (by a
  // code_graph symbol reference), a Rust and a TypeScript symbol; check, edit,
  // refresh, undo; requirements_for; unlinked; one link_result handle followed.
  const links = async (action, args = {}) => {
    const first = await tool("requirement_links", { action, ...args });
    return first.state === "running" ? await tool("link_result", { jobId: first.jobId, wait: true, section: args.section ?? "items" }) : first;
  };
  const linkIds = {};
  const MONEY = join(PROJECT, "web/src/money.ts");
  const moneyOriginal = readFileSync(MONEY, "utf8");
  const row = (l) => `${l.record}/${l.symbol?.name}:${l.state}`;
  // All six links: plan:R2's three from the CLI steps and plan:R1's three from MCP.
  const allLinks = (r1 = {}) =>
    ["plan:R1/percent_of", "plan:R1/roundCents", "plan:R1/taxFor", "plan:R2/ComputeTotal", "plan:R2/apply_discount", "plan:R2/formatTotal"].map((k) => `${k}:${r1[k] ?? "ok"}`).sort();
  const linkCall = (id, display, fn, expect) => call(id, display, ["requirement_links", "link_result"], guarded(fn), { expect: ok(expect) });
  await linkCall("mcp-requirement_links-requirement", 'requirement_links {action:"requirement", id:"R1"}', () => links("requirement", { id: "R1", title: "An order is charged at most once" }), (j) =>
    same([j.summary?.status, j.items?.map((i) => i.id)], ["created", ["plan:R1"]], "requirement"),
  );
  await linkCall(
    "mcp-requirement_links-add-go",
    'code_graph {action:"symbol", query:"taxFor"}, then requirement_links {action:"add", record:"R1", selector:<symbol ref>}',
    async () => {
      const found = await graph({ action: "symbol", query: "taxFor" });
      const ref = found.items?.[0]?.ref;
      const added = await links("add", { record: "R1", selector: ref });
      linkIds.taxFor = added.items?.[0]?.id;
      return { ref, added };
    },
    ({ ref, added }) =>
      !/^symbol:[0-9a-f]{64}$/.test(ref ?? "")
        ? `code_graph symbol ref ${JSON.stringify(ref)}`
        : same([added.summary?.status, added.items?.length, added.items?.[0]?.record, added.items?.[0]?.symbol?.name, added.items?.[0]?.symbol?.ref, typeof added.items?.[0]?.id], ["created", 1, "plan:R1", "taxFor", ref, "string"], "link to taxFor"),
  );
  for (const [lang, symbol, path] of [
    ["rust", "percent_of", "engine/src/discount.rs"],
    ["ts", "roundCents", "web/src/money.ts"],
  ])
    await linkCall(`mcp-requirement_links-add-${lang}`, `requirement_links {action:"add", record:"R1", selector:"${symbol}"}`, async () => {
      const added = await links("add", { record: "R1", selector: symbol });
      linkIds[symbol] = added.items?.[0]?.id;
      return added;
    }, (j) =>
      same([j.summary?.status, j.items?.length, j.items?.[0]?.record, j.items?.[0]?.symbol?.name, j.items?.[0]?.symbol?.path, typeof j.items?.[0]?.id], ["created", 1, "plan:R1", symbol, path, "string"], `link to ${symbol}`),
    );
  await linkCall("mcp-requirement_links-list", 'requirement_links {action:"list", record:"R1"}', () => links("list", { record: "R1" }), (j) =>
    same((j.items ?? []).map(row).sort(), ["plan:R1/percent_of:ok", "plan:R1/roundCents:ok", "plan:R1/taxFor:ok"], "links of plan:R1"),
  );
  const checkLinks = (id, expectedRows, passed, extra = () => null) =>
    linkCall(id, 'requirement_links {action:"check"}', () => links("check"), (j) => same([(j.items ?? []).map(row).sort(), j.summary?.passed], [expectedRows, passed], "check") ?? extra(j));
  await checkLinks("mcp-requirement_links-check", allLinks(), true);
  writeFileSync(MONEY, moneyOriginal.replace("Math.round(value * 100) / 100", "Math.round(value * 100) / 100 + 0"));
  await checkLinks("mcp-requirement_links-check-after-edit", allLinks({ "plan:R1/roundCents": "changed" }), false, (j) =>
    same((j.items ?? []).filter((l) => l.state !== "ok").map((l) => [l.id, l.differs]), [[linkIds.roundCents, ["body"]]], "the changed link"),
  );
  const refreshRound = (id) => linkCall(id, 'requirement_links {action:"refresh", link:<roundCents link>}', () => links("refresh", { link: linkIds.roundCents }), (j) => same([j.summary?.status, j.items?.[0]?.id], ["refreshed", linkIds.roundCents], "refresh"));
  await refreshRound("mcp-requirement_links-refresh");
  await checkLinks("mcp-requirement_links-check-after-refresh", allLinks(), true);
  writeFileSync(MONEY, moneyOriginal);
  await refreshRound("mcp-requirement_links-refresh-restored");
  await checkLinks("mcp-requirement_links-check-final", allLinks(), true);
  await linkCall("mcp-requirement_links-requirements_for", 'requirement_links {action:"requirements_for", symbol:"percent_of"}', () => links("requirements_for", { symbol: "percent_of" }), (j) =>
    same((j.items ?? []).map((t) => `${t.record}:${t.via}:${t.symbol?.name}`), ["plan:R1:direct:percent_of"], "requirements for percent_of"),
  );
  await linkCall("mcp-requirement_links-unlinked", 'requirement_links {action:"unlinked", symbols:true, section:"symbols"}', () => links("unlinked", { symbols: true, section: "symbols" }), (j) => {
    const names = (j.items ?? []).map((x) => x.name);
    return names.includes("renderBasket") ? (["formatTotal", "roundCents", "ComputeTotal"].find((n) => names.includes(n)) ? `linked symbol listed as unlinked: ${names.join(", ")}` : null) : `renderBasket missing from unlinked symbols: ${names.join(", ")}`;
  });
  // A handle followed from running to finished.
  await linkCall("mcp-link_result-handle", 'requirement_links {action:"check", wait:false}, then link_result {jobId, wait:true}', async () => {
    const handle = await tool("requirement_links", { action: "check", wait: false });
    const done = await tool("link_result", { jobId: handle.jobId, wait: true });
    return { handle, done };
  }, ({ handle, done }) =>
    same([handle.state, typeof handle.jobId, done.state, done.jobId === handle.jobId, done.summary?.passed, (done.items ?? []).map(row).sort()], ["running", "string", "complete", true, true, allLinks()], "handle → result"),
  );

  // Architecture and the older TypeScript implementation tools, end to end:
  // the requirement R1 created by `pymtheg link requirement` is the plan record.
  await call("mcp-read_architecture", 'read_architecture {section:"summary"}', ["read_architecture"], guarded(() => tool("read_architecture", { section: "summary" })), {
    // `available:false` is reported only without a store; each requirement made one revision.
    expect: ok((j) => same([j.available, j.totalRevisions], [undefined, 2], "architecture summary (available; two revisions: plan:R2 by CLI, plan:R1 by MCP)")),
  });
  await call(
    "mcp-observe_implementation",
    'read_implementation {section:"versions"}, then observe_implementation {files:["web/src/main.ts"]}',
    ["read_implementation", "observe_implementation"],
    guarded(async () => {
      const versions = await tool("read_implementation", { section: "versions" });
      const observed = await tool("observe_implementation", { files: ["web/src/main.ts"], label: "Acceptance observation", expectedRevision: versions.activeRevision });
      ctx.observed = observed;
      return { versions, observed };
    }),
    { expect: ok(({ versions, observed }) => (!Array.isArray(versions.items) ? "versions.items is not a list" : typeof observed.revision?.id === "string" ? null : `observed: ${excerpt(JSON.stringify(observed), 160)}`)) },
  );
  await call(
    "mcp-link_implementation",
    "read_implementation graph (planned R1, observed renderBasket), then link_implementation {reviewed:true}",
    ["read_implementation", "link_implementation"],
    guarded(async () => {
      const gaps = await tool("read_implementation", { section: "graph", mode: "gaps", limit: 20 });
      const plan = { items: (gaps.items ?? []).filter((i) => i.id === "plan:R1") };
      const code = await tool("read_implementation", { section: "graph", mode: "existing", limit: 20 });
      const decl = (code.items ?? []).find((i) => i.name === "renderBasket");
      ctx.link = { planId: plan.items?.[0]?.id, nodeId: decl?.id };
      const receipt = await tool("link_implementation", { revision: ctx.observed.revision.id, planId: plan.items[0].id, planHash: plan.items[0].planHash, nodeId: decl.id, observationId: code.observationId, note: "acceptance", reviewed: true });
      const linked = await tool("read_implementation", { section: "graph" });
      ctx.linkedRevision = linked.activeRevision;
      return { plan, decl, receipt, linked };
    }),
    {
      expect: ok(({ plan, decl, receipt, linked }) => {
        if (!decl) return "observed declarations lack renderBasket";
        if (plan.items?.[0]?.id !== "plan:R1") return `planned record ${JSON.stringify(plan.items?.[0]?.id)}, expected "plan:R1"`;
        const item = (linked.items ?? []).find((i) => i.id === "plan:R1");
        return receipt.reviewed !== true ? "receipt not reviewed" : same(item?.linkCount, 1, "links on plan:R1");
      }),
    },
  );
  await call(
    "mcp-compare_implementation",
    "compare_implementation {plan:R1, renderBasket}",
    ["compare_implementation"],
    guarded(() => tool("compare_implementation", { planId: ctx.link.planId, nodeId: ctx.link.nodeId, planRevision: ctx.linkedRevision, codeRevision: ctx.linkedRevision })),
    { expect: ok((j) => same([j.source?.equal, j.note], [true, "acceptance"], "comparison")) },
  );
  await call(
    "mcp-unlink_implementation",
    "unlink_implementation {plan:R1, renderBasket}, then read_implementation graph",
    ["unlink_implementation", "read_implementation"],
    guarded(async () => {
      const receipt = await tool("unlink_implementation", { revision: ctx.linkedRevision, planId: ctx.link.planId, nodeId: ctx.link.nodeId });
      const after = await tool("read_implementation", { section: "graph" });
      return { receipt, after };
    }),
    { expect: ok(({ receipt, after }) => (typeof receipt.revision?.id !== "string" ? "no revision receipt" : same((after.items ?? []).find((i) => i.id === "plan:R1")?.linkCount ?? 0, 0, "links on plan:R1 after unlink"))) },
  );

  // Every listed tool must have been exercised above; a new tool fails here
  // until the harness calls it.
  await step({
    id: "mcp-tool-coverage",
    display: "every tool in tools/list was called with a checked result",
    run: async () => ({ exitCode: null, json: { listed: tools, called: [...called] } }),
    expect: (r) => {
      if (r.json.listed === null) return "tools/list did not succeed";
      const unexercised = r.json.listed.filter((n) => !called.has(n));
      return unexercised.length ? `listed but not exercised by the harness: ${unexercised.join(", ")}` : null;
    },
    note: (r) => `${r.json.listed.length} tools listed, all called`,
  });
  await step({ id: "mcp-shutdown", display: "close stdin; server exits 0", expect: exit(0), run: async () => ({ exitCode: await mcp.close(), ...mcp.take() }) });
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
    const response = await fetch(url.origin + path, { headers: auth ? { authorization: "Bearer " + url.token } : {}, signal: AbortSignal.timeout(120_000) });
    return { http: response.status, type: response.headers.get("content-type") ?? "", body: await response.text() };
  };
  await step({ id: "studio-start", display: "pymtheg studio PROJECT --port 0 (prints session URL)", expect: () => (url ? null : "no session URL printed"), run: async () => ({ exitCode: null, ...take() }) });
  await step({
    id: "studio-status",
    display: "GET /api/project (Bearer session token)",
    run: async () => {
      if (!url) return { exitCode: null, ...take(), harnessError: "studio did not start" };
      const r = await get("/api/project", true);
      const io = take();
      return { exitCode: null, http: r.http, type: r.type, stdout: r.body + io.stdout, stderr: io.stderr, json: parseJson(r.body) };
    },
    expect: (r) => (r.http !== 200 || !/json/.test(r.type) ? `HTTP ${r.http} ${r.type}` : same(r.json?.workspace?.name, "Acceptance shop", "workspace name")),
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
          : r.statuses
              .filter(([, s]) => s !== 200)
              .map(([a, s]) => `${a} HTTP ${s}`)
              .join(", ") || null,
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
const behaviour = (j) => (j.results ?? []).filter((p) => p.analysisKind === "behaviour");
const propertyRows = (j, fields) => behaviour(j).map((p) => [p.propertyId.split("/").pop(), ...fields.map((f) => p[f])]).sort();

/** The steps every install shape must pass. */
async function coreSteps(P, { afterInit = [] } = {}) {
  await step({ id: "help", cmd: P(["--help"]), expect: all(exit(0), includes("graph index"), includes("link requirement"), includes("init [DIRECTORY]")) });
  await step({ id: "version", cmd: P(["--version"]), expect: all(exit(0), (r) => (/^\d+\.\d+\.\d+\n?$/.test(r.stdout) ? null : `version output ${JSON.stringify(r.stdout)}`)) });
  // init: identity created; nothing outside .pymtheg/ created or changed.
  const rootBefore = snapshotTree(PROJECT);
  await step({
    id: "init",
    cmd: P(["init", PROJECT, "--name", "Acceptance shop"]),
    expect: all(
      exit(0),
      includes("3 existing documents found"),
      () => (existsSync(join(PROJECT, ".pymtheg/project.json")) ? null : "no .pymtheg/project.json"),
      () => same(treeChanges(rootBefore, snapshotTree(PROJECT)), [], "files changed outside .pymtheg/ by init"),
    ),
  });
  const metadata = () =>
    ["project.json", "settings.json"].map((f) => {
      try {
        return readFileSync(join(PROJECT, ".pymtheg", f), "utf8");
      } catch {
        return null;
      }
    });
  const before = metadata();
  await step({ id: "init-repeat", cmd: P(["init", PROJECT]), expect: all(exit(0), () => (before.includes(null) ? "no metadata after init" : same(metadata(), before, "metadata bytes after re-init"))) });
  for (const extra of afterInit) await step(extra);
  await step({
    id: "doctor",
    cmd: P(["doctor", "--format", "json"]),
    expect: all(
      exit(0),
      json((j) => {
        const checks = j.checks ?? [];
        const notReady = checks.filter((c) => c.status !== "ready").map((c) => `${c.name}: ${c.status}`);
        return !checks.length ? "no checks" : notReady.length ? `not ready: ${notReady.join(", ")}` : null;
      }),
    ),
    note: (r) => r.json.checks.map((c) => c.name).join(", ") + ": ready",
  });
  await step({ id: "check-valid", cmd: P(["check", DESIGN, "--format", "json"]), expect: all(exit(0), json((j) => same((j.diagnostics ?? null)?.length, 0, "diagnostics"))) });
  const allClean = (exhaustive) => [
    ["chargedOnce", "no_counterexample", "complete", exhaustive],
    ["shippedOnlyWhenPaid", "no_counterexample", "complete", exhaustive],
    ["state-domains", "no_counterexample", "complete", exhaustive],
  ];
  await step({
    id: "verify-valid",
    cmd: P(["verify", DESIGN, "--entry", "Order", "--format", "json"]),
    expect: all(exit(0), json((j) => same(propertyRows(j, ["outcome", "completion", "exhaustive"]), allClean(true), "verify results"))),
  });
  await step({
    id: "simulate-valid",
    cmd: P(["simulate", DESIGN, "--entry", "Order", "--seed", "42", "--max-steps", "6", "--max-samples", "200", "--format", "json"]),
    expect: all(exit(0), json((j) => same(propertyRows(j, ["outcome", "completion", "exhaustive"]), allClean(false), "simulate results"))),
  });
  // A real behaviour violation must be reported as one (exhaustive search finds it).
  await step({
    id: "verify-violation",
    expectFail: true,
    cmd: P(["verify", VIOLATION, "--entry", "Overcharge", "--format", "json"]),
    expect: all(
      exit(1),
      json((j) =>
        same(
          propertyRows(j, ["outcome", "completion"]),
          [
            ["chargedOnce", "counterexample", "complete"],
            ["state-domains", "no_counterexample", "complete"],
          ],
          "verify results on the violating design",
        ),
      ),
    ),
  });
  await step({ id: "check-broken", expectFail: true, cmd: P(["check", BROKEN]), expect: all(exit(1), hasLine(BROKEN_DIAGNOSTIC)) });
  await step({ id: "verify-broken", expectFail: true, cmd: P(["verify", BROKEN, "--entry", "BrokenOrder"]), expect: all(exit(1), hasLine(BROKEN_DIAGNOSTIC)) });
  await step({
    id: "graph-index",
    cmd: P(["graph", "index", "--root", PROJECT, "--json"]),
    expect: all(
      exit(0),
      json((j) => (j.status !== "ok" ? `status ${j.status}` : j.failedFiles?.length ? `failed files: ${j.failedFiles.map((f) => f.path).join(", ")}` : same(j.counts?.files, SAMPLE_SOURCE_FILES, "indexed files"))),
    ),
    note: (r) => `${r.json.counts.files} files, ${r.json.counts.symbols} symbols, ${r.json.counts.links} links`,
    fingerprint: graphFingerprint,
  });
  await step({
    id: "graph-status",
    cmd: P(["graph", "status", "--root", PROJECT, "--json"]),
    expect: all(exit(0), json((j) => (j.status !== "ok" ? `status ${j.status}` : j.staleFiles?.length ? "stale files right after index" : same((j.modules ?? []).map((m) => m.id).sort(), ["go", "rust", "typescript"], "modules")))),
  });
  // Five cross-file calls and one same-file call; each must be exactly this
  // caller, in this file, with definite certainty.
  const q = (id, symbol, expected) => step({ id, cmd: P(["graph", "callers", symbol, "--root", PROJECT, "--json"]), expect: callers(symbol, expected), note: linkSummary, fingerprint: graphFingerprint });
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
 * `pymtheg link` (R1-D): requirement plan:R2 linked to a Go, a Rust and a TypeScript
 * symbol; `check` passes; a body edit makes exactly that link `changed` and
 * `check` exit 1; `refresh` makes it ok again. The edit is undone (and
 * refreshed) at the end so the project is unchanged for later steps.
 */
async function linkSteps(P) {
  const root = ["--root", PROJECT, "--json"];
  const DISCOUNT = join(PROJECT, "engine/src/discount.rs");
  const original = readFileSync(DISCOUNT, "utf8");
  const ids = {};
  await step({
    id: "link-requirement",
    cmd: P(["link", "requirement", "R2", "--title", "Totals are computed from item prices", ...root]),
    expect: all(exit(0), json((j) => same([j.status, j.record?.id], ["created", "plan:R2"], "requirement"))),
  });
  for (const [lang, symbol] of [
    ["go", "ComputeTotal"],
    ["rust", "apply_discount"],
    ["ts", "formatTotal"],
  ])
    await step({
      id: `link-add-${lang}`,
      cmd: P(["link", "add", "R2", symbol, ...root]),
      expect: all(
        exit(0),
        json((j) => {
          ids[symbol] = j.link?.id;
          return same([j.status, typeof j.link?.id], ["created", "string"], `link to ${symbol}`);
        }),
      ),
    });
  const states = (j) => (j.links ?? []).map((l) => `${l.current?.name ?? l.link?.symbol?.identity}:${l.state}`).sort();
  const allOk = ["ComputeTotal:ok", "apply_discount:ok", "formatTotal:ok"];
  await step({
    id: "link-list",
    cmd: P(["link", "list", "--record", "R2", ...root]),
    expect: all(exit(0), json((j) => same(states(j), allOk, "links of R2") ?? same(j.counts?.ok, 3, "ok count"))),
  });
  const check = (id, code, expectedStates, extra = {}) =>
    step({
      id,
      cmd: P(["link", "check", ...root]),
      ...extra,
      expect: all(exit(code), json((j) => same(states(j), expectedStates, "link states") ?? same(j.passed, code === 0, "passed"))),
    });
  await check("link-check", 0, allOk);
  writeFileSync(DISCOUNT, original.replace("cents - percent_of(cents, percent)", "cents - percent_of(cents, percent) * 1"));
  await check("link-check-after-edit", 1, ["ComputeTotal:ok", "apply_discount:changed", "formatTotal:ok"], { expectFail: true });
  const refresh = (id) =>
    step({
      id,
      display: "pymtheg link refresh <apply_discount link> --json",
      run: () => run(P(["link", "refresh", ids.apply_discount ?? "missing-link-id", ...root])),
      expect: all(exit(0), json((j) => same(j.status, "refreshed", "refresh status"))),
    });
  await refresh("link-refresh");
  await check("link-check-after-refresh", 0, allOk);
  writeFileSync(DISCOUNT, original);
  await refresh("link-refresh-restored");
  await check("link-check-final", 0, allOk);
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
    expect: all(exit(0), includes(".pymtheg-studio", "a notice naming the old folder"), () => (readFileSync(join(legacy, ".pymtheg-studio", "old.json"), "utf8") === "{}" ? null : "old folder was changed")),
  });
}

async function networkOff() {
  await step({
    id: "network-off",
    display: "fetch https://registry.npmjs.org/ and http://1.1.1.1/ must both fail",
    harnessOutput: true,
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

/**
 * After the whole scenario, nothing outside these places may have been created
 * or modified (files newer than the marker written after the install):
 *  - the project folders the scenario works in (sample, legacy copy, Go
 *    project, restic, the local-install app);
 *  - npm's own cache, logs, npx store and update-notifier stamp
 *    (~/.npm/_cacache, _logs, _npx, _update-notifier-last-checked): npm and
 *    npx write there on every invocation, not Pymtheg;
 *  - in scenario c only, Go's own build and module caches (~/.cache/go-build,
 *    ~/go) and its config folder (~/.config/go: Go's local telemetry
 *    counters), written by the `go` the project opted into;
 *  - /acc, the harness's own files.
 */
async function writesOutside({ go = false } = {}) {
  const npmOwn = ["_cacache/", "_logs/", "_npx/", "_update-notifier-last-checked"].map((p) => `${HOME}/.npm/${p}`);
  const allowed = [`${PROJECT}/`, `${HOME}/legacy/`, `${GO_PROJECT}/`, `${HOME}/restic/`, `${APP}/`, ...npmOwn, "/acc/", ...(go ? [`${HOME}/.cache/go-build/`, `${HOME}/go/`, `${HOME}/.config/go/`] : [])];
  await step({
    id: "writes-outside-project",
    display: "no file created or modified outside the project folders and npm's own cache folders (nothing in /tmp)",
    harnessOutput: true,
    cmd: ["sh", "-c", `find / -xdev \\( -path /proc -o -path /sys -o -path /dev \\) -prune -o -newer ${OUT}/.marker \\( -type f -o -type l \\) -print 2>/dev/null`],
    expect: (r) => {
      const outside = r.stdout.split("\n").filter(Boolean).filter((p) => !allowed.some((a) => p.startsWith(a)));
      return outside.length ? `written outside the allowed places: ${outside.slice(0, 8).join(", ")}${outside.length > 8 ? ` (+${outside.length - 8})` : ""}` : null;
    },
    note: (r) => {
      const counts = {};
      for (const p of r.stdout.split("\n").filter(Boolean)) {
        const a = allowed.find((x) => p.startsWith(x)) ?? "other";
        counts[a] = (counts[a] ?? 0) + 1;
      }
      return "all inside allowed places: " + Object.entries(counts).map(([k, v]) => `${k.replace(HOME, "~")} ${v}`).join("; ");
    },
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
    harnessOutput: true,
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
    harnessOutput: true,
    note: (r) => (r.exitCode === 0 ? "works" : `exit ${r.exitCode}: ${excerpt(r.stdout + r.stderr, 120)}`),
  });
}

// ---------------------------------------------------------------- Go toolchain opt-in

/**
 * With graph.toolchain.go set, the index must actually run `go` and report the
 * route `used` with upgraded links; with it removed, no `go` runs and no
 * toolchain is reported.
 */
const goAddLinks = (r) => (r.json?.data?.links ?? []).map((l) => `${l.source?.name}@${l.source?.file}:${l.line}->${l.target?.name ?? l.targetName}:${l.certainty}:${l.decidedBy ?? "source"}`).sort();
const ADD_CALLERS_ON = [10, 10, 13, 15, 17].map((line) => `main@main.go:${line}->Add:definite:toolchain`);
const REAL_GO = "/usr/local/go/bin/go";
async function goOptIn(pym) {
  // The route needs go.mod at the project root, so the opt-in runs on the
  // sample's Go module as a project of its own (the shape a Go repository has).
  // The route accepts only <GOROOT>/bin/go, so the PATH shim (rightly) cannot
  // stand in: the setting names the real binary, and the spawn trace records it.
  rmSync(GO_PROJECT, { recursive: true, force: true });
  cpSync(join(PROJECT, "service"), GO_PROJECT, { recursive: true });
  await step({ id: "go-project-init", cmd: pym(["init", GO_PROJECT]), cwd: GO_PROJECT, expect: exit(0) });
  const settingsFile = join(GO_PROJECT, ".pymtheg/settings.json");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  writeFileSync(settingsFile, JSON.stringify({ ...settings, graph: { ...(settings.graph ?? {}), toolchain: { go: REAL_GO } } }, null, 2) + "\n");
  await step({
    id: "go-toolchain-index",
    display: `graph.toolchain.go = "${REAL_GO}"; graph index --json (Go module at the project root)`,
    cmd: pym(["graph", "index", "--root", GO_PROJECT, "--json"]),
    cwd: GO_PROJECT,
    allowToolchain: true,
    expect: (r) => {
      const go = r.json?.toolchain?.go;
      const goCalls = r.calls.filter((c) => c.tool === "go").length;
      return (
        exit(0)(r) ??
        (go?.state !== "used"
          ? `toolchain ${excerpt(JSON.stringify(r.json?.toolchain ?? "absent"), 300)}, expected state "used"`
          : !(go.upgradedLinks > 0)
            ? `upgradedLinks ${go.upgradedLinks}, expected > 0`
            : goCalls === 0
              ? "reported used, but no go process ran"
              : null)
      );
    },
    note: (r) => `${r.json.toolchain.go.upgradedLinks} links upgraded; ${r.calls.filter((c) => c.tool === "go").length} go processes`,
  });
  await step({
    id: "go-toolchain-callers",
    display: "opted in: graph callers Add --json (the generic-result call at main.go:13 is decided by the toolchain)",
    cmd: pym(["graph", "callers", "Add", "--root", GO_PROJECT, "--json"]),
    cwd: GO_PROJECT,
    allowToolchain: true,
    // Exactly five definite calls of (*Cart).Add from main, each decided or
    // confirmed by the toolchain, including line 13 (pricing.First(...).Add(5)).
    expect: all(exit(0), (r) => same(goAddLinks(r), ADD_CALLERS_ON, "callers of Add, opted in")),
    note: (r) => goAddLinks(r).join(", "),
  });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  await step({
    id: "go-toolchain-off-again",
    display: "setting removed; graph index --json runs no go",
    cmd: pym(["graph", "index", "--root", GO_PROJECT, "--json"]),
    cwd: GO_PROJECT,
    expect: all(exit(0), json((j) => (j.status !== "ok" ? `status ${j.status}` : "toolchain" in j ? `toolchain reported while off: ${JSON.stringify(j.toolchain)}` : null))),
  });  await step({
    id: "go-source-only-callers",
    display: "setting off: graph callers Add --json (source-only: main.go:13 is not a definite caller)",
    cmd: pym(["graph", "callers", "Add", "--root", GO_PROJECT, "--json"]),
    cwd: GO_PROJECT,
    // The same query without the toolchain: the generic-result call is not
    // definite, so the opted-in answer above is the toolchain's doing.
    expect: all(exit(0), (r) => same(goAddLinks(r), ADD_CALLERS_ON.filter((l) => !l.includes(":13->")).map((l) => l.replace(":toolchain", ":source")), "callers of Add, source-only")),
    note: (r) => goAddLinks(r).join(", "),
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
      note: (r) => `${r.json.status}; ${JSON.stringify(r.json.resultCounts)}; ${(r.durationMs / 1000).toFixed(1)} s, peak RSS ≥ ${((r.peakRssKiB ?? 0) / 1024).toFixed(0)} MiB (observations)`,
    });
  await step({ id: "restic-init", cmd: pym(["init", R]), cwd: R, expect: exit(0), note: (r) => `${(r.durationMs / 1000).toFixed(1)} s (observation)` });
  await step({
    id: "restic-graph-index",
    cmd: pym(["graph", "index", "--root", R, "--json"]),
    cwd: R,
    expect: all(exit(0), json((j) => (j.status !== "ok" ? `status ${j.status}` : j.failedFiles?.length ? `${j.failedFiles.length} failed files` : null))),
    note: (r) => `${r.json.counts.files} files, ${r.json.counts.symbols} symbols, ${r.json.counts.links} links, 0 failed; ${(r.durationMs / 1000).toFixed(1)} s, peak RSS ≥ ${((r.peakRssKiB ?? 0) / 1024).toFixed(0)} MiB (observations)`,
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
const npxInstall = () => installStep("install-npx", ["npx", "--yes", "./" + TGZ.split("/").pop(), "--help"], join(ACC, "pkg"), includes("graph index"));

const gitStatus = (id, extra = {}) => ({
  id,
  cmd: ["git", "status", "--porcelain", "--untracked-files=all"],
  harnessOutput: true,
  expect: all(exit(0), (r) => same(r.stdout.split("\n").filter(Boolean).sort(), ["?? .pymtheg/.gitignore", "?? .pymtheg/project.json", "?? .pymtheg/settings.json"], "untracked files")),
  ...extra,
});

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
        harnessOutput: true,
        cmd: ["sh", "-c", "git init -q -b main && git -c user.email=a@example.invalid -c user.name=acc add -A && git -c user.email=a@example.invalid -c user.name=acc commit -qm sample && git status --porcelain"],
        expect: all(exit(0), (r) => (r.stdout.trim() ? "tree not clean after commit" : null)),
      });
      await coreSteps(npx, {
        afterInit: [gitStatus("git-status-after-init"), { id: "git-tracked-unchanged", cmd: ["sh", "-c", "git diff --exit-code --stat && git diff --cached --exit-code --stat"], harnessOutput: true, expect: exit(0) }],
      });
      // After graph, links (edit undone), MCP and Studio, only the same three files are visible.
      await step(gitStatus("git-status-end"));
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
        harnessOutput: true,
        cmd: ["sh", "-c", "PATH=$(echo $PATH | sed 's#/acc/shims:##'); go version && cargo --version && rustc --version"],
        note: (r) => r.stdout.trim().split("\n").join("; "),
      });
      await coreSteps(npx);
      await goOptIn(npx);
      await writesOutside({ go: true });
    },
  },
  "d-global": {
    install: () => installStep("install-global", ["npm", "install", "--global", TGZ], HOME),
    run: async () => {
      await networkOff();
      await installSize();
      await step({
        id: "bin-location",
        harnessOutput: true,
        cmd: ["sh", "-c", 'readlink -f "$(command -v pymtheg)"'],
        expect: all(exit(0), (r) => (r.stdout.trim() === GLOBAL_PREFIX + "/lib/node_modules/pymtheg/dist/cli/main.js" ? null : `resolves to ${r.stdout.trim()}`)),
      });
      await coreSteps((args) => ["pymtheg", ...args]);
      await writesOutside();
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
      await writesOutside();
    },
  },
  "f-restic": {
    install: npxInstall,
    run: async () => {
      await networkOff();
      await restic(npx);
      await writesOutside();
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
      await step({ id: "node-version", cmd: ["node", "--version"], cwd: HOME, observe: true, harnessOutput: true, note: (r) => r.stdout.trim() });
      await step({ id: "help", cmd: npx(["--help"]), expect: all(exit(0), includes("graph index")) });
      await step({ id: "init", cmd: npx(["init", PROJECT]), expect: exit(0) });
      await step({
        id: "doctor",
        cmd: npx(["doctor", "--format", "json"]),
        expect: all(
          exit(0),
          json((j) => {
            const bad = (j.checks ?? []).filter((c) => c.status !== "ready").map((c) => `${c.name}: ${c.status}`);
            return !j.checks?.length ? "no checks" : bad.length ? `not ready: ${bad.join(", ")}` : null;
          }),
        ),
      });
      await step({ id: "check-valid", cmd: npx(["check", DESIGN, "--format", "json"]), expect: all(exit(0), json((j) => same(j.diagnostics?.length, 0, "diagnostics"))) });
      await step({ id: "verify-valid", cmd: npx(["verify", DESIGN, "--entry", "Order"]), expect: exit(0) });
      await step({ id: "simulate-valid", cmd: npx(["simulate", DESIGN, "--entry", "Order", "--seed", "42"]), expect: exit(0) });
      await step({ id: "check-broken", expectFail: true, cmd: npx(["check", BROKEN]), expect: all(exit(1), hasLine(BROKEN_DIAGNOSTIC)) });
      await step({
        id: "graph-index",
        cmd: npx(["graph", "index", "--root", PROJECT, "--json"]),
        expect: all(exit(0), json((j) => (j.failedFiles?.length ? "failed files" : same(j.counts?.files, SAMPLE_SOURCE_FILES, "indexed files")))),
      });
      await step({ id: "graph-ts-callers", cmd: npx(["graph", "callers", "formatTotal", "--root", PROJECT, "--json"]), expect: callers("formatTotal", [["renderBasket", "web/src/main.ts"]]) });
      await writesOutside();
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
  const rows = readFileSync(RESULTS, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const seen = rows.filter((r) => r.processes?.length && r.step !== "go-toolchain-index");
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
