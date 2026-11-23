// SPDX-License-Identifier: MIT
/**
 * C-50: a language module's synchronous work after an await.
 *
 * `executeGraph` announces a module call to `onModuleCall`: `true` while the
 * call's own synchronous code runs, `"awaiting"` while its promise is
 * awaited, `false` once it settles. While awaited, a module may still run
 * long synchronous code between its awaits (Go's project-wide link notes
 * after the toolchain's facts arrive; its parse after the parser loads).
 * During that code no cancellation checkpoint is passed and the event loop
 * does not turn, so a caller that cancels cooperatively would wait for it.
 *
 * A module wraps such a stretch in `synchronousStretch`: it is announced as
 * inside the module call (`true`) and, when it ends, as awaited again. The
 * announcement may throw to refuse the stretch (a cancellation already set).
 * Outside a module call, or with no listener, it simply runs.
 */
type Listener = (inside: boolean | "awaiting") => void;

let listener: Listener | undefined;

/** Installs the listener for an awaited module call; returns its removal. */
export function awaitingModuleCall(next: Listener | undefined): () => void {
  const previous = listener;
  listener = next;
  return () => {
    listener = previous;
  };
}

/** Runs `run`, a module's synchronous stretch, as inside the module call. */
export function synchronousStretch<T>(run: () => T): T {
  const current = listener;
  if (!current) return run();
  current(true);
  try {
    return run();
  } finally {
    current("awaiting");
  }
}
