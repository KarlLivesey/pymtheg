// SPDX-License-Identifier: MIT
// Run from the mirrored project on the dev server with PYM_SCRATCH set.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const scratch = process.env.PYM_SCRATCH;
const [mode, other, ...args] = process.argv.slice(2);
const [output] = args;
const repos = JSON.parse(readFileSync("sweep/repos.json", "utf8"));
const baseline = JSON.parse(readFileSync("evidence/sw-1/results.json", "utf8"));
const finished = new Set(
  baseline.repos
    .filter((row) => row.outcome === "finished")
    .map((row) => row.id),
);
const pins = repos.filter(
  (repo) => repo.language === "typescript" && finished.has(repo.id),
);
const auditPins = new Set([
  "dexie/Dexie.js",
  "honojs/hono",
  "oclif/core",
  "pmndrs/zustand",
  "yargs/yargs",
]);
const preservationPins = new Set([
  "pingdotgg/t3code",
  "nestjs/nest",
  "excalidraw/excalidraw",
  "withastro/astro",
  "honojs/hono",
  "trpc/trpc",
  "vitejs/vite",
]);
const manifest = join(scratch, `${mode}-manifest.json`);
const picked = /^candidate-pick(?:-[a-z0-9-]+)?$/.test(mode);
const run = (args) => {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0)
    throw Error(`${args[0]} exited ${result.status ?? result.signal}`);
};
const sweep = (target, parallel, build) =>
  run([
    "scripts/sweep/run.mjs",
    "--manifest",
    manifest,
    "--scratch",
    target,
    "--parallel",
    String(parallel),
    "--output",
    join(target, `${mode}-run.json`),
    ...(build ? ["--local-build", build] : []),
  ]);
const main = join(scratch, process.env.C11_MAIN_BUILD ?? "main");
function unpackMain() {
  if (existsSync(join(main, "dist/cli/main.js"))) return;
  mkdirSync(main, { recursive: true });
  const result = spawnSync(
    "tar",
    ["-xf", join(scratch, "main.tgz"), "-C", main, "--strip-components=1"],
    { stdio: "inherit" },
  );
  if (result.status !== 0)
    throw Error(`Main archive extraction exited ${result.status}`);
  symlinkSync(
    join(scratch, "release/node_modules"),
    join(main, "node_modules"),
  );
}
const coverage = (target, previous) =>
  run([
    "scripts/sweep/coverage-export.mjs",
    "--scratch",
    scratch,
    "--results",
    join(scratch, `${target}-run.json`),
    "--output",
    join(scratch, `${output ?? target}-coverage.json`),
    "--reference-samples",
    "evidence/sw-3/samples.json.gz",
    ...(previous
      ? ["--shared-with", join(scratch, `${previous}-run.json`)]
      : []),
  ]);

if (mode === "release") {
  writeFileSync(manifest, JSON.stringify(pins));
  sweep(scratch, Number(other ?? 4));
} else if (mode === "main") {
  unpackMain();
  writeFileSync(
    manifest,
    JSON.stringify(pins.filter((repo) => preservationPins.has(repo.id))),
  );
  sweep(scratch, Number(other ?? 3), realpathSync(main));
} else if (mode === "collect" || mode === "replace") {
  const packets = [other, ...args].map((name) =>
    JSON.parse(readFileSync(join(scratch, `${name}-run.json`), "utf8")),
  );
  const [first] = packets;
  if (
    mode === "collect" &&
    packets.some((packet) => packet.release.sha256 !== first.release.sha256)
  )
    throw Error("Candidate shards must use one build");
  const byId = new Map(first.repos.map((row) => [row.id, row]));
  for (const packet of packets.slice(1))
    for (const row of packet.repos) {
      if (mode === "replace" && byId.get(row.id)?.commit !== row.commit)
        throw Error(`Replacement must replay an existing pin: ${row.id}`);
      byId.set(
        row.id,
        mode === "replace" ? { ...row, build: packet.release.sha256 } : row,
      );
    }
  writeFileSync(
    join(scratch, "candidate-run.json"),
    JSON.stringify({ ...first, repos: [...byId.values()] }),
  );
} else if (
  picked ||
  ["candidate", "candidate-audit", "candidate-core", "previous"].includes(mode)
) {
  writeFileSync(
    manifest,
    JSON.stringify(
      mode === "candidate" || mode === "previous"
        ? pins
        : picked
          ? args.map((id) => pins.find((repo) => repo.id === id))
          : pins.filter(
              (repo) => auditPins.has(repo.id) === (mode === "candidate-audit"),
            ),
    ),
  );
  const build = process.env.C11_BUILD
    ? realpathSync(join(scratch, process.env.C11_BUILD))
    : resolve(".");
  sweep(scratch, Number(other ?? 4), build);
} else if (
  ["release", "main", "candidate"].includes(other) &&
  mode.endsWith("-export")
)
  coverage(mode.replace(/-export$/, ""), other);
else throw Error(`Unknown C-11 run ${mode}`);
