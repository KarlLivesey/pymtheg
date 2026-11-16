// SPDX-License-Identifier: MIT
import type { ProjectIR } from "../semantic/core.js";
import { validateInterfaceType } from "./interface-builder.js";
import { describeTypeDefinition } from "./signature.js";
import { typeAuthoring, rewriteTypeText } from "./type-authoring.js";
import { sourceEditPreview } from "./source-edit.js";

/** Standalone data-shape authoring uses the same source and reference policies as interface edits. */
export function rewriteType(
  ir: ProjectIR,
  symbolId: string,
  value: unknown,
  expectedSourceHash: string,
) {
  const original = describeTypeDefinition(ir, symbolId);
  const declaration = ir.symbols.get(symbolId)!;
  if (declaration.kind !== "type" || !original.definition)
    throw Error(
      original.unsupported ?? "Choose an editable record or outcome type.",
    );
  const source = ir.snapshot.sources.find(
    (source) => source.file === declaration.span.file,
  )!;
  if (source.hash !== expectedSourceHash)
    throw Error(
      "This type belongs to a different source snapshot. Check the current edit before applying it.",
    );
  validateInterfaceType(value);
  if (
    typeof value === "string" ||
    (value.kind !== "record" && value.kind !== "choice") ||
    value.name !== declaration.name
  )
    throw Error(
      "Keep the shared type name; renaming requires reviewing every reference.",
    );
  if (JSON.stringify(value) === JSON.stringify(original.definition))
    return sourceEditPreview(ir, source.file, [], []);
  const writer = typeAuthoring(ir, source.file);
  const definition = writer.definitionSource(value);
  const rewritten = rewriteTypeText(source.text, declaration, definition);
  const prefix = [...writer.newDefinitions.values()]
    .map((item) => item.source + "\n")
    .join("");
  const edit = {
    span: rewritten.span,
    before: source.text.slice(rewritten.span.start, rewritten.span.end),
    text: prefix + rewritten.text,
  };
  return sourceEditPreview(
    ir,
    source.file,
    [edit],
    [symbolId],
    rewritten.notices,
  );
}
