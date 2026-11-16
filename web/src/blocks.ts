// SPDX-License-Identifier: MIT
/** Insertable syntax, not an alternate source interpreter. Placeholders remain editable. */
export const blocks = [
  {
    name: "flow",
    title: "Describe a component",
    detail: "Give it an input and say what it returns.",
    template:
      'flow ${name}(${input}: ${Nat}) -> ${Unit} {\n  unknown "What should this component do?";\n}',
  },
  {
    name: "rule",
    title: "Name a reusable decision",
    detail:
      "A pure rule returns a value without changing resources or services.",
    template: "rule ${name}(${input}: ${Nat}) -> Bool = ${input} >= 0;",
  },
  {
    name: "op",
    title: "Declare work done elsewhere",
    detail: "Describe the interface without implementing its adapter.",
    template: "op ${name}(${input}: ${String}) -> ${Unit};",
  },
  {
    name: "call",
    title: "Call an operation",
    detail: "Use a declared operation. Suggestions show the inputs it expects.",
    template: "call ${operation}(${argument});",
  },
  {
    name: "if",
    title: "Add a choice",
    detail: "Describe both paths of a decision.",
    template:
      'if ${condition} {\n  unknown "What happens when this is true?";\n} else {\n  unknown "What happens otherwise?";\n}',
  },
  {
    name: "return",
    title: "Return a value",
    detail: "End this path with the output promised by the component.",
    template: "return ${value};",
  },
  {
    name: "unknown",
    title: "Leave a visible question",
    detail:
      "Keep a missing design decision explicit; dependent claims stay incomplete.",
    template: 'unknown "${What still needs deciding?}";',
  },
] as const;
