// SPDX-License-Identifier: MIT
import { z } from "zod";
export const workspaceSchema = z
  .object({
    schema: z.literal("pymtheg.workspace/v1"),
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    created: z.string().datetime(),
  })
  .strict();
export type WorkspaceIdentity = z.infer<typeof workspaceSchema>;
