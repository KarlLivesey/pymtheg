// SPDX-License-Identifier: MIT
/**
 * Observation counters for one graph index (C-22): how much work each stage
 * did, counted deterministically, plus each stage's wall and CPU time. Nothing
 * reads them to decide anything; they exist so a re-index can be measured by
 * operation counts instead of by timings on a shared machine.
 */
export interface StageTime {
  wallMs: number;
  cpuMs: number;
  calls: number;
}
export const graphWork = {
  counts: {} as Record<string, number>,
  stages: {} as Record<string, StageTime>,
};

/** Adds `amount` to the named counter. */
export function count(name: string, amount = 1): void {
  graphWork.counts[name] = (graphWork.counts[name] ?? 0) + amount;
}

/** Clears every counter and stage time. */
export function resetGraphWork(): void {
  graphWork.counts = {};
  graphWork.stages = {};
}

/**
 * Runs `action` and adds its wall and process CPU time to the named stage.
 * CPU time is the whole process's, so worker threads count to the stage that
 * waited on them.
 */
export async function stage<T>(
  name: string,
  action: () => T | Promise<T>,
): Promise<T> {
  const wall = performance.now();
  const cpu = process.cpuUsage();
  try {
    return await action();
  } finally {
    const used = process.cpuUsage(cpu);
    const entry = (graphWork.stages[name] ??= {
      wallMs: 0,
      cpuMs: 0,
      calls: 0,
    });
    entry.wallMs += performance.now() - wall;
    entry.cpuMs += (used.user + used.system) / 1000;
    entry.calls++;
  }
}
