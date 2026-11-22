// SPDX-License-Identifier: MIT
/** C-48: the memory a graph worker shares with its parent (see graph-worker.ts). */
export const CONTROL = { cancel: 0, section: 1, checkpoints: 2 } as const;
export const controlLength = 3;
/** Section values: in the graph command itself, or inside a module's call. */
export const SECTION = { core: 0, module: 1 } as const;
