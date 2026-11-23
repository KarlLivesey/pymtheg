// SPDX-License-Identifier: MIT
/** C-48: the memory a graph worker shares with its parent (see graph-worker.ts). */
export const CONTROL = { cancel: 0, section: 1, checkpoints: 2 } as const;
export const controlLength = 3;
/**
 * Section values: in the graph command itself; inside a module's own call
 * (until it returns, or returns its promise); or awaiting a promise a module
 * (or a toolchain) returned, when the worker's event loop is free.
 */
export const SECTION = { core: 0, module: 1, awaiting: 2 } as const;
