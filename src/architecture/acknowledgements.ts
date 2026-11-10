import { compareText } from "../shared/order.js";
import { z } from "zod";
const metadata = z
  .object({
    reviewer: z.string().max(200).optional(),
    reason: z.string().max(4000).optional(),
    created: z.string().max(80).optional(),
  })
  .strict();
const acknowledgementShape = metadata.extend({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  against: z.string().regex(/^[a-f0-9]{64}$/),
  withdrawal: metadata.optional(),
  additionalWithdrawals: z.array(metadata).max(9999).optional(),
  compatibilityOnly: z.boolean().optional(),
});
export const acknowledgementSchema = acknowledgementShape.superRefine(
  (record, ctx) => {
    if (record.additionalWithdrawals?.length && !record.withdrawal)
      ctx.addIssue({
        code: "custom",
        message: "Additional withdrawal records require the first withdrawal",
      });
  },
);
export type Acknowledgement = z.infer<typeof acknowledgementSchema>;
export function withdrawalEvents(record: Acknowledgement) {
  return record.withdrawal
    ? [record.withdrawal, ...(record.additionalWithdrawals ?? [])]
    : [];
}
export const withdrawalPageSchema = z
  .object({
    items: z.array(metadata).max(50),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();
/** Withdrawals merge monotonically; re-reviewing creates a new acknowledgement ID. */
export function mergeAcknowledgement(
  before: Acknowledgement,
  after: Acknowledgement,
): Acknowledgement {
  const base = (a: Acknowledgement) =>
    JSON.stringify([
      a.id,
      a.against,
      a.reviewer ?? null,
      a.reason ?? null,
      a.created ?? null,
    ]);
  if (base(before) !== base(after))
    throw Error("Conflicting branch acknowledgement identity");
  const withdrawals = new Map<string, z.infer<typeof metadata>>();
  for (const entry of [
    ...withdrawalEvents(before),
    ...withdrawalEvents(after),
  ]) {
    const key = JSON.stringify([
      entry.reviewer ?? null,
      entry.reason ?? null,
      entry.created ?? null,
    ]);
    withdrawals.set(key, entry);
  }
  const ordered = [...withdrawals]
    .sort(([a], [b]) => compareText(a, b))
    .map(([, entry]) => entry);
  const {
    withdrawal: _old,
    additionalWithdrawals: _extra,
    ...original
  } = before;
  return acknowledgementSchema.parse({
    ...original,
    ...(before.compatibilityOnly || after.compatibilityOnly
      ? { compatibilityOnly: true }
      : {}),
    ...(ordered.length
      ? {
          withdrawal: ordered[0],
          ...(ordered.length > 1
            ? { additionalWithdrawals: ordered.slice(1) }
            : {}),
        }
      : {}),
  });
}

export const acknowledgementPageSchema = z
  .object({
    items: z.array(
      acknowledgementShape
        .omit({ additionalWithdrawals: true })
        .extend({ withdrawalCount: z.number().int().nonnegative().optional() }),
    ),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();
