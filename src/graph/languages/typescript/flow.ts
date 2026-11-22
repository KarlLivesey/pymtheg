// SPDX-License-Identifier: MIT
import ts from "typescript";

/**
 * Control-flow graphs the compiler's flow analysis would not leave.
 *
 * `getTypeAtFlowNode` (TypeScript 5.9) follows a flow node's single
 * successor in a `while (true)` loop without counting: past an assignment,
 * call or array mutation that yields no type, past a label with one
 * antecedent, and from a function's start to its container's flow node. If
 * those steps lead back to a node already passed, the loop never ends and
 * allocates nothing, so no stack or memory limit stops it (microsoft/
 * TypeScript's `unreachableFlowAfterThrowingForHead1.ts`). The steps are a
 * property of the binder's graph, so whether they can cycle is decided
 * before any checker query, from the source alone. Every step that might
 * continue is taken (worst case), so a file is reported whenever the
 * compiler could loop. See docs/changes/C-26.md.
 */

type FlowNode = {
  flags: number;
  antecedent?: FlowNode | FlowNode[];
  node?: { flowNode?: FlowNode };
};
/** The compiler's flow flags (internal; read at load so a change is loud). */
const F = (() => {
  const flags = (ts as unknown as { FlowFlags?: Record<string, number> })
    .FlowFlags;
  const names = ["Assignment", "Call", "ArrayMutation", "Label", "Start"];
  if (!flags || names.some((name) => typeof flags[name] !== "number"))
    throw Error("The pinned TypeScript compiler no longer exposes FlowFlags");
  return flags as Record<
    "Assignment" | "Call" | "ArrayMutation" | "Label" | "Start",
    number
  >;
})();

/**
 * Whether the single-successor walk from `start` comes back to a node it
 * passed. `memo` records the answer for every node on a finished walk.
 */
function cycles(start: FlowNode, memo: WeakMap<FlowNode, boolean>): boolean {
  const path: FlowNode[] = [];
  const seen = new Set<FlowNode>();
  let flow: FlowNode | undefined = start;
  let answer = false;
  while (flow) {
    const known = memo.get(flow);
    if (known !== undefined) {
      answer = known;
      break;
    }
    if (seen.has(flow)) {
      answer = true;
      break;
    }
    seen.add(flow);
    path.push(flow);
    const flags = flow.flags;
    if (flags & (F.Assignment | F.Call | F.ArrayMutation)) {
      flow = flow.antecedent as FlowNode | undefined;
      continue;
    }
    if (flags & F.Label) {
      const antecedents = flow.antecedent as FlowNode[] | undefined;
      if (antecedents?.length === 1) {
        flow = antecedents[0];
        continue;
      }
      break;
    }
    if (flags & F.Start && flow.node?.flowNode) {
      flow = flow.node.flowNode;
      continue;
    }
    break;
  }
  for (const node of path) memo.set(node, answer);
  return answer;
}

/**
 * The first node, in source order, whose flow analysis would not return,
 * for a bound source file; undefined when there is none.
 */
export function nonReturningFlow(
  source: ts.SourceFile,
  memo: WeakMap<FlowNode, boolean>,
): ts.Node | undefined {
  // Iterative, in source order: a deeply nested file must not exhaust the
  // stack here.
  const stack: ts.Node[] = [source];
  while (stack.length) {
    const node = stack.pop()!;
    const flows = node as ts.Node & {
      flowNode?: FlowNode;
      endFlowNode?: FlowNode;
      returnFlowNode?: FlowNode;
    };
    for (const flow of [
      flows.flowNode,
      flows.endFlowNode,
      flows.returnFlowNode,
    ])
      if (flow && cycles(flow, memo)) return node;
    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!);
  }
  return undefined;
}
