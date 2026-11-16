// SPDX-License-Identifier: MIT
import { evaluateScalar } from "../shared/scalar-expression.js";
import { hash } from "../shared/identity.js";
import { describeShape } from "./shape-description.js";
import { valueShape, guidedShapeLimits } from "./shapes.js";
import type { ProjectIR, Type } from "../semantic/core.js";
import { callable, variants, compatible } from "../semantic/core.js";
import { nodeKey, type Stmt } from "../language/ast.js";
import type { Span } from "../shared/identity.js";
import type {
  BlockDocument,
  BlockField,
  BlockSection,
  DesignBlock,
} from "./block-document.js";

export function describeBlocks(ir: ProjectIR, file: string): BlockDocument {
  const source = ir.snapshot.sources.find((s) => s.file === file);
  if (!source) throw Error("Check this file before opening its blocks.");
  const text = source.text;
  let ownerResult: Type | undefined;
  const shapeBudget = { remaining: guidedShapeLimits.perRun };
  let remaining = 1200,
    truncated = false;
  const slice = (s: Span) => text.slice(s.start, s.end);
  const field = (
    id: string,
    label: string,
    span: Span,
    help = "Use an input name, value or expression.",
    format: BlockField["format"] = "expression",
  ): BlockField => ({
    id,
    label,
    span: { start: span.start, end: span.end },
    format,
    help,
  });
  const child = (
    parent: DesignBlock,
    id: string,
    kind: string,
    title: string,
    span: Span,
    summary: string,
  ): DesignBlock | undefined => {
    if (remaining-- <= 0) {
      truncated = true;
      return;
    }
    const item: DesignBlock = {
      id,
      kind,
      title,
      span,
      summary,
      fields: [],
      sections: [],
    };
    (parent.children ??= []).push(item);
    return item;
  };
  const childField = (
    item: DesignBlock,
    label: string,
    span: Span,
    help: string,
  ) => {
    if (remaining-- <= 0) {
      truncated = true;
      return;
    }
    item.fields.push(
      field(`${item.id}/${item.fields.length}`, label, span, help),
    );
  };
  function section(
    id: string,
    label: string,
    span: Span,
    statements: Stmt[],
  ): BlockSection {
    const blocks: DesignBlock[] = [];
    // One reverse pass per scope; nested scopes are considered independently.
    const handledCalls = new Set<Stmt>();
    const consumed = new Set<string>();
    for (let i = statements.length - 1; i >= 0; i--) {
      const statement = statements[i]!;
      if (statement.kind === "invoke" && statement.binding) {
        if (consumed.has(statement.binding)) handledCalls.add(statement);
        consumed.delete(statement.binding);
      } else if (
        statement.kind === "match" ||
        statement.kind === "return" ||
        statement.kind === "propagate"
      ) {
        if (statement.expr.kind === "name") consumed.add(statement.expr.name);
      } else if (statement.kind === "if" && statement.test.kind === "name") {
        consumed.add(statement.test.name);
      }
    }
    for (const [index, statement] of statements.entries()) {
      if (remaining-- <= 0) {
        truncated = true;
        break;
      }
      const projected = project(statement, `${id}/${index}`);
      if (projected.callResult)
        projected.callResult.hasOutcomeStep = handledCalls.has(statement);
      blocks.push(projected);
    }
    const scope = ir.blockResources.get(nodeKey(span));
    const resources = (scope?.bindings ?? []).flatMap((binding) => {
      const resource = ir.symbols.get(binding.resourceId);
      return resource?.kind === "resource"
        ? [
            {
              name: binding.name,
              resource: resource.name,
              states: resource.states.slice(0, 100),
              stateCount: resource.states.length,
            },
          ]
        : [];
    });
    return {
      id,
      label,
      span,
      blocks,
      resources,
      resourceCount: scope?.total ?? 0,
    };
  }
  function project(s: Stmt, id: string): DesignBlock {
    const b: DesignBlock = {
      id,
      kind: s.kind,
      title: s.kind,
      span: s.span,
      fields: [],
      sections: [],
      summary: "",
    };
    const f = (
      label: string,
      span: Span,
      help?: string,
      format?: BlockField["format"],
    ) =>
      b.fields.push(
        field(`${id}/${b.fields.length}`, label, span, help, format),
      );
    switch (s.kind) {
      case "for":
        b.title = `Repeat · ${s.name}`;
        f(
          "Number of repetitions",
          s.count.span,
          "A whole number or a bounded input, such as attempts.",
        );
        if (s.bodySpan)
          b.sections.push(
            section(id + "/body", "For each repetition", s.bodySpan, s.body),
          );
        break;
      case "retry":
        b.title = `Retry on ${s.outcome}`;
        f("Maximum attempts", s.count.span);
        if (s.bodySpan)
          b.sections.push(
            section(id + "/body", "Each attempt", s.bodySpan, s.body),
          );
        break;
      case "if":
        b.title = "Decide";
        f(
          "When this is true",
          s.test.span,
          "A yes/no expression, such as amount > 0.",
        );
        if (s.yesSpan)
          b.sections.push(section(id + "/yes", "Then", s.yesSpan, s.yes));
        if (s.noSpan)
          b.sections.push(section(id + "/no", "Otherwise", s.noSpan, s.no));
        break;
      case "match":
        b.title = "Handle each outcome";
        f("Outcome to inspect", s.expr.span);
        for (const [i, a] of s.arms.entries())
          if (a.bodySpan)
            b.sections.push(
              section(
                id + `/arm${i}`,
                a.tag + (a.binding ? ` · ${a.binding}` : ""),
                a.bodySpan,
                a.body,
              ),
            );
        break;
      case "invoke": {
        b.title = `Call ${s.name}`;
        b.summary = s.binding ? `Keep the result as ${s.binding}` : "";
        const target = ir.symbols.get(
          ir.info.get(nodeKey(s.span))?.target ?? "",
        );
        s.args.forEach((a, i) => {
          f(
            callableTarget(target)
              ? (target.params[i]?.name ?? `Input ${i + 1}`)
              : `Input ${i + 1}`,
            a.expr.span,
            a.mode === "borrow"
              ? "Borrow this resource for the call; ownership stays with this component."
              : a.mode === "take"
                ? "Transfer ownership to the callee. Its cleanup obligations still need checking."
                : undefined,
          );
          const input = b.fields.at(-1)!;
          const reason =
            a.expr.kind === "unknown"
              ? a.expr.reason
              : `Choose ${callableTarget(target) ? (target.params[i]?.name ?? `input ${i + 1}`) : `input ${i + 1}`}`;
          input.placeholder = reason;
          input.placeholderSource =
            a.expr.kind === "unknown"
              ? slice(a.expr.span)
              : `unknown ${JSON.stringify(reason)}`;
          if (a.expr.kind === "unknown") {
            const info = ir.info.get(nodeKey(a.expr.span));
            input.suggestions = info?.suggestions ?? [];
            input.suggestionsComplete = info?.suggestionsComplete ?? true;
          }
        });
        if (s.binding && callableTarget(target)) {
          const result = ir.types.get(nodeKey(target.result.span));
          const outcomes = result ? [...variants(ir, result)] : [];
          b.callResult = {
            binding: s.binding,
            hasOutcomeStep: false,
            canDecide: result?.kind === "primitive" && result.name === "Bool",
            propagate: result?.kind === "result",
            canReturn:
              !!result &&
              result.kind !== "error" &&
              !!ownerResult &&
              ownerResult.kind !== "error" &&
              compatible(result, ownerResult),
            outcomes: outcomes
              .slice(0, 40)
              .map(([tag, payload]) => ({ tag, payload: payload !== null })),
            outcomeCount: outcomes.length,
          };
        }
        break;
      }
      case "let":
        b.title = `Keep a value · ${s.name}`;
        f("Value", s.expr.span);
        break;
      case "return":
        b.title = "Return a result";
        f("Result", s.expr.span);
        break;
      case "propagate":
        b.title = "Pass on the outcome";
        f("Outcome", s.expr.span);
        break;
      case "assert":
        b.title = "Require this to hold";
        f("Condition", s.expr.span);
        break;
      case "unknown":
        b.title = "Open question";
        if (s.reasonSpan)
          f(
            "What still needs deciding?",
            s.reasonSpan,
            "This remains an explicit gap in the design until resolved.",
            "text",
          );
        break;
      case "own":
        b.title = `Create ${s.resource} · ${s.name}`;
        b.summary = "This creates a cleanup obligation.";
        if (s.nameSpan)
          f(
            "Resource name",
            s.nameSpan,
            "A local name for this owned resource.",
          );
        if (s.resourceSpan)
          f(
            "Resource type",
            s.resourceSpan,
            "A resource declared in this design or its imports.",
          );
        break;
      case "move":
        b.title = `Transfer ownership · ${s.name}`;
        b.summary =
          "The receiver and its cleanup responsibility still need to be specified; a bare transfer stays unresolved.";
        if (s.nameSpan)
          f("Resource name", s.nameSpan, "The owned resource to transfer.");
        break;
      case "transition": {
        b.title = `Change ${s.name} to ${s.state}`;
        if (s.nameSpan)
          f(
            "Resource name",
            s.nameSpan,
            "The resource whose state changes here.",
          );
        if (s.stateSpan) {
          f(
            "Destination state",
            s.stateSpan,
            "Declared states are choices, not proof of a legal transition. Check this path after changing it.",
          );
          const type = ir.info.get(nodeKey(s.span))?.type;
          const resource =
            type?.kind === "nominal" ? ir.symbols.get(type.id) : undefined;
          if (resource?.kind === "resource") {
            b.fields.at(-1)!.choices = resource.states.slice(0, 100);
            if (resource.states.length > 100)
              b.fields.at(-1)!.help +=
                " Showing the first 100 states; use Text for others.";
          }
        }
        break;
      }
    }
    return b;
  }
  const blocks: DesignBlock[] = [];
  for (const [i, d] of source.parsed.declarations.entries()) {
    if (remaining-- <= 0) {
      truncated = true;
      break;
    }
    const id = `declaration/${i}`;
    const b: DesignBlock = {
      id,
      kind: d.kind,
      title: d.name,
      span: d.span,
      fields: [],
      sections: [],
      summary: "",
      symbolId: d.id,
    };
    if (callable(d)) {
      b.canAddCancellation = d.kind === "flow" && !d.cancel;
      ownerResult = ir.types.get(nodeKey(d.result.span));
      b.summary = `${d.params.map((p) => `${p.name}: ${describeShape(valueShape(ir, ir.types.get(nodeKey(p.type.span)), shapeBudget))}`).join(" · ") || "No inputs"} → ${describeShape(valueShape(ir, ir.types.get(nodeKey(d.result.span)), shapeBudget))}`;
      if (d.bodySpan && d.body)
        b.sections.push(section(id + "/body", "Steps", d.bodySpan, d.body));
      if (d.cancelSpan && d.cancel)
        b.sections.push(
          section(id + "/cancel", "If cancelled", d.cancelSpan, d.cancel),
        );
      if (d.expr)
        b.fields.push(
          field(
            id + "/expression",
            "Decision",
            d.expr.span,
            "A pure expression using the declared inputs.",
          ),
        );
    } else {
      b.summary = {
        type: "Data shape",
        resource: "Resource lifecycle",
        machine: "Finite event model",
      }[d.kind];
      if (d.kind === "resource")
        b.lifecycle = {
          states: d.states.slice(0, 40),
          initial: d.initial,
          terminal: d.terminal.slice(0, 40),
          transitions: d.transitions.slice(0, 40),
          stateCount: d.states.length,
          terminalCount: d.terminal.length,
          transitionCount: d.transitions.length,
        };
      if (d.kind === "type") {
        if (d.fields)
          for (const [index, member] of d.fields.entries()) {
            const item = child(
              b,
              `${id}/field/${index}`,
              "data-field",
              member.name,
              member.span,
              "Data passed in this field.",
            );
            if (!item) break;
            childField(
              item,
              "Field type",
              member.type.span,
              "A type such as Nat, String, List<Item>, or a named data shape. Changes can affect callers.",
            );
          }
        else
          for (const [index, variant] of d.variants.entries()) {
            const item = child(
              b,
              `${id}/variant/${index}`,
              "outcome",
              variant.name,
              variant.span,
              variant.payload
                ? "This outcome carries a value."
                : "This outcome carries no additional value.",
            );
            if (!item) break;
            if (variant.payload)
              childField(
                item,
                "Carried value type",
                variant.payload.span,
                "The data carried by this outcome. Changing it can affect every handler.",
              );
          }
      }
      if (d.kind === "machine") {
        for (const [index, state] of d.states.entries()) {
          const item = child(
            b,
            `${id}/state/${index}`,
            "state-value",
            state.name,
            state.span,
            state.min !== null && state.max !== null
              ? `Allowed values: ${state.min} to ${state.max}.`
              : "A value kept between events.",
          );
          if (!item) break;
          childField(
            item,
            "State type",
            state.type.span,
            "Finite event state supports Bool, Nat or Int. Edit numeric bounds together using Apply range.",
          );
          if (
            (state.type.name === "Nat" || state.type.name === "Int") &&
            state.minSpan &&
            state.maxSpan
          ) {
            const min = slice(state.minSpan),
              max = slice(state.maxSpan);
            // Embedded comments between a minus and its digits belong to Text.
            if (/^-?\s*\d+$/.test(min) && /^-?\s*\d+$/.test(max))
              item.numericRange = {
                key: `${d.name}/${state.name}`,
                label: `${d.name}.${state.name}`,
                hash: hash(slice(state.span)),
                type: state.type.name,
                min,
                max,
                minSpan: state.minSpan,
                maxSpan: state.maxSpan,
              };
            if (item.numericRange) {
              try {
                const initial = evaluateScalar(state.init, {});
                if (typeof initial === "bigint")
                  item.numericRange.initialValue = String(initial);
              } catch {
                /* unresolved initial value stays explicit in the checked source */
              }
            }
          }
          childField(
            item,
            "Initial value",
            state.init.span,
            "The value before the first event.",
          );
        }
        for (const [index, event] of d.events.entries()) {
          const item = child(
            b,
            `${id}/event/${index}`,
            "event",
            event.name,
            event.span,
            "Changes happen together, using values from before this event.",
          );
          if (!item) break;
          childField(
            item,
            "When this can happen",
            event.guard.span,
            "A yes/no condition on the current state. The event is unavailable when false.",
          );
          for (const update of event.updates)
            childField(
              item,
              `Set ${update.name}`,
              update.expr.span,
              `The new value for ${update.name}, using the state before this event.`,
            );
        }
        for (const [index, invariant] of d.invariants.entries()) {
          const item = child(
            b,
            `${id}/invariant/${index}`,
            "invariant",
            invariant.name,
            invariant.span,
            "A condition to check in every reachable state.",
          );
          if (!item) break;
          childField(
            item,
            "Must always hold",
            invariant.expr.span,
            "A yes/no condition. Writing it declares a requirement; run a behavioural check to test it.",
          );
        }
      }
    }
    blocks.push(b);
  }
  const calls = [...(ir.visibleSymbols.get(file)?.entries() ?? [])].flatMap(
    ([name, ids]) => {
      const d = ids.length === 1 ? ir.symbols.get(ids[0]!) : undefined;
      return d && callable(d) && d.kind !== "rule"
        ? [
            {
              name,
              params: d.params.map((p) => ({ name: p.name, mode: p.mode })),
              returnsUnit: d.result.name === "Unit",
            },
          ]
        : [];
    },
  );
  const resourceTypes = [
    ...(ir.visibleSymbols.get(file)?.entries() ?? []),
  ].flatMap(([name, ids]) => {
    const resource = ids.length === 1 ? ir.symbols.get(ids[0]!) : undefined;
    return resource?.kind === "resource"
      ? [{ name, initial: resource.initial }]
      : [];
  });
  return {
    snapshotId: ir.snapshot.id,
    file,
    text,
    parsed: !source.recovered,
    truncated,
    blocks,
    calls,
    resourceTypes: resourceTypes.slice(0, 100),
    resourceTypeCount: resourceTypes.length,
  };
}
function callableTarget(
  d: import("../language/ast.js").Decl | undefined,
): d is import("../language/ast.js").Callable {
  return !!d && callable(d);
}
