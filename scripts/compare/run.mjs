#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// SW-2 comparison harness: run Pymtheg and other code-graph tools on the same
// pinned public repositories and diff what each finds. Run it on the dev
// server, never on a workstation:
//
//   pymtheg-dev --name sw2 -- node --max-old-space-size=32768 scripts/compare/run.mjs \
//     --repos scripts/compare/pilot-repos.json --out "$PYM_SCRATCH/compare" \
//     --tools-dir "$PYM_SCRATCH/tools" --jobs 6
//
// An entry may also carry `exclude`: repository-relative paths removed from
// each tool's copy before it runs (for example vendored trees), reported in
// the results. The clone itself is never changed.
//
// Options:
//   --repos FILE        repository list, the `sweep/repos.json` format:
//                       [{ id, language, url, commit (full SHA), category, why }]
//                       (default sweep/repos.json)
//   --out DIR           results (default $PYM_SCRATCH/compare, else ./compare-out)
//   --work DIR          clones and per-tool copies (default OUT/work)
//   --tools LIST        comma list, in report order (default pymtheg,codegraph,graphify)
//   --tools-dir DIR     where the tools are installed (see README.md); each tool's
//                       binary can also be given with --bin-<tool> PATH
//   --only IDS          comma list of repository ids
//   --jobs N            tool runs at once (default 4, at most 12)
//   --timeout SECONDS   safety limit per tool run (default 1800). Hitting it is
//                       reported as `timeout`; timings are observations only.
//   --force             rerun tools that already have a result
//   --keep              keep each tool's working copy after it ran
//   --renormalise       rebuild normalised output and diffs from copies kept
//                       by an earlier --keep run, without running any tool
//   --seed N --sample N fixed-seed sample size per diff bucket (default 1, 25)
//   --no-isolate        do not run tools without network (`unshare -rn`)
//   --node-heap MB      raise the V8 heap limit of the Node-based tools (Pymtheg,
//                       CodeGraph) through NODE_OPTIONS; off by default, so the
//                       default run measures what a user gets. Recorded in results.
//
// Safety: repositories are untrusted. They are fetched shallow at the pinned
// commit with hooks off and no submodules or LFS, then only read by the
// tools. Nothing here runs a repository's install scripts, builds or tests.
// Each tool runs in its own copy of the checkout, with a scratch HOME, an
// environment holding no API keys and, where the kernel allows, no network.
//
// Resumable: a repository is fetched once, a tool's result is kept once
// written, and the diff is rebuilt from kept results. A failing tool or
// repository is recorded and the run continues. A tool run that crashed or
// timed out is reported but left out of that repository's diff, since its
// partial output would show as misses.

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import * as pymtheg from "./adapters/pymtheg.mjs";
import * as codegraph from "./adapters/codegraph.mjs";
import * as graphify from "./adapters/graphify.mjs";
import {
  languageOf,
  readNormalised,
  summarise,
  writeNormalised,
} from "./lib/common.mjs";
import { diff } from "./lib/match.mjs";
import { writeReport } from "./lib/report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ADAPTERS = { pymtheg, codegraph, graphify };

function parseArgs(argv) {
  const o = {
    tools: "pymtheg,codegraph,graphify",
    jobs: 4,
    timeout: 1800,
    seed: 1,
    sample: 25,
    isolate: true,
    bins: {},
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => {
      if (i + 1 >= argv.length) throw usage(`${a} needs a value`);
      return argv[++i];
    };
    if (a === "--repos") o.repos = v();
    else if (a === "--out") o.out = v();
    else if (a === "--work") o.work = v();
    else if (a === "--tools") o.tools = v();
    else if (a === "--tools-dir") o.toolsDir = v();
    else if (a === "--only") o.only = v().split(",").filter(Boolean);
    else if (a === "--jobs")
      o.jobs = Math.max(1, Math.min(12, Number(v()) || 1));
    else if (a === "--timeout") o.timeout = Number(v());
    else if (a === "--seed") o.seed = Number(v());
    else if (a === "--sample") o.sample = Number(v());
    else if (a === "--force") o.force = true;
    else if (a === "--keep") o.keep = true;
    else if (a === "--renormalise") o.renormalise = true;
    else if (a === "--node-heap") o.nodeHeap = Number(v());
    else if (a === "--no-isolate") o.isolate = false;
    else if (a.startsWith("--bin-")) o.bins[a.slice(6)] = v();
    else if (a === "--help" || a === "-h") {
      process.stdout.write(
        readFileSync(fileURLToPath(import.meta.url), "utf8")
          .split("\n")
          .filter((l) => l.startsWith("//"))
          .join("\n") + "\n",
      );
      process.exit(0);
    } else throw usage(`unknown option ${a}`);
  }
  o.repos ??= "sweep/repos.json";
  o.out = resolve(
    o.out ??
      (process.env.PYM_SCRATCH
        ? join(process.env.PYM_SCRATCH, "compare")
        : "compare-out"),
  );
  o.work = resolve(o.work ?? join(o.out, "work"));
  o.tools = o.tools.split(",").filter(Boolean);
  for (const t of o.tools) if (!ADAPTERS[t]) throw usage(`unknown tool ${t}`);
  return o;
}

