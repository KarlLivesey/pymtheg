import { z } from "zod";
import { numericRangeSchema } from "./range-data.js";

const range = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export type BlockRange = z.infer<typeof range>;
const callResultSchema = z.object({
  binding: z.string(),
  hasOutcomeStep: z.boolean(),
  propagate: z.boolean(),
  canReturn: z.boolean(),
  canDecide: z.boolean(),
  outcomes: z.array(z.object({ tag: z.string(), payload: z.boolean() })),
  outcomeCount: z.number(),
});
const lifecycleSchema = z.object({
  states: z.array(z.string()),
  initial: z.string(),
  terminal: z.array(z.string()),
  transitions: z.array(z.object({ from: z.string(), to: z.string() })),
  stateCount: z.number().int().nonnegative(),
  terminalCount: z.number().int().nonnegative(),
  transitionCount: z.number().int().nonnegative(),
});
const resourceChoiceSchema = z.object({
  name: z.string(),
  resource: z.string(),
  states: z.array(z.string()),
  stateCount: z.number().int().nonnegative(),
});
export interface BlockField {
  id: string;
  label: string;
  span: BlockRange;
  format: "expression" | "text";
  help: string;
  choices?: string[] | undefined;
  placeholder?: string | undefined;
  placeholderSource?: string | undefined;
  suggestions?: string[] | undefined;
  suggestionsComplete?: boolean | undefined;
}
export interface BlockSection {
  id: string;
  label: string;
  span: BlockRange;
  blocks: DesignBlock[];
  resources: z.infer<typeof resourceChoiceSchema>[];
  resourceCount: number;
}
export interface DesignBlock {
  id: string;
  kind: string;
  title: string;
  span: BlockRange;
  fields: BlockField[];
  sections: BlockSection[];
  summary: string;
  symbolId?: string | undefined;
  callResult?: z.infer<typeof callResultSchema> | undefined;
  lifecycle?: z.infer<typeof lifecycleSchema> | undefined;
  numericRange?: z.infer<typeof numericRangeSchema> | undefined;
  canAddCancellation?: boolean | undefined;
  children?: DesignBlock[] | undefined;
}
const field = z.object({
  id: z.string(),
  label: z.string(),
  span: range,
  format: z.enum(["expression", "text"]),
  help: z.string(),
  choices: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  placeholderSource: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
  suggestionsComplete: z.boolean().optional(),
});
const block: z.ZodType<DesignBlock> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.string(),
    title: z.string(),
    span: range,
    fields: z.array(field),
    sections: z.array(section),
    summary: z.string(),
    symbolId: z.string().optional(),
    callResult: callResultSchema.optional(),
    lifecycle: lifecycleSchema.optional(),
    numericRange: numericRangeSchema.optional(),
    canAddCancellation: z.boolean().optional(),
    children: z.array(block).optional(),
  }),
);
const section: z.ZodType<BlockSection> = z.lazy(() =>
  z.object({
    id: z.string(),
    label: z.string(),
    span: range,
    blocks: z.array(block),
    resources: z.array(resourceChoiceSchema),
    resourceCount: z.number().int().nonnegative(),
  }),
);
export const blockDocumentSchema = z.object({
  snapshotId: z.string(),
  file: z.string(),
  text: z.string(),
  parsed: z.boolean(),
  truncated: z.boolean(),
  blocks: z.array(block),
  calls: z.array(
    z.object({
      name: z.string(),
      params: z.array(
        z.object({
          name: z.string(),
          mode: z.enum(["value", "take", "borrow"]),
        }),
      ),
      returnsUnit: z.boolean(),
    }),
  ),
  resourceTypes: z.array(z.object({ name: z.string(), initial: z.string() })),
  resourceTypeCount: z.number().int().nonnegative(),
});
export type BlockDocument = z.infer<typeof blockDocumentSchema>;
export interface BlockEdit {
  span: BlockRange;
  expected: string;
  insert: string;
}
export function applyBlockEdit(text: string, edit: BlockEdit): string {
  const { start, end } = edit.span;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end > text.length ||
    text.slice(start, end) !== edit.expected
  )
    throw Error(
      "The source changed. Check the current text before editing this block.",
    );
  return text.slice(0, start) + edit.insert + text.slice(end);
}
/** Maps only a field replacement, never an arbitrary structural edit. */
export function replaceBlockField(
  document: BlockDocument,
  field: BlockField,
  value: string,
): BlockDocument {
  // React callbacks may still hold a field from before another local edit.
  // The current projection owns its range; callers only supply its identity.
  const find = (blocks: DesignBlock[]): BlockField | undefined => {
    for (const block of blocks) {
      const found = block.fields.find((candidate) => candidate.id === field.id);
      if (found) return found;
      for (const section of block.sections) {
        const nested = find(section.blocks);
        if (nested) return nested;
      }
      const child = find(block.children ?? []);
      if (child) return child;
    }
    return undefined;
  };
  const current = find(document.blocks);
  if (!current)
    throw Error("This field is no longer available. Check the current source.");
  field = current;
  const insert =
    field.format === "text"
      ? JSON.stringify(value)
      : !value.trim() && field.placeholderSource !== undefined
        ? field.placeholderSource
        : value;
  const { start, end } = field.span;
  const text = applyBlockEdit(document.text, {
    span: field.span,
    expected: document.text.slice(start, end),
    insert,
  });
  const delta = insert.length - (end - start);
  function map(span: BlockRange): BlockRange {
    if (span.start === start && span.end === end)
      return { start, end: start + insert.length };
    if (span.end <= start) return span;
    if (span.start >= end)
      return { start: span.start + delta, end: span.end + delta };
    if (span.start <= start && span.end >= end)
      return { start: span.start, end: span.end + delta };
    throw Error(
      "This edit overlaps another field. Check the source before continuing.",
    );
  }
  const visit = (b: DesignBlock): DesignBlock => ({
    ...b,
    span: map(b.span),
    // A field inside this state invalidates its captured hash until rechecked.
    numericRange:
      b.numericRange && !(start < b.span.end && end > b.span.start)
        ? {
            ...b.numericRange,
            minSpan: map(b.numericRange.minSpan),
            maxSpan: map(b.numericRange.maxSpan),
          }
        : undefined,
    fields: b.fields.map((f) => ({ ...f, span: map(f.span) })),
    sections: b.sections.map((s) => ({
      ...s,
      span: map(s.span),
      blocks: s.blocks.map(visit),
    })),
    ...(b.children ? { children: b.children.map(visit) } : {}),
  });
  return { ...document, text, blocks: document.blocks.map(visit) };
}
export function insertBlock(
  text: string,
  section: BlockSection,
  source: string,
): string {
  if (text[section.span.start] !== "{" || text[section.span.end - 1] !== "}")
    throw Error("Check the current source before adding a step.");
  const last = section.blocks.at(-1);
  if (last && (last.kind === "return" || last.kind === "propagate")) {
    // Keep leading notes with the exit, matching the block reordering policy.
    const at = section.blocks.at(-2)?.span.end ?? section.span.start + 1;
    const line = text.lastIndexOf("\n", last.span.start - 1) + 1;
    const indent =
      /^[ \t]*/.exec(text.slice(line, last.span.start))?.[0] || "  ";
    return applyBlockEdit(text, {
      span: { start: at, end: at },
      expected: "",
      insert:
        "\n" +
        source
          .split("\n")
          .map((s) => indent + s)
          .join("\n") +
        "\n",
    });
  }
  const close = section.span.end - 1;
  const lineStart = text.lastIndexOf("\n", close - 1) + 1;
  const closingIndent = text.slice(lineStart, close);
  const standalone = /^\s*$/.test(closingIndent);
  const indent = standalone ? closingIndent : "";
  const at = standalone ? lineStart : close;
  const insert =
    (standalone ? "" : "\n") +
    source
      .split("\n")
      .map((line) => indent + "  " + line)
      .join("\n") +
    "\n" +
    (standalone ? "" : indent);
  return applyBlockEdit(text, {
    span: { start: at, end: at },
    expected: "",
    insert,
  });
}
/** Leading notes travel with the following step; final notes stay in the section. */
export function moveBlock(
  text: string,
  section: BlockSection,
  index: number,
  direction: -1 | 1,
): string {
  const other = index + direction;
  if (other < 0 || other >= section.blocks.length)
    throw Error("This step cannot move further.");
  const first = Math.min(index, other),
    a = section.blocks[first]!,
    b = section.blocks[first + 1]!;
  const start =
    first === 0 ? section.span.start + 1 : section.blocks[first - 1]!.span.end;
  const left = text.slice(start, a.span.end),
    right = text.slice(a.span.end, b.span.end);
  return applyBlockEdit(text, {
    span: { start, end: b.span.end },
    expected: left + right,
    insert: right + left,
  });
}

