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
