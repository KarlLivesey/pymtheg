import { z } from "zod";
export const declarationTypeQuerySchema = z
  .object({
    inventoryId: z.string().optional(),
    refresh: z.boolean().default(false),
    directory: z.string().max(4096).default("."),
    query: z.string().max(256).default(""),
    kind: z.enum(["all", "record", "choice", "resource"]).default("all"),
    offset: z.number().int().nonnegative().default(0),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
export const declarationTypeItemSchema = z.object({
  name: z.string(),
  symbolId: z.string(),
  file: z.string(),
  sourceHash: z.string(),
  kind: z.enum(["record", "choice", "resource"]),
  status: z.enum(["candidate", "syntax-incomplete", "duplicate"]),
});
export const declarationTypeInventorySchema = z.object({
  id: z.string(),
  items: z.array(declarationTypeItemSchema),
  complete: z.boolean(),
  warnings: z.array(z.string()),
  parsedFiles: z.number(),
  bytes: z.number(),
  meaning: z.string(),
});
export type DeclarationTypeInventory = z.infer<
  typeof declarationTypeInventorySchema
>;
export const declarationTypePageSchema = declarationTypeInventorySchema
  .omit({ id: true })
  .extend({
    inventoryId: z.string(),
    total: z.number(),
    offset: z.number(),
    nextOffset: z.number().nullable(),
  });
