// SPDX-License-Identifier: MIT
import { sourceFileName } from "../shared/identity-values.js";
import { readSignatureEdit } from "./interface-data.js";
import {
  buildInterface,
  type InterfaceContext,
  type InterfaceType,
} from "./interface-builder.js";
import { identifierProblem } from "../shared/names.js";
/** Small editable starting points. The compiler remains their sole semantic authority. */
export type InputType = "Nat" | "Int" | "String" | "Bool";
export interface RecipeOptions {
  items: string;
  calls: string;
  budget: string;
  age: string;
  name: string;
  deduplicate: boolean;
  inputs: {
    name: string;
    type: InterfaceType;
    mode?: "value" | "take" | "borrow";
  }[];
  output: InterfaceType;
  effects?: { kind: string; target: string }[];
}
export const defaultRecipeOptions: RecipeOptions = {
  items: "200",
  calls: "3",
  budget: "500",
  age: "18",
  name: "main",
  deduplicate: false,
  inputs: [{ name: "quantity", type: "Nat" }],
  output: "Unit",
};
export const recipes = [
  {
    id: "work",
    title: "Keep work within a budget",
    description:
      "See how repeated calls multiply, then change the design before building it.",
    filename: sourceFileName("work-budget"),
    concepts: [
      ["Operation", "One piece of work, such as fetching a price."],
      ["Flow", "The steps your program performs."],
      ["Budget", "The most work you want those steps to require."],
    ],
  },
  {
    id: "decision",
    title: "Define a reusable decision",
    description:
      "Put a business rule in one place so every caller uses the same decision.",
    filename: sourceFileName("eligibility"),
    concepts: [
      ["Rule", "A decision that returns a value without changing anything."],
      ["Input", "A value the caller supplies."],
      ["Bool", "A yes-or-no answer: true or false."],
    ],
  },
  {
    id: "retry",
    title: "See why a retry can do work twice",
    description:
      "Explore a lost acknowledgement, then make repeating the request safe.",
    filename: sourceFileName("retry-design"),
    concepts: [
      [
        "Acknowledgement",
        "The caller learning that work finished. Losing it does not undo the work.",
      ],
      [
        "Idempotency",
        "Repeating the same request has the same effect as doing it once.",
      ],
      [
        "Counterexample",
        "One possible sequence of events that breaks a stated rule.",
      ],
    ],
  },
  {
    id: "resource",
    title: "Handle a file safely",
    description:
      "Describe success, read failure and cancellation with cleanup on every exit.",
    filename: sourceFileName("file-processing"),
    concepts: [
      ["Resource", "Something your program must clean up."],
      ["Outcome", "One of the ways a step can finish."],
      ["Cancellation", "Stopping early still needs cleanup."],
    ],
  },
  {
    id: "uncertain",
    title: "Plan for an uncertain response",
    description:
      "Make a missing external response visible without assuming nothing happened.",
    filename: sourceFileName("external-response"),
    concepts: [
      [
        "Unknown outcome",
        "A request may have taken effect even if its reply was lost.",
      ],
      ["Unknown decision", "A question the design still needs to answer."],
      ["Effect", "Which service or resource a step can change."],
    ],
  },
  {
    id: "component",
    title: "Describe inputs and outputs",
    description:
      "Name a component and the values it receives and returns, without writing its implementation.",
    filename: sourceFileName("component"),
    concepts: [
      ["Input", "A value passed into this component by its caller."],
      ["Output", "The value its caller gets back."],
      [
        "Not decided yet",
        "A question to answer later, kept visible in the design.",
      ],
    ],
  },
  {
    id: "blank",
    title: "Blank design",
    description: "Add parts with friendly forms and Blocks, or write in Text.",
    filename: sourceFileName("my-design"),
    concepts: [
      [
        "Unknown decision",
        "An unfinished design question stays visible to the checker.",
      ],
    ],
  },
] as const;
export type RecipeId = (typeof recipes)[number]["id"];
export function recipeSource(
  id: RecipeId,
  options: RecipeOptions,
  context?: InterfaceContext,
): string {
  const natural = (value: string, label: string) => {
    if (!/^\d{1,30}$/.test(value))
      throw Error(`${label} must be a nonnegative whole number.`);
    return BigInt(value).toString();
  };
  if (id === "component")
    return buildInterface(
      options.name,
      options.inputs,
      options.output,
      options.effects,
      context,
    );
  if (id === "work") {
    const items = natural(options.items, "Maximum items"),
      budget = natural(options.budget, "Call budget"),
      calls = natural(options.calls, "Calls for each item");
    if (BigInt(calls) > 20n)
      throw Error("Choose at most 20 calls for each item in this recipe.");
    return `// Each fetch counts as one external call. No service is actually contacted.\n// Atomic contract assumption: this simple count example ignores in-flight requests.\nop fetch() -> Unit effects(remote.Service) cost remote_calls exact 1 atomic;\n\n// Item count may be zero, up to ${items}. The budget is a limit, not extra work.\nflow main(items: Nat) -> Unit\n effects(remote.Service) bound items <= ${items} budget remote_calls <= ${budget} {\n for item in items {\n${Array.from({ length: Number(calls) }, () => "  call fetch();").join("\n")}\n }\n}\n`;
  }
  if (id === "decision") {
    const age = natural(options.age, "Minimum age");
    return `// Define the decision once; callers reuse it.\nrule eligible(age: Nat) -> Bool = age >= ${age};\n\n// This example explores ages from 0 to 120.\nflow main(age: Nat) -> Bool bound age <= 120 {\n return eligible(age);\n}\n`;
  }
  if (id === "retry")
    return `// One request, at most two attempts. Provider work and acknowledgement are separate events.
// The invariant asks that the request's effect happen at most once.
machine RetryDesign {
 state pending: Bool = false;
 state effected: Bool = false;
 state acknowledged: Bool = false;
 state deliveries: Nat in 0..2 = 0;
 state attempts: Nat in 0..2 = 0;
 event enqueue when !pending && !acknowledged && attempts < 2 {
  pending = true; effected = false; attempts = attempts + 1;
 }
 event performWork when pending && !effected {
  deliveries = ${options.deduplicate ? "1" : "deliveries + 1"}; effected = true;
 }
 event loseAcknowledgement when pending && effected { pending = false; }
 event receiveAcknowledgement when pending && effected { pending = false; acknowledged = true; }
 invariant atMostOnce = deliveries <= 1;
}
`;
  if (id === "resource")
    return `// A file must reach Closed before this flow finishes.\n// Atomic read assumption: this recipe models completed reads, not in-flight IO.\nresource File {\n states Open, Closed; initial Open; terminal Closed;\n Open -> Closed; Closed -> Closed;\n}\ntype ReadErrors = InvalidData;\nop read(borrow file: File) -> Result<Unit, ReadErrors>\n effects(read.File) cost file_reads exact 1 atomic;\n\nflow main() -> Unit effects(read.File, state.File) {\n own file: File;\n call read(borrow file) as outcome;\n match outcome {\n  Ok(value) => { transition file -> Closed; return unit; }\n  InvalidData => { transition file -> Closed; return unit; }\n }\n} on cancel { transition file -> Closed; }\n`;
  if (id === "uncertain")
    return `// A lost response is different from a definite rejection.\ntype SubmitErrors = Declined | OutcomeUnknown;\nop submit() -> Result<Unit, SubmitErrors>\n effects(remote.Provider) cost remote_calls exact 1;\n\nflow main() -> Result<Unit, SubmitErrors> effects(remote.Provider) {\n call submit() as outcome;\n match outcome {\n  Ok(value) => { return Ok(unit); }\n  Declined => { return Declined; }\n  OutcomeUnknown => {\n   unknown "How will we find out whether the request took effect?";\n   return OutcomeUnknown;\n  }\n }\n}\n`;
  return '// Write a small design question before implementing it.\nflow main() -> Unit {\n unknown "What should happen next?";\n}\n';
}

