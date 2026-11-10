import type { ProjectIR } from "../semantic/core.js";
import { hash, type Span } from "../shared/identity.js";
import { authoringExpression } from "./authoring-expression.js";
import { checkSourceName } from "./signature-source.js";
import { sourceEditPreview, type SourceChange } from "./source-edit.js";

export {
  operationContractSchema,
  type OperationContract,
} from "./operation-data.js";
import {
  operationContractSchema,
  type OperationContract,
} from "./operation-data.js";

export function operationRuleSource(
  kind: "requires" | "ensures",
  value: string,
  index = 0,
): string {
  return `${kind} (${authoringExpression(value, `${kind === "requires" ? "Precondition" : "Guarantee"} ${index + 1}`, kind === "requires" ? "amount > 0" : "result >= amount")})`;
}
export function operationCostSource(
  cost: OperationContract["costs"][number],
  kind: "cost" | "overhead" = "cost",
): string {
  checkSourceName(cost.metric, "Work metric");
  return `${kind} ${cost.metric} ${cost.quality} ${authoringExpression(cost.expression, "Work count for " + cost.metric, "1 or count * 2")}`;
}

export function describeOperationContract(ir: ProjectIR, symbolId: string) {
  const declaration = ir.symbols.get(symbolId);
  if (
    !declaration ||
    !["op", "flow"].includes(declaration.kind) ||
    !("meta" in declaration)
  )
    throw Error(
      "Choose an existing external operation from the checked design.",
    );
  const source = ir.snapshot.sources.find(
    (s) => s.file === declaration.span.file,
  )!;
  const text = (span: Span) => source.text.slice(span.start, span.end);
  const definition: OperationContract = {
    requires: declaration.meta.requires.map((e) => text(e.span)),
    ensures: declaration.meta.ensures.map((e) => text(e.span)),
    budgets: declaration.meta.costs
      .filter((c) => c.kind === "budget")
      .map((c) => ({ metric: c.metric, expression: text(c.expr.span) })),
    bounds: Object.entries(declaration.meta.bounds).map(
      ([parameter, maximum]) => ({ parameter, maximum: String(maximum) }),
    ),
    costs: declaration.meta.costs
      .filter(
        (c) => c.kind === (declaration.kind === "flow" ? "overhead" : "cost"),
      )
      .map((c) => ({
        metric: c.metric,
        quality: c.quality,
        expression: text(c.expr.span),
      })),
  };
  const parsed = operationContractSchema.safeParse(definition);
  return {
    schema: "pymtheg.operation-contract/v1" as const,
    kind: declaration.kind as "op" | "flow",
    parameters: declaration.params.map((p) => p.name),
    symbolId,
    file: source.file,
    name: declaration.name,
    snapshotId: ir.snapshot.id,
    sourceHash: source.hash,
    declarationHash: hash(text(declaration.span)),
    declarationText: text(declaration.span),
    definition: parsed.success ? parsed.data : null,
    origins: {
      requires: definition.requires.map((_, i) => i),
      ensures: definition.ensures.map((_, i) => i),
      costs: definition.costs.map((_, i) => i),
    },
    unsupported: parsed.success
      ? null
      : "This operation exceeds the form's 20-rule/cost or 1,000-character expression limit. Edit its full contract in Text.",
  };
}

