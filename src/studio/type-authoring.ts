// SPDX-License-Identifier: MIT
import type { TypeDecl } from "../language/ast.js";
import { blockedSymbols, type ProjectIR } from "../semantic/core.js";
import type { Span } from "../shared/identity.js";
import {
  validateInterfaceType,
  type InterfaceType,
} from "./interface-builder.js";
import { interfaceTypeSource } from "./interface-syntax.js";

/** Shared nominal identity and nested-definition policy for source authoring. */
export function typeAuthoring(
  ir: ProjectIR,
  homeFile: string,
  options: { allowImports?: boolean } = {},
) {
  const imports = new Set<string>();
  const effective = new Map(
    [...(ir.visibleSymbols.get(homeFile) ?? [])].map(([name, ids]) => [
      name,
      [...ids],
    ]),
  );
  let blocked: Set<string> | undefined;
  let cycleSources: Set<string> | undefined;
  function sourcesReachingHome() {
    if (cycleSources) return cycleSources;
    const reverse = new Map<string, string[]>();
    for (const source of ir.snapshot.sources)
      for (const imported of source.imports) {
        const users = reverse.get(imported) ?? [];
        users.push(source.file);
        reverse.set(imported, users);
      }
    const seen = new Set([homeFile]),
      pending = [homeFile];
    for (let i = 0; i < pending.length; i++)
      for (const user of reverse.get(pending[i]!) ?? [])
        if (!seen.has(user)) {
          seen.add(user);
          pending.push(user);
        }
    return (cycleSources = seen);
  }
  function importType(id: string, name: string) {
    const target = ir.symbols.get(id);
    if (
      !target ||
      target.name !== name ||
      (target.kind !== "type" && target.kind !== "resource")
    )
      throw Error(
        "The selected type identity is not in this checked design. Refresh the type choices.",
      );
    blocked ??= blockedSymbols(ir);
    if (blocked.has(id))
      throw Error(
        "The selected type is incomplete. Correct its source before importing it.",
      );
    if (sourcesReachingHome().has(target.span.file))
      throw Error(
        "This type import would create a cycle. Move shared types into an independent file.",
      );
    const incoming = ir.visibleSymbols.get(target.span.file);
    if (!incoming)
      throw Error(
        "The selected type's import scope is unavailable. Check its source again.",
      );
    for (const [name, ids] of incoming) {
      if (
        newDefinitions.has(name) ||
        new Set([...(effective.get(name) ?? []), ...ids]).size !== 1
      )
        throw Error(
          "Importing this type would make " +
            name +
            " ambiguous. Put the shared type in a module with distinct names.",
        );
    }
    for (const [name, ids] of incoming)
      effective.set(name, [
        ...new Set([...(effective.get(name) ?? []), ...ids]),
      ]);
    imports.add(target.span.file);
    return target;
  }
  const newDefinitions = new Map<
    string,
    { definition: InterfaceType; source: string }
  >();
  const type = (value: InterfaceType, file = homeFile): string => {
    validateInterfaceType(value);
    return interfaceTypeSource(value, (named) => {
      const visible =
        file === homeFile ? effective : ir.visibleSymbols.get(file);
      if (named.kind === "named") {
        const ids = visible?.get(named.name) ?? [];
        let target = ids.length === 1 ? ir.symbols.get(ids[0]!) : undefined;
        if (
          options.allowImports &&
          file === homeFile &&
          named.symbolId &&
          (!target || target.id !== named.symbolId)
        )
          target = importType(named.symbolId, named.name);
        if (!target && file === homeFile && newDefinitions.has(named.name))
          return named.name;
        if (
          !target ||
          (target.kind !== "type" && target.kind !== "resource") ||
          (named.symbolId && target.id !== named.symbolId)
        )
          throw Error(
            "Type " +
              named.name +
              " is not uniquely available in this file. Choose a checked type or add its import first.",
          );
        return target.name;
      }
      if (visible?.has(named.name))
        throw Error(
          "Type " +
            named.name +
            " already exists. Edit its shared definition below or choose another name.",
        );
      if (file !== homeFile)
        throw Error(
          "Create new types in the component file before referencing them in another file.",
        );
      const previous = newDefinitions.get(named.name);
      if (previous) {
        if (JSON.stringify(previous.definition) !== JSON.stringify(named))
          throw Error("Two different types are called " + named.name + ".");
        return named.name;
      }
      newDefinitions.set(named.name, { definition: named, source: "" });
      newDefinitions.get(named.name)!.source = definitionSource(named, file);
      return named.name;
    });
  };
  const definitionSource = (definition: InterfaceType, file = homeFile) =>
    typeDefinitionSource(definition, file, type);
  return {
    type,
    definitionSource,
    newDefinitions,
    imports,
    visibleSymbols: effective,
  };
}

