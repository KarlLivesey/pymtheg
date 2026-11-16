// SPDX-License-Identifier: MIT
import {
  validateInterfaceType,
  type InterfaceType,
} from "./interface-builder.js";
export interface SignatureInput {
  name: string;
  type: InterfaceType;
  mode?: "value" | "take" | "borrow";
}
export interface SignatureEdit {
  name: string;
  inputs: SignatureInput[];
  output: InterfaceType;
  effects: { kind: string; target: string }[];
  typeEdits?: { symbolId: string; definition: InterfaceType }[];
}
export interface SignatureDescription extends SignatureEdit {
  schema: "pymtheg.signature/v1";
  symbolId: string;
  snapshotId: string;
  file: string;
  sourceHash: string;
  headerHash?: string;
  types: {
    name: string;
    symbolId: string;
    file: string;
    kind: "record" | "choice" | "resource";
    definition?: InterfaceType;
    unsupported?: string;
  }[];
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function readSignatureEdit(
  value: unknown,
  draft = false,
): SignatureEdit {
  if (
    !object(value) ||
    typeof value.name !== "string" ||
    value.name.length > 120 ||
    !Array.isArray(value.inputs) ||
    value.inputs.length > 20 ||
    !Array.isArray(value.effects) ||
    value.effects.length > 20
  )
    throw Error("Invalid interface editing request.");
  const inputs = value.inputs.map((input) => {
    if (
      !object(input) ||
      typeof input.name !== "string" ||
      input.name.length > 120 ||
      (input.mode !== undefined &&
        !["value", "take", "borrow"].includes(String(input.mode)))
    )
      throw Error("Invalid interface input.");
    validateInterfaceType(input.type, {
      draft,
      label: `Input “${input.name}”`,
    });
    return {
      name: input.name,
      type: input.type,
      ...(input.mode === undefined
        ? {}
        : { mode: input.mode as "value" | "take" | "borrow" }),
    };
  });
  validateInterfaceType(value.output, { draft, label: "Output" });
  const effects = value.effects.map((effect) => {
    if (
      !object(effect) ||
      typeof effect.kind !== "string" ||
      typeof effect.target !== "string" ||
      effect.target.length > 120
    )
      throw Error("Invalid interface effect.");
    return { kind: effect.kind, target: effect.target };
  });
  if (
    value.typeEdits !== undefined &&
    (!Array.isArray(value.typeEdits) || value.typeEdits.length > 20)
  )
    throw Error("Edit at most 20 shared types at once.");
  const typeEdits = (value.typeEdits as unknown[] | undefined)?.map((entry) => {
    if (!object(entry) || typeof entry.symbolId !== "string")
      throw Error("Invalid shared type edit.");
    validateInterfaceType(entry.definition, { draft });
    if (
      typeof entry.definition === "string" ||
      !["record", "choice"].includes(entry.definition.kind)
    )
      throw Error("Choose a record or outcome definition.");
    return { symbolId: entry.symbolId, definition: entry.definition };
  });
  return {
    name: value.name,
    inputs,
    output: value.output,
    effects,
    ...(typeEdits ? { typeEdits } : {}),
  };
}
export function readSignatureDescription(value: unknown): SignatureDescription {
  const edit = readSignatureEdit(value);
  if (
    !object(value) ||
    value.schema !== "pymtheg.signature/v1" ||
    typeof value.symbolId !== "string" ||
    typeof value.snapshotId !== "string" ||
    typeof value.file !== "string" ||
    typeof value.sourceHash !== "string" ||
    !Array.isArray(value.types) ||
    value.types.length > 100000
  )
    throw Error("Invalid checked interface response.");
  if (value.headerHash !== undefined && typeof value.headerHash !== "string")
    throw Error("Invalid signature header hash");
  const types = value.types.map((type) => {
    if (
      !object(type) ||
      typeof type.name !== "string" ||
      typeof type.symbolId !== "string" ||
      typeof type.file !== "string" ||
      !["record", "choice", "resource"].includes(String(type.kind))
    )
      throw Error("Invalid project type response.");
    if (type.definition !== undefined) validateInterfaceType(type.definition);
    if (type.unsupported !== undefined && typeof type.unsupported !== "string")
      throw Error("Invalid type support reason.");
    return {
      ...(type.definition === undefined ? {} : { definition: type.definition }),
      ...(typeof type.unsupported === "string"
        ? { unsupported: type.unsupported }
        : {}),
      name: type.name,
      symbolId: type.symbolId,
      file: type.file,
      kind: type.kind as "record" | "choice" | "resource",
    };
  });
  return {
    ...edit,
    schema: "pymtheg.signature/v1",
    symbolId: value.symbolId,
    snapshotId: value.snapshotId,
    file: value.file,
    sourceHash: value.sourceHash,
    ...(typeof value.headerHash === "string"
      ? { headerHash: value.headerHash }
      : {}),
    types,
  };
}

export interface SourceFileEdit {
  file: string;
  expectedSourceHash: string;
  before: string;
  hash: string;
  text: string;
  edits: {
    span: { file: string; start: number; end: number };
    before: string;
    text: string;
  }[];
}
export interface SourceEditPreview {
  baseSnapshotId?: string;
  importedSources?: { file: string; hash: string }[];
  notices?: string[];
  affectedComplete?: boolean;
  schema: "pymtheg.source-edit/v1";
  files: SourceFileEdit[];
  affected: { symbolId: string; name: string; file: string }[];
  file: string;
  snapshotId: string;
  expectedSourceHash: string;
  hash: string;
  text: string;
  edits: {
    span: { file: string; start: number; end: number };
    before: string;
    text: string;
  }[];
}
export function readSourceEditPreview(value: unknown): SourceEditPreview {
  if (
    !object(value) ||
    value.schema !== "pymtheg.source-edit/v1" ||
    typeof value.file !== "string" ||
    typeof value.snapshotId !== "string" ||
    typeof value.expectedSourceHash !== "string" ||
    typeof value.hash !== "string" ||
    typeof value.text !== "string" ||
    !Array.isArray(value.edits)
  )
    throw Error("Invalid interface preview.");
  if (
    value.notices !== undefined &&
    (!Array.isArray(value.notices) ||
      !value.notices.every((notice) => typeof notice === "string"))
  )
    throw Error("Invalid source-edit notices.");
  if (
    value.baseSnapshotId !== undefined &&
    typeof value.baseSnapshotId !== "string"
  )
    throw Error("Invalid preview base snapshot.");
  const importedSources =
    value.importedSources === undefined
      ? undefined
      : (() => {
          if (
            !Array.isArray(value.importedSources) ||
            value.importedSources.length > 2048
          )
            throw Error("Invalid imported source provenance.");
          return value.importedSources.map((item) => {
            if (
              !object(item) ||
              typeof item.file !== "string" ||
              typeof item.hash !== "string" ||
              !/^[a-f0-9]{64}$/.test(item.hash)
            )
              throw Error("Invalid imported source provenance.");
            return { file: item.file, hash: item.hash };
          });
        })();
  const edits = value.edits.map((edit) => {
    if (
      !object(edit) ||
      !object(edit.span) ||
      typeof edit.span.file !== "string" ||
      !Number.isSafeInteger(edit.span.start) ||
      !Number.isSafeInteger(edit.span.end) ||
      Number(edit.span.start) < 0 ||
      Number(edit.span.end) < Number(edit.span.start) ||
      typeof edit.before !== "string" ||
      typeof edit.text !== "string"
    )
      throw Error("Invalid interface source edit.");
    return {
      span: {
        file: edit.span.file,
        start: Number(edit.span.start),
        end: Number(edit.span.end),
      },
      before: edit.before,
      text: edit.text,
    };
  });
  if (
    !Array.isArray(value.files) ||
    value.files.length > 128 ||
    !Array.isArray(value.affected)
  )
    throw Error("Invalid multi-file edit preview.");
  const files = value.files.map((file) => {
    if (
      !object(file) ||
      typeof file.file !== "string" ||
      typeof file.expectedSourceHash !== "string" ||
      typeof file.before !== "string" ||
      typeof file.hash !== "string" ||
      typeof file.text !== "string" ||
      !Array.isArray(file.edits)
    )
      throw Error("Invalid source file preview.");
    // Reuse the same span validation without recursively accepting nested bundles.
    const validated = readSourceEditPreview({
      ...file,
      schema: "pymtheg.source-edit/v1",
      snapshotId: value.snapshotId,
      files: [],
      affected: [],
    });
    return {
      file: validated.file,
      expectedSourceHash: validated.expectedSourceHash,
      before: file.before,
      hash: validated.hash,
      text: validated.text,
      edits: validated.edits,
    };
  });
  const affected = value.affected.map((row) => {
    if (
      !object(row) ||
      typeof row.symbolId !== "string" ||
      typeof row.name !== "string" ||
      typeof row.file !== "string"
    )
      throw Error("Invalid affected interface.");
    return { symbolId: row.symbolId, name: row.name, file: row.file };
  });
  return {
    schema: "pymtheg.source-edit/v1",
    ...(typeof value.baseSnapshotId === "string"
      ? { baseSnapshotId: value.baseSnapshotId }
      : {}),
    ...(importedSources ? { importedSources } : {}),
    ...(value.notices ? { notices: value.notices as string[] } : {}),
    ...(typeof value.affectedComplete === "boolean"
      ? { affectedComplete: value.affectedComplete }
      : {}),
    files,
    affected,
    file: value.file,
    snapshotId: value.snapshotId,
    expectedSourceHash: value.expectedSourceHash,
    hash: value.hash,
    text: value.text,
    edits,
  };
}

export interface InterfaceBaseline {
  signature: SignatureEdit;
  headerHash?: string;
  types: {
    symbolId: string;
    definition: InterfaceType;
    declarationHash?: string;
  }[];
}
export interface InterfaceDraft {
  file: string;
  symbolId: string;
  snapshotId: string;
  edit: SignatureEdit;
  baseline?: InterfaceBaseline;
}
export function readInterfaceDraft(value: unknown): InterfaceDraft {
  if (
    !object(value) ||
    typeof value.file !== "string" ||
    value.file.length > 4096 ||
    typeof value.symbolId !== "string" ||
    value.symbolId.length > 8192 ||
    typeof value.snapshotId !== "string" ||
    value.snapshotId.length > 128
  )
    throw Error("Invalid unfinished interface form.");
  let baseline: InterfaceBaseline | undefined;
  if (value.baseline !== undefined) {
    if (
      !object(value.baseline) ||
      !Array.isArray(value.baseline.types) ||
      value.baseline.types.length > 20
    )
      throw Error("Invalid interface baseline");
    const signature = readSignatureEdit(value.baseline.signature);
    const types = value.baseline.types.map((entry) => {
      if (!object(entry) || typeof entry.symbolId !== "string")
        throw Error("Invalid type baseline");
      validateInterfaceType(entry.definition);
      if (
        entry.declarationHash !== undefined &&
        typeof entry.declarationHash !== "string"
      )
        throw Error("Invalid declaration hash");
      return {
        symbolId: entry.symbolId,
        definition: entry.definition,
        ...(typeof entry.declarationHash === "string"
          ? { declarationHash: entry.declarationHash }
          : {}),
      };
    });
    if (
      value.baseline.headerHash !== undefined &&
      typeof value.baseline.headerHash !== "string"
    )
      throw Error("Invalid header hash");
    baseline = {
      signature,
      types,
      ...(typeof value.baseline.headerHash === "string"
        ? { headerHash: value.baseline.headerHash }
        : {}),
    };
  }
  return {
    file: value.file,
    symbolId: value.symbolId,
    snapshotId: value.snapshotId,
    edit: readSignatureEdit(value.edit, true),
    ...(baseline ? { baseline } : {}),
  };
}

export interface TypeDefinitionDescription {
  schema: "pymtheg.type-definition/v1";
  snapshotId: string;
  symbolId: string;
  name: string;
  file: string;
  sourceHash: string;
  declarationHash?: string;
  definition?: InterfaceType;
  unsupported?: string;
}
export function readTypeDefinition(value: unknown): TypeDefinitionDescription {
  if (
    !object(value) ||
    value.schema !== "pymtheg.type-definition/v1" ||
    typeof value.snapshotId !== "string" ||
    typeof value.symbolId !== "string" ||
    typeof value.name !== "string" ||
    typeof value.file !== "string" ||
    typeof value.sourceHash !== "string"
  )
    throw Error("Invalid checked type definition.");
  if (
    value.declarationHash !== undefined &&
    typeof value.declarationHash !== "string"
  )
    throw Error("Invalid type declaration hash");
  if (value.definition !== undefined) {
    validateInterfaceType(value.definition);
    if (
      typeof value.definition === "string" ||
      !["record", "choice"].includes(value.definition.kind) ||
      !("name" in value.definition) ||
      value.definition.name !== value.name ||
      value.unsupported !== undefined
    )
      throw Error("Invalid checked type definition.");
  } else if (typeof value.unsupported !== "string")
    throw Error("Missing checked type definition.");
  return {
    schema: "pymtheg.type-definition/v1",
    snapshotId: value.snapshotId,
    symbolId: value.symbolId,
    name: value.name,
    file: value.file,
    sourceHash: value.sourceHash,
    ...(typeof value.declarationHash === "string"
      ? { declarationHash: value.declarationHash }
      : {}),
    ...(value.definition === undefined
      ? { unsupported: value.unsupported as string }
      : { definition: value.definition }),
  };
}
