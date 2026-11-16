// SPDX-License-Identifier: MIT
import { z } from "zod";

// Recovery is authoring state, never an acknowledgement of source correctness.
export const implementationDraftSchema = z
  .object({
    planId: z.string().min(1).max(4096),
    planName: z.string().max(4096),
    planHash: z.string().max(128),
    planRevision: z.string().max(256),
    codeRevision: z.string().max(256),
    observationId: z.string().max(256),
    nodeId: z.string().max(4096),
    note: z.string().max(2000),
  })
  .strict();
export const implementationDraftsSchema = z
  .array(implementationDraftSchema)
  .max(100)
  .refine(
    (items) => new Set(items.map((item) => item.planId)).size === items.length,
    "Duplicate link draft",
  );
export type ImplementationDraft = z.infer<typeof implementationDraftSchema>;