export interface RecipeFormDraft {
  id: RecipeId;
  options: RecipeOptions;
  path: string;
  choosing: boolean;
}
export function readRecipeFormDraft(value: unknown): RecipeFormDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid new-design draft");
  const v = value as Record<string, unknown>;
  if (
    !recipes.some((r) => r.id === v.id) ||
    typeof v.path !== "string" ||
    v.path.length > 4096 ||
    typeof v.choosing !== "boolean" ||
    !v.options ||
    typeof v.options !== "object"
  )
    throw Error("Invalid new-design draft");
  const o = v.options as Record<string, unknown>;
  for (const key of ["items", "calls", "budget", "age", "name"])
    if (typeof o[key] !== "string" || o[key].length > 120)
      throw Error("Invalid recipe field");
  if (typeof o.deduplicate !== "boolean") throw Error("Invalid recipe choice");
  const edit = readSignatureEdit(
    {
      name: o.name,
      inputs: o.inputs,
      output: o.output,
      effects: o.effects ?? [],
    },
    true,
  );
  return {
    id: v.id as RecipeId,
    path: v.path,
    choosing: v.choosing,
    options: {
      items: o.items as string,
      calls: o.calls as string,
      budget: o.budget as string,
      age: o.age as string,
      name: edit.name,
      deduplicate: o.deduplicate,
      inputs: edit.inputs,
      output: edit.output,
      effects: edit.effects,
    },
  };
}