function usage(msg) {
  const e = new Error(msg);
  e.usage = true;
  return e;
}

/** Validate the `sweep/repos.json` format. Bad entries are reported, not fatal. */
export function loadRepos(text) {
  const list = JSON.parse(text);
  const items = Array.isArray(list)
    ? list
    : Array.isArray(list.repos)
      ? list.repos
      : null;
  if (!items)
    throw usage("repository list must be an array (or { repos: [...] })");
  const ok = [];
  const bad = [];
  const seen = new Set();
  for (const r of items) {
    const problems = [];
    if (!r || typeof r.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(r.id))
      problems.push("id");
    if (!["typescript", "go", "rust"].includes(r?.language))
      problems.push("language");
    if (typeof r?.url !== "string" || !/^https:\/\/[^\s]+$/.test(r.url))
      problems.push("url");
    if (typeof r?.commit !== "string" || !/^[0-9a-f]{40}$/.test(r.commit))
      problems.push("commit (full SHA)");
    if (r && seen.has(r.id)) problems.push("duplicate id");
    if (
      r?.exclude != null &&
      (!Array.isArray(r.exclude) ||
        r.exclude.some(
          (p) =>
            typeof p !== "string" ||
            !p ||
            p.startsWith("/") ||
            p.split("/").includes("..") ||
            p.split("/").includes(".git"),
        ))
    )
      problems.push("exclude (relative paths inside the checkout)");
    if (problems.length)
      bad.push({ entry: r?.id ?? JSON.stringify(r).slice(0, 80), problems });
    else {
      seen.add(r.id);
      ok.push(r);
    }
  }
  return { ok, bad };
}

function binFor(tool, o) {
  if (o.bins[tool]) return resolve(o.bins[tool]);
  const d = o.toolsDir ? resolve(o.toolsDir) : undefined;
  const guesses = {
    pymtheg: d && join(d, "pym", "node_modules", ".bin", "pymtheg"),
    codegraph: d && join(d, "cg", "node_modules", ".bin", "codegraph"),
    graphify: d && join(d, "gfy", "bin", "graphify"),
  };
  return guesses[tool];
}

/** Run one command with a wall limit; record exit, wall time and peak RSS. */
function run(
  args,
  { cwd, env, timeoutMs, stdoutFile, stderrFile, isolate, timeFile },
) {
  return new Promise((done) => {
    const prefix = [];
    const hasTime = existsSync("/usr/bin/time");
    if (hasTime) prefix.push("/usr/bin/time", "-f", "%e %M", "-o", timeFile);
    if (isolate) prefix.push("unshare", "-rn");
    const full = [...prefix, ...args];
    const t0 = performance.now();
    let out;
    let err;
    const chunks = { out: [], err: [] };
    const child = spawn(full[0], full.slice(1), {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (b) => chunks.out.push(b));
    child.stderr.on("data", (b) => chunks.err.push(b));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, timeoutMs);
    child.on("error", (e) => chunks.err.push(Buffer.from(String(e))));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const wallMs = performance.now() - t0;
      out = Buffer.concat(chunks.out);
      err = Buffer.concat(chunks.err);
      if (stdoutFile) writeFileSync(stdoutFile, out);
      if (stderrFile) writeFileSync(stderrFile, err);
      let peakKb;
      if (hasTime && existsSync(timeFile)) {
        const m = /(\d+(?:\.\d+)?) (\d+)\s*$/.exec(
          readFileSync(timeFile, "utf8"),
        );
        if (m) peakKb = Number(m[2]);
      }
      done({
        code,
        signal,
        timedOut,
        wallMs,
        peakKb,
        stdout: out.toString("utf8"),
        stderr: err.toString("utf8"),
      });
    });
  });
}

