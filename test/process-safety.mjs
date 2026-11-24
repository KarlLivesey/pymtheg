// SPDX-License-Identifier: MIT
import { readFileSync, readdirSync } from "node:fs";

/** An integer above 1: never this process's own group (0) or every process (-1). */
const isProcessId = (pid) => Number.isInteger(pid) && pid > 1;
/** This bound reports missing evidence; it never establishes correctness. */
export async function within(promise, waitingFor, cleanup = () => {}) {
  let timer,
    expired = false;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(
            Error(
              `Safety budget exhausted waiting for ${waitingFor}; evidence unresolved`,
            ),
          );
        }, 60000);
      }),
    ]);
  } catch (error) {
    if (expired) await cleanup();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Observe a kernel state, rather than guessing how fast a signal is delivered. */
export async function processState(pid, states, waitingFor, allowGone = false) {
  const { readFile } = await import("node:fs/promises");
  const controller = new AbortController();
  return within(
    (async () => {
      for (;;) {
        try {
          const stat = await readFile(`/proc/${pid}/stat`, {
            encoding: "utf8",
            signal: controller.signal,
          });
          const state = stat.slice(stat.lastIndexOf(")") + 2)[0];
          if (states.includes(state)) return;
        } catch (error) {
          if (allowGone && ["ENOENT", "ESRCH"].includes(error.code)) return;
          throw error;
        }
      }
    })(),
    waitingFor,
    () => controller.abort(),
  );
}

/** Independent of runProcess: discover and kill tagged fixture groups/leaves. */
export function killFixtureGroups(token) {
  const groups = new Set();
  const members = [];
  const ownStat = readFileSync("/proc/self/stat", "utf8");
  const ownGroup = Number(
    ownStat.slice(ownStat.lastIndexOf(")") + 2).split(" ")[2],
  );
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const env = readFileSync(`/proc/${entry}/environ`, "utf8");
      if (!env.split("\0").includes(`PYM_TEST_PROCESS_OWNER=${token}`))
        continue;
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const group = Number(fields[2]);
      members.push(Number(entry));
      if (group !== ownGroup) groups.add(group);
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  // Never 0, 1 or a negative number: kill(0) is this process's own group.
  for (const pid of members.filter(isProcessId)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  for (const group of [...groups].filter(isProcessId)) {
    try {
      process.kill(-group, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
}