/** One spelling policy for standalone type edits and callable-interface edits. */
export function typeDefinitionSource(
  definition: InterfaceType,
  file: string,
  type: (value: InterfaceType, file: string) => string,
): string {
  if (
    typeof definition === "string" ||
    (definition.kind !== "record" && definition.kind !== "choice")
  )
    throw Error("Choose a record or outcome definition.");
  const members =
    definition.kind === "record"
      ? definition.fields.map(
          (field) => field.name + ": " + type(field.type, file),
        )
      : definition.variants.map(
          (variant) =>
            variant.name +
            (variant.payload === undefined
              ? ""
              : "(" + type(variant.payload, file) + ")"),
        );
  const body =
    definition.kind === "record"
      ? "{ " + members.join(", ") + " }"
      : members.join(" | ");
  const compact = "type " + definition.name + " = " + body + ";";
  if (compact.length <= 88) return compact;
  return definition.kind === "record"
    ? `type ${definition.name} = {\n${members.map((member) => "  " + member).join(",\n")}\n};`
    : `type ${definition.name} =\n  ${members.join(" |\n  ")};`;
}

/** Preserve notes with their former member identity when a definition is rebuilt. */
export function rewriteTypeText(
  fullSource: string,
  declared: TypeDecl,
  replacement: string,
): { span: Span; text: string; notices: string[] } {
  const trailing =
    /^[ \t]*\/\/[^\r\n]*/.exec(fullSource.slice(declared.span.end))?.[0] ?? "";
  const span = { ...declared.span, end: declared.span.end + trailing.length };
  const before = fullSource.slice(span.start, span.end);
  const members = declared.fields ?? declared.variants;
  let previousMember = -1;
  const comments = [...before.matchAll(/\/\/[^\r\n]*/g)].map((match) => {
    const position = span.start + match.index!;
    while (
      previousMember + 1 < members.length &&
      members[previousMember + 1]!.span.end <= position
    )
      previousMember++;
    const prior = members[previousMember];
    const member =
      prior && !/[\r\n]/.test(fullSource.slice(prior.span.end, position))
        ? prior
        : undefined;
    return `// Previous ${declared.name}${member ? "." + member.name : ""} comment (review after this edit):\n${match[0]}`;
  });
  const notices: string[] = [];
  const prefix = fullSource.slice(0, declared.span.start);
  const preceding = /(?:^|\n)((?:[ \t]*\/\/[^\n]*\n)+)[ \t]*$/.exec(
    prefix,
  )?.[1];
  if (preceding)
    notices.push(
      `${declared.name}: Existing comments above this type may describe fields or variants changed by this edit. Review their meaning; they were preserved.`,
    );
  if (comments.length)
    notices.push(
      `${declared.name}: ${comments.length} comment${comments.length === 1 ? "" : "s"} retained above the rewritten type. Review their placement and meaning.`,
    );
  return {
    span,
    text: (comments.length ? comments.join("\n") + "\n" : "") + replacement,
    notices,
  };
}