function probeIsolation() {
  return new Promise((done) => {
    const c = spawn("unshare", ["-rn", "true"], { stdio: "ignore" });
    c.on("error", () => done(false));
    c.on("close", (code) => done(code === 0));
  });
}

class Pool {
  constructor(n) {
    this.n = n;
    this.active = 0;
    this.queue = [];
  }
  async use(fn) {
    if (this.active >= this.n) await new Promise((r) => this.queue.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1) + "\n");
  renameSync(tmp, file);
};
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const tail = (s, n = 1500) => (s.length > n ? `…${s.slice(-n)}` : s);
const scrub = (s, o) =>
  s
    .split(o.work)
    .join("$WORK")
    .split(o.out)
    .join("$OUT")
    .split(process.env.HOME ?? "\u0000")
    .join("~");

async function fetchRepo(repo, o) {
  const src = join(o.work, repo.id, "src");
  const marker = join(o.work, repo.id, "fetched.json");
  if (existsSync(marker) && readJson(marker).commit === repo.commit)
    return { ok: true, src };
  rmSync(join(o.work, repo.id), { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const env = {
    PATH: process.env.PATH,
    HOME: join(o.work, repo.id),
    GIT_TERMINAL_PROMPT: "0",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (args) =>
    run(
      [
        "git",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "protocol.file.allow=never",
        "-c",
        "advice.detachedHead=false",
        ...args,
      ],
      {
        cwd: src,
        env,
        timeoutMs: 600_000,
        isolate: false,
        timeFile: join(o.work, repo.id, "git.time"),
      },
    );
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    const steps = [
      ["init", "-q"],
      ["fetch", "-q", "--depth", "1", "--no-tags", repo.url, repo.commit],
      ["checkout", "-q", "--detach", "FETCH_HEAD"],
    ];
    let ok = true;
    for (const s of steps) {
      last = await git(s);
      if (last.code !== 0) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
      if (head !== repo.commit)
        return {
          ok: false,
          error: `checked out ${head}, expected ${repo.commit}`,
        };
      writeJson(marker, { commit: repo.commit, url: repo.url });
      return { ok: true, src };
    }
  }
  return {
    ok: false,
    error: scrub(tail(last?.stderr ?? "fetch failed", 600), o),
  };
}

function sourceCounts(dir, exclude = []) {
  const counts = { go: 0, rust: 0, typescript: 0 };
  const skip = new Set(exclude.map((p) => join(dir, p)));
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === ".git" || name === "node_modules") continue;
      const p = join(d, name);
      if (skip.has(p)) continue;
      let st;
      try {
        st = statSync(p, { throwIfNoEntry: false });
      } catch {
        continue;
      }
      if (!st) continue;
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) {
        const lang = languageOf(name);
        if (lang !== "other") counts[lang]++;
      }
    }
  };
  walk(dir);
  return counts;
}

function toolEnv(tool, o, home) {
  mkdirSync(home, { recursive: true });
  const nodeDir = dirname(process.execPath);
  const base = {
    HOME: home,
    TMPDIR: home,
    LANG: "C.UTF-8",
    NO_COLOR: "1",
    DO_NOT_TRACK: "1",
  };
  if (tool === "graphify")
    return { ...base, PATH: `${dirname(binFor("graphify", o))}:/usr/bin:/bin` };
  const heap = o.nodeHeap
    ? { NODE_OPTIONS: `--max-old-space-size=${o.nodeHeap}` }
    : {};
  if (tool === "codegraph")
    return {
      ...base,
      ...heap,
      PATH: `${nodeDir}:/usr/bin:/bin`,
      CODEGRAPH_TELEMETRY: "0",
    };
  return {
    ...base,
    ...heap,
    PATH: `${nodeDir}:/usr/bin:/bin`,
    npm_config_update_notifier: "false",
  };
}

