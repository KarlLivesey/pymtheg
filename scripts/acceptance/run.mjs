#!/usr/bin/env node
// Clean-machine acceptance harness (R1-F). Run on the dev server from the
// repository root (it needs Docker):
//
//   pymtheg-dev --name r1f-xxxx -- node scripts/acceptance/run.mjs [options]
//
// Options:
//   --scenarios a-node-only,b-node-git,...   subset (default: all)
//   --tarball PATH                           reuse a packed tarball (skip build)
//   --out DIR                                result directory (default evidence/r1-f)
//   --commit SHA                             recorded in the result (the mirror has no .git)
//   --restic DIR                             restic checkout (default ~/pymtheg-dev/corpora/restic)
//   --keep-images                            do not remove images this run created or pulled
//
// It builds the tarball as a release would (npm ci, npm run build, npm pack)
// in a throwaway node:24 container, then runs each scenario in a fresh
// container started from an official node image with nothing else installed,
// as the unprivileged `node` user. Only the install step has network; the
// container is disconnected from every network before the remaining steps.
//
// Exit status: 0 every required step passes; 2 no failures but known gaps
// remain (named chunks still in flight); 1 a required step fails; 3 harness
// error. Durations, sizes and memory are observations, never assertions.
import { spawnSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, copyFileSync, rmSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
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
const RUN_ID = randomBytes(3).toString("hex");
const BASE = "node:24-bookworm-slim";
const BUILD_IMAGE = "node:24.21.0-bookworm-slim";

const SCENARIOS = [
  { id: "a-node-only", image: BASE, proves: "Node only: install from the tarball with npx, then init, doctor, check/verify/simulate, a broken design, graph (TypeScript, Go and Rust source-only), MCP over stdio and Studio over HTTP; no toolchain process and no Java/Quint/TLC wording." },
  { id: "b-node-git", image: BASE, setup: "git", proves: "Same as (a) in a git repository (git installed with apt before the install step), plus what init does to git state." },
  { id: "c-node-go-rust", image: BASE, setup: "toolchains", proves: "Same as (a) with Go and Rust toolchains (copied from the official golang and rust images) on PATH: the source-only graph is identical and nothing runs them by default; the Go opt-in when it is in the build." },
  { id: "d-global", image: BASE, proves: "npm install --global of the tarball: the binary resolves grammars, web assets and helpers from the installed location." },
  { id: "d-local", image: BASE, proves: "npm install of the tarball as a dependency of another package, then npx pymtheg." },
  { id: "e-node-24.0.0", image: "node:24.0.0-bookworm-slim", observeOnly: true, proves: "Lowest Node 24 release the engines field allows (report only)." },
  { id: "e-node-25", image: "node:25-bookworm-slim", observeOnly: true, proves: "Node 25, outside engines (report only)." },
  { id: "e-node-26", image: "node:26-bookworm-slim", observeOnly: true, proves: "Node 26, outside engines (report only)." },
  { id: "f-restic", image: BASE, restic: true, proves: "restic (a larger real Go project): init, graph index and five queries; time and peak memory are observations." },
];

const wanted = opt("--scenarios", null)?.split(",");
const selected = SCENARIOS.filter((s) => !wanted || wanted.includes(s.id));
const results = [];
const containers = new Set();
const createdImages = new Set();
const log = (...a) => console.log(`[acceptance ${new Date().toISOString().slice(11, 19)}]`, ...a);

function sh(cmd, args, { input, allowFail = true, quiet = false } = {}) {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (!quiet && r.status !== 0) log(`${cmd} ${args.slice(0, 4).join(" ")} → ${r.status}\n${(r.stderr || "").slice(-2000)}`);
  if (!allowFail && r.status !== 0) throw Error(`${cmd} ${args.join(" ")} failed: ${r.stderr}`);
  return r;
}
const docker = (...args) => sh("docker", args);
function dockerStream(args, prefix) {
  return new Promise((resolveExit) => {
    const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const relay = (d) => {
      out += d;
      for (const line of String(d).split("\n")) if (line.trim()) console.log(`  ${prefix} ${line}`);
    };
    child.stdout.on("data", relay);
    child.stderr.on("data", relay);
    child.on("close", (code) => resolveExit({ code, out }));
  });
}
function add(scenario, step, fields) {
  const r = { scenario, step, command: step, network: false, required: true, exitCode: null, status: "fail", reason: "", outputBytes: 0, durationMs: null, excerpt: "", ...fields };
  results.push(r);
  log(`${r.status.padEnd(13)} ${scenario}/${step}: ${r.reason.slice(0, 200)}`);
  return r;
}
const imageExists = (image) => docker("image", "inspect", image).status === 0;
const preexisting = new Set();
function ensureImage(image) {
  if (imageExists(image)) {
    preexisting.add(image);
    return true;
  }
  const pulled = docker("pull", "-q", image);
  if (pulled.status === 0) createdImages.add(image);
  return pulled.status === 0;
}

// ------------------------------------------------------------------ build

async function buildTarball() {
  const given = opt("--tarball", null);
  if (given) return resolve(given);
  if (!ensureImage(BUILD_IMAGE)) throw Error("cannot pull " + BUILD_IMAGE);
  const name = `pymtheg-acc-build-${RUN_ID}`;
  docker("run", "-d", "--rm", "--name", name, BUILD_IMAGE, "sleep", "infinity");
  containers.add(name);
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
  // Keep a copy outside the per-run scratch so `--tarball` can reuse it.
  const kept = join(process.env.PYM_SCRATCH ?? tmpdir(), "acceptance-tarball");
  mkdirSync(kept, { recursive: true });
  copyFileSync(local, join(kept, pack.filename));
  log(`tarball kept at ${join(kept, pack.filename)} (reuse with --tarball)`);
  docker("rm", "-f", name);
  containers.delete(name);
  return local;
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
  const unexpected = files.filter((f) => /^(test|evidence|research|src|web\/src)\//.test(f.path)).map((f) => f.path);
  const summary = {
    file: basename(tgz),
    packedBytes: statSync(tgz).size,
    unpackedBytes: unpacked,
    files: files.length,
    largestTopLevel: Object.entries(byTop).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / 1048576).toFixed(2)} MiB`),
  };
  const pkg = JSON.parse(sh("tar", ["-xzOf", tgz, "package/package.json"]).stdout);
  add("0-build", "tarball-contents", {
    command: "tar -tvzf " + basename(tgz),
    status: missing.length ? "fail" : "pass",
    reason: missing.length ? `missing ${missing.join(", ")}` : `${files.length} files, ${(summary.packedBytes / 1048576).toFixed(2)} MiB packed, ${(unpacked / 1048576).toFixed(2)} MiB unpacked; ${unexpected.length} source/test/evidence files`,
    observation: summary,
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
    return r.status === 0 ? r.stdout.trim() : "apt-get install git failed: " + r.stderr.slice(-300);
  }
  if (s.setup === "toolchains") {
    const copied = [];
    for (const [image, paths] of [["golang:1-bookworm", ["/usr/local/go"]], ["rust:1-slim-bookworm", ["/usr/local/cargo", "/usr/local/rustup"]]]) {
      if (!ensureImage(image)) return `cannot pull ${image}`;
      const source = `pymtheg-acc-src-${image.split(":")[0]}-${RUN_ID}`;
      docker("create", "--name", source, image);
      containers.add(source);
      for (const path of paths) {
        const r = sh("sh", ["-c", `docker cp ${source}:${path} - | docker cp - ${name}:/usr/local`]);
        if (r.status !== 0) return `copy ${path} failed`;
      }
      docker("rm", "-f", source);
      containers.delete(source);
      copied.push(image);
    }
    const v = docker("exec", ...TOOLCHAIN_ENV, name, "sh", "-c", "go version && cargo --version");
    return v.status === 0 ? `${copied.join(", ")}: ${v.stdout.trim().split("\n").join("; ")}` : "toolchain check failed: " + v.stderr.slice(-300);
  }
  return null;
}

async function runScenario(s, tgz) {
  log(`scenario ${s.id} (${s.image})`);
  const problem = ensureImage(s.image) ? null : `image ${s.image} is not available`;
  if (problem) {
    add(s.id, "image", { command: `docker pull/build ${s.image}`, required: !s.observeOnly, status: s.observeOnly ? "observed" : "fail", reason: problem });
    return;
  }
  const name = `pymtheg-acc-${s.id.replace(/[^a-z0-9-]/g, "")}-${RUN_ID}`;
  const started = docker("run", "-d", "--rm", "--name", name, "--user", "node", "--memory", "16g", "--cpus", "8", "--pids-limit", "4096", s.image, "sleep", "infinity");
  if (started.status !== 0) {
    add(s.id, "container", { status: "fail", reason: started.stderr.trim() });
    return;
  }
  containers.add(name);
  const root = (...cmd) => docker("exec", "-u", "root", name, ...cmd);
  root("mkdir", "-p", "/acc/pkg", "/acc/shims", "/acc/out");
  docker("cp", tgz, `${name}:/acc/pkg/`);
  for (const f of ["driver.mjs", "spawn-trace.cjs", "shim.sh"]) docker("cp", join(HERE, f), `${name}:/acc/${f}`);
  root("sh", "-c", "for n in java quint go cargo rustc rustup tlc; do cp /acc/shim.sh /acc/shims/$n; done; chmod 755 /acc/shims/*");
  docker("cp", join(REPO, "test/fixtures/acceptance/sample"), `${name}:/home/node/project`);
  if (s.restic) {
    if (!existsSync(RESTIC)) add(s.id, "restic-copy", { status: "fail", reason: `no restic checkout at ${RESTIC}` });
    else docker("cp", RESTIC, `${name}:/home/node/restic`);
  }
  // The pinned corpora are read-only on the server and docker cp keeps modes.
  root("sh", "-c", "chown -R node:node /home/node /acc/out && chmod -R u+w /home/node");
  const nodeVersion = docker("exec", name, "node", "--version").stdout.trim();
  if (s.setup) {
    const note = setup(s, name);
    const ok = note && !/failed|cannot/.test(note);
    add(s.id, "setup-" + s.setup, { command: s.setup === "git" ? "apt-get install git (root, network)" : "copy Go and Rust toolchains from official images", network: true, status: ok ? "pass" : "fail", reason: note ?? "nothing" });
    if (!ok) {
      docker("rm", "-f", name);
      containers.delete(name);
      return;
    }
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
  if (install.code !== 0 || runPhase.code !== 0)
    add(s.id, "driver", { status: "fail", reason: `driver exited ${install.code}/${runPhase.code}: ${runPhase.out.slice(-300)}` });
  // Aggregate: nothing tried to run go, cargo, rustc, java or quint.
  const forbidden = docker("exec", name, "sh", "-c", "cat /acc/out/forbidden.json 2>/dev/null || true").stdout.trim();
  const calls = forbidden ? forbidden.split("\n").flatMap((l) => JSON.parse(l)) : [];
  const unexpected = calls.filter((c) => !(s.id === "c-node-go-rust" && c.step.startsWith("go-toolchain")));
  const onlyBackends = unexpected.every((c) => c.calls.every((x) => /^(java|quint|tlc)\b/.test(x)));
  add(s.id, "no-toolchain-processes", {
    command: "PATH shims + spawn trace for java, quint, go, cargo, rustc, rustup, tlc",
    required: !s.observeOnly,
    status: s.observeOnly ? "observed" : !unexpected.length ? "pass" : onlyBackends ? "known-gap" : "fail",
    ...(unexpected.length && onlyBackends && !s.observeOnly ? { chunk: "R1-A" } : {}),
    reason: unexpected.length ? unexpected.map((c) => `${c.step}: ${c.calls.join("; ")}`).join(" | ") : "log empty",
  });
  docker("rm", "-f", name);
  containers.delete(name);
}

function compareGraphs() {
  const a = results.filter((r) => r.scenario === "a-node-only" && r.fingerprint);
  const c = results.filter((r) => r.scenario === "c-node-go-rust" && r.fingerprint);
  if (!a.length || !c.length) return;
  const diffs = [];
  for (const row of a) {
    const other = c.find((r) => r.step === row.step);
    const strip = (f) => JSON.stringify({ ...f, counts: f?.counts ? { ...f.counts } : null });
    if (!other) diffs.push(`${row.step} missing`);
    else if (strip(row.fingerprint) !== strip(other.fingerprint)) diffs.push(row.step);
  }
  add("c-node-go-rust", "graph-identical-to-node-only", {
    command: "compare graph results of (c) with (a)",
    status: diffs.length ? "fail" : "pass",
    reason: diffs.length ? `differs: ${diffs.join(", ")}` : `${a.length} graph results identical`,
  });
}

// ------------------------------------------------------------------ report

function report(tarball) {
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
    docker: docker("version", "-f", "{{.Server.Version}}").stdout.trim(),
    tarball,
    scenarios: selected.map(({ id, image, proves, observeOnly }) => ({ id, image, proves, reportOnly: !!observeOnly })),
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
  for (const s of [{ id: "0-build", proves: "Release build: npm ci, npm run build, npm pack in a node:24.21.0 container." }, ...doc.scenarios]) {
    const rows = results.filter((r) => r.scenario === s.id);
    if (!rows.length) continue;
    lines.push(`## ${s.id}`, "", s.proves + (s.reportOnly ? " Report only." : ""), "", "| Step | Status | Exit | Req. | Reason |", "|---|---|---|---|---|");
    for (const r of rows)
      lines.push(`| ${cell(r.step)} | ${r.status}${r.chunk ? " (" + r.chunk + ")" : ""} | ${r.exitCode ?? "–"} | ${r.required ? "yes" : "no"} | ${cell(r.reason)} |`);
    lines.push("");
  }
  writeFileSync(join(OUT, "latest.md"), lines.join("\n"));
  log(`verdict ${verdict}; ${JSON.stringify(counts)}; wrote ${OUT}/latest.{json,md}`);
  return verdict;
}

function cleanup() {
  for (const c of containers) docker("rm", "-f", c);
  if (!flag("--keep-images")) for (const image of createdImages) if (!preexisting.has(image)) docker("image", "rm", "-f", image);
  // Dangling build layers from our multi-stage builds.
  rmSync(SCRATCH, { recursive: true, force: true });
}

let code = 3;
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
try {
  const tgz = await buildTarball();
  const tarball = inspectTarball(tgz);
  for (const s of selected) await runScenario(s, tgz);
  compareGraphs();
  const verdict = report(tarball);
  code = verdict === "pass" ? 0 : verdict === "known-gaps" ? 2 : 1;
} catch (e) {
  log("harness error: " + (e?.stack ?? e));
  try {
    report({ file: null, packedBytes: 0, unpackedBytes: 0, files: 0 });
  } catch {}
  code = results.some((r) => r.status === "fail") ? 1 : 3;
} finally {
  cleanup();
}
process.exit(code);
