import type { ProjectIR, Type } from "../semantic/core.js";
import { callable } from "../semantic/core.js";
import { nodeKey } from "../language/ast.js";
import type { Span } from "../shared/identity.js";
import { hash } from "../shared/identity.js";
import { signatureParts } from "./signature-source.js";
import { typeAuthoring, rewriteTypeText } from "./type-authoring.js";
import { sourceEditPreview } from "./source-edit.js";
import {
  validateInterfaceType,
  type InterfaceType,
} from "./interface-builder.js";
import type {
  SignatureEdit,
  SignatureDescription,
  TypeDefinitionDescription,
  InterfaceDraft,
} from "./interface-data.js";
export type { SignatureEdit, SignatureDescription } from "./interface-data.js";
function describeType(ir: ProjectIR, type: Type | undefined): InterfaceType {
  if (!type || type.kind === "error")
    throw Error(
      "This signature has an unresolved type. Check and resolve it before editing its interface.",
    );
  switch (type.kind) {
    case "primitive":
      return type.name;
    case "list":
      return { kind: "list", element: describeType(ir, type.element) };
    case "result":
      return {
        kind: "result",
        ok: describeType(ir, type.ok),
        error: describeType(ir, type.error),
      };
    case "nominal": {
      const declaration = ir.symbols.get(type.id);
      if (!declaration)
        throw Error("The signature refers to a missing declaration.");
      return {
        kind: "named",
        name: declaration.name,
        symbolId: declaration.id,
      };
    }
  }
}
export function describeInterfaceTypes(
  ir: ProjectIR,
  file: string,
): SignatureDescription["types"] {
  return [...(ir.visibleSymbols.get(file)?.values() ?? [])].flatMap((ids) => {
    if (ids.length !== 1) return [];
    const d = ir.symbols.get(ids[0]!)!;
    if (d.kind !== "type" && d.kind !== "resource") return [];
    return [
      {
        name: d.name,
        symbolId: d.id,
        file: d.span.file,
        kind:
          d.kind === "resource"
            ? ("resource" as const)
            : d.fields === null
              ? ("choice" as const)
              : ("record" as const),
      },
    ];
  });
}
export function describeTypeDefinition(
  ir: ProjectIR,
  symbolId: string,
): TypeDefinitionDescription {
  const d = ir.symbols.get(symbolId);
  if (!d || d.kind !== "type")
    throw Error("Choose a record or outcome type from the checked design.");
  const metadata = {
    schema: "pymtheg.type-definition/v1" as const,
    snapshotId: ir.snapshot.id,
    symbolId: d.id,
    name: d.name,
    file: d.span.file,
    sourceHash: ir.snapshot.sources.find((s) => s.file === d.span.file)!.hash,
    declarationHash: hash(
      ir.snapshot.sources
        .find((s) => s.file === d.span.file)!
        .text.slice(d.span.start, d.span.end),
    ),
  };
  try {
    const definition: InterfaceType =
      d.fields === null
        ? {
            kind: "choice",
            name: d.name,
            variants: d.variants.map((v) => ({
              name: v.name,
              ...(v.payload
                ? {
                    payload: describeType(
                      ir,
                      ir.types.get(nodeKey(v.payload.span)),
                    ),
                  }
                : {}),
            })),
          }
        : {
            kind: "record",
            name: d.name,
            fields: d.fields.map((f) => ({
              name: f.name,
              type: describeType(ir, ir.types.get(nodeKey(f.type.span))),
            })),
          };
    validateInterfaceType(definition);
    return { ...metadata, definition };
  } catch (e) {
    return {
      ...metadata,
      unsupported: e instanceof Error ? e.message : String(e),
    };
  }
}
export function describeSignature(
  ir: ProjectIR,
  symbolId: string,
): SignatureDescription {
  const declaration = ir.symbols.get(symbolId);
  if (!declaration || !callable(declaration))
    throw Error("Choose a callable interface from the checked design.");
  if (!declaration.nameSpan || !declaration.paramsSpan)
    throw Error(
      "Check the source again to obtain editable signature locations.",
    );
  return {
    schema: "pymtheg.signature/v1",
    symbolId,
    snapshotId: ir.snapshot.id,
    file: declaration.span.file,
    sourceHash: ir.snapshot.sources.find(
      (s) => s.file === declaration.span.file,
    )!.hash,
    headerHash: hash(
      JSON.stringify(
        [
          declaration.nameSpan!,
          declaration.paramsSpan!,
          declaration.result.span,
          ...(declaration.meta.effectSpans ?? []),
        ].map((span) =>
          ir.snapshot.sources
            .find((s) => s.file === span.file)!
            .text.slice(span.start, span.end),
        ),
      ),
    ),
    types: describeInterfaceTypes(ir, declaration.span.file),
    name: declaration.name,
    inputs: declaration.params.map((p) => ({
      name: p.name,
      mode: p.mode,
      type: describeType(ir, ir.types.get(nodeKey(p.type.span))),
    })),
    output: describeType(ir, ir.types.get(nodeKey(declaration.result.span))),
    effects: declaration.meta.effects.map((effect) => {
      const dot = effect.indexOf(".");
      return { kind: effect.slice(0, dot), target: effect.slice(dot + 1) };
    }),
  };
}
export function rewriteSignature(
  ir: ProjectIR,
  symbolId: string,
  edit: SignatureEdit,
  expectedSourceHash: string,
) {
  const original = describeSignature(ir, symbolId),
    declaration = ir.symbols.get(symbolId)!;
  if (!callable(declaration)) throw Error("Choose a callable.");
  const source = ir.snapshot.sources.find((s) => s.file === original.file)!;
  if (source.hash !== expectedSourceHash)
    throw Error(
      "This interface belongs to a different source snapshot. Check the current edit before applying it.",
    );
  const edits: { span: Span; before: string; text: string }[] = [];
  const notices: string[] = [];
  const sources = new Map(ir.snapshot.sources.map((s) => [s.file, s]));
  const add = (span: Span, text: string) => {
    const before = sources.get(span.file)!.text.slice(span.start, span.end);
    if (before !== text) edits.push({ span, before, text });
  };
  const { type, definitionSource, newDefinitions } = typeAuthoring(
    ir,
    source.file,
  );
  const changedTypes = new Set<string>();
  for (const requested of edit.typeEdits ?? []) {
    if (changedTypes.has(requested.symbolId))
      throw Error("Edit each shared type once.");
    changedTypes.add(requested.symbolId);
    const declared = ir.symbols.get(requested.symbolId);
    const described = original.types.some(
      (t) => t.symbolId === requested.symbolId,
    )
      ? describeTypeDefinition(ir, requested.symbolId)
      : null;
    if (!declared || declared.kind !== "type" || !described?.definition)
      throw Error("Choose an editable type from this checked interface.");
    validateInterfaceType(requested.definition);
    if (
      typeof requested.definition === "string" ||
      !["record", "choice"].includes(requested.definition.kind) ||
      !("name" in requested.definition) ||
      requested.definition.name !== declared.name
    )
      throw Error(
        "Keep the shared type name; renaming requires reviewing every reference.",
      );
    if (
      JSON.stringify(requested.definition) !==
      JSON.stringify(described.definition)
    ) {
      const fullSource = sources.get(declared.span.file)!.text;
      const replacement = rewriteTypeText(
        fullSource,
        declared,
        definitionSource(requested.definition, declared.span.file),
      );
      notices.push(...replacement.notices);
      add(replacement.span, replacement.text);
    }
  }
  const removedInputs = original.inputs.filter(
    (p) => !edit.inputs.some((next) => next.name === p.name),
  );
  if (removedInputs.length)
    notices.push(
      "Input names changed or were removed: " +
        removedInputs.map((p) => p.name).join(", ") +
        ". Body expressions, rules, budgets and bounds keep their original references. Review and update those references before applying; the next check reports unresolved names.",
    );
  const { parameters, output, effects } = signatureParts(edit, type);
  if (edit.name !== original.name) add(declaration.nameSpan!, edit.name);
  const normalized = (inputs: SignatureEdit["inputs"]) =>
    inputs.map((p) => ({
      name: p.name,
      type: p.type,
      mode: p.mode ?? "value",
    }));
  if (
    JSON.stringify(normalized(edit.inputs)) !==
    JSON.stringify(normalized(original.inputs))
  )
    add(declaration.paramsSpan!, `(${parameters})`);
  if (JSON.stringify(edit.output) !== JSON.stringify(original.output))
    add(declaration.result.span, output);
  if (JSON.stringify(effects) !== JSON.stringify(declaration.meta.effects)) {
    const spans = declaration.meta.effectSpans ?? [];
    if (spans.length) {
      add(
        spans[0]!,
        effects.length ? "effects(" + effects.join(", ") + ")" : "",
      );
      for (const span of spans.slice(1)) add(span, "");
    } else if (effects.length)
      add(
        { ...declaration.result.span, start: declaration.result.span.end },
        " effects(" + effects.join(", ") + ")",
      );
  }
  if (newDefinitions.size)
    add(
      { ...declaration.span, end: declaration.span.start },
      [...newDefinitions.values()].map((d) => d.source).join("\n") + "\n",
    );
  return sourceEditPreview(
    ir,
    source.file,
    edits,
    [...changedTypes, ...(edits.length ? [symbolId] : [])],
    notices,
  );
}