function normaliseInto(tool, copy, toolOut, dir, outcome, failed, o) {
  try {
    let normalised;
    if (tool === "pymtheg") {
      if (!existsSync(pymtheg.dbPath(copy)))
        throw new Error("no graph store written");
      normalised = pymtheg.normalise({
        db: pymtheg.dbPath(copy),
        readText: pymtheg.readFrom(copy),
      });
      const idxFile = join(dir, "index.json");
      if (existsSync(idxFile)) {
        try {
          const idx = JSON.parse(readFileSync(idxFile, "utf8"));
          const rep = idx.sync?.report ?? {};
          outcome.pymtheg = {
            status: idx.status,
            complete: idx.sync?.complete,
            counts: idx.counts,
            failed: (rep.failed ?? []).slice(0, 20),
            partialCount: rep.partialCount,
            unclaimedCount: rep.unclaimedCount,
            errors: (rep.errors ?? []).slice(0, 5),
            toolchain: idx.toolchain ?? null,
          };
        } catch {}
      }
    } else if (tool === "codegraph") {
      if (!existsSync(codegraph.dbPath(copy)))
        throw new Error("no .codegraph/codegraph.db written");
      normalised = codegraph.normalise({ db: codegraph.dbPath(copy) });
    } else if (tool === "graphify") {
      if (!existsSync(graphify.graphPath(toolOut)))
        throw new Error("no graphify-out/graph.json written");
      normalised = graphify.normalise({ graph: graphify.graphPath(toolOut) });
    }
    writeNormalised(join(dir, "normalised.jsonl"), normalised);
    outcome.counts = summarise(normalised);
    outcome.outcome = failed ? `partial (${failed})` : (outcome.note ?? "ok");
  } catch (e) {
    outcome.outcome = failed ?? "normalise-failed";
    outcome.error = scrub(String(e?.message ?? e), o);
  }
}

async function runTool(tool, repo, src, o, pool) {
  const dir = join(o.out, "repos", repo.id, tool);
  const outcomeFile = join(dir, "outcome.json");
  if (o.renormalise && existsSync(outcomeFile)) {
    // Re-read kept tool output (needs an earlier --keep run); no tool runs.
    const outcome = readJson(outcomeFile);
    const copy = join(o.work, repo.id, tool, "repo");
    if (!existsSync(copy)) return outcome;
    const failed = /^partial \((.*)\)$/.exec(outcome.outcome ?? "")?.[1];
    normaliseInto(
      tool,
      copy,
      join(o.work, repo.id, tool, "out"),
      dir,
      outcome,
      failed,
      o,
    );
    writeJson(outcomeFile, outcome);
    return outcome;
  }
  if (!o.force && existsSync(outcomeFile)) return readJson(outcomeFile);
  return pool.use(async () => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const adapter = ADAPTERS[tool];
    const bin = binFor(tool, o);
    const copy = join(o.work, repo.id, tool, "repo");
    const toolOut = join(o.work, repo.id, tool, "out");
    rmSync(join(o.work, repo.id, tool), { recursive: true, force: true });
    mkdirSync(toolOut, { recursive: true });
    const outcome = {
      tool,
      repo: repo.id,
      commit: repo.commit,
      isolated: o.isolate,
      steps: [],
    };
    if (o.nodeHeap && tool !== "graphify") outcome.nodeHeapMb = o.nodeHeap;
    if (!bin || !existsSync(bin)) {
      outcome.outcome = "not-installed";
      writeJson(outcomeFile, outcome);
      return outcome;
    }
    const cp = await run(["cp", "-a", "--reflink=auto", src, copy], {
      cwd: o.work,
      env: process.env,
      timeoutMs: 600_000,
      isolate: false,
      timeFile: join(dir, "cp.time"),
    });
    if (cp.code !== 0) {
      outcome.outcome = "copy-failed";
      outcome.error = scrub(tail(cp.stderr, 400), o);
      writeJson(outcomeFile, outcome);
      return outcome;
    }
    for (const rel of repo.exclude ?? [])
      rmSync(join(copy, rel), { recursive: true, force: true });
    if (repo.exclude?.length) outcome.excluded = repo.exclude;
    const env = toolEnv(tool, o, join(o.work, repo.id, tool, "home"));
    let wallMs = 0;
    let peakKb = 0;
    let failed;
    for (const step of adapter.commands({
      bin,
      repoDir: copy,
      outDir: toolOut,
    })) {
      const r = await run(step.args, {
        cwd: copy,
        env,
        timeoutMs: o.timeout * 1000,
        isolate: o.isolate,
        timeFile: join(dir, `${step.label}.time`),
        stdoutFile: step.stdoutFile ? join(dir, step.stdoutFile) : undefined,
      });
      wallMs += r.wallMs;
      peakKb = Math.max(peakKb, r.peakKb ?? 0);
      outcome.steps.push({
        label: step.label,
        code: r.code,
        signal: r.signal,
        timedOut: r.timedOut,
        wallMs: Math.round(r.wallMs),
        peakKb: r.peakKb,
        stderrTail: scrub(tail(r.stderr, 1200), o),
      });
      const meaning =
        adapter.exitMeaning?.[r.code] ?? (r.code === 0 ? "ok" : undefined);
      if (r.timedOut || !meaning) {
        failed = r.timedOut ? "timeout" : `exit ${r.code ?? r.signal}`;
        break;
      }
      if (meaning !== "ok") outcome.note = `${meaning} (exit ${r.code})`;
    }
    outcome.wallMs = Math.round(wallMs);
    outcome.peakMb = peakKb ? Math.round(peakKb / 102.4) / 10 : null;
    normaliseInto(tool, copy, toolOut, dir, outcome, failed, o);
    writeJson(outcomeFile, outcome);
    if (!o.keep)
      rmSync(join(o.work, repo.id, tool), { recursive: true, force: true });
    log(
      `${repo.id} ${tool}: ${outcome.outcome} ${(outcome.wallMs / 1000).toFixed(1)}s`,
    );
    return outcome;
  });
}

