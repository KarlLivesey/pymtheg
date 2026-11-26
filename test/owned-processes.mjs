// SPDX-License-Identifier: MIT
// C-50 review: a test kills only a process it started. The pid must be an
// integer above 1 (never this process's group, every process or init), and
// its command line must carry a marker only this test's processes have (a
// path in the test's own scratch directory).
import { readFileSync } from "node:fs";

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
