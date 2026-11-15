import { textPageCharacters } from "../shared/text-pages.js";
/** Session transport/retention bounds; they are not semantic source-domain bounds. */
export const agentLimits = {
  responseBytes: 262144,
  linkJobs: 3,
  linkInlineWaitMs: 5000,
  linkResultBytes: 8 * 1024 * 1024,
  linkResponseBytes: 65536,
  retainedInventories: 3,
  inventoryBytes: 32 * 1024 * 1024,
  retainedEmissions: 8,
  emissionBytes: 32 * 1024 * 1024,
  textPageCharacters,
} as const;
