// SPDX-License-Identifier: MIT
// C-37: a second writer beside a cold index. While process <pid> runs, about
// once a second it does what a graph write does until it holds the write
// lock: with --turnstile, it first takes the turnstile beside the store (as
// the store's writes do), then BEGIN IMMEDIATE with the production 30-second
// busy wait, then leaves the turnstile; then it rolls back, so the index's
// rows and run are not changed. It records how long it waited for the lock
// and any error ("database is locked"). The waits are observations; with
// measure.mjs's commit times they give the number of batches each spanned.
//   node scripts/store-cost/waiter.mjs <graph.sqlite> <pid> <out.json> [--turnstile]
import { existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [graph, pidArg, out, flag] = process.argv.slice(2);
const turnstile = flag === "--turnstile";
const wait = 30_000;
const pid = Number(pidArg);
const alive = () => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const waits = [];
while (alive()) {
  if (!existsSync(graph)) {
    await pause(200);
    continue;
  }
  const started = Date.now();
  let error;
  const gate = turnstile
    ? new DatabaseSync(`${graph}-turnstile`, { timeout: wait })
    : undefined;
  const db = new DatabaseSync(graph, { timeout: wait });
  try {
    gate?.exec("BEGIN IMMEDIATE");
    try {
      db.exec("BEGIN IMMEDIATE");
    } finally {
      gate?.exec("ROLLBACK");
    }
    db.exec("ROLLBACK");
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    db.close();
    gate?.close();
  }
  const ended = Date.now();
  waits.push({ started, ended, ...(error ? { error } : {}) });
  writeFileSync(out, JSON.stringify({ waits }));
  await pause(1000);
}
writeFileSync(out, JSON.stringify({ waits }));
