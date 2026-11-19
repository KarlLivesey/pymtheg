// SPDX-License-Identifier: MIT
// Run the unchanged repository initialization test alone on main and C-11.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statfsSync } from "node:fs";
import { join, resolve } from "node:path";

const scratch = process.env.PYM_SCRATCH;
const [memory, mode, ...directories] = process.argv.slice(2);
if (!scratch || !memory || statfsSync(memory).type !== 0x01021994)
  throw Error("The self-index bracket requires a tmpfs scratch directory");
const env = { ...process.env, PYM_SCRATCH: memory, TMPDIR: memory };
const test = [
  process.execPath,
  "--test",
  "--test-name-pattern",
  "this repository initializes and serves commands",
  "test/project-init-clean.test.mjs",
];
const builds = [
  ["main", join(scratch, process.env.C11_MAIN_BUILD ?? "main-src")],
  ["head", resolve(".")],
];
const profiling = mode === "--profile";
function sampledIndex(directory) {
  const profiles = readdirSync(directory)
    .filter((entry) => entry.endsWith(".cpuprofile"))
    .map((entry) => JSON.parse(readFileSync(join(directory, entry), "utf8")));
  const isTypescript = (frame) => frame.url.includes("/languages/typescript/");
  const hasExtraction = (profile) =>
    profile.nodes.some(
      ({ callFrame }) =>
        isTypescript(callFrame) && callFrame.functionName === "extractFile",
    );
  const index = profiles
    .filter(hasExtraction)
    .sort((a, b) => b.endTime - b.startTime - (a.endTime - a.startTime))[0];
  if (!index) throw Error("No CPU profile reached TypeScript extraction");
  const nodes = new Map(index.nodes.map((node) => [node.id, node]));
  const parents = new Map(
    index.nodes.flatMap((node) =>
      (node.children ?? []).map((child) => [child, node.id]),
    ),
  );
  const phases = {};
  const extraction = {};
  let graphStorage = 0;
  const evidenceReaders = {};
  const measuredReaders = new Set([
    "collectScopedNames",
    "propertyWrite",
    "memberWritten",
    "missingBinding",
    "missingUnit",
    "moduleReason",
    "declarationUnit",
    "targetOf",
  ]);
  for (const [n, sample] of index.samples.entries()) {
    let inExtraction = false;
    let inAnalysis = false;
    let inStorage = false;
    const readers = new Set();
    for (let at = sample; at !== undefined; at = parents.get(at)) {
      const frame = nodes.get(at).callFrame;
      if (frame.url.includes("/graph/store.js")) inStorage = true;
      if (!isTypescript(frame)) continue;
      if (frame.functionName === "extractFile") inExtraction = true;
      if (measuredReaders.has(frame.functionName))
        readers.add(frame.functionName);
      if (
        frame.functionName === "analyze" &&
        frame.url.endsWith("/typescript/index.js")
      )
        inAnalysis = true;
    }
    const phase = inExtraction
      ? "extraction"
      : inAnalysis
        ? "other-ts-analysis"
        : "other-index";
    const seconds = index.timeDeltas[n] / 1_000_000;
    phases[phase] = (phases[phase] ?? 0) + seconds;
    if (inStorage) graphStorage += seconds;
    if (inExtraction) {
      const frame = nodes.get(sample).callFrame;
      const name = frame.functionName || "(anonymous)";
      extraction[name] = (extraction[name] ?? 0) + seconds;
      for (const reader of readers)
        evidenceReaders[reader] = (evidenceReaders[reader] ?? 0) + seconds;
    }
  }
  return {
    phases,
    graphStorage,
    evidenceReaders,
    extraction: Object.entries(extraction)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12),
  };
}
if (mode === "--summarize") {
  for (const directory of directories)
    console.log(
      JSON.stringify({
        directory,
        profile: sampledIndex(join(scratch, directory)),
      }),
    );
  process.exit(0);
}
let failed = false;
for (let run = 1; run <= (profiling ? 1 : 3); run++) {
  for (const [build, cwd] of builds) {
    const timing = join(scratch, `self-index-${build}-${run}.time`);
    const profile = profiling
      ? mkdtempSync(join(scratch, `self-profile-${build}-`))
      : undefined;
    const runEnv = profile
      ? {
          ...env,
          NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --cpu-prof --cpu-prof-dir=${profile}`,
        }
      : env;
    const result = spawnSync(
      "/usr/bin/time",
      ["-f", "%e %U %S %M", "-o", timing, ...test],
      { cwd, env: runEnv, stdio: "inherit" },
    );
    if (result.error) throw result.error;
    const [seconds, userSeconds, systemSeconds, rssKiB] = readFileSync(
      timing,
      "utf8",
    )
      .trim()
      .split("\n")
      .at(-1)
      .split(/\s+/)
      .map(Number);
    console.log(
      JSON.stringify({
        build,
        run,
        seconds,
        userSeconds,
        systemSeconds,
        rssKiB,
        exitCode: result.status,
        signal: result.signal,
        ...(profile && { profile: sampledIndex(profile) }),
      }),
    );
    failed ||= result.status !== 0;
  }
}
process.exitCode = failed ? 1 : 0;
