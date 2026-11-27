// SPDX-License-Identifier: MIT
// C-50 review: a test kills only a process it started. The pid must be an
// integer above 1 (never this process's group, every process or init), and
// its command line must carry a marker only this test's processes have (a
// path in the test's own scratch directory).
import { readdirSync, readFileSync } from "node:fs";

const isProcessId = (pid) => Number.isInteger(pid) && pid > 1;

/** Sends SIGKILL to `pid` (or its group, `group`) if it is the test's own. */
export function killOwned(pid, marker, { group = false } = {}) {
  if (!isProcessId(pid) || typeof marker !== "string" || !marker) return false;
  let commandLine;
  try {
    commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return false; // gone, or not readable: not proved to be the test's
  }
  if (!commandLine.split("\0").some((part) => part.includes(marker)))
    return false;
  try {
    process.kill(group ? -pid : pid, "SIGKILL");
    return true;
  } catch {
    return false;
  }
}

// C-50 review: a test whose awaited event never comes fails instead of
// hanging the run, and leaves nothing running. The bound only turns such a
// wait into a failure; it decides nothing when the test passes.
export const SAFETY_BOUND_MS = 3 * 60_000;

/** `promise`; past the bound, `onExpiry` runs (it ends what the wait was for) and the wait fails. */
export async function bounded(
  promise,
  what,
  onExpiry = () => {},
  ms = SAFETY_BOUND_MS,
) {
  let timer;
  let expired = false;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(
            Error(
              `Safety budget exhausted waiting for ${what}; evidence unresolved`,
            ),
          );
        }, ms);
      }),
    ]);
  } catch (error) {
    if (expired) await onExpiry();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * SIGKILL to a child process this test spawned, through its own handle:
 * Node signals it only while it has not been reaped, so the pid is still
 * the child's.
 */
export function endChild(child) {
  if (child && child.exitCode === null && child.signalCode === null)
    child.kill("SIGKILL");
}

/** Its [code, signal] once closed, within the bound; past it the child is killed and the wait fails. Call it at spawn. */
export function closing(child, what) {
  const closed = new Promise((resolve, reject) => {
    child.once("close", (...result) => resolve(result));
    child.once("error", reject);
  });
  closed.catch(() => {});
  return { wait: () => bounded(closed, what, () => endChild(child)) };
}

/**
 * Kills every process whose command line carries `marker`, each with its
 * process group when it leads one (C-50 review, Sol: a fixture is found by
 * its own marker, not only by a pid it may never have reported).
 */
export function killMarked(marker) {
  for (const entry of readdirSync("/proc"))
    if (/^\d+$/.test(entry) && Number(entry) !== process.pid) {
      const pid = Number(entry);
      if (!killOwned(pid, marker, { group: true })) killOwned(pid, marker);
    }
}
