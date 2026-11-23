// SPDX-License-Identifier: MIT
/**
 * The process groups this server has started, in memory shared by the main
 * thread and its worker threads (C-43 review). `runProcess` starts every
 * child as the leader of its own process group and records the group here
 * as soon as it has a pid, and removes it once the group is killed. The
 * server, which owns the memory, can kill every recorded group itself: when
 * a job is cancelled and its worker is terminated (the worker's own abort
 * and cleanup never run), and when the server exits. That does not depend
 * on the worker cooperating.
 *
 * A worker uses the server's registry when it is given one
 * (`useChildGroups(workerData.childGroups)`); the main thread has its own.
 * A process killed with SIGKILL runs no code, so its children are not
 * killed by this; the next run's stale-run sweep removes their folders.
 */
import { isMainThread } from "node:worker_threads";

/** Slots for live process groups; children run one or a few at a time. */
export const CHILD_GROUP_SLOTS = 256;

export const createChildGroups = (): SharedArrayBuffer =>
  new SharedArrayBuffer(CHILD_GROUP_SLOTS * Int32Array.BYTES_PER_ELEMENT);

let groups: Int32Array | undefined = isMainThread
  ? new Int32Array(createChildGroups())
  : undefined;
let exitHook = false;

/** The registry this thread records its children in (the server's, in a worker). */
export function useChildGroups(buffer: SharedArrayBuffer | undefined): void {
  if (buffer) groups = new Int32Array(buffer);
}

/** This thread's registry, to hand to a worker it starts. */
export function childGroupsBuffer(): SharedArrayBuffer | undefined {
  return groups?.buffer as SharedArrayBuffer | undefined;
}

/**
 * Records a started group; returns its slot, or -1 when the registry is
 * full (the child then runs untracked by the server, as before C-43's
 * review; the worker's own abort still kills it).
 */
export function recordChildGroup(pid: number): number {
  if (!groups || !(pid > 0)) return -1;
  if (isMainThread && !exitHook) {
    exitHook = true;
    process.once("exit", () => killChildGroups());
  }
  for (let slot = 0; slot < groups.length; slot++)
    if (Atomics.compareExchange(groups, slot, 0, pid) === 0) return slot;
  return -1;
}

/** Forgets a group after it was killed (only if the slot still holds it). */
export function forgetChildGroup(slot: number, pid: number): void {
  if (groups && slot >= 0) Atomics.compareExchange(groups, slot, pid, 0);
}

/** The recorded groups still live in `buffer` (default: this thread's). */
export function liveChildGroups(buffer?: SharedArrayBuffer): number[] {
  const view = buffer ? new Int32Array(buffer) : groups;
  if (!view) return [];
  const out: number[] = [];
  for (let slot = 0; slot < view.length; slot++) {
    const pid = Atomics.load(view, slot);
    if (pid) out.push(pid);
  }
  return out;
}

/**
 * Sends SIGKILL to every recorded group in `buffer` (default: this
 * thread's) and forgets it. Returns the number of groups signalled.
 */
export function killChildGroups(buffer?: SharedArrayBuffer): number {
  const view = buffer ? new Int32Array(buffer) : groups;
  if (!view) return 0;
  let killed = 0;
  for (let slot = 0; slot < view.length; slot++) {
    const pid = Atomics.load(view, slot);
    if (!pid) continue;
    try {
      process.kill(-pid, "SIGKILL");
      killed++;
    } catch {
      /* already gone */
    }
    Atomics.compareExchange(view, slot, pid, 0);
  }
  return killed;
}
