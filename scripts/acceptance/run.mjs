#!/usr/bin/env node
// Clean-machine acceptance harness (R1-F). Run on the dev server from the
// repository root (it needs Docker):
//
//   pymtheg-dev --name r1f-xxxx -- node scripts/acceptance/run.mjs [options]
//
// Options:
//   --scenarios a-node-only,b-node-git,...   subset (default: all; an unknown name is an error)
//   --tarball PATH                           reuse a packed tarball (skip build)
//   --pack-only                              build the tarball, print `TARBALL=<path>`, stop
//   --out DIR                                result directory (default evidence/r1-f)
//   --commit SHA                             recorded in the result (the mirror has no .git)
//   --restic DIR                             restic checkout (default ~/pymtheg-dev/corpora/restic)
//   --keep-images                            do not remove images this harness pulled
//
// It builds the tarball as a release would (npm ci, npm run build, npm pack)
// in a throwaway node:24 container, then runs each scenario in a fresh
// container started from an official node image with nothing else installed,
// as the unprivileged `node` user. Only the install step has network; the
// container is disconnected from every network before the remaining steps.
//
// Exit status: 0 every required step passes; 2 no failures but known gaps
// remain (named chunks still in flight); 1 a required step fails; 3 harness
// or usage error; 129/130/143 stopped by a signal (everything removed).
// Durations, sizes and memory are observations, never assertions.
//
// Docker hygiene (the server is shared, and several runs may overlap):
// every container is named pymtheg-acc-<scenario>-<run id> and labelled with
// this harness, its owner and the run's pid; a container's own process is a
// bounded `sleep`, so even a lost container removes itself (--rm). At start-up
// the harness removes only its OWN owner's containers whose run has died.
// The harness pulls an image only when it is absent, and records every image
// it pulls; images it did not pull are never removed. A recorded image is
// removed by the last run to finish, once no container (of any run) uses it.
// The list is shared in ~/.cache/pymtheg-acceptance.
import { spawnSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { randomBytes } from "node:crypto";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(name);
const REPO = resolve(new URL("../..", import.meta.url).pathname);
const HERE = join(REPO, "scripts/acceptance");
const OUT = resolve(opt("--out", join(REPO, "evidence/r1-f")));
const SCRATCH = mkdtempSync(join(process.env.PYM_SCRATCH ?? tmpdir(), "acc-"));
const RESTIC = resolve(opt("--restic", join(homedir(), "pymtheg-dev/corpora/restic")));
const RUN_ID = randomBytes(4).toString("hex");
const OWNER = `${userInfo().username}@${hostname()}`;
const LABELS = ["--label", "pymtheg-acc=1", "--label", `pymtheg-acc.owner=${OWNER}`, "--label", `pymtheg-acc.run=${RUN_ID}`, "--label", `pymtheg-acc.pid=${process.pid}`];
/** A container's main process: a bounded life, never `sleep infinity`. */
const LIFETIME = ["sleep", "14400"];
const BASE = "node:24-bookworm-slim";
const BUILD_IMAGE = "node:24.21.0-bookworm-slim";

const SCENARIOS = [
  { id: "a-node-only", image: BASE, proves: "Node only: install from the tarball with npx, then init, doctor, check/verify/simulate, a broken design, graph (TypeScript, Go and Rust source-only), requirement links, MCP over stdio and Studio over HTTP; no backend or toolchain process and no Java/Quint/TLC wording." },
  { id: "b-node-git", image: BASE, setup: "git", proves: "Same as (a) in a git repository (git installed with apt before the install step), plus exactly what init does to git state." },
  { id: "c-node-go-rust", image: BASE, setup: "toolchains", proves: "Same as (a) with Go and Rust toolchains (copied from the official golang and rust images) on PATH: the source-only graph is identical and nothing runs them by default; with graph.toolchain.go on, `go` runs and links are upgraded." },
  { id: "d-global", image: BASE, proves: "npm install --global of the tarball: the binary resolves grammars, web assets and helpers from the installed location." },
  { id: "d-local", image: BASE, proves: "npm install of the tarball as a dependency of another package, then npx pymtheg." },
  { id: "e-node-24.0.0", image: "node:24.0.0-bookworm-slim", proves: "Lowest Node release engines \">=24\" allows: install, doctor and the core commands." },
  { id: "e-node-25", image: "node:25-bookworm-slim", proves: "Node 25 (supported by engines \">=24\"): install, doctor and the core commands." },
  { id: "e-node-26", image: "node:26-bookworm-slim", proves: "Node 26 (supported by engines \">=24\"): install, doctor and the core commands." },
  { id: "f-restic", image: BASE, restic: true, proves: "restic (a larger real Go project): init, graph index and five queries; time and peak memory are observations." },
];

const results = [];
const containers = new Set();
const children = new Set();
let outputBroken = false;
const log = (...a) => {
  if (outputBroken) return;
  try {
    console.log(`[acceptance ${new Date().toISOString().slice(11, 19)}]`, ...a);
  } catch {}
};

function sh(cmd, args, { input, allowFail = true, quiet = false } = {}) {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (!quiet && r.status !== 0) log(`${cmd} ${args.slice(0, 4).join(" ")} → ${r.status}\n${(r.stderr || "").slice(-2000)}`);
  if (!allowFail && r.status !== 0) throw Error(`${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  return r;
}
const docker = (...args) => sh("docker", args);
const dockerQuiet = (...args) => sh("docker", args, { quiet: true });
function dockerStream(args, prefix) {
  return new Promise((resolveExit) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    children.add(child);
    let out = "";
    const relay = (d) => {
      out += d;
      for (const line of String(d).split("\n")) if (line.trim()) log(`  ${prefix} ${line}`);
    };
    child.stdout.on("data", relay);
    child.stderr.on("data", relay);
    child.on("close", (code) => {
      children.delete(child);
      resolveExit({ code, out });
    });
  });
}
function add(scenario, step, fields) {
  const r = { scenario, step, command: step, network: false, required: true, exitCode: null, status: "fail", reason: "", outputBytes: 0, durationMs: null, excerpt: "", ...fields };
  results.push(r);
  log(`${r.status.padEnd(13)} ${scenario}/${step}: ${r.reason.slice(0, 200)}`);
  return r;
}

// ------------------------------------------------------------------ containers and images

function run(image, name, extra = []) {
  const r = docker("run", "-d", "--rm", "--name", name, ...LABELS, ...extra, image, ...LIFETIME);
  if (r.status === 0) containers.add(name);
  return r;
}
function removeContainer(name) {
  dockerQuiet("rm", "-f", name);
  containers.delete(name);
}

/** Remove containers left by this owner's earlier runs whose harness process is gone. Never others'. */
function reapOrphans() {
  const rows = dockerQuiet("ps", "-a", "--filter", "label=pymtheg-acc=1", "--filter", `label=pymtheg-acc.owner=${OWNER}`, "--format", '{{.Names}} {{.Label "pymtheg-acc.pid"}}').stdout.trim().split("\n").filter(Boolean);
  for (const row of rows) {
    const [name, pid] = row.split(" ");
    let alive = false;
    try {
      alive = readFileSync(`/proc/${pid}/cmdline`, "utf8").includes("scripts/acceptance/run.mjs");
    } catch {}
    if (!alive) {
      log(`removing leftover ${name} (its run, pid ${pid}, has ended)`);
      dockerQuiet("rm", "-f", name);
    }
  }
}

/**
 * Images pulled by any run of this harness (this owner), shared between
 * overlapping runs in a small locked file, so whichever run finishes last
 * removes an image once no container uses it.
 */
const STATE = join(homedir(), ".cache/pymtheg-acceptance");
const PULLED_FILE = join(STATE, "pulled-images");
function withLock(fn) {
  mkdirSync(STATE, { recursive: true });
  const lock = join(STATE, "lock");
  for (let i = 0; i < 300; i++) {
    try {
      mkdirSync(lock);
      try {
        return fn();
      } finally {
        rmSync(lock, { recursive: true, force: true });
      }
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // A lock older than ten minutes belongs to a dead run.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 600_000) rmSync(lock, { recursive: true, force: true });
      } catch {}
      spawnSync("sleep", ["0.1"]);
    }
  }
  throw Error("could not take " + lock);
}
const readPulled = () => (existsSync(PULLED_FILE) ? readFileSync(PULLED_FILE, "utf8").split("\n").filter(Boolean) : []);
function ensureImage(image) {
  if (dockerQuiet("image", "inspect", image).status === 0) return true;
  const r = docker("pull", "-q", image);
  // This run pulled it, so it was absent a moment ago: it is ours to clean
  // up, whatever was on the server when the run started (another run may
  // have removed an image that was present then).
  if (r.status === 0)
    withLock(() => {
      if (!readPulled().includes(image)) writeFileSync(PULLED_FILE, [...readPulled(), image].join("\n") + "\n");
    });
  return r.status === 0;
}
function removeUnusedPulledImages() {
  withLock(() => {
    const keep = [];
    for (const image of readPulled()) {
      if (dockerQuiet("ps", "-a", "-q", "--filter", `ancestor=${image}`).stdout.trim()) {
        log(`keeping ${image}: still used by a container`);
        keep.push(image);
      } else if (dockerQuiet("image", "inspect", image).status === 0 && dockerQuiet("image", "rm", image).status !== 0) keep.push(image);
    }
    writeFileSync(PULLED_FILE, keep.length ? keep.join("\n") + "\n" : "");
  });
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const child of children) {
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  for (const c of [...containers]) removeContainer(c);
  if (!flag("--keep-images"))
    try {
      removeUnusedPulledImages();
    } catch (e) {
      log("image cleanup: " + e.message);
    }
  rmSync(SCRATCH, { recursive: true, force: true });
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]])
  process.on(signal, () => {
    log(`${signal}: removing this run's containers and pulled images`);
    cleanup();
    process.exit(code);
  });
// Through pymtheg-dev (ssh, no tty) a dropped connection shows up as a broken pipe, not a signal.
for (const stream of [process.stdout, process.stderr])
  stream.on("error", (e) => {
    outputBroken = true;
    if (e.code === "EPIPE") {
      cleanup();
      process.exit(141);
    }
  });

// ------------------------------------------------------------------ build

async function buildTarball() {
  const given = opt("--tarball", null);
  if (given) return resolve(given);
  if (!ensureImage(BUILD_IMAGE)) throw Error("cannot pull " + BUILD_IMAGE);
  const name = `pymtheg-acc-build-${RUN_ID}`;
  if (run(BUILD_IMAGE, name).status !== 0) throw Error("cannot start the build container");
  docker("exec", name, "mkdir", "-p", "/build");
  // Copy the source tree only: no node_modules, build output, evidence or research.
  const tar = spawnSync(
    "tar",
    ["-c", "--exclude=./node_modules", "--exclude=./dist", "--exclude=./dist-web", "--exclude=./evidence", "--exclude=./research", "--exclude=./.git", "--exclude=./.pymtheg", "--exclude=*.tgz", "-C", REPO, "."],
    { maxBuffer: 1024 * 1024 * 1024 },
  );
  if (tar.status !== 0) throw Error("tar failed " + tar.stderr);
  sh("docker", ["cp", "-", `${name}:/build`], { input: tar.stdout, allowFail: false });
  for (const [step, command] of [
    ["npm-ci", "npm ci --no-audit --no-fund"],
    ["npm-run-build", "npm run build"],
    ["npm-pack", "npm pack --json > /build/pack.json"],
  ]) {
    const started = Date.now();
    const r = await dockerStream(["exec", "-w", "/build", name, "sh", "-c", command], "build|");
    const warnings = [...new Set(r.out.split("\n").filter((l) => /npm (warn|WARN|ERR)/.test(l)).map((l) => l.trim().slice(0, 200)))];
    add("0-build", step, {
      command,
      network: step === "npm-ci",
      exitCode: r.code,
      status: r.code === 0 ? "pass" : "fail",
      reason: r.code === 0 ? `${((Date.now() - started) / 1000).toFixed(1)} s (observation); ${warnings.length} npm warning lines` : r.out.trim().split("\n").slice(-3).join(" | "),
      outputBytes: Buffer.byteLength(r.out),
      durationMs: Date.now() - started,
      excerpt: r.out.trim().slice(-360),
      observation: { npmWarnings: warnings.slice(0, 12) },
    });
    if (r.code !== 0) throw Error(`build step ${step} failed`);
  }
  const pack = JSON.parse(docker("exec", name, "cat", "/build/pack.json").stdout)[0];
  mkdirSync(join(SCRATCH, "pkg"), { recursive: true });
  const local = join(SCRATCH, "pkg", pack.filename);
  docker("cp", `${name}:/build/${pack.filename}`, local);
  removeContainer(name);
  // Keep a copy outside the per-run scratch so `--tarball` can reuse it.
  const kept = join(process.env.PYM_SCRATCH ?? tmpdir(), `acceptance-tarball-${RUN_ID}`);
  mkdirSync(kept, { recursive: true });
  copyFileSync(local, join(kept, pack.filename));
  log(`tarball kept at ${join(kept, pack.filename)} (reuse with --tarball)`);
  return join(kept, pack.filename);
}

function inspectTarball(tgz) {
  const list = sh("tar", ["-tvzf", tgz], { allowFail: false }).stdout.trim().split("\n");
  const entries = list.map((l) => {
    const parts = l.trim().split(/\s+/);
    return { size: Number(parts[2]), path: parts.slice(5).join(" ").replace(/^package\//, "") };
  });
  const files = entries.filter((e) => !e.path.endsWith("/"));
  const unpacked = files.reduce((n, e) => n + e.size, 0);
  const byTop = {};
  for (const e of files) {
    const top = e.path.split("/")[0];
    byTop[top] = (byTop[top] ?? 0) + e.size;
  }
  const needed = ["dist/cli/main.js", "dist-web/index.html", "grammars/go/tree-sitter-go.wasm", "grammars/rust/tree-sitter-rust.wasm", "package.json", "README.md", "pymtheg"];
  const missing = needed.filter((n) => !files.some((f) => f.path === n));
  // TypeScript sources, tests, evidence and research must not ship. Helper
  // sources the product runs (e.g. the Go toolchain helper under src/graph) may.
  const unexpected = files.filter((f) => /^(test|evidence|research|web\/src)\//.test(f.path) || /^src\/.*\.tsx?$/.test(f.path)).map((f) => f.path);
  const helpers = files.filter((f) => /^src\//.test(f.path) && !/\.tsx?$/.test(f.path)).map((f) => f.path);
  const summary = {
    file: basename(tgz),
    packedBytes: statSync(tgz).size,
    unpackedBytes: unpacked,
    files: files.length,
    largestTopLevel: Object.entries(byTop).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / 1048576).toFixed(2)} MiB`),
  };
  const pkg = JSON.parse(sh("tar", ["-xzOf", tgz, "package/package.json"]).stdout || "{}");
  add("0-build", "tarball-contents", {
    command: "tar -tvzf " + basename(tgz),
    status: missing.length || unexpected.length ? "fail" : "pass",
    reason: missing.length
      ? `missing ${missing.join(", ")}`
      : unexpected.length
        ? `unexpected source/test/evidence files: ${unexpected.slice(0, 5).join(", ")}`
        : `${files.length} files, ${(summary.packedBytes / 1048576).toFixed(2)} MiB packed, ${(unpacked / 1048576).toFixed(2)} MiB unpacked`,
    observation: { ...summary, helperSources: helpers },
  });
  add("0-build", "package-private", {
    command: "package.json private",
    required: false,
    status: "observed",
    reason: pkg.private ? '"private": true — npm refuses to publish it, so `npx pymtheg` from the registry cannot work until the owner decides to publish; `npx ./pymtheg-*.tgz` works without publishing' : "not private",
  });
  add("0-build", "package-engines", {
    command: "package.json engines",
    required: false,
    status: "observed",
    reason: `engines.node ${JSON.stringify(pkg.engines?.node)}; optionalDependencies ${JSON.stringify(pkg.optionalDependencies ?? {})}`,
  });
  return summary;
}

// ------------------------------------------------------------------ scenarios

const TOOLCHAIN_ENV = ["-e", "PATH=/usr/local/go/bin:/usr/local/cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", "-e", "RUSTUP_HOME=/usr/local/rustup", "-e", "CARGO_HOME=/usr/local/cargo"];
/** Root-only preparation with network, before the scenario's own install step. */
function setup(s, name) {
  if (s.setup === "git") {
    const r = docker("exec", "-u", "root", name, "sh", "-c", "apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates >/dev/null && rm -rf /var/lib/apt/lists/* && git --version");
    return r.status === 0 ? { ok: true, note: r.stdout.trim() } : { ok: false, note: "apt-get install git failed: " + r.stderr.slice(-300) };
  }
  if (s.setup === "toolchains") {
    const copied = [];
    for (const [image, paths] of [["golang:1-bookworm", ["/usr/local/go"]], ["rust:1-slim-bookworm", ["/usr/local/cargo", "/usr/local/rustup"]]]) {
      if (!ensureImage(image)) return { ok: false, note: `cannot pull ${image}` };
      const source = `pymtheg-acc-src-${image.split(":")[0]}-${RUN_ID}`;
      if (docker("create", "--name", source, ...LABELS, image).status !== 0) return { ok: false, note: `cannot create ${source}` };
      containers.add(source);
      for (const path of paths) {
        const r = sh("sh", ["-c", `docker cp ${source}:${path} - | docker cp - ${name}:/usr/local`]);
        if (r.status !== 0) return { ok: false, note: `copy ${path} failed` };
      }
      removeContainer(source);
      copied.push(image);
    }
    const v = docker("exec", ...TOOLCHAIN_ENV, name, "sh", "-c", "go version && cargo --version");
    return v.status === 0 ? { ok: true, note: `${copied.join(", ")}: ${v.stdout.trim().split("\n").join("; ")}` } : { ok: false, note: "toolchain check failed: " + v.stderr.slice(-300) };
  }
  return { ok: true, note: "" };
}

async function runScenario(s, tgz) {
  log(`scenario ${s.id} (${s.image})`);
  if (!ensureImage(s.image)) {
    add(s.id, "image", { command: `docker pull ${s.image}`, reason: `image ${s.image} is not available` });
    return;
  }
  const name = `pymtheg-acc-${s.id.replace(/[^a-z0-9-]/g, "")}-${RUN_ID}`;
  const started = run(s.image, name, ["--user", "node", "--memory", "16g", "--cpus", "8", "--pids-limit", "4096"]);
  if (started.status !== 0) {
    add(s.id, "container", { reason: started.stderr.trim() });
    return;
  }
  try {
    const root = (...cmd) => docker("exec", "-u", "root", name, ...cmd);
    root("mkdir", "-p", "/acc/pkg", "/acc/shims", "/acc/out");
    docker("cp", tgz, `${name}:/acc/pkg/`);
    for (const f of ["driver.mjs", "wording.mjs", "spawn-trace.cjs", "shim.sh"]) docker("cp", join(HERE, f), `${name}:/acc/${f}`);
    root("sh", "-c", "for n in java javac quint tlc go cargo rustc rustup; do cp /acc/shim.sh /acc/shims/$n; done; chmod 755 /acc/shims/*");
    docker("cp", join(REPO, "test/fixtures/acceptance/sample"), `${name}:/home/node/project`);
    if (s.restic) {
      if (!existsSync(RESTIC)) {
        add(s.id, "restic-copy", { reason: `no restic checkout at ${RESTIC}` });
        return;
      }
      docker("cp", RESTIC, `${name}:/home/node/restic`);
    }
    // The pinned corpora are read-only on the server and docker cp keeps modes.
    root("sh", "-c", "chown -R node:node /home/node /acc/out && chmod -R u+w /home/node");
    const nodeVersion = docker("exec", name, "node", "--version").stdout.trim();
    if (s.setup) {
      const { ok, note } = setup(s, name);
      add(s.id, "setup-" + s.setup, { command: s.setup === "git" ? "apt-get install git (root, network)" : "copy Go and Rust toolchains from official images", network: true, status: ok ? "pass" : "fail", reason: note });
      if (!ok) return;
    }
    const env = s.setup === "toolchains" ? TOOLCHAIN_ENV : [];
    const install = await dockerStream(["exec", ...env, "-u", "node", "-w", "/home/node", name, "node", "/acc/driver.mjs", s.id, "install"], `${s.id}|`);
    // Cut every network before any step after the install.
    const networks = JSON.parse(docker("inspect", "-f", "{{json .NetworkSettings.Networks}}", name).stdout || "{}");
    for (const net of Object.keys(networks)) docker("network", "disconnect", "-f", net, name);
    const runPhase = await dockerStream(["exec", ...env, "-u", "node", "-w", "/home/node/project", name, "node", "/acc/driver.mjs", s.id, "run"], `${s.id}|`);
    const got = docker("exec", name, "cat", "/acc/out/results.jsonl");
    const rows = got.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const row of rows) results.push({ ...row, image: s.image, node: nodeVersion });
    if (install.code !== 0 || runPhase.code !== 0 || !rows.length)
      add(s.id, "driver", { reason: `driver exited ${install.code}/${runPhase.code} with ${rows.length} results: ${runPhase.out.slice(-300)}` });
  } finally {
    removeContainer(name);
  }
}

function compareGraphs() {
  const a = results.filter((r) => r.scenario === "a-node-only" && r.fingerprint);
  const c = results.filter((r) => r.scenario === "c-node-go-rust" && r.fingerprint && !r.step.startsWith("go-toolchain"));
  if (!a.length || !c.length) return;
  const diffs = [];
  for (const row of a) {
    const other = c.find((r) => r.step === row.step);
    if (!other) diffs.push(`${row.step} missing`);
    else if (JSON.stringify(row.fingerprint) !== JSON.stringify(other.fingerprint)) diffs.push(row.step);
  }
  add("c-node-go-rust", "graph-identical-to-node-only", {
    command: "compare graph results of (c) with (a)",
    status: diffs.length ? "fail" : "pass",
    reason: diffs.length ? `differs: ${diffs.join(", ")}` : `${a.length} graph results identical`,
  });
}

// ------------------------------------------------------------------ report

function report(tarball, selected) {
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const requiredFails = results.filter((r) => r.required && r.status === "fail");
  const gaps = results.filter((r) => r.status === "known-gap");
  const verdict = requiredFails.length ? "fail" : gaps.length ? "known-gaps" : "pass";
  const doc = {
    schema: "pymtheg.acceptance/v1",
    generatedAt: new Date().toISOString(),
    commit: opt("--commit", null),
    verdict,
    counts,
    docker: dockerQuiet("version", "-f", "{{.Server.Version}}").stdout.trim(),
    tarball,
    scenarios: selected.map(({ id, image, proves }) => ({ id, image, proves })),
    results: results.map(({ fingerprint, ...r }) => r),
  };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "latest.json"), JSON.stringify(doc, null, 2) + "\n");
  const cell = (t) => String(t ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 220);
  const lines = [
    "# Clean-machine acceptance — latest run",
    "",
    `Generated ${doc.generatedAt} from commit ${doc.commit ?? "unknown"} by \`scripts/acceptance/run.mjs\`. Verdict: **${verdict}**.`,
    "",
    `Counts: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}. Tarball ${tarball.file}: ${(tarball.packedBytes / 1048576).toFixed(2)} MiB packed, ${(tarball.unpackedBytes / 1048576).toFixed(2)} MiB unpacked, ${tarball.files} files.`,
    "",
    "Durations, sizes and memory are observations on the dev server, not limits.",
    "",
  ];
  // An empty gap list is the normal, releasable state.
  lines.push("## Known gaps", "");
  if (gaps.length) {
    lines.push("| Scenario | Step | Chunk | Reason |", "|---|---|---|---|");
    for (const r of gaps) lines.push(`| ${r.scenario} | ${cell(r.step)} | ${r.chunk} | ${cell(r.reason)} |`);
  } else lines.push("None.");
  lines.push("");
  for (const s of [{ id: "0-build", proves: "Release build: npm ci, npm run build, npm pack in a node:24.21.0 container." }, ...doc.scenarios]) {
    const rows = results.filter((r) => r.scenario === s.id);
    if (!rows.length) continue;
    lines.push(`## ${s.id}`, "", s.proves, "", "| Step | Status | Exit | Req. | Reason |", "|---|---|---|---|---|");
    for (const r of rows) lines.push(`| ${cell(r.step)} | ${r.status}${r.chunk ? " (" + r.chunk + ")" : ""} | ${r.exitCode ?? "–"} | ${r.required ? "yes" : "no"} | ${cell(r.reason)} |`);
    lines.push("");
  }
  writeFileSync(join(OUT, "latest.md"), lines.join("\n"));
  log(`verdict ${verdict}; ${JSON.stringify(counts)}; wrote ${OUT}/latest.{json,md}`);
  return verdict;
}

// ------------------------------------------------------------------ main

let code = 3;
try {
  const wanted = opt("--scenarios", null)?.split(",").filter(Boolean);
  const unknown = (wanted ?? []).filter((w) => !SCENARIOS.some((s) => s.id === w));
  if (unknown.length) throw Object.assign(Error(`unknown scenario(s): ${unknown.join(", ")}; known: ${SCENARIOS.map((s) => s.id).join(", ")}`), { usage: true });
  if (wanted && !wanted.length) throw Object.assign(Error("--scenarios names no scenario"), { usage: true });
  const selected = SCENARIOS.filter((s) => !wanted || wanted.includes(s.id));
  reapOrphans();
  const tgz = await buildTarball();
  if (flag("--pack-only")) {
    console.log(`TARBALL=${tgz}`);
    code = 0;
  } else {
    const tarball = inspectTarball(tgz);
    for (const s of selected) await runScenario(s, tgz);
    compareGraphs();
    const verdict = report(tarball, selected);
    code = verdict === "pass" ? 0 : verdict === "known-gaps" ? 2 : 1;
  }
} catch (e) {
  log((e.usage ? "usage error: " : "harness error: ") + (e.usage ? e.message : e?.stack ?? e));
  if (!e.usage && results.length)
    try {
      report({ file: null, packedBytes: 0, unpackedBytes: 0, files: 0 }, SCENARIOS);
    } catch {}
  code = !e.usage && results.some((r) => r.status === "fail") ? 1 : 3;
} finally {
  cleanup();
}
process.exit(code);
