// SPDX-License-Identifier: MIT
import { z } from "zod";
import type { BlockDocument, DesignBlock } from "./block-document.js";
import { validateNumericRange } from "./numeric-range.js";
const span = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export const numericRangeSchema = z.object({
  key: z.string(),
  label: z.string(),
  hash: z.string(),
  type: z.enum(["Nat", "Int"]),
  initialValue: z.string().optional(),
  min: z.string(),
  max: z.string(),
  minSpan: span,
  maxSpan: span,
});
export type NumericRange = z.infer<typeof numericRangeSchema>;
export const rangeDraftSchema = z
  .object({
    file: z.string().min(1).max(4096),
    key: z.string().min(1).max(1024),
    label: z.string().max(1024),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    originalMin: z.string().max(4096),
    originalMax: z.string().max(4096),
    min: z.string().max(4096),
    max: z.string().max(4096),
  })
  .strict();
export const rangeDraftsSchema = z.array(rangeDraftSchema).max(32);
export type RangeDraft = z.infer<typeof rangeDraftSchema>;
export function beginRangeDraft(file: string, range: NumericRange): RangeDraft {
  return {
    file,
    key: range.key,
    label: range.label,
    hash: range.hash,
    originalMin: range.min,
    originalMax: range.max,
    min: range.min.replace(/\s/g, ""),
    max: range.max.replace(/\s/g, ""),
  };
}
export function rangesIn(document: BlockDocument): NumericRange[] {
  const ranges: NumericRange[] = [];
  const visit = (blocks: DesignBlock[]) => {
    for (const b of blocks) {
      if (b.numericRange) ranges.push(b.numericRange);
      visit(b.children ?? []);
      for (const section of b.sections) visit(section.blocks);
    }
  };
  visit(document.blocks);
  return ranges;
}
export function rangeDraftMatches(
  draft: RangeDraft,
  range: NumericRange,
): boolean {
  return (
    draft.key === range.key &&
    draft.hash === range.hash &&
    draft.originalMin === range.min &&
    draft.originalMax === range.max
  );
}
/** One buffer transaction. Neither bound is written before both are validated. */
export function applyRangeDraft(
  document: BlockDocument,
  draft: RangeDraft,
): string {
  const matches = rangesIn(document).filter((r) => r.key === draft.key);
  const range = matches[0];
  if (
    !document.parsed ||
    matches.length !== 1 ||
    !range ||
    !rangeDraftMatches(draft, range)
  )
    throw Error(
      "This state changed or is no longer available. Review its current range, then explicitly restart the range edit.",
    );
  const { min, max } = validateNumericRange(
    draft.min,
    draft.max,
    range.type,
    draft.label,
  );
  const edits = [
    {
      span: range.minSpan,
      before: range.min,
      after:
        min === BigInt(range.min.replace(/\s/g, "")) ? range.min : String(min),
    },
    {
      span: range.maxSpan,
      before: range.max,
      after:
        max === BigInt(range.max.replace(/\s/g, "")) ? range.max : String(max),
    },
  ].sort((a, b) => b.span.start - a.span.start);
  if (edits[1]!.span.end > edits[0]!.span.start)
    throw Error("Range bounds overlap. Check the source before continuing.");
  let text = document.text;
  for (const { span, before, after } of edits) {
    if (span.end < span.start || text.slice(span.start, span.end) !== before)
      throw Error("The source changed. Check it before applying this range.");
    text = text.slice(0, span.start) + after + text.slice(span.end);
  }
  return text;
}
