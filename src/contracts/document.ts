import {
  defaultScaffoldBodyMode,
  type ScaffoldBodyMode,
  type OutputMode,
} from "../shared/outputs.js";
import { portableContractDocument } from "./portable.js";
import { contractExpression } from "./expression.js";
import {
  blockedSymbols,
  diagnosticsBySymbol,
  callable,
  type ProjectIR,
  type Type,
} from "../semantic/core.js";
import { nodeKey, type TypeRef } from "../language/ast.js";
import type { Span } from "../shared/identity.js";
export type ContractType =
  | { kind: "primitive"; name: "Bool" | "Int" | "Nat" | "String" | "Unit" }
  | { kind: "named"; symbolId: string }
  | { kind: "list"; element: ContractType }
  | { kind: "result"; ok: ContractType; error: ContractType };
interface Origin {
  symbolId: string;
  name: string;
  span: Span;
  notes: string[];
  implementationNotes?: string[];
}
export type ContractDeclaration = Origin &
  (
    | { kind: "record"; fields: { name: string; type: ContractType }[] }
    | {
        kind: "union";
        variants: { name: string; payload: ContractType | null }[];
      }
    | {
        kind: "resource";
        states: string[];
        initial: string;
        terminal: string[];
      }
    | {
        kind: "callable";
        parameters: {
          name: string;
          mode: "value" | "take" | "borrow";
          type: ContractType;
        }[];
        result: ContractType;
        maySuspend?: boolean;
      }
  );
export interface ContractDocument {
  schema: "pymtheg.contracts/v1";
  snapshotId: string;
  bodyPolicy?: ScaffoldBodyMode;
  outputMode?: OutputMode;
  sourceRoot?: string;
  declarations: ContractDeclaration[];
  omitted: ContractOmission[];
}
/**
 * Contract material the output should cover but cannot (unresolved source,
 * dependency or type, or an unsupported construct). No `applicability` field:
 * every omission without the explicit not-applicable marker below, including
 * those added by plugins or read from older documents, blocks any claim of
 * complete contracts.
 */
export interface UnresolvedContractOmission {
  name: string;
  reason: string;
  applicability?: never;
}
/**
 * A declaration that is not interface-contract material at all (a behavioural
 * machine). It is still listed so no output claims to cover it, but it does not
 * make the contracts incomplete for an implementation check.
 */
export interface NotApplicableContractOmission {
  name: string;
  reason: string;
  applicability: "not-contract-material";
}
export type ContractOmission =
  | UnresolvedContractOmission
  | NotApplicableContractOmission;
/** True only for the explicit marker; anything else is treated as unresolved. */
export const isNotContractMaterial = (
  omission: ContractOmission,
): omission is NotApplicableContractOmission =>
  omission.applicability === "not-contract-material";
