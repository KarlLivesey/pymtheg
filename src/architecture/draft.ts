import { architectureLimits } from "./limits.js";
import { z } from "zod";
import { planItemSchema } from "./schema.js";
export const architectureDraftSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("plan"),
      target: z
        .object({
          document: z.string(),
          originalId: z.string(),
          itemIndex: z.number().int().nonnegative().optional(),
        })
        .optional(),
      baseRevision: z.string(),
      item: planItemSchema.extend({
        title: z.string().max(240),
        owner: z.string().max(120),
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("document"),
      createOnly: z.boolean().optional(),
      baseRevision: z.string(),
      label: z.string().max(160),
      document: z
        .object({
          path: z.string().max(4096),
          text: z.string().max(architectureLimits.draftBytes),
        })
        .strict(),
    })
    .strict(),
]);
export type ArchitectureDraft = z.infer<typeof architectureDraftSchema>;
export const architectureDraftViewSchema = z
  .object({
    version: z.number().int().nonnegative(),
    draft: architectureDraftSchema.nullable(),
  })
  .strict();