/** Find actual line comments while skipping complete quoted strings. */
function containsComment(text: string): boolean {
  return [...text.matchAll(/"(?:\\[\s\S]|[^"\\])*"|\/\/[^\r\n]*/g)].some(
    (match) => match[0].startsWith("//"),
  );
}
/** Change only the requested clauses in the already parsed operation. Never writes source. */
export function rewriteOperationContract(
  ir: ProjectIR,
  symbolId: string,
  value: unknown,
  expectedSourceHash: string,
) {
  const description = describeOperationContract(ir, symbolId);
  const declaration = ir.symbols.get(symbolId)!;
  if (declaration.kind !== "op" && declaration.kind !== "flow")
    throw Error("Choose an operation or component.");
  const source = ir.snapshot.sources.find((s) => s.file === description.file)!;
  if (source.hash !== expectedSourceHash)
    throw Error(
      "The operation source changed. Check it before previewing this contract.",
    );
  if (source.recovered)
    throw Error(
      "Correct this file's syntax before editing its operation contract.",
    );
  if (!description.definition) throw Error(description.unsupported!);
  const next = operationContractSchema.parse(value),
    before = description.definition;
  if (JSON.stringify(next) === JSON.stringify(before))
    return sourceEditPreview(ir, source.file, [], []);
  if (!declaration.meta.clauses)
    throw Error(
      "Check this source again to obtain operation-clause locations.",
    );
  const edits: SourceChange[] = [],
    added: string[] = [];
  const slice = (span: Span) => source.text.slice(span.start, span.end);
  function origins(kind: "requires" | "ensures" | "costs", count: number) {
    const supplied = next.origins?.[kind];
    if (!supplied) {
      // Legacy clients may infer identity only when one changed clause has one possible old slot.
      const old = before[kind].map((v) => JSON.stringify(v));
      const proposed = next[kind].map((v) => JSON.stringify(v));
      const used = new Set<number>();
      const matched = proposed.map((v) => {
        const i = old.findIndex((item, j) => item === v && !used.has(j));
        if (i >= 0) used.add(i);
        return i >= 0 ? i : null;
      });
      const unmatched = matched.filter((i) => i === null).length;
      if (
        unmatched &&
        old.length > used.size &&
        (old.length !== proposed.length || unmatched > 1)
      )
        throw Error(
          "Clause identity is ambiguous. Reload the contract and supply original clause indices (origins); new clauses use null. No comments were moved.",
        );
      return matched.map((i) => {
        if (i !== null) return i;
        const remaining = old.findIndex((_, j) => !used.has(j));
        if (remaining >= 0) used.add(remaining);
        return remaining >= 0 ? remaining : null;
      });
    }
    const retained = supplied.filter((i): i is number => i !== null);
    if (
      supplied.length !== next[kind].length ||
      new Set(retained).size !== retained.length ||
      retained.some((i) => i >= count)
    )
      throw Error(
        `The ${kind} clause identities no longer match this operation. Reload its description and keep each original index with its edited clause; new clauses use null.`,
      );
    if (retained.some((i, j) => j > 0 && i < retained[j - 1]!))
      throw Error(
        "Reordering operation clauses requires Text so their notes stay with the intended rule.",
      );
    return supplied;
  }
  function replace(span: Span, text: string, label: string) {
    const before = slice(span);
    if (containsComment(before))
      throw Error(
        `${label} contains an embedded comment. Edit this clause in Text to preserve its notes; other clauses can still be edited here.`,
      );
    const tail = source.text.slice(span.end).split(/\r?\n/, 1)[0]!;
    const retainedNote = text === "" && /^[ \t]*\/\//.test(tail);
    if (text === "" && !retainedNote) {
      const lineStart = source.text.lastIndexOf("\n", span.start - 1) + 1;
      const newline = source.text.indexOf("\n", span.end);
      const lineEnd = newline < 0 ? source.text.length : newline;
      if (
        /^[ \t]*$/.test(source.text.slice(lineStart, span.start)) &&
        /^[ \t\r]*$/.test(source.text.slice(span.end, lineEnd))
      ) {
        const lineSpan = {
          ...span,
          start: lineStart,
          end: newline < 0 ? lineEnd : newline + 1,
        };
        edits.push({ span: lineSpan, before: slice(lineSpan), text: "" });
        return;
      }
    }
    edits.push({
      span,
      before,
      text: retainedNote
        ? `// Removed ${label}; retained original note:`
        : text,
    });
  }
  for (const kind of ["requires", "ensures"] as const) {
    const expressions = declaration.meta[kind];
    const clauses = declaration.meta.clauses.filter((c) => c.kind === kind);
    if (clauses.length !== expressions.length)
      throw Error(
        "Operation clause locations are inconsistent. Check the source again.",
      );
    const mapping = origins(kind, expressions.length);
    for (let i = 0; i < expressions.length; i++) {
      const proposedIndex = mapping.indexOf(i);
      const expression = expressions[i],
        raw = proposedIndex < 0 ? undefined : next[kind][proposedIndex];
      if (expression && raw !== undefined && slice(expression.span) === raw)
        continue;
      if (raw === undefined) {
        replace(clauses[i]!.span, "", `${kind} rule ${i + 1}`);
        continue;
      }
      const clause = operationRuleSource(kind, raw, i);
      replace(
        expression!.span,
        clause.slice(kind.length + 1),
        `${kind} rule ${i + 1}`,
      );
    }
    mapping.forEach((origin, i) => {
      if (origin === null)
        added.push(operationRuleSource(kind, next[kind][i]!, i));
    });
  }
  const costs = declaration.meta.costs.filter(
    (c) => c.kind === (declaration.kind === "flow" ? "overhead" : "cost"),
  );
  const metrics = new Set<string>();
  for (const cost of next.costs) {
    if (metrics.has(cost.metric))
      throw Error("Declare each work metric once: " + cost.metric);
    metrics.add(cost.metric);
  }
  const costOrigins = origins("costs", costs.length);
  for (let i = 0; i < costs.length; i++) {
    const proposedIndex = costOrigins.indexOf(i);
    const cost = costs[i],
      proposed = proposedIndex < 0 ? undefined : next.costs[proposedIndex];
    if (
      cost &&
      proposed &&
      JSON.stringify(before.costs[i]) === JSON.stringify(proposed)
    )
      continue;
    if (!proposed) {
      replace(cost!.span, "", `Cost ${cost!.metric}`);
      continue;
    }
    const clause = operationCostSource(
      proposed,
      declaration.kind === "flow" ? "overhead" : "cost",
    );
    replace(cost!.span, clause, `Cost ${cost!.metric}`);
  }
  costOrigins.forEach((origin, i) => {
    if (origin === null)
      added.push(
        operationCostSource(
          next.costs[i]!,
          declaration.kind === "flow" ? "overhead" : "cost",
        ),
      );
  });
  // Named budgets and bounds retain their original clause locations and notes.
  for (const kind of ["budget", "bound"] as const) {
    const clauses = declaration.meta.clauses.filter((c) => c.kind === kind);
    const old =
      kind === "budget"
        ? (before.budgets ?? []).map((b) => ({
            key: b.metric,
            source: `budget ${b.metric} <= ${b.expression}`,
          }))
        : (before.bounds ?? []).map((b) => ({
            key: b.parameter,
            source: `bound ${b.parameter} <= ${b.maximum}`,
          }));
    const proposed =
      kind === "budget"
        ? (next.budgets ?? before.budgets ?? []).map((b) => {
            checkSourceName(b.metric, "Budget metric");
            return {
              key: b.metric,
              source: `budget ${b.metric} <= ${authoringExpression(b.expression, "Budget for " + b.metric, "100")}`,
            };
          })
        : (next.bounds ?? before.bounds ?? []).map((b) => {
            checkSourceName(b.parameter, "Bound input");
            if (!declaration.params.some((p) => p.name === b.parameter))
              throw Error("Choose an existing input for bound: " + b.parameter);
            if (!/^\d+$/.test(b.maximum))
              throw Error(
                "A bound maximum must be a nonnegative whole number.",
              );
            return {
              key: b.parameter,
              source: `bound ${b.parameter} <= ${b.maximum}`,
            };
          });
    if (new Set(proposed.map((p) => p.key)).size !== proposed.length)
      throw Error("Declare each " + kind + " once.");
    if (clauses.length !== old.length)
      throw Error(
        "Repeated " +
          kind +
          " clauses require Text; their original locations are kept.",
      );
    old.forEach((item, i) => {
      const next = proposed.find((p) => p.key === item.key);
      if (next?.source !== item.source)
        replace(clauses[i]!.span, next?.source ?? "", kind + " " + item.key);
    });
    proposed
      .filter((p) => !old.some((o) => o.key === p.key))
      .forEach((p) => added.push(p.source));
  }
  if (added.length) {
    const at =
      declaration.kind === "flow"
        ? declaration.bodySpan!.start
        : declaration.span.end - 1;
    if (![";", "{"].includes(source.text[at]!))
      throw Error(
        "The operation's source boundary is unavailable. Check the source again.",
      );
    const prefix = source.text.slice(0, at),
      whitespace = prefix.match(/[ \t]*$/)![0].length;
    const start = at - whitespace;
    const multiline =
      source.text.slice(declaration.span.start, at).includes("\n") ||
      declaration.kind === "flow";
    edits.push({
      span: { file: source.file, start, end: at },
      before: source.text.slice(start, at),
      text: multiline
        ? (source.text[start - 1] === "\n" ? "" : "\n") +
          added.join("\n") +
          "\n"
        : " " + added.join(" "),
    });
  }
  return sourceEditPreview(
    ir,
    source.file,
    edits,
    [symbolId],
    [
      declaration.kind === "flow"
        ? "Caller rules constrain each call. Return guarantees are obligations checked against this component. Overhead is additional declared work, and budgets constrain the calculated total."
        : "Caller rules constrain each call. Return guarantees and work summaries remain assumptions about the external implementation.",
      "Other operation clauses and caller source were retained. Review comments near changed rules and check affected callers before relying on this contract.",
    ],
  );
}
