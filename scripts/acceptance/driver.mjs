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

const [scenario, phase] = process.argv.slice(2);
const ACC = "/acc";
const OUT = join(ACC, "out");
const RESULTS = join(OUT, "results.jsonl");
const SHIM_LOG = join(OUT, "shim.log");
const SPAWN_LOG = join(OUT, "spawn.log");
const HOME = process.env.HOME ?? "/home/node";
const PROJECT = join(HOME, "project");
const TGZ = join(
  ACC,
  "pkg",
  readdirSync(join(ACC, "pkg")).find((f) => f.endsWith(".tgz")),
);
const GLOBAL_PREFIX = join(HOME, ".npm-global");
const APP = join(HOME, "app");
const ELSEWHERE = join(HOME, "elsewhere");

/** Words a user must not see once R1-A has removed the external backends. */
const WORDING = /\b(java|quint|tlc|tla\+|tla2tools|apalache|jvm)\b/gi;
/** Programs Pymtheg must not start on its own on a clean machine. */
const FORBIDDEN_FILE = /^(java|quint|go|cargo|rustc|rustup|tlc)$/;
const FORBIDDEN_ARG = /@informalsystems[/\\]quint|tla2tools|\.jar$/;

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

function run(cmd, { cwd = PROJECT, env = baseEnv, timeoutMs = 900_000 } = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true, // own process group, so a safety stop reaches npx's children too
    });
    const out = [],
      err = [];
    let timedOut = false;
    const peak = watchMemory(child.pid);
    const timer = setTimeout(() => {
      // A safety stop for a hung step, never a speed assertion.
      timedOut = true;
      killGroup(child, "SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", (e) => err.push(Buffer.from(String(e))));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const peakKiB = peak.stop();
      resolve({
        exitCode: code,
        signal,
        timedOut,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        peakRssKiB: peakKiB,
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
    try {
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
    } catch {}
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

/** Signal a whole process group, as a terminal's Ctrl-C does (npx does not forward signals). */
function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}

function resetTraces() {
  writeFileSync(SHIM_LOG, "");
  writeFileSync(SPAWN_LOG, "");
}
function readTraces() {
  const shims = readFileSync(SHIM_LOG, "utf8").split("\n").filter(Boolean);
  const spawns = readFileSync(SPAWN_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter(
      (s) =>
        FORBIDDEN_FILE.test(s.file.split("/").pop()) ||
        s.args.some((a) => FORBIDDEN_ARG.test(a)),
    )
    .map((s) => {
      const file = s.file.split("/").pop();
      // Name the tool even when it is started as `node …/quint/dist/src/cli.js`.
      const tool = FORBIDDEN_FILE.test(file)
        ? file
        : s.args.some((a) => /quint/.test(a))
          ? "quint"
          : "tlc";
      return `${tool} (${file} ${s.args.slice(0, 3).join(" ")})`.trim();
    });
  return [...new Set([...shims, ...spawns])];
}

function wordingHits(text) {
  const hits = new Set();
  for (const line of text.split("\n")) {
    WORDING.lastIndex = 0;
    if (WORDING.test(line)) hits.add(line.trim().slice(0, 160));
    if (hits.size >= 3) break;
  }
  return [...hits];
}

function excerpt(text, max = 360) {
  const t = text.replace(/\s+\n/g, "\n").trim();
  return t.length <= max ? t : t.slice(0, max / 2) + " … " + t.slice(-max / 2);
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const last = text.trim().split("\n").pop();
    try {
      return JSON.parse(last);
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------- recording

const scenarioOptions = { observeOnly: false, forbidAll: true };
const forbiddenSeen = [];

/**
 * Classify one step. Statuses:
 *  pass          expectation met, no forbidden tool, no Java/Quint/TLC wording
 *  expected-fail the step must fail (a broken design) and failed usefully
 *  known-gap     every problem is attributed to a named chunk still in flight
 *  fail          anything else
 *  observed      report-only step (timings, sizes, node-version edges)
 */
/** A note or fingerprint must never crash the run; a broken one reads as such. */
function safe(fn, r) {
  if (!fn) return undefined;
  try {
    return fn(r);
  } catch (e) {
    return `(note unavailable: ${e.message})`;
  }
}

function record(step, r) {
  const problems = [];
  const gaps = new Set();
  const text = (r.stdout ?? "") + "\n" + (r.stderr ?? "");
  const expectation = step.expect ? step.expect(r) : null;
  if (expectation) {
    const gap = (step.gaps ?? []).find((g) => g.when(r));
    if (gap) gaps.add(gap.chunk);
    problems.push({ reason: expectation, chunk: gap?.chunk ?? null });
  }
  const words = step.skipWording ? [] : wordingHits(text);
  if (words.length)
    problems.push({ reason: `mentions Java/Quint/TLC: ${words[0]}`, chunk: "R1-A" });
  const forbidden = r.forbidden ?? [];
  if (forbidden.length) {
    forbiddenSeen.push({ step: step.id, calls: forbidden });
    const onlyBackends = forbidden.every((c) => /^(java|quint|tlc)\b/.test(c));
    const allowed = step.allowToolchain && forbidden.every((c) => /^(go|cargo|rustc)\b/.test(c));
    if (!allowed)
      problems.push({
        reason: `started ${forbidden.join("; ")}`,
        chunk: onlyBackends ? "R1-A" : null,
      });
  }
  let status, reason, chunk;
  if (step.observe || scenarioOptions.observeOnly) {
    status = "observed";
    reason = problems.length ? "would fail: " + problems.map((p) => p.reason).join(" | ") : safe(step.note, r) ?? "ok";
  } else if (!problems.length) {
    status = step.expectFail ? "expected-fail" : "pass";
    reason = safe(step.note, r) ?? (step.expectFail ? "failed as designed with a diagnostic" : "ok");
  } else if (problems.every((p) => p.chunk)) {
    status = "known-gap";
    chunk = [...new Set(problems.map((p) => p.chunk))].join(", ");
    reason = problems.map((p) => p.reason).join(" | ");
  } else {
    status = "fail";
    reason = problems.map((p) => p.reason).join(" | ");
  }
  const result = {
    scenario,
    step: step.id,
    command: step.display ?? (step.cmd ? step.cmd.join(" ") : step.id),
    network: phase === "install",
    required: step.required !== false && !scenarioOptions.observeOnly && !step.observe,
    exitCode: r.exitCode ?? null,
    status,
    reason,
    ...(chunk ? { chunk } : {}),
    outputBytes: Buffer.byteLength(text) - 1,
    durationMs: r.durationMs === undefined ? null : Math.round(r.durationMs),
    ...(r.peakRssKiB ? { peakRssKiB: r.peakRssKiB } : {}),
    ...(r.timedOut ? { timedOut: true } : {}),
    excerpt: excerpt(text),
    ...(step.fingerprint ? { fingerprint: safe(step.fingerprint, r) } : {}),
    ...(step.observation ? { observation: safe(step.observation, r) } : {}),
  };
  appendFileSync(RESULTS, JSON.stringify(result) + "\n");
  process.stdout.write(`${status.padEnd(13)} ${scenario}/${step.id}: ${reason.slice(0, 200)}\n`);
  return result;
}

async function step(def) {
  resetTraces();
  let r;
  try {
    r = def.run ? await def.run() : await run(def.cmd, { cwd: def.cwd, env: def.env });
  } catch (e) {
    r = { exitCode: null, stdout: "", stderr: `harness error: ${e?.stack ?? e}` };
  }
  r.forbidden = readTraces();
  r.json = r.json ?? parseJson(r.stdout ?? "");
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
const has = (pattern, what) => (r) =>
  pattern.test(r.stdout + "\n" + r.stderr) ? null : `output lacks ${what}`;
const linkNames = (r, side) =>
  (r.json?.data?.links ?? []).map((l) => `${l[side]?.name ?? l.targetName}:${l.certainty}`);

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

async function mcpSteps(pym) {
  const mcp = new Mcp(pym(["mcp", PROJECT]), PROJECT);
  let tools = [];
  const call = async (id, fn, def) =>
    step({
      id,
      display: def.display,
      expect: def.expect,
      gaps: def.gaps,
      required: def.required,
      run: async () => {
        const value = await fn();
        const io = mcp.take();
        return { ...io, exitCode: null, json: value };
      },
    });
  const noError = (r) =>
    r.json?.error ? `JSON-RPC error: ${r.json.error.message}` : r.json?.result ? null : "no result";
  await call(
    "mcp-initialize",
    async () => {
      const response = await mcp.request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "pymtheg-acceptance", version: "1" },
      });
      mcp.notify("notifications/initialized", {});
      return response;
    },
    { display: "pymtheg mcp PROJECT (stdio) → initialize", expect: noError },
  );
  await call(
    "mcp-tools-list",
    async () => {
      const response = await mcp.request("tools/list", {});
      tools = response.result?.tools ?? [];
      // Tool descriptions are output too: keep them in the wording check.
      mcp.stdout += "";
      return response;
    },
    {
      display: "tools/list",
      expect: all(noError, (r) =>
        (r.json.result.tools ?? []).some((t) => t.name === "check_design") ? null : "no check_design tool",
      ),
    },
  );
  const toolCall = (name, args) => mcp.request("tools/call", { name, arguments: args });
  await call("mcp-check-design", () => toolCall("check_design", { file: "designs/order.pym" }), {
    display: 'tools/call check_design {file:"designs/order.pym"}',
    expect: all(noError, (r) => (r.json.result.isError ? "tool returned isError" : null)),
  });
  await call(
    "mcp-check-broken",
    async () => {
      const checked = await toolCall("check_design", { file: "designs/broken.pym" });
      const runId = checked.result?.structuredContent?.runId;
      if (!runId) return checked;
      const findings = await toolCall("read_run", { runId, section: "findings" });
      return { ...findings, checked: checked.result?.structuredContent };
    },
    {
      display: 'tools/call check_design {file:"designs/broken.pym"} then read_run {section:"findings"}',
      expect: all(noError, (r) =>
        /\bcharge\b/.test(JSON.stringify(r.json.result)) ? null : "findings do not name the undeclared `charge`",
      ),
    },
  );
  // Behaviour exploration over MCP: an agent on a clean machine must get the
  // same built-in verify/simulate as the CLI, not a missing-Java failure.
  for (const method of ["verify", "simulate"])
    await call(
      `mcp-explore-${method}`,
      async () => {
        const explored = await toolCall("explore_behaviour", { file: "designs/order.pym", entry: "Order", method, maxSteps: 6, maxSamples: 200 });
        const runId = explored.result?.structuredContent?.runId;
        // The summary carries no reason; the properties section does.
        const properties = runId ? await toolCall("read_run", { runId, section: "properties" }) : null;
        return { ...explored, properties: properties?.result?.structuredContent ?? properties?.result ?? null };
      },
      {
        display: `tools/call explore_behaviour {entry:"Order", method:"${method}"}`,
        expect: all(noError, (r) => {
          const summary = r.json.result.structuredContent ?? {};
          return r.json.result.isError || summary.exitStatus !== 0
            ? `exitStatus ${summary.exitStatus}${r.json.result.isError ? ", isError" : ""}: ${excerpt(JSON.stringify(r.json.properties ?? {}), 240)}`
            : null;
        }),
        note: (r) => excerpt(JSON.stringify(r.json?.properties ?? {}), 200),
        gaps: [{ chunk: "R1-A", when: (r) => /java|tlc|quint|tla/i.test(JSON.stringify(r.json?.properties ?? r.json?.result ?? {})) }],
      },
    );
  const graphTool = () => tools.find((t) => /graph/i.test(t.name));
  await call(
    "mcp-graph-tool",
    async () => {
      const tool = graphTool();
      if (!tool) return { result: { absent: true, tools: tools.map((t) => t.name) } };
      const props = Object.keys(tool.inputSchema?.properties ?? {});
      const args = props.includes("command") ? { command: "status" } : {};
      return { tool: tool.name, ...(await toolCall(tool.name, args)) };
    },
    {
      display: "tools/call <graph tool> (status)",
      expect: (r) =>
        r.json?.result?.absent
          ? "no graph tool over MCP"
          : r.json?.error
            ? `JSON-RPC error: ${r.json.error.message}`
            : r.json?.result?.isError
              ? "graph tool returned isError"
              : null,
      gaps: [{ chunk: "R1-C", when: (r) => !!r.json?.result?.absent }],
    },
  );
  await call(
    "mcp-requirement-links",
    async () => ({ result: { tools: tools.map((t) => t.name) } }),
    {
      display: "tools/list contains a requirement-to-symbol link tool",
      expect: (r) =>
        r.json.result.tools.some((n) => /link/i.test(n) && /(requirement|symbol|code)/i.test(n))
          ? null
          : "no requirement-to-symbol link tool over MCP",
      gaps: [{ chunk: "R1-D", when: () => true }],
    },
  );
  await step({
    id: "mcp-shutdown",
    display: "close stdin; server exits",
    expect: exit(0),
    run: async () => ({ exitCode: await mcp.close(), ...mcp.take() }),
  });
}

// ---------------------------------------------------------------- Studio

async function studioSteps(pym) {
  const child = spawn(pym(["studio", PROJECT, "--port", "0"])[0], pym(["studio", PROJECT, "--port", "0"]).slice(1), {
    cwd: PROJECT,
    env: baseEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
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
  await step({
    id: "studio-start",
    display: "pymtheg studio PROJECT --port 0 (prints session URL)",
    expect: () => (url ? null : "no session URL printed"),
    run: async () => ({ exitCode: null, ...take() }),
  });
  const get = async (path, auth) => {
    if (!url) return { exitCode: null, stdout: "", stderr: "studio did not start" };
    const response = await fetch(url.origin + path, {
      headers: auth ? { authorization: "Bearer " + url.token } : {},
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.text();
    return { exitCode: null, http: response.status, type: response.headers.get("content-type"), body, stdout: "", stderr: "" };
  };
  await step({
    id: "studio-status",
    display: "GET /api/project (Bearer session token)",
    expect: (r) => (r.http === 200 && /json/.test(r.type) && parseJson(r.body) ? null : `HTTP ${r.http ?? "none"}`),
    note: (r) => "HTTP 200 " + excerpt(r.body, 120),
    run: async () => {
      const r = await get("/api/project", true);
      return { ...r, ...take(), stdout: r.body ?? "" };
    },
  });
  await step({
    id: "studio-assets",
    display: "GET / and its first script asset",
    expect: (r) => (r.ok ? null : r.problem),
    run: async () => {
      const index = await get("/", false);
      if (index.http !== 200) return { ...index, ...take(), ok: false, problem: `GET / HTTP ${index.http}` };
      const src = /<script[^>]+src="([^"]+)"/.exec(index.body)?.[1];
      if (!src) return { ...take(), ok: false, problem: "index.html has no script asset" };
      const asset = await get(src.startsWith("/") ? src : "/" + src, false);
      return {
        ...take(),
        exitCode: null,
        ok: asset.http === 200,
        problem: `asset ${src} HTTP ${asset.http}`,
      };
    },
    skipWording: true, // the bundled web app is minified code, not user-facing text
  });
  await step({
    id: "studio-stop",
    display: "SIGINT to studio",
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
    links: [...linkNames(r, "source"), ...linkNames(r, "target")].sort(),
    matches: (j.data?.matches ?? []).map((m) => m.name).sort(),
    found: j.data?.found,
  };
}

async function coreSteps(pym, { afterInit = [] } = {}) {
  const P = (args) => pym(args);
  await step({
    id: "help",
    cmd: P(["--help"]),
    expect: all(exit(0), has(/graph index/, "the graph command"), has(/\binit\b/, "init")),
  });
  await step({ id: "version", cmd: P(["--version"]), expect: exit(0), required: false });
  await step({
    id: "cli-requirement-links",
    display: "help lists a command to link requirements to code symbols",
    cmd: P(["--help"]),
    skipWording: true,
    expect: (r) => (/^pymtheg (link|links|requirement)/m.test(r.stdout) ? null : "no requirement-link command in help"),
    gaps: [{ chunk: "R1-D", when: () => true }],
  });
  await step({
    id: "init",
    cmd: P(["init", PROJECT, "--name", "Acceptance shop"]),
    expect: all(exit(0), () => (existsSync(join(PROJECT, ".pymtheg/project.json")) ? null : "no .pymtheg/project.json")),
  });
  const identity = existsSync(join(PROJECT, ".pymtheg/project.json"))
    ? readFileSync(join(PROJECT, ".pymtheg/project.json"), "utf8")
    : null;
  await step({
    id: "init-repeat",
    cmd: P(["init", PROJECT]),
    expect: all(exit(0), () =>
      identity !== null && readFileSync(join(PROJECT, ".pymtheg/project.json"), "utf8") === identity
        ? null
        : "project identity changed on re-run",
    ),
  });
  for (const extra of afterInit) await step(extra);
  await step({ id: "doctor", cmd: P(["doctor"]), expect: exit(0) });
  await step({ id: "check-valid", cmd: P(["check", join(PROJECT, "designs/order.pym")]), expect: exit(0) });
  await step({
    id: "verify-valid",
    cmd: P(["verify", join(PROJECT, "designs/order.pym"), "--entry", "Order"]),
    expect: exit(0),
  });
  await step({
    id: "simulate-valid",
    cmd: P(["simulate", join(PROJECT, "designs/order.pym"), "--entry", "Order", "--seed", "42", "--max-steps", "6", "--max-samples", "200"]),
    expect: exit(0),
  });
  await step({
    id: "check-broken",
    expectFail: true,
    cmd: P(["check", join(PROJECT, "designs/broken.pym")]),
    expect: all(exit(1), has(/broken\.pym/, "the file name"), has(/:7\b|line 7/, "line 7"), has(/\bcharge\b/, "the undeclared name")),
  });
  await step({
    id: "verify-broken",
    expectFail: true,
    cmd: P(["verify", join(PROJECT, "designs/broken.pym"), "--entry", "BrokenOrder"]),
    expect: all(exit(1), has(/\bcharge\b/, "the undeclared name")),
  });
  await step({
    id: "graph-index",
    cmd: P(["graph", "index", "--root", PROJECT, "--json"]),
    expect: all(exit(0), (r) =>
      !r.json
        ? "no JSON"
        : r.json.failedFiles?.length
          ? `failed files: ${r.json.failedFiles.map((f) => f.path).join(", ")}`
          : r.json.counts.files < 8
            ? `only ${r.json.counts.files} files indexed`
            : null,
    ),
    note: (r) => `${r.json.counts.files} files, ${r.json.counts.symbols} symbols, ${r.json.counts.links} links`,
    fingerprint: graphFingerprint,
  });
  await step({
    id: "graph-status",
    cmd: P(["graph", "status", "--root", PROJECT, "--json"]),
    expect: all(exit(0), (r) => (r.json?.staleFiles?.length ? "stale files right after index" : null)),
    note: (r) => `status ${r.json.status}; modules ${(r.json.modules ?? []).map((m) => m.id).join(", ")}`,
  });
  const callerQuery = (id, symbol, caller) => ({
    id,
    cmd: P(["graph", "callers", symbol, "--root", PROJECT, "--json"]),
    expect: all(exit(0), (r) =>
      linkNames(r, "source").some((n) => n.startsWith(caller + ":")) ? null : `no caller ${caller} (got ${linkNames(r, "source").join(", ") || "none"})`,
    ),
    note: (r) => linkNames(r, "source").join(", "),
    fingerprint: graphFingerprint,
  });
  await step(callerQuery("graph-ts-callers", "formatTotal", "renderBasket"));
  await step({
    id: "graph-ts-path",
    cmd: P(["graph", "path", "renderBasket", "roundCents", "--root", PROJECT, "--json"]),
    expect: all(exit(0), (r) => (r.json?.data?.found ? null : "no call path renderBasket → roundCents")),
    note: (r) => `found ${r.json.data.found} (${r.json.data.certainty})`,
    fingerprint: graphFingerprint,
  });
  await step(callerQuery("graph-go-callers", "ComputeTotal", "main"));
  await step(callerQuery("graph-go-same-package", "taxFor", "ComputeTotal"));
  await step(callerQuery("graph-rust-callers", "apply_discount", "main"));
  await step(callerQuery("graph-rust-same-file", "percent_of", "apply_discount"));
  await step({
    id: "graph-search",
    cmd: P(["graph", "search", "Total", "--root", PROJECT, "--json"]),
    expect: all(exit(0), (r) => {
      const names = (r.json?.data?.matches ?? []).map((m) => m.name);
      return ["formatTotal", "ComputeTotal"].every((n) => names.includes(n)) ? null : `matches: ${names.join(", ")}`;
    }),
    fingerprint: graphFingerprint,
  });
  await mcpSteps(pym);
  await studioSteps(pym);
  await legacyInit(pym);
}

async function legacyInit(pym) {
  const legacy = join(HOME, "legacy");
  rmSync(legacy, { recursive: true, force: true });
  cpSync(PROJECT, legacy, { recursive: true, filter: (src) => !src.includes("/.pymtheg") && !src.includes("/.git") });
  mkdirSync(join(legacy, ".pymtheg-studio"));
  writeFileSync(join(legacy, ".pymtheg-studio", "old.json"), "{}");
  await step({
    id: "init-with-legacy-folder",
    display: "pymtheg init (project that has an old .pymtheg-studio/ folder)",
    cmd: pym(["init", legacy]),
    cwd: legacy,
    expect: exit(0),
    gaps: [{ chunk: "R1-B", when: (r) => /Old Pymtheg storage layout/i.test(r.stdout + r.stderr) }],
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

async function networkOff() {
  await step({
    id: "network-off",
    display: "fetch https://registry.npmjs.org/ must fail",
    skipWording: true,
    expect: (r) => (r.reached ? "the container can still reach the registry" : null),
    run: async () => {
      try {
        await fetch("https://registry.npmjs.org/", { signal: AbortSignal.timeout(15_000) });
        return { reached: true, exitCode: null, stdout: "", stderr: "" };
      } catch (e) {
        return { reached: false, exitCode: null, stdout: "", stderr: String(e.cause?.code ?? e.message) };
      }
    },
  });
  writeFileSync(join(OUT, ".marker"), "");
}

async function writesOutside() {
  await step({
    id: "writes-outside-project",
    display: "find / -xdev -newer marker (outside the project and harness)",
    observe: true,
    skipWording: true,
    cmd: [
      "sh",
      "-c",
      `find / -xdev -newer ${OUT}/.marker -type f 2>/dev/null | grep -v -e '^/proc' -e '^/sys' -e '^/acc/' -e '^${HOME}/project/' -e '^${HOME}/legacy/' -e '^${HOME}/restic/' -e '^${HOME}/git-status' | sed -E 's#^(/[^/]+/[^/]+/[^/]+/[^/]+).*#\\1#' | sort | uniq -c | sort -rn | head -20`,
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

function installSize() {
  return step({
    id: "install-size",
    observe: true,
    skipWording: true,
    run: async () => {
      const roots = [join(HOME, ".npm/_npx"), join(HOME, ".npm/_cacache"), GLOBAL_PREFIX, join(APP, "node_modules")].filter(existsSync);
      const sizes = roots.map((p) => `${p.replace(HOME, "~")} ${(sizeOf(p) / 1048576).toFixed(1)} MiB`);
      const kinds = ["npx", "global", "local"].map(installedRoot).filter((p) => p && existsSync(p));
      // The node_modules that holds pymtheg's dependencies: nested for a global install, hoisted otherwise.
      const modules = kinds.length ? (existsSync(join(kinds[0], "node_modules")) ? join(kinds[0], "node_modules") : join(kinds[0], "..")) : null;
      const packages = [];
      if (modules)
        for (const e of readdirSync(modules)) {
          if (e.startsWith(".")) continue;
          const names = e.startsWith("@") ? readdirSync(join(modules, e)).map((n) => `${e}/${n}`) : [e];
          for (const n of names) packages.push([n, sizeOf(join(modules, n))]);
        }
      packages.sort((a, b) => b[1] - a[1]);
      return {
        exitCode: 0,
        stdout: sizes.join("; "),
        stderr: "",
        largest: packages.slice(0, 10).map(([n, b]) => `${n} ${(b / 1048576).toFixed(1)} MiB`),
        packageCount: packages.length,
      };
    },
    note: (r) => `${r.stdout} (apparent file sizes)`,
    observation: (r) => ({ packages: r.packageCount, largestPackages: r.largest }),
  });
}

const npmWarnings = (r) => {
  const lines = (r.stdout + "\n" + r.stderr).split("\n").filter((l) => /npm (warn|WARN|error|ERR)/.test(l));
  return [...new Set(lines.map((l) => l.trim().slice(0, 200)))].slice(0, 12);
};

function installStep(id, cmd, cwd = HOME) {
  return step({
    id,
    cmd,
    cwd,
    expect: exit(0),
    note: (r) => `${(r.durationMs / 1000).toFixed(1)} s (observation); ${npmWarnings(r).length} npm warning lines`,
    observation: (r) => ({ npmWarnings: npmWarnings(r) }),
  });
}

// ---------------------------------------------------------------- scenarios

// `npx /abs/path.tgz` runs the path as a command (exit 126); `./name.tgz` and
// `file:/abs/path.tgz` are package specs. The install step uses the documented
// relative form from the tarball's folder; later steps use the same tarball.
const npx = (args) => ["npx", "--yes", "file:" + TGZ, ...args];
const npxInstall = () =>
  step({
    id: "install-npx",
    cmd: ["npx", "--yes", "./" + TGZ.split("/").pop(), "--help"],
    cwd: join(ACC, "pkg"),
    expect: exit(0),
    note: (r) => `${(r.durationMs / 1000).toFixed(1)} s (observation); ${npmWarnings(r).length} npm warning lines`,
    observation: (r) => ({ npmWarnings: npmWarnings(r) }),
  });
const globalBin = (args) => ["pymtheg", ...args];
const localBin = (args) => ["npx", "--no-install", "pymtheg", ...args];

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

async function goOptIn() {
  const root = installedRoot("npx");
  const config = root ? join(root, "dist/shared/config.js") : null;
  const commands = root ? join(root, "dist/graph/commands.js") : null;
  const supported =
    config && existsSync(config) && /graphToolchains/.test(readFileSync(config, "utf8")) &&
    existsSync(commands) && /graphToolchains|toolchain/.test(readFileSync(commands, "utf8"));
  if (!supported) {
    await step({
      id: "go-toolchain-opt-in",
      display: 'settings.json graph.toolchain.go = true, then graph callers ComputeTotal',
      required: false,
      expect: () => "Go toolchain opt-in is not in this build (PR 33 open; not wired into `pymtheg graph`)",
      gaps: [{ chunk: "W3-L (PR 33)", when: () => true }],
      run: async () => ({ exitCode: null, stdout: "", stderr: "" }),
    });
    return;
  }
  const settingsFile = join(PROJECT, ".pymtheg/settings.json");
  const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  settings.graph = { ...(settings.graph ?? {}), toolchain: { go: true } };
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  await step({
    id: "go-toolchain-index",
    cmd: npx(["graph", "index", "--root", PROJECT, "--json"]),
    allowToolchain: true,
    required: false,
    expect: exit(0),
    note: (r) => `${r.json?.counts?.links} links; toolchain calls: ${r.forbidden.length}`,
  });
  await step({
    id: "go-toolchain-callers",
    cmd: npx(["graph", "callers", "ComputeTotal", "--root", PROJECT, "--json"]),
    allowToolchain: true,
    required: false,
    expect: exit(0),
    note: (r) => linkNames(r, "source").join(", "),
  });
}

async function restic() {
  const R = join(HOME, "restic");
  const q = (id, args) =>
    step({
      id,
      cmd: npx([...args, "--root", R, "--json"]),
      cwd: R,
      expect: exit(0, 2),
      note: (r) =>
        `${(r.durationMs / 1000).toFixed(1)} s, peak RSS ≥ ${((r.peakRssKiB ?? 0) / 1024).toFixed(0)} MiB (observations); ` +
        `${r.json?.resultCounts ? JSON.stringify(r.json.resultCounts) : r.json?.status}`,
    });
  await step({
    id: "restic-init",
    cmd: npx(["init", R]),
    cwd: R,
    expect: exit(0),
    note: (r) => `${(r.durationMs / 1000).toFixed(1)} s (observation)`,
  });
  await step({
    id: "restic-graph-index",
    cmd: npx(["graph", "index", "--root", R, "--json"]),
    cwd: R,
    expect: exit(0),
    note: (r) =>
      `${r.json?.counts?.files} files, ${r.json?.counts?.symbols} symbols, ${r.json?.counts?.links} links, ` +
      `${r.json?.failedFiles?.length} failed; ${(r.durationMs / 1000).toFixed(1)} s, peak RSS ≥ ${((r.peakRssKiB ?? 0) / 1024).toFixed(0)} MiB (observations)`,
  });
  await q("restic-status", ["graph", "status"]);
  await q("restic-search", ["graph", "search", "Snapshot", "--limit", "20"]);
  await q("restic-callers", ["graph", "callers", "SaveBlob"]);
  await q("restic-callees", ["graph", "callees", "runBackup"]);
  await q("restic-impact", ["graph", "impact", "LoadIndex", "--depth", "2"]);
  await q("restic-path", ["graph", "path", "runBackup", "SaveBlob"]);
}

const scenarios = {
  // a. Node only.
  "a-node-only": {
    install: () => npxInstall(),
    run: async () => {
      await networkOff();
      await installSize();
      await npxAbsolute();
      await coreSteps(npx);
      await writesOutside();
    },
  },
  // b. Node + git, project is a git repository.
  "b-node-git": {
    install: () => npxInstall(),
    run: async () => {
      await networkOff();
      const git = (id, script, extra = {}) => ({
        id,
        cmd: ["sh", "-c", script],
        skipWording: true,
        ...extra,
      });
      await step(
        git(
          "git-setup",
          "git init -q -b main && git -c user.email=a@example.invalid -c user.name=acc add -A && git -c user.email=a@example.invalid -c user.name=acc commit -qm sample && git status --porcelain",
          { expect: all(exit(0), (r) => (r.stdout.trim() ? "tree not clean after commit" : null)) },
        ),
      );
      await coreSteps(npx, {
        afterInit: [
          git("git-status-after-init", "git status --porcelain --untracked-files=all", {
            expect: all(exit(0), (r) => {
              const lines = r.stdout.split("\n").filter(Boolean);
              const other = lines.filter((l) => !l.startsWith("?? .pymtheg/"));
              return other.length ? `init changed: ${other.join(", ")}` : null;
            }),
            note: (r) => r.stdout.trim().split("\n").join("; ") || "clean",
          }),
          git("git-ignored-after-init", "git status --porcelain --ignored --untracked-files=all", {
            observe: true,
            note: (r) => r.stdout.trim().split("\n").join("; ") || "nothing",
          }),
          git("git-tracked-unchanged", "git diff --exit-code --stat && git diff --cached --exit-code --stat", {
            expect: exit(0),
          }),
        ],
      });
      await step(
        git("git-status-end", "git status --porcelain --untracked-files=all", {
          observe: true,
          note: (r) => r.stdout.trim().split("\n").join("; ") || "clean",
        }),
      );
      await writesOutside();
    },
  },
  // c. Node + Go and Rust toolchains present on PATH.
  "c-node-go-rust": {
    install: () => npxInstall(),
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
      await goOptIn();
    },
  },
  // d1. Global install.
  "d-global": {
    install: () => installStep("install-global", ["npm", "install", "--global", TGZ], HOME),
    run: async () => {
      await networkOff();
      await installSize();
      await step({
        id: "bin-location",
        skipWording: true,
        cmd: ["sh", "-c", "readlink -f \"$(command -v pymtheg)\""],
        expect: all(exit(0), (r) =>
          r.stdout.trim().startsWith(GLOBAL_PREFIX + "/lib/node_modules/pymtheg/") ? null : `resolves to ${r.stdout.trim()}`,
        ),
        note: (r) => r.stdout.trim(),
      });
      mkdirSync(ELSEWHERE, { recursive: true });
      await coreSteps(globalBin);
    },
  },
  // d2. Local install as a dependency of another package.
  "d-local": {
    install: async () => {
      mkdirSync(APP, { recursive: true });
      writeFileSync(join(APP, "package.json"), JSON.stringify({ name: "acc-app", version: "1.0.0", private: true }) + "\n");
      await installStep("install-local", ["npm", "install", TGZ], APP);
    },
    run: async () => {
      await networkOff();
      await installSize();
      const local = (args) => ["sh", "-c", `cd ${APP} && exec npx --no-install pymtheg "$@"`, "pymtheg", ...args];
      await coreSteps(local);
    },
  },
  // f. A larger real project (restic, Go).
  "f-restic": {
    install: () => npxInstall(),
    run: async () => {
      await networkOff();
      await restic();
    },
  },
};

// e. Node version edges: report only.
for (const edge of ["e-node-24.0.0", "e-node-25", "e-node-26"])
  scenarios[edge] = {
    install: () => {
      scenarioOptions.observeOnly = true;
      return npxInstall();
    },
    run: async () => {
      scenarioOptions.observeOnly = true;
      await networkOff();
      await step({ id: "node-version", cmd: ["node", "--version"], cwd: HOME, skipWording: true, note: (r) => r.stdout.trim() });
      await step({ id: "help", cmd: npx(["--help"]), expect: exit(0) });
      await step({ id: "init", cmd: npx(["init", PROJECT]), expect: exit(0) });
      await step({ id: "doctor", cmd: npx(["doctor"]), expect: exit(0), note: (r) => excerpt(r.stdout, 160) });
      await step({ id: "check-valid", cmd: npx(["check", "designs/order.pym"]), expect: exit(0) });
      await step({ id: "verify-valid", cmd: npx(["verify", "designs/order.pym", "--entry", "Order"]), expect: exit(0) });
      await step({
        id: "graph-index",
        cmd: npx(["graph", "index", "--root", PROJECT, "--json"]),
        expect: all(exit(0), (r) => (r.json?.failedFiles?.length ? "failed files" : null)),
      });
    },
  };

const chosen = scenarios[scenario.replace(/^e-node-24\.\d+\.\d+$/, "e-node-24.0.0")] ?? scenarios[scenario];
if (!chosen || !["install", "run"].includes(phase)) {
  console.error(`usage: driver.mjs (${Object.keys(scenarios).join("|")}) install|run`);
  process.exit(64);
}
mkdirSync(OUT, { recursive: true });
await chosen[phase]();
if (phase === "run" && forbiddenSeen.length)
  appendFileSync(join(OUT, "forbidden.json"), JSON.stringify(forbiddenSeen) + "\n");