/** Carry a saved form across body/unrelated edits only when every editable baseline still matches. */
export function resumeSignature(ir: ProjectIR, draft: InterfaceDraft) {
  const candidates = ir.declarations
    .filter(
      (d) =>
        callable(d) &&
        d.span.file ===
          draft.symbolId.slice(0, draft.symbolId.lastIndexOf("#")),
    )
    .slice(0, 100)
    .map((d) => ({ symbolId: d.id, name: d.name }));
  let description: SignatureDescription;
  try {
    description = describeSignature(ir, draft.symbolId);
  } catch (error) {
    return {
      description: null,
      draft,
      candidates,
      conflicts: [
        ir.symbols.has(draft.symbolId)
          ? String(error)
          : "The saved component was removed or renamed. Choose its current interface to compare; no rename is assumed and your saved edits are intact.",
      ],
    };
  }
  const conflicts: string[] = [];
  const normalize = (s: SignatureEdit) => ({
    name: s.name,
    inputs: s.inputs.map((p) => ({
      name: p.name,
      mode: p.mode ?? "value",
      type: p.type,
    })),
    output: s.output,
    effects: [...s.effects].sort((a, b) =>
      (a.kind + "." + a.target).localeCompare(b.kind + "." + b.target),
    ),
  });
  function canonical(value: unknown): string {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object")
      return (
        "{" +
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
          .join(",") +
        "}"
      );
    return JSON.stringify(value);
  }
  if (ir.snapshot.id !== draft.snapshotId) {
    if (!draft.baseline)
      conflicts.push(
        "This older draft has no saved contract baseline. Keep or download it, then reopen the current interface.",
      );
    else {
      if (
        !draft.baseline.headerHash ||
        draft.baseline.headerHash !== description.headerHash ||
        canonical(normalize(description)) !==
          canonical(normalize(draft.baseline.signature))
      )
        conflicts.push(
          "The component's inputs, output, name or effects changed since this form started. Review both contracts before applying it.",
        );
      for (const edit of draft.edit.typeEdits ?? []) {
        const before = draft.baseline.types.find(
            (t) => t.symbolId === edit.symbolId,
          ),
          current = describeTypeDefinition(ir, edit.symbolId);
        if (
          !before ||
          !before.declarationHash ||
          before.declarationHash !== current.declarationHash ||
          !current.definition ||
          canonical(before.definition) !== canonical(current.definition)
        )
          conflicts.push(
            "Shared type " +
              current.name +
              " changed since this form started. Its saved edit was retained.",
          );
      }
    }
  }
  return {
    description,
    candidates,
    draft: conflicts.length ? draft : { ...draft, snapshotId: ir.snapshot.id },
    conflicts,
  };
}
