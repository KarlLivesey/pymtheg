import assert from "node:assert/strict";
/** A test owns every deadline; the host's scheduling speed cannot expire it. */
export function controlledClock() {
  let serial = 0;
  const callbacks = new Map();
  return {
    schedule(callback, milliseconds) {
      const id = ++serial;
      callbacks.set(id, { callback, milliseconds });
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
    fireNext() {
      const first = callbacks.entries().next().value;
      assert.ok(first, "Expected a scheduled deadline");
      callbacks.delete(first[0]);
      first[1].callback();
      return first[1].milliseconds;
    },
    get pending() {
      return callbacks.size;
    },
  };
}
