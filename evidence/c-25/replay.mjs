// SPDX-License-Identifier: MIT
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { measured } from "../../scripts/sweep/run.mjs";

const [scratchArgument, location, build, result, parallelText, ...selected] =
  process.argv.slice(2);
const scratch = resolve(scratchArgument);
const attempts = JSON.parse(await readFile(location, "utf8"));
const parallel = Number(parallelText);
if (
  !Number.isSafeInteger(parallel) ||
  parallel < 1 ||
  parallel > 6 ||
  !/^[\w-]+$/.test(result)
)
  throw Error("Expected SCRATCH RECEIPT BUILD RESULT PARALLEL [PIN…]");
const env = { ...process.env };
delete env.NODE_OPTIONS;
const pending = attempts.repos.filter(
  ({ outcome, id }) =>
    outcome === "finished" && (!selected.length || selected.includes(id)),
);
const repos = [];
async function replay(repo) {
  const root = join(scratch, repo.attempt, "checkout");
  const state = join(root, ".pymtheg", "rebuildable");
  const attempt = join(result, repo.id);
  const logs = join(scratch, attempt);
  const saved = join(logs, "checkout", ".pymtheg");
  await mkdir(saved, { recursive: true });
  const backup = join(logs, "previous");
  await rename(state, backup);
  const start = performance.now();
  const run = async (label) => {
    const log = join(logs, label);
    const result = await measured({
      command: "unshare",
      args: [
        "--user",
        "--map-root-user",
        "--net",
        "--",
        process.execPath,
        join(scratch, build, "dist/cli/main.js"),
        "graph",
        "index",
        "--root",
        ".",
        "--json",
      ],
      cwd: root,
      log,
      seconds: repo.limitSeconds - (performance.now() - start) / 1000,
      env,
      foreground: true,
    });
    const body = JSON.parse(await readFile(log + ".out", "utf8"));
    if (![0, 2].includes(result.code) || body.schema !== "pymtheg.graph/v1")
      throw Error(`Index ${label} failed for ${repo.id}`);
    return { ...result, status: body.status };
  };
  try {
    const cold = await run("cold");
    const warm = await run("warm");
    await rename(state, join(saved, "rebuildable"));
    return { ...repo, sourceAttempt: repo.attempt, attempt, cold, warm };
  } catch (error) {
    console.error(`${repo.id}: ${error.message}`);
    return { ...repo, outcome: "replay-failed" };
  } finally {
    await rename(state, join(logs, "interrupted")).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rename(backup, state);
  }
}

await Promise.all(
  Array.from({ length: parallel }, async () => {
    for (let repo; (repo = pending.shift()); ) {
      console.error(`${repo.id} replay started`);
      const row = await replay(repo);
      console.error(`${repo.id} replay ${row.outcome}`);
      repos.push(row);
    }
  }),
);
repos.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(
  join(scratch, `${result}-run.json`),
  JSON.stringify({ ...attempts, repos }),
);
