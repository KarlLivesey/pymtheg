// SPDX-License-Identifier: MIT
import { z } from "zod";
import { workspaceSchema } from "./workspace.js";
import { importPreviewSchema } from "../architecture/schema.js";
export const projectSetupSchema = z.object({
  root: z.string(),
  workspace: workspaceSchema,
  created: z.boolean(),
  filesCreated: z.array(z.string()),
  /** D22: the trust that applies on this machine, and whether this call recorded it. */
  trust: z.enum(["trusted", "source-only", "unanswered"]).optional(),
  trustRecorded: z.boolean().optional(),
  documentation: z.object({
    status: z.enum([
      "none",
      "preview",
      "imported",
      "unchanged",
      "needs_review",
      "unavailable",
    ]),
    committed: z.boolean(),
    previewToken: z.string().optional(),
    review: importPreviewSchema.optional(),
    total: z.number().int().nonnegative().optional(),
    files: z.array(z.string()).max(100).optional(),
    filesTruncated: z.boolean().optional(),
    message: z.string().optional(),
    warnings: z.array(z.string()).optional(),
    changes: importPreviewSchema.shape.summary.optional(),
    revision: z.string().optional(),
  }),
});
export type ProjectSetup = z.infer<typeof projectSetupSchema>;
