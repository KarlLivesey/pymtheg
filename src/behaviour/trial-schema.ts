// SPDX-License-Identifier: MIT
import { z } from "zod";
const spanSchema = z
  .object({
    file: z.string(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .strict();
export const trialSchema = z
  .object({
    schema: z.literal("pymtheg.trial/v1"),
    snapshotId: z.string(),
    completion: z.enum([
      "complete",
      "unsupported",
      "violated",
      "limited",
      "cancelled",
    ]),
    steps: z.number().int().nonnegative(),
    output: z.unknown(),
    message: z.string(),
    assumptions: z.array(z.string()),
    violation: z
      .object({
        code: z.string(),
        message: z.string(),
        span: spanSchema,
        condition: spanSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type TrialResult = z.infer<typeof trialSchema>;
