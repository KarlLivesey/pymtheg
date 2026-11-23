// SPDX-License-Identifier: MIT
/** C-48: the memory a graph worker shares with its parent (see graph-worker.ts). */
export const CONTROL = { cancel: 0, section: 1, checkpoints: 2 } as const;
export const controlLength = 3;
/**
 * Section values: in the graph command itself; inside a module's own call
 * (until it returns, or returns its promise), or in a synchronous stretch
 * the module marks after an await (`synchronousStretch`, src/graph/
 * sections.ts: Go's notes pass after the toolchain facts, and its parse
 * after the parser loads); or awaiting a promise a module (or a toolchain)
 * returned. While awaiting, a module may still run unmarked synchronous code
 * between its awaits; a cancel then waits for its next await or for the
 * promise to settle, at most CANCEL_GRACE_MS (graph-jobs.ts).
 */
export const SECTION = { core: 0, module: 1, awaiting: 2 } as const;
