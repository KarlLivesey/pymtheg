// SPDX-License-Identifier: MIT
// Supply the standard exporter's warm CLI totals for a paired cold sweep.
import { spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [results, work, build, concurrency, ...ids] = process.argv.slice(2);
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const pending = read(results)
  .repos.filter((repo) => !ids.length || ids.includes(repo.id))
  .map((repo) => {
    if (repo.outcome !== "finished")
      throw Error(`Missing cold index for ${repo.id}`);
    return { ...repo, path: join(work, repo.attempt) };
  });

async function worker() {
  for (let repo; (repo = pending.shift()); ) {
    const warm = join(repo.path, "warm.out");
    if (!existsSync(warm)) {
      const out = createWriteStream(warm, { flags: "wx" });
      const err = createWriteStream(join(repo.path, "warm.err"), {
        flags: "wx",
      });
      await Promise.all(
        [out, err].map(
          (stream) =>
            new Promise((done, fail) => {
              stream.once("open", done);
              stream.once("error", fail);
            }),
        ),
      );
      const code = await new Promise((done, fail) => {
        const child = spawn(
          process.execPath,
          [
            resolve(build, "dist/cli/main.js"),
            "graph",
            "index",
            "--root",
            ".",
            "--json",
          ],
          { cwd: join(repo.path, "checkout"), stdio: ["ignore", out, err] },
        );
        child.once("error", fail);
        child.once("close", done);
      });
      out.end();
      err.end();
      if (code !== 0 && code !== 2)
        throw Error(`Warm index exited ${code} on ${repo.id}`);
    }
    const body = read(warm);
    const cold = read(join(repo.path, "cold.out"));
    if (
      !body.sync?.complete ||
      JSON.stringify(body.counts) !== JSON.stringify(cold.counts)
    )
      throw Error(`Warm index changed graph totals for ${repo.id}`);
    console.log(`${repo.id}: warm totals match`);
  }
}

await Promise.all(Array.from({ length: Number(concurrency) }, worker));
