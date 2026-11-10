import {
  resourceDefinitionSchema,
  type ResourceDefinition,
} from "./declaration-data.js";
import { validateResourceDefinition } from "./resource-definition.js";
import type { ProjectIR } from "../semantic/core.js";
import { formatSource } from "../language/format.js";
import { hash } from "../shared/identity.js";
import { sourceEditPreview } from "./source-edit.js";

/** Shared syntax/validation for resource creation and retained-definition editing. */
export function resourceDefinitionSource(value: unknown): string {
  const item = validateResourceDefinition(value);
  return `resource ${item.name} {\n  states ${item.states.join(", ")};\n  initial ${item.initial};\n  terminal ${item.terminal.join(", ")};\n${item.transitions.map((edge) => `  ${edge.from} -> ${edge.to};\n`).join("")}}\n`;
}
export function describeResourceDefinition(ir: ProjectIR, symbolId: string) {
  const declaration = ir.symbols.get(symbolId);
  if (!declaration || declaration.kind !== "resource")
    throw Error(
      "Choose an existing resource lifecycle from the checked design.",
    );
  const source = ir.snapshot.sources.find(
    (s) => s.file === declaration.span.file,
  )!;
  const metadata = {
    schema: "pymtheg.resource-definition/v1" as const,
    symbolId,
    file: source.file,
    name: declaration.name,
    snapshotId: ir.snapshot.id,
    sourceHash: source.hash,
    declarationHash: hash(
      source.text.slice(declaration.span.start, declaration.span.end),
    ),
  };
  const definition: ResourceDefinition = {
    kind: "resource",
    name: declaration.name,
    states: declaration.states,
    initial: declaration.initial,
    terminal: declaration.terminal,
    transitions: declaration.transitions,
  };
  const parsed = resourceDefinitionSchema.safeParse(definition);
  return parsed.success
    ? { ...metadata, definition: parsed.data, unsupported: null }
    : {
        ...metadata,
        definition: null,
        unsupported:
          "This lifecycle exceeds the form's 40-state or 80-transition limit. Edit its complete definition in Text.",
      };
}
export function rewriteResourceDefinition(
  ir: ProjectIR,
  symbolId: string,
  value: unknown,
  expectedSourceHash: string,
) {
  const description = describeResourceDefinition(ir, symbolId);
  const source = ir.snapshot.sources.find((s) => s.file === description.file)!;
  if (source.hash !== expectedSourceHash)
    throw Error(
      "The resource source changed. Check the current source before previewing.",
    );
  if (source.recovered)
    throw Error(
      "Correct this file's syntax errors before rewriting its resource lifecycle.",
    );
  if (!description.definition) throw Error(description.unsupported!);
  const next = resourceDefinitionSchema.parse(value);
  if (next.name !== description.name)
    throw Error(
      "Resource renaming is not part of lifecycle editing. Keep its existing name.",
    );
  const replacement = formatSource(source.file, resourceDefinitionSource(next));
  if (JSON.stringify(description.definition) === JSON.stringify(next))
    return sourceEditPreview(ir, source.file, [], []);
  const declaration = ir.symbols.get(symbolId)!;
  const trailing =
    /^[ \t]*\/\/[^\r\n]*/.exec(source.text.slice(declaration.span.end))?.[0] ??
    "";
  const span = {
    ...declaration.span,
    end: declaration.span.end + trailing.length,
  };
  const before = source.text.slice(span.start, span.end);
  let line = source.text.slice(0, span.start).split("\n").length;
  let cursor = 0;
  const comments = [...before.matchAll(/\/\/[^\r\n]*/g)].map((match) => {
    line += before.slice(cursor, match.index!).split("\n").length - 1;
    cursor = match.index!;
    return `// Previous ${description.name} comment from line ${line} (review after lifecycle edit):\n${match[0]}`;
  });
  const notices = [
    "Lifecycle changes can invalidate callers and cleanup paths. Apply to the buffer and check the affected components; no uses are silently rewritten.",
  ];
  if (comments.length)
    notices.push(
      `${comments.length} existing lifecycle comments retained with their old line numbers. Review their meaning and placement.`,
    );
  return sourceEditPreview(
    ir,
    source.file,
    [
      {
        span,
        before,
        text:
          (comments.length ? comments.join("\n") + "\n" : "") +
          replacement.trimEnd(),
      },
    ],
    [symbolId],
    notices,
  );
}