/** Adds a user-selected outcome action without changing the existing steps. */
export function appendCallOutcome(
  document: BlockDocument,
  block: DesignBlock,
  action: "handle" | "return" | "decide",
): string {
  const result = block.callResult;
  if (!result) throw Error("Check this call before adding its outcome steps.");
  if (result.hasOutcomeStep)
    throw Error(
      "This result already has an outcome step. Edit that step instead.",
    );
  let source: string;
  if (action === "return") {
    if (!result.canReturn)
      throw Error(
        "This result does not match the component output. Edit the output or handle its cases instead.",
      );
    source = `${result.propagate ? "propagate" : "return"} ${result.binding};`;
  } else if (action === "decide") {
    if (!result.canDecide)
      throw Error("Only a yes/no result can be used for this decision.");
    source = `if ${result.binding} {\n  unknown "What happens when yes?";\n} else {\n  unknown "What happens when no?";\n}`;
  } else {
    if (
      !result.outcomes.length ||
      result.outcomes.length !== result.outcomeCount
    )
      throw Error(
        "This outcome set cannot be expanded here. Handle it in the text editor.",
      );
    let payload = "returnedValue",
      suffix = 1;
    while (document.text.includes(payload))
      payload = `returnedValue${suffix++}`;
    source = `match ${result.binding} {\n${result.outcomes.map((outcome) => `  ${outcome.tag}${outcome.payload ? `(${payload})` : ""} => {\n    unknown ${JSON.stringify(`What should happen for ${outcome.tag}?`)};\n  }`).join("\n")}\n}`;
  }
  const line = document.text.lastIndexOf("\n", block.span.start - 1) + 1;
  const indentation =
    /^[ \t]*/.exec(document.text.slice(line, block.span.start))?.[0] || "  ";
  return applyBlockEdit(document.text, {
    span: { start: block.span.end, end: block.span.end },
    expected: "",
    insert:
      "\n" +
      source
        .split("\n")
        .map((s) => indentation + s)
        .join("\n") +
      "\n" +
      indentation,
  });
}

