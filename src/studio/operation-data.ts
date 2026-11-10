import { z } from "zod";
const originList = z
  .array(z.number().int().nonnegative().max(19).nullable())
  .max(20);
export const operationOriginsSchema = z
  .object({ requires: originList, ensures: originList, costs: originList })
  .strict();
export const operationContractSchema = z
  .object({
    requires: z.array(z.string().max(1000)).max(20),
    ensures: z.array(z.string().max(1000)).max(20),
    costs: z
      .array(
        z
          .object({
            metric: z.string().max(120),
            quality: z.enum(["exact", "upper"]),
            expression: z.string().max(1000),
          })
          .strict(),
      )
      .max(20),
    budgets: z
      .array(
        z
          .object({
            metric: z.string().max(120),
            expression: z.string().max(1000),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    bounds: z
      .array(
        z
          .object({
            parameter: z.string().max(120),
            maximum: z.string().max(120),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    origins: operationOriginsSchema.optional(),
  })
  .strict();
export type OperationContract = z.infer<typeof operationContractSchema>;

export const operationDescriptionSchema = z.object({
  schema: z.literal("pymtheg.operation-contract/v1"),
  kind: z.enum(["op", "flow"]).default("op"),
  parameters: z.array(z.string()).default([]),
  symbolId: z.string(),
  file: z.string(),
  name: z.string(),
  snapshotId: z.string(),
  sourceHash: z.string(),
  declarationHash: z.string(),
  declarationText: z.string().max(2 * 1024 * 1024),
  definition: operationContractSchema.nullable(),
  origins: operationOriginsSchema.optional(),
  unsupported: z.string().nullable(),
});
export type OperationDescription = z.infer<typeof operationDescriptionSchema>;
export const operationDraftSchema = z
  .object({
    file: z.string().min(1).max(4096),
    name: z.string().min(1).max(120),
    baseline: operationDescriptionSchema,
    edit: operationContractSchema,
  })
  .strict()
  .refine(
    (d) => d.name === d.baseline.name,
    "Keep the original operation identity",
  );
export type OperationDraft = z.infer<typeof operationDraftSchema>;
