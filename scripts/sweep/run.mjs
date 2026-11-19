// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { installation } from "./install.mjs";

const version = "0.1.0";
const languageExtensions = {
  typescript: /\.(?:ts|tsx|mts|cts)$/,
  go: /\.go$/,
  rust: /\.rs$/,
  javascript: /\.(?:js|jsx|mjs|cjs)$/,
};
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const environment = { ...process.env, LC_ALL: "C.UTF-8" };
delete environment.NODE_OPTIONS; // Measure the released CLI with Node's default heap.

const gitEnvironment = {
  ...environment,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_COUNT: "0",
  GIT_ALLOW_PROTOCOL: "https",
  GIT_TERMINAL_PROMPT: "0",
};
delete gitEnvironment.GIT_CONFIG_PARAMETERS;
delete gitEnvironment.GIT_DIR;
delete gitEnvironment.GIT_WORK_TREE;

async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function tail(path) {
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const bytes = Buffer.alloc(Math.min(32_768, size));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, size - bytes.length);
    return bytes.toString("utf8", 0, bytesRead);
  } finally {
    await file.close();
  }
}

export async function measured({ command, args, cwd, log, seconds, env = environment, foreground = false }) {
  const started = performance.now();
  const stdout = openSync(`${log}.out`, "w");
  const stderr = openSync(`${log}.err`, "w");
  let code, signal;
  try {
    [code, signal] = await new Promise((accept, reject) => {
      const child = spawn("/usr/bin/time", [
        "-q", "-f", "%M %U %S", "-o", `${log}.rss`, "timeout", ...(foreground ? ["--foreground"] : []),
        "--verbose", "--kill-after=10s",
        `${Math.max(seconds, 0.001)}s`, "prlimit", "--core=0:0", "--", command, ...args,
      ], { cwd, env, stdio: ["ignore", stdout, stderr] });
      child.once("error", reject);
      child.once("close", (exitCode, exitSignal) => accept([exitCode, exitSignal]));
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
  const wallSeconds = Math.round(performance.now() - started) / 1000;
  const [rss = "", user = "", system = ""] = (await readFile(`${log}.rss`, "utf8")).trim().split(/\s+/);
  const peakRssKiB = /^[1-9]\d*$/.test(rss) ? Number(rss) : null;
  return { code, ...(signal ? { signal } : {}), wallSeconds, peakRssKiB,
    ...(user && system && { cpuSeconds: Number(user) + Number(system) }) };
}

function clean(raw, root, scratch) {
  const relative = String(raw).replaceAll(`${root}/`, "").replaceAll(root, ".")
    .replaceAll(scratch, "$PYM_SCRATCH")
    .replaceAll(process.execPath, "node")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/0x[\da-f]{6,}/gi, "[address]")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
  return process.env.HOME ? relative.replaceAll(process.env.HOME, "~") : relative;
}

export function processFailure(result, stderr, errorMessage) {
  const lines = stderr.trimEnd().split("\n").filter(Boolean);
  const stderrTail = lines.slice(-6).map((line) => line.slice(0, 260));
  const lastProgress = lines.findLast((line) => /^graph \S+.*: \d+\/\d+/.test(line));
  const memoryMessage = lines.find((line) =>
    /FATAL ERROR: .*heap out of memory|FATAL ERROR: .*Allocation failed.*memory|terminate called after throwing an instance of 'std::bad_alloc'/i.test(line));
  const outcome = result.code === 124 || /timeout: sending signal (?:TERM|KILL)/.test(stderr)
    ? "wall-limit"
    : memoryMessage ? "killed-for-memory" : "crashed";
  return { outcome, ...result,
    ...(memoryMessage && outcome === "killed-for-memory" ? { memoryMessage: memoryMessage.slice(0, 260) } : {}),
    ...(lastProgress ? { lastProgress: lastProgress.slice(0, 260) } : {}),
    ...(errorMessage ? { message: errorMessage.slice(0, 300) } : {}), stderrTail };
}

export function reasonFamily(reason) {
  return reason
    .replace(/\b[Ss]yntax error at line \d+, column \d+: /, "Syntax error: ")
    .replace(/\bsyntax error in lines? \d+(?:–\d+)?: /, "Syntax error: ")
    .replace(/^line \d+, column \d+: /, "Syntax error: ")
    .replace(/^\d+:\d+: /, "")
    .replace(/ Found: ".*"\.$/, "");
}

// Each stored resolution class separately. A 0.1.0 CLI reports no library
// count (schema 3 has none); a library link is never resolved in the checkout.
export function linkShares({ links, ambiguous, unresolved, library }) {
  const outside = library ?? 0;
  const resolved = links - ambiguous - unresolved - outside;
  if (![links, resolved, ambiguous, unresolved, outside].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw Error("Invalid released graph link counts");
  const classes = { resolved, ambiguous, unresolved, ...(library === undefined ? {} : { library }) };
  return {
    total: links,
    ...classes,
    percentages: links ? Object.fromEntries(Object.entries(classes)
      .map(([key, count]) => [key, Math.round(10_000 * count / links) / 100])) : null,
  };
}

export function lineForOffset(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

export function selectSearchSample(matches, language) {
  return matches?.find(({ file, id }) =>
    languageExtensions[language].test(file) && /^symbol:[a-f0-9]{64}$/.test(id));
}

export async function summarizeIndex(report, locate, redact = (value) => value) {
  const groups = new Map();
  for (const entry of report.failedFiles) {
    const message = redact(entry.reason);
    const reason = reasonFamily(message);
    const key = JSON.stringify([entry.language, reason]);
    if (!groups.has(key)) groups.set(key, { language: entry.language, reason, count: 0, files: [], examples: [] });
    const group = groups.get(key);
    group.count++;
    group.files.push(entry.path);
    if (group.examples.length < 2) {
      group.examples.push({ file: entry.path, line: await locate(entry), message: message.slice(0, 260) });
    }
  }
  const { report: details, complete } = report.sync;
  const errors = Object.fromEntries(["errors", "analysisErrors", "resolutionErrors"].map((key) => {
    const entries = details[key];
    return [key, { count: entries.length, examples: entries.slice(0, 2).map((entry) => ({
      ...(entry.path ? { file: entry.path } : { module: entry.module }),
      message: redact(entry.message).slice(0, 260),
    })) }];
  }));
  return {
    complete,
    fileCounts: Object.fromEntries(report.modules.map(({ id, files }) => [id, files])),
    symbolCount: report.counts.symbols,
    partialFileCount: report.counts.partial,
    failedFileCount: report.failedFiles.length,
    failures: [...groups.values()].sort((a, b) => b.count - a.count || compare(a.reason, b.reason) || compare(a.language ?? "", b.language ?? "")),
    links: linkShares(report.counts),
    ...(Object.values(errors).some(({ count }) => count > 0) ? { errors } : {}),
  };
}

async function checkedSelection(path) {
  const repos = JSON.parse(await readFile(path, "utf8"));
  const owners = new Set();
  const ids = new Set();
  for (const repo of repos) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.id) || repo.id.split("/").some((part) => /^\.+$/.test(part)) ||
        repo.url !== `https://github.com/${repo.id}.git` || !/^[0-9a-f]{40}$/.test(repo.commit) ||
        !["typescript", "go", "rust"].includes(repo.language)) {
      throw Error("Expected a public GitHub URL, repository ID, full commit SHA and supported language");
    }
    const id = repo.id.toLowerCase();
    const owner = `${repo.language}:${id.split("/")[0]}`;
    if (ids.has(id)) throw Error(`Duplicate repository: ${repo.id}`);
    if (owners.has(owner)) throw Error(`Duplicate owner in language: ${owner}`);
    ids.add(id);
    owners.add(owner);
  }
  return repos;
}

async function installRelease(scratch) {
  const prefix = join(scratch, "release");
  const release = join(prefix, "node_modules/pymtheg");
  const entry = join(release, "dist/cli/main.js");
  if (!await exists(entry) || !await exists(join(prefix, "package-lock.json"))) {
    await rm(prefix, { recursive: true, force: true });
    await mkdir(prefix, { recursive: true });
    const result = await measured({ command: "npm", args: [
      "install", "--prefix", prefix, "--cache", join(scratch, "npm-cache"), "--userconfig", "/dev/null",
      "--globalconfig", join(scratch, "empty-npmrc"), "--registry", "https://registry.npmjs.org/",
      "--ignore-scripts", "--no-audit", "--no-fund", "--no-update-notifier", "--save-exact", `pymtheg@${version}`,
    ], cwd: prefix, log: join(scratch, "npm-install"), seconds: 600,
    env: { ...environment, NO_UPDATE_NOTIFIER: "1" } });
    if (result.code !== 0) throw Error("Release install failed; see npm-install.err under scratch");
  }
  const lock = JSON.parse(await readFile(join(prefix, "package-lock.json"), "utf8"));
  const { version: locked, resolved, integrity } = lock.packages["node_modules/pymtheg"];
  const installed = JSON.parse(await readFile(join(release, "package.json"), "utf8"));
  if (locked !== version || installed.version !== version || !integrity ||
      resolved !== `https://registry.npmjs.org/pymtheg/-/pymtheg-${version}.tgz`) {
    throw Error("Scratch package does not match the public npm release");
  }
  return { entry, provenance: { package: `pymtheg@${version}`, resolved, integrity, node: process.version } };
}

async function buildDigest(path) {
  const hash = createHash("sha256");
  async function capture(name) {
    const file = join(path, name);
    if ((await lstat(file)).isDirectory()) {
      for (const child of (await readdir(file)).sort(compare)) await capture(join(name, child));
    } else {
      const bytes = await readFile(file);
      hash.update(JSON.stringify([name, bytes.length])).update(bytes);
    }
  }
  for (const name of ["package.json", "package-lock.json", "dist", "grammars"]) {
    if (await exists(join(path, name))) await capture(name);
  }
  return hash.digest("hex");
}

export async function localBuild(scratch, path) {
  const input = resolve(path);
  const directory = (await lstat(input)).isDirectory();
  if (!directory && extname(input) !== ".tgz") throw Error("Use a built package directory or a local .tgz");
  const sha256 = directory ? await buildDigest(input) : createHash("sha256").update(await readFile(input)).digest("hex");
  let root = input;
  if (!directory) {
    const prefix = join(scratch, "builds", sha256);
    root = join(prefix, "node_modules/pymtheg");
    if (!await exists(join(prefix, "package-lock.json")) || !await exists(join(root, "dist/cli/main.js"))) {
      await rm(prefix, { recursive: true, force: true });
      await mkdir(prefix, { recursive: true });
      const result = await measured({ command: "npm", args: [
        "install", "--offline", "--prefix", prefix, "--cache", join(scratch, "npm-cache"),
        "--userconfig", "/dev/null", "--globalconfig", join(scratch, "empty-npmrc"),
        "--ignore-scripts", "--no-audit", "--no-fund", "--no-update-notifier", input,
      ], cwd: prefix, log: join(prefix, "install"), seconds: 600 });
      if (result.code !== 0) throw Error("Offline candidate install failed. Use the release cache or an installed build directory.");
    }
  }
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const entry = join(root, "dist/cli/main.js");
  if (manifest.name !== "pymtheg" || !await exists(entry)) throw Error("Candidate must contain a built Pymtheg CLI");
  return { entry, sha256, provenance: { package: `pymtheg@${manifest.version}`, source: directory ? "local build" : "local tarball", sha256, node: process.version } };
}

async function corpusSize(root, listing) {
  const files = Object.fromEntries(Object.keys(languageExtensions).map((key) => [key, 0]));
  const lines = { ...files };
  const samples = {};
  for (const item of listing.split("\0")) {
    const tab = item.indexOf("\t");
    if (tab < 0 || !/^100(?:644|755) blob /.test(item.slice(0, tab))) continue;
    const path = item.slice(tab + 1);
    const language = Object.keys(languageExtensions).find((key) => languageExtensions[key].test(path));
    if (!language) continue;
    const source = await readFile(join(root, path));
    files[language]++;
    lines[language] += source.reduce((total, byte) => total + (byte === 10), 0)
      + (source.length > 0 && source.at(-1) !== 10 ? 1 : 0);
    samples[language] ??= path;
  }
  return { files, lines, samples };
}

async function runRepository(repo, release, scratch, limitSeconds, installed) {
  // A retry gets a distinct directory even if a previous child is winding down.
  const work = join(scratch, "work", ...repo.id.split("/"), repo.commit, randomUUID());
  const root = join(work, "checkout");
  const record = { id: repo.id, language: repo.language, commit: repo.commit,
    attempt: relative(scratch, work), limitSeconds, queries: [] };
  const started = performance.now();
  let peak = null;
  let stage = "prepare";
  const redact = (message) => clean(message, root, scratch);
  const elapsed = () => Math.round(performance.now() - started) / 1000;
  const finalize = (outcome, failure) => ({ ...record, outcome, ...(failure ? { failure } : {}),
    wallSeconds: elapsed(), peakRssKiB: peak });
  const run = async (label, command, args, env, foreground) => {
    stage = label;
    const log = join(work, label);
    const seconds = limitSeconds - elapsed();
    if (seconds <= 0) throw { outcome: "wall-limit", stage };
    const process = await measured({ command, args, cwd: root, log, seconds, env, foreground });
    if (process.peakRssKiB !== null) peak = Math.max(peak ?? 0, process.peakRssKiB);
    return { process, log };
  };
  const fail = async ({ process, log }, message) => {
    throw { ...processFailure(process, redact(await tail(`${log}.err`)), message && redact(message)), stage };
  };
  const git = async (label, ...args) => {
    const runResult = await run(label, "git", ["-c", "core.hooksPath=/dev/null", ...args], gitEnvironment);
    if (runResult.process.code !== 0) await fail(runResult);
    return readFile(`${runResult.log}.out`, "utf8");
  };
  const cli = async (label, args, expectedCommand) => {
    // Source-only CLI calls have no toolchain children. Keep timeout alive
    // after a forced kill so GNU time can collect the CLI's peak RSS.
    const runner = installed ? "unshare" : process.execPath;
    const argv = installed
      ? ["--user", "--map-root-user", "--net", "--", process.execPath, release.entry, ...args]
      : [release.entry, ...args];
    const runResult = await run(label, runner, argv, environment, true);
    let body;
    // Exit 2 with a normal graph response means incomplete, so keep its facts.
    if ([0, 2, 3].includes(runResult.process.code)) {
      try {
        body = JSON.parse(await readFile(`${runResult.log}.out`, "utf8"));
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
    }
    if (expectedCommand) {
      if (body?.schema !== "pymtheg.graph/v1" || body.command !== expectedCommand ||
          ![0, 2].includes(runResult.process.code) || body.exitCode !== runResult.process.code || !body.counts) {
        const message = body?.error?.message ?? ([0, 2, 3].includes(runResult.process.code)
          ? "Expected a released graph JSON response" : undefined);
        await fail(runResult, message);
      }
    } else if (runResult.process.code !== 0) {
      await fail(runResult, body?.documentation?.message ?? body?.error?.message);
    }
    return { ...runResult.process, body };
  };
  const graph = (label, command, ...args) => cli(label, ["graph", command, ...args, "--root", ".", "--json"], command);
  const query = async (command, ...args) => {
    const response = await graph(`query-${command}`, command, ...args, "--no-sync", "--limit", "25");
    const { body } = response;
    record.queries.push({ command, status: body.status, exitCode: response.code,
      resultCounts: body.resultCounts, truncated: body.truncated });
    return body.data;
  };
  const locate = async (entry) => {
    if (!entry.range) return null;
    const path = resolve(root, entry.path);
    if (!path.startsWith(`${root}/`)) return null;
    return lineForOffset(await readFile(path, "utf8"), entry.range.start);
  };
  try {
    await mkdir(root, { recursive: true });
    await git("git-init", "init", "--template=", "--quiet");
    await git("fetch", "fetch", "--depth", "1", "--no-tags", "--no-recurse-submodules", repo.url, repo.commit);
    await git("checkout", "checkout", "--quiet", "--detach", "FETCH_HEAD");
    if ((await git("verify", "rev-parse", "--verify", "HEAD")).trim() !== repo.commit) {
      throw Error("Checkout does not match the pinned commit");
    }
    const tracked = await git("tree", "ls-tree", "-rz", "--full-tree", "HEAD");
    stage = "size";
    const { files, lines, samples } = await corpusSize(root, tracked);
    record.trackedSource = { files, lines };
    if (installed) {
      stage = "install";
      // This Nest pin documents the peer resolution mode in CONTRIBUTING.md.
      const setup = await installation(root, scratch, {
        legacyPeerDeps: repo.id === "nestjs/nest" &&
          repo.commit === "085f83a168e9edbedfe9560428dcfd270073ae00",
      });
      if (!setup.command) {
        record.install = setup;
        return finalize("install-unavailable");
      }
      const install = await run("install", setup.command, setup.args, setup.env);
      record.install = { manager: setup.manager, status: install.process.code === 0 ? "installed" : "failed", exitCode: install.process.code };
      if (install.process.code !== 0) return finalize("install-unavailable");
    }
    stage = "init";
    // Never use project-supplied Pymtheg settings. init creates default settings.
    if (await exists(join(root, ".pymtheg"))) throw Error("Checkout contains existing Pymtheg settings or storage");
    await cli("init", ["init", ".", "--name", repo.id, "--format", "json"]);
    const cold = await graph("cold", "index");
    record.cold = { wallSeconds: cold.wallSeconds, cpuSeconds: cold.cpuSeconds, peakRssKiB: cold.peakRssKiB, exitCode: cold.code, status: cold.body.status };
    record.index = await summarizeIndex(cold.body, locate, redact);
    if (cold.body.toolchain) throw Error("Unexpected toolchain state in a default source-only run");
    const warm = await graph("warm", "index");
    record.warm = { wallSeconds: warm.wallSeconds, cpuSeconds: warm.cpuSeconds, peakRssKiB: warm.peakRssKiB, exitCode: warm.code,
      status: warm.body.status, unchanged: warm.body.sync.report.unchanged };
    await query("status");
    const found = await query("search", "init");
    const sample = selectSearchSample(found?.matches, repo.language);
    if (sample) {
      record.querySample = { file: sample.file, line: sample.line, name: sample.name };
      await query("callees", sample.id);
    }
    const path = sample?.file ?? samples[repo.language];
    if (path) await query("file", path);
    return finalize("finished");
  } catch (error) {
    if (error.outcome) {
      const { outcome, ...failure } = error;
      return finalize(outcome, failure);
    }
    return finalize("crashed", { stage, message: redact(error.message).slice(0, 300) });
  }
}

async function writeAtomic(path, data) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, path);
}