export function addResourceStep(
  document: BlockDocument,
  section: BlockSection,
  resource: string,
  state: string,
): string {
  const choice = section.resources.find((item) => item.name === resource);
  if (!choice || !choice.states.includes(state))
    throw Error(
      "Choose a resource and declared state from this block's current scope.",
    );
  return insertBlock(
    document.text,
    section,
    `transition ${resource} -> ${state};`,
  );
}

export function createResourceStep(
  document: BlockDocument,
  section: BlockSection,
  type: string,
): string {
  if (!document.resourceTypes.some((resource) => resource.name === type))
    throw Error("Choose a declared resource type.");
  const base = `owned${type.split(".").at(-1)}`;
  let name = base,
    suffix = 1;
  while (document.text.includes(name)) name = `${base}${suffix++}`;
  return insertBlock(document.text, section, `own ${name}: ${type};`);
}

export function addCancellation(
  document: BlockDocument,
  block: DesignBlock,
): string {
  if (!block.canAddCancellation)
    throw Error(
      "This component already has cancellation steps, or cannot declare them.",
    );
  return applyBlockEdit(document.text, {
    span: { start: block.span.end, end: block.span.end },
    expected: "",
    insert:
      '\n on cancel {\n  unknown "How are resources settled if cancelled?";\n}',
  });
}
