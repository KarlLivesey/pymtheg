// SPDX-License-Identifier: MIT
import { resourceDefinitionSource } from "./resource-authoring.js";
import { machineDefinitionSource } from "./machine-authoring.js";
import {
  operationRuleSource,
  operationCostSource,
} from "./operation-contract.js";
import { describeInterfaceTypes } from "./signature.js";
import type { ProjectIR } from "../semantic/core.js";
import { formatSource } from "../language/format.js";
import { readSignatureEdit } from "./interface-data.js";
import {
  declarationSchema,
  declarationKinds,
  declarationInfo,
} from "./declaration-data.js";
import { typeAuthoring } from "./type-authoring.js";
import { checkSourceName, signatureParts } from "./signature-source.js";
import { sourceEditPreview } from "./source-edit.js";
import {
  validateInterfaceType,
  relativeImportPath,
} from "./interface-builder.js";

/** Create-only source authoring against one checked snapshot; never writes files. */
export function createDeclaration(
  ir: ProjectIR,
  file: string,
  value: unknown,
  expectedSourceHash: string,
) {
  const source = ir.snapshot.sources.find((s) => s.file === file);
  if (!source || source.hash !== expectedSourceHash)
    throw Error(
      "This file belongs to a different source snapshot. Check the current source before adding a declaration.",
    );
  if (source.recovered)
    throw Error(
      "Correct this file's syntax errors before adding declarations. Existing field edits remain available.",
    );
  const item = declarationSchema.parse(value);
  const writer = typeAuthoring(ir, file, { allowImports: true });
  const name =
    item.kind === "type"
      ? (item.definition as { name: string }).name
      : item.kind === "resource" || item.kind === "machine"
        ? item.name
        : item.signature.name;
  checkSourceName(name, "Declaration");
  if (ir.visibleSymbols.get(file)?.has(name))
    throw Error(
      name +
        " already exists in this file or its imports. Choose a new name; adding never replaces a declaration.",
    );
  let body = "";
  const notices: string[] = [];
  if (item.kind === "type") {
    validateInterfaceType(item.definition);
    writer.type(item.definition);
  } else if (item.kind === "resource") {
    body = resourceDefinitionSource(item);
    notices.push(
      "Creating a resource creates a cleanup obligation; no flow or cleanup step was added.",
    );
  } else if (item.kind === "machine") {
    body = machineDefinitionSource(item);
    notices.push(
      "Events are atomic model steps. Assignments use the old state; unassigned state stays unchanged. This does not prove production behaviour or eventual completion.",
    );
    if (!item.invariants.length)
      notices.push(
        "No safety rules were added. Add a rule stating what must always hold before asking for a safety check.",
      );
  } else {
    const edit = readSignatureEdit(item.signature);
    if (edit.typeEdits?.length)
      throw Error("Adding a declaration cannot edit existing shared types.");
    const { parameters, output, effects } = signatureParts(edit, writer.type);
    if (writer.newDefinitions.has(name))
      throw Error("Use different names for the component and its new types.");
    const header = `${item.kind === "operation" ? "op" : "flow"} ${name}(${parameters}) -> ${output}${effects.length ? " effects(" + effects.join(", ") + ")" : ""}`;
    if (item.kind === "component")
      body =
        header +
        ` {\n  ${output === "Unit" ? 'unknown "What should this component do?";' : 'return unknown "What result should this component return?";'}\n}\n`;
    else {
      const metrics = new Set<string>();
      const costs = item.costs
        .map((cost) => {
          checkSourceName(cost.metric, "Work metric");
          if (metrics.has(cost.metric))
            throw Error("Declare each work metric once.");
          metrics.add(cost.metric);
          if (!/^\d{1,30}$/.test(cost.count))
            throw Error("Work count must be a nonnegative whole number.");
          return (
            " " +
            operationCostSource({
              metric: cost.metric,
              quality: cost.quality,
              expression: String(BigInt(cost.count)),
            })
          );
        })
        .join("");
      const rules = (["requires", "ensures"] as const)
        .flatMap((kind) =>
          (item[kind] ?? []).map(
            (value, i) => " " + operationRuleSource(kind, value, i),
          ),
        )
        .join("");
      body = header + rules + costs + (item.atomic ? " atomic" : "") + ";\n";
      notices.push(
        "Operation effects and work summaries are assumptions, not an implementation or proof.",
      );
      if (item.ensures?.length)
        notices.push(
          "Operation guarantees are assumptions about the external implementation. Checking callers does not prove that implementation keeps them.",
        );
      if (!item.costs.length)
        notices.push(
          "No work summary was declared. Work through this operation remains unknown.",
        );
    }
  }
  if (writer.imports.size && writer.visibleSymbols.has(name))
    throw Error(
      "The new declaration name " +
        name +
        " conflicts with an imported declaration. Choose another name.",
    );
  const importText = [...writer.imports]
    .map((target) => relativeImportPath(file, target))
    .sort()
    .map((path) => "import " + JSON.stringify(path) + ";\n")
    .join("");
  if (importText)
    notices.push(
      "Adds explicit whole-file imports for selected project types. Review the imports and recheck the generated source.",
    );
  const generated = formatSource(
    file,
    [...writer.newDefinitions.values()].map((d) => d.source + "\n").join("") +
      body,
  );
  const addition =
    (source.text.endsWith("\n\n")
      ? ""
      : source.text.endsWith("\n")
        ? "\n"
        : "\n\n") + generated;
  const at = source.text.length;
  const importAt = source.text.startsWith("\uFEFF") ? 1 : 0;
  const preview = sourceEditPreview(
    ir,
    file,
    at === 0
      ? [
          {
            span: { file, start: 0, end: 0 },
            before: "",
            text: importText + addition,
          },
        ]
      : [
          ...(importText
            ? [
                {
                  span: { file, start: importAt, end: importAt },
                  before: "",
                  text: importText,
                },
              ]
            : []),
          { span: { file, start: at, end: at }, before: "", text: addition },
        ],
    [],
    [
      ...notices,
      "New names may resolve earlier missing references. Recheck to discover their full impact.",
    ],
  );
  return { ...preview, affectedComplete: false };
}

export function declarationContext(ir: ProjectIR, file: string) {
  const source = ir.snapshot.sources.find((s) => s.file === file);
  if (!source) throw Error("Choose a file in the checked snapshot.");
  return {
    file,
    sourceHash: source.hash,
    snapshotId: ir.snapshot.id,
    declarationKinds: declarationKinds.map((kind) => ({
      kind,
      ...declarationInfo[kind],
    })),
    types: describeInterfaceTypes(ir, file),
    canCreate: !source.recovered,
    notice: source.recovered
      ? "Correct this file's syntax errors before adding declarations."
      : null,
  };
}