async function main() {
  const { values } = parseArgs({ options: {
    manifest: { type: "string", default: "sweep/repos.json" },
    scratch: { type: "string", default: process.env.PYM_SCRATCH },
    parallel: { type: "string", default: "1" },
    "wall-minutes": { type: "string", default: "60" },
    "local-build": { type: "string" },
    installed: { type: "boolean" },
    "retry-unfinished": { type: "boolean" },
    output: { type: "string" },
  } });
  const parallel = Number(values.parallel);
  const limitSeconds = 60 * Number(values["wall-minutes"]);
  if (!values.scratch || !Number.isInteger(parallel) || parallel < 1 || parallel > 12 ||
      !Number.isFinite(limitSeconds) || limitSeconds <= 0) {
    throw Error("Use --scratch (or PYM_SCRATCH), --parallel 1..12 and a positive --wall-minutes");
  }
  const scratch = resolve(values.scratch);
  const repos = (await checkedSelection(values.manifest)).filter((repo) => !values.installed || repo.language === "typescript");
  const release = values["local-build"] ? await localBuild(scratch, values["local-build"]) : await installRelease(scratch);
  const recordsDirectory = values.installed
    ? join(scratch, "installed-records", createHash("sha256").update(await readFile(new URL("./install.mjs", import.meta.url))).digest("hex"), release.sha256 ?? "release")
    : join(scratch, release.sha256 ? "build-records" : "records", release.sha256 ?? "");
  const outputPath = values.output ? resolve(values.output) : join(scratch, `results${values.installed ? "-installed" : ""}${release.sha256 ? `-${release.sha256}` : ""}.json`);
  await mkdir(recordsDirectory, { recursive: true });
  const records = new Map();
  const recordPath = (repo) => join(recordsDirectory, ...repo.id.split("/"), `${repo.commit}.json`);
  for (const repo of repos) {
    const path = recordPath(repo);
    if (await exists(path)) {
      const record = JSON.parse(await readFile(path, "utf8"));
      if (!values["retry-unfinished"] || record.outcome === "finished" || record.outcome === "install-unavailable")
        records.set(repo.id, record);
    }
  }
  const pending = repos.filter((repo) => !records.has(repo.id));
  const saveResults = () => writeAtomic(outputPath, [
    "{", `  "release": ${JSON.stringify(release.provenance)},`, `  "mode": ${JSON.stringify(values.installed ? "installed" : "source-only (default)")},`, '  "repos": [',
    [...records].sort(([a], [b]) => compare(a, b)).map(([, record]) => `    ${JSON.stringify(record)}`).join(",\n"),
    "  ]", "}", "",
  ].join("\n"));
  await saveResults();
  console.error(`${pending.length} pending; ${records.size} recorded; ${parallel} workers`);
  // Serialize writes to the aggregate while each worker uses independent checkouts.
  let output = Promise.resolve();
  await Promise.all(Array.from({ length: parallel }, async () => {
    for (let repo; (repo = pending.shift()); ) {
      console.error(`${repo.id} started`);
      const record = await runRepository(repo, release, scratch, limitSeconds, values.installed);
      await mkdir(join(recordsDirectory, ...repo.id.split("/")), { recursive: true });
      await writeAtomic(recordPath(repo), `${JSON.stringify(record)}\n`);
      records.set(repo.id, record);
      output = output.then(saveResults);
      await output;
      console.error(`${repo.id} ${record.outcome} (${record.wallSeconds} s)`);
    }
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