const log = (s) => process.stderr.write(`[compare] ${s}\n`);

async function runRepo(repo, o, pool) {
  const base = join(o.out, "repos", repo.id);
  mkdirSync(base, { recursive: true });
  const f = await pool.use(() => fetchRepo(repo, o));
  const meta = { ...repo, fetched: f.ok, error: f.error };
  if (f.ok) meta.sourceFiles = sourceCounts(f.src, repo.exclude);
  writeJson(join(base, "meta.json"), meta);
  if (!f.ok) {
    log(`${repo.id}: fetch failed`);
    return;
  }
  const outcomes = await Promise.all(
    o.tools.map((t) =>
      runTool(t, repo, f.src, o, pool).catch((e) => ({
        tool: t,
        outcome: "harness-error",
        error: String(e?.message ?? e),
      })),
    ),
  );
  const ran = [];
  for (const oc of outcomes) {
    const file = join(base, oc.tool, "normalised.jsonl");
    if (
      existsSync(file) &&
      !/^(normalise-failed|timeout|exit|partial)/.test(oc.outcome ?? "")
    )
      ran.push([oc.tool, readNormalised(file)]);
  }
  try {
    writeJson(
      join(base, "diff.json"),
      diff(ran, { seed: o.seed, sample: o.sample }),
    );
  } catch (e) {
    writeJson(join(base, "diff.json"), { error: String(e?.stack ?? e) });
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const { ok: repos, bad } = loadRepos(readFileSync(o.repos, "utf8"));
  const selected = o.only ? repos.filter((r) => o.only.includes(r.id)) : repos;
  if (o.isolate && !(await probeIsolation())) {
    log("unshare -rn is not available; tools will run with network");
    o.isolate = false;
  }
  mkdirSync(o.out, { recursive: true });
  writeJson(join(o.out, "run.json"), {
    repos: o.repos,
    tools: o.tools,
    isolated: o.isolate,
    timeoutSeconds: o.timeout,
    seed: o.seed,
    sample: o.sample,
    invalidEntries: bad,
  });
  const pool = new Pool(o.jobs);
  await Promise.all(
    selected.map((r) =>
      runRepo(r, o, pool).catch((e) =>
        log(`${r.id}: harness error ${e?.message ?? e}`),
      ),
    ),
  );
  writeReport(o.out, selected, o.tools);
  log(
    `done: ${selected.length} repositories; report in ${join(o.out, "summary.md")}`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((e) => {
    process.stderr.write(`${e.usage ? "usage: " : ""}${e.message}\n`);
    process.exit(e.usage ? 64 : 1);
  });
}
