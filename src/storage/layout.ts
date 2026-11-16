// SPDX-License-Identifier: MIT
/** Project-relative storage names, safe to share with browser clients. */
export const layout = {
  marker: ".pymtheg/project.json",
  settings: ".pymtheg/settings.json",
  planning: ".pymtheg/shared/architecture.sqlite",
  drafts: ".pymtheg/shared/drafts.sqlite",
  graph: ".pymtheg/rebuildable/graph.sqlite",
  runs: ".pymtheg/rebuildable/runs.sqlite",
} as const;
export type StorageItem = keyof typeof layout;
