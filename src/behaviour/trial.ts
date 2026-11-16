// SPDX-License-Identifier: MIT
import type { Span } from "../shared/identity.js";
import type { ProjectIR } from "../semantic/core.js";
import { compileFlow, initialFlowStates, flowSuccessors } from "./flow.js";
import { json } from "../shared/identity.js";
import { type TrialResult } from "./trial-schema.js";
export * from "./trial-schema.js";
export function tryFlow(
  ir: ProjectIR,
  entry: string,
  inputs: Record<string, unknown>,
  inspection?: {
    maxSteps?: number;
    onViolation?: (error: {
      code: string;
      message: string;
      span: Span;
      condition?: Span;
    }) => void;
  },
): TrialResult {
  let plan: ReturnType<typeof compileFlow> | undefined;
  const result = (
    completion: TrialResult["completion"],
    steps: number,
    output: unknown,
    message: string,
  ): TrialResult => ({
    schema: "pymtheg.trial/v1",
    snapshotId: ir.snapshot.id,
    completion,
    steps,
    output,
    message,
    assumptions: [
      "One example execution with the chosen inputs; cancellation is not injected.",
      "An example result does not establish a property for all inputs.",
      ...(plan?.assumptions ?? []),
    ],
  });
  try {
    const declarations = ir.declarations.filter(
      (d) => (d.name === entry || d.id === entry) && d.kind === "flow",
    );
    const declaration = declarations[0];
    if (
      declarations.length !== 1 ||
      !declaration ||
      declaration.kind !== "flow"
    )
      return result("unsupported", 0, null, "Choose a unique structured flow.");
    const names = new Set(declaration.params.map((p) => p.name));
    if (
      Object.keys(inputs).some((name) => !names.has(name)) ||
      declaration.params.some((p) => !Object.hasOwn(inputs, p.name))
    )
      return result(
        "unsupported",
        0,
        null,
        "Supply exactly the declared input names; missing or unused inputs cannot be ignored.",
      );
    plan = compileFlow(
      ir,
      declaration.id,
      {
        inputs: Object.fromEntries(
          Object.entries(inputs).map(([name, value]) => [name, [value]]),
        ),
      },
      { allowHoles: true },
    );
    const states = initialFlowStates(plan);
    if (states.length !== 1)
      return result(
        "unsupported",
        0,
        null,
        "Choose exactly one value for each input.",
      );
    let current = states[0]!;
    const maximum = Math.min(10000, Math.max(0, inspection?.maxSteps ?? 10000));
    for (let steps = 0; steps <= maximum; steps++) {
      if (current.status === "returned")
        return result(
          "complete",
          steps,
          JSON.parse(json(current.result)) as unknown,
          "Returned value for these inputs.",
        );
      if (current.status === "violated") {
        if (current.error) inspection?.onViolation?.(current.error);
        return {
          ...result(
            "violated",
            steps,
            null,
            current.error?.message ??
              "This example violates a declared condition.",
          ),
          ...(current.error ? { violation: current.error } : {}),
        };
      }
      if (current.status !== "running")
        return result(
          "unsupported",
          steps,
          null,
          "This path did not return a value.",
        );
      const next = flowSuccessors(plan, current).filter(
        (edge) => edge.operation !== "cancel",
      );
      if (next.length !== 1)
        return result(
          "unsupported",
          steps,
          null,
          "This step has multiple possible outcomes. Use a scenario and simulation to explore them.",
        );
      current = next[0]!.state;
    }
    return result(
      "limited",
      maximum,
      null,
      "Example execution reached the step budget; no result is claimed.",
    );
  } catch (error) {
    return result("unsupported", 0, null, String(error));
  }
}