/** The sole typed-IR to output boundary. No emitter makes semantic decisions. */
export function contractDocument(
  ir: ProjectIR,
  bodyPolicy: ScaffoldBodyMode = defaultScaffoldBodyMode,
): ContractDocument {
  const diagnostics = diagnosticsBySymbol(ir);
  const recoveredFiles = new Set(
    ir.snapshot.sources.filter((s) => s.recovered).map((s) => s.file),
  );
  const seenIds = new Set<string>(),
    duplicateIds = new Set<string>();
  for (const declaration of ir.declarations) {
    if (seenIds.has(declaration.id)) duplicateIds.add(declaration.id);
    seenIds.add(declaration.id);
  }
  const blocked = blockedSymbols(ir),
    declarations: ContractDeclaration[] = [],
    omitted: ContractDocument["omitted"] = [];
  for (const file of recoveredFiles)
    if (!ir.declarations.some((d) => d.span.file === file))
      omitted.push({
        name: file,
        reason: "Source could not be parsed; contract coverage is unknown.",
      });
  const type = (t: Type): ContractType => {
    switch (t.kind) {
      case "error":
        throw Error("Unresolved type");
      case "primitive":
        return t;
      case "nominal":
        if (blocked.has(t.id))
          throw Error("Referenced type or resource is unresolved");
        return { kind: "named", symbolId: t.id };
      case "list":
        return { kind: "list", element: type(t.element) };
      case "result":
        return { kind: "result", ok: type(t.ok), error: type(t.error) };
    }
  };
  const ref = (t: TypeRef) => {
    const resolved = ir.types.get(nodeKey(t.span));
    if (!resolved) throw Error("Unresolved type");
    return type(resolved);
  };
  for (const d of ir.declarations) {
    if (d.kind === "machine") {
      // In a partially parsed file the machine says nothing about which
      // contracts were lost, so coverage there stays unresolved.
      omitted.push(
        recoveredFiles.has(d.span.file)
          ? {
              name: d.name,
              reason:
                "Source could not be fully parsed; contract coverage of this file is unknown.",
            }
          : {
              name: d.name,
              reason:
                "Behavioural machines are specifications, not callable implementation contracts.",
              applicability: "not-contract-material",
            },
      );
      continue;
    }
    const headerEnd = callable(d)
      ? (d.body?.[0]?.span.start ?? d.expr?.span.start ?? d.span.end)
      : d.span.end;
    const invalidHeader = diagnostics
      .get(d.id)
      ?.some((f) => f.severity === "error" && f.span.start < headerEnd);
    if (
      recoveredFiles.has(d.span.file) ||
      duplicateIds.has(d.id) ||
      (!callable(d) && blocked.has(d.id)) ||
      (callable(d) && invalidHeader)
    ) {
      omitted.push({
        name: d.name,
        reason: "Unresolved source or dependency; no contract was invented.",
      });
      continue;
    }
    try {
      const base = {
        symbolId: d.id,
        name: d.name,
        span: d.span,
        notes: [] as string[],
      };
      if (d.kind === "type")
        declarations.push(
          d.fields !== null
            ? {
                ...base,
                kind: "record",
                fields: d.fields.map((f) => ({
                  name: f.name,
                  type: ref(f.type),
                })),
              }
            : {
                ...base,
                kind: "union",
                variants: d.variants.map((v) => ({
                  name: v.name,
                  payload: v.payload ? ref(v.payload) : null,
                })),
              },
        );
      else if (d.kind === "resource")
        declarations.push({
          ...base,
          kind: "resource",
          states: d.states,
          initial: d.initial,
          terminal: d.terminal,
          notes: [
            "Owned resource; transitions and cleanup remain implementation obligations.",
            ...d.transitions.map(
              (t) => `Allowed transition: ${t.from} -> ${t.to}`,
            ),
          ],
        });
      else if (callable(d)) {
        const implementationNotes = [
          `Source: ${d.name} (${d.kind})`,
          ...(blocked.has(d.id)
            ? [
                "Body or dependent implementation is incomplete; this output preserves the declared interface only.",
              ]
            : []),
          ...(diagnostics.get(d.id) ?? [])
            .filter((f) => f.code === "U001")
            .map((f) => "Open decision: " + f.message),
        ];
        declarations.push({
          ...base,
          kind: "callable",
          parameters: d.params.map((p) => ({
            name: p.name,
            mode: p.mode,
            type: ref(p.type),
          })),
          result: ref(d.result),
          ...([...(ir.effects.get(d.id) ?? [])].some((effect) =>
            /^(remote|io)\./.test(effect),
          )
            ? { maySuspend: true }
            : {}),
          implementationNotes,
          notes: [
            ...implementationNotes,
            ...d.params
              .filter((p) => p.mode !== "value")
              .map(
                (p) =>
                  `${p.mode} ${p.name}: ${p.mode === "take" ? "ownership is transferred" : "read-only borrow for this call"}`,
              ),
            ...(d.meta.effects.length
              ? ["Effects: " + d.meta.effects.join(", ")]
              : []),
            ...(d.meta.stable ? ["Stable: declared"] : []),
            ...(d.meta.atomic ? ["Atomic: declared"] : []),
            ...(d.meta.creates ? ["Creates: fresh owned resource"] : []),
            ...Object.entries(d.meta.bounds).map(
              ([name, bound]) => `Bound: ${name} <= ${bound}`,
            ),
            ...d.meta.costs.map(
              (c) =>
                `${c.kind} ${c.metric} ${c.quality}: ${contractExpression(c.expr)}`,
            ),
            ...d.meta.requires.map((e) => "Requires: " + contractExpression(e)),
            ...d.meta.ensures.map((e) => "Ensures: " + contractExpression(e)),
            ...d.meta.settles.map(
              (s) => "Settles: " + s.param + " on " + s.outcomes.join(", "),
            ),
          ],
        });
      }
    } catch (error) {
      omitted.push({ name: d.name, reason: String(error) });
    }
  }
  return portableContractDocument(
    {
      schema: "pymtheg.contracts/v1",
      snapshotId: ir.snapshot.id,
      ...(ir.snapshot.root ? { sourceRoot: ir.snapshot.root } : {}),
      bodyPolicy,
      declarations,
      omitted,
    },
    ir.snapshot.sources.map((source) => source.file),
  );
}
