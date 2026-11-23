// SPDX-License-Identifier: MIT
// C-50: the child process groups a worker thread starts, recorded in memory
// the thread that owns the worker can read. A worker that is terminated
// (a cancel inside a module's synchronous code) cannot kill the process
// groups it started: its `finally` blocks never run. So every group is
// registered here the moment it is spawned (runProcess, which starts each
// child in its own group) and released once it has been killed. The owner
// kills whatever is still registered after the worker has stopped, when the
// worker exits, and when its own process exits.
//
// The owner creates the table (`childGroupTable`) and passes it to the
// worker, which adopts it (`adoptChildGroupTable`) before it starts work. A
// thread that adopted none registers nothing: a child it starts is its own
// to end, as before.

/** Groups one worker may have running at once. */
const SLOTS = 256;

/** A new table, for the owner to pass to one worker. */
export function childGroupTable(): SharedArrayBuffer {
  return new SharedArrayBuffer(SLOTS * Int32Array.BYTES_PER_ELEMENT);
}

let adopted: Int32Array | undefined;

/** The worker's side: register into `table` from now on. */
export function adoptChildGroupTable(table: SharedArrayBuffer | undefined) {
  adopted = table ? new Int32Array(table) : undefined;
}

/**
 * Records a started process group (its leader's pid). Returns its release,
 * or undefined when the table is full: the caller must then end the group
 * itself and not run it.
 */
export function registerChildGroup(pid: number): (() => void) | undefined {
  const table = adopted;
  if (!table) return () => {};
  for (let slot = 0; slot < table.length; slot++)
    if (Atomics.compareExchange(table, slot, 0, pid) === 0)
      return () => void Atomics.compareExchange(table, slot, pid, 0);
  return undefined;
}

/**
 * The owner's side: sends SIGKILL to every group still registered in
 * `table` and clears it. Call it only once the worker can no longer start
 * one (after `terminate()` resolves, or on its `exit`). Returns the groups
 * it signalled.
 */
export function killChildGroups(table: SharedArrayBuffer): number[] {
  const slots = new Int32Array(table);
  const killed: number[] = [];
  for (let slot = 0; slot < slots.length; slot++) {
    const pid = Atomics.exchange(slots, slot, 0);
    if (!pid) continue;
    try {
      process.kill(-pid, "SIGKILL");
      killed.push(pid);
    } catch {
      /* the group has already ended */
    }
  }
  return killed;
}
