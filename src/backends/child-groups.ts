// SPDX-License-Identifier: MIT
/**
 * The process groups this process has started, in memory shared by the main
 * thread and its worker threads (C-54). `runProcess` starts every child as
 * the leader of its own process group and records the group here as soon as
 * it has a pid, and forgets it once the group is killed. The owner of the
 * memory can kill every recorded group itself: when a job is cancelled and
 * its worker is terminated (the worker's own abort and clean-up never run),
 * and when the process exits. That does not depend on the worker
 * cooperating.
 *
 * - The main thread has its own registry, killed when the process exits.
 * - A job manager gives each job a registry of its own (`jobChildGroups`),
 *   passes it to the job's worker, which records into it
 *   (`useChildGroups(workerData.childGroups)`), and kills it when the job
 *   ends or is cancelled, and when the process exits.
 * - A full registry refuses to start a child (`runProcess` reports it), so
 *   no child runs untracked.
 *
 * Limits. A process that dies without running JavaScript (SIGKILL, a crash,
 * a signal Node does not turn into an exit) kills nothing it started: the
 * children are in their own process groups, so a signal to the parent's
 * group does not reach them, and they run until they end on their own. The
 * CLI turns SIGINT, SIGTERM and SIGHUP into an orderly exit. On Windows
 * there are no process groups: the recorded process itself is killed, and
 * its own children are not.
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
/** Every job registry of this process, killed when it exits. */
const jobRegistries = new Set<SharedArrayBuffer>();
function hookExit(): void {
  if (exitHook) return;
  exitHook = true;
  process.once("exit", () => {
    killChildGroups(groups?.buffer as SharedArrayBuffer | undefined);
    for (const registry of jobRegistries) killChildGroups(registry);
  });
}

/** The registry this thread records its children in (a job's, in a worker). */
export function useChildGroups(buffer: SharedArrayBuffer | undefined): void {
  if (buffer) groups = new Int32Array(buffer);
}

/** This thread's registry. */
export function childGroupsBuffer(): SharedArrayBuffer | undefined {
  return groups?.buffer as SharedArrayBuffer | undefined;
}

/**
 * A new registry for one job's worker, killed when this process exits.
 * `releaseJobChildGroups` kills what it still holds and forgets it.
 */
export function jobChildGroups(): SharedArrayBuffer {
  const buffer = createChildGroups();
  jobRegistries.add(buffer);
  hookExit();
  return buffer;
}
export function releaseJobChildGroups(buffer: SharedArrayBuffer): void {
  killChildGroups(buffer);
  jobRegistries.delete(buffer);
}

/**
 * Records a started group; returns its slot, `-1` when this thread has no
 * registry (a worker given none), or `"full"` when every slot is taken.
 */
export function recordChildGroup(pid: number): number | "full" {
  if (!groups || !(pid > 0)) return -1;
  if (isMainThread) hookExit();
  for (let slot = 0; slot < groups.length; slot++)
    if (Atomics.compareExchange(groups, slot, 0, pid) === 0) return slot;
  return "full";
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

/** SIGKILL to a process group (to the process itself on Windows). */
/**
 * Whether `pid` can name one other process or process group: an integer
 * above 1. `process.kill(-0)` is `kill(0)`, which signals the caller's own
 * process group, `-1` signals every process the caller may signal, and 1 is
 * init; a pid read from a file that is still empty is `Number("")`, 0.
 */
export function isProcessId(pid: unknown): pid is number {
  return Number.isInteger(pid) && (pid as number) > 1;
}

export function killGroup(pid: number): boolean {
  // C-50 review: never the caller's own group (see isProcessId).
  if (!isProcessId(pid)) return false;
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
    return true;
  } catch {
    return false; // already gone
  }
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
    if (killGroup(pid)) killed++;
    Atomics.compareExchange(view, slot, pid, 0);
  }
  return killed;
}
