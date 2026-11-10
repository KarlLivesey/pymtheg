import type { Finding, Span } from "../shared/identity.js";
import type { Report } from "./report.js";
export interface SourceLocation extends Span {
  line: number | null;
  column: number | null;
  excerpt: string | null;
}
export interface ExplainedFinding extends Finding {
  title: string;
  why: string;
  nextStep: string;
  evidenceNote: string;
  location: SourceLocation;
  relatedLocations: SourceLocation[];
}
const guidance: Record<
  string,
  { title: string; why: string; nextStep: string }
> = {
  P001: {
    title: "This text is not a valid language token",
    why: "The source cannot be read reliably beyond this token.",
    nextStep:
      "Correct the character or close the quoted string at the highlighted position, then check again.",
  },
  P002: {
    title: "The source does not follow the grammar",
    why: "This declaration could not be parsed; dependent claims remain incomplete.",
    nextStep:
      "Correct the highlighted syntax using the grammar guide, starting with the first parser error.",
  },
  N001: {
    title: "A name is declared more than once",
    why: "Two declarations would make references ambiguous.",
    nextStep:
      "Rename or remove the duplicate and update its references; inspect the related original declaration.",
  },
  N002: {
    title: "This name has no visible declaration",
    why: "The checker cannot establish what value, type or component this reference means.",
    nextStep:
      "Correct the spelling or import and declare the intended component. Do not substitute an unknown value to hide it.",
  },
  L001: {
    title: "An imported source could not be loaded",
    why: "The project is missing part of its declared design.",
    nextStep:
      "Check the import path and file permissions. Restore the referenced file, then check again.",
  },
  L003: {
    title: "A source file was skipped during caller discovery",
    why: "The selected source can still be checked, but the importer inventory may be incomplete.",
    nextStep:
      "Repair the named file or narrow sources.include/exclude in .pymtheg.json. Use entry scope when you only want the selected import closure.",
  },
  L002: {
    title: "These imports form a cycle",
    why: "Cyclic module loading is outside the supported language subset.",
    nextStep:
      "Move shared declarations into a separate module so imports have a single direction.",
  },
  T001: {
    title: "This type declaration or use is invalid",
    why: "The specified type cannot be resolved with these arguments.",
    nextStep:
      "Use a declared type and the documented number of type arguments; inspect related declarations.",
  },
  T004: {
    title: "The number of arguments does not match",
    why: "The call or outcome payload does not match its declared signature.",
    nextStep:
      "Pass the declared number of arguments or payloads. Inspect the related declaration before changing the interface.",
  },
  T006: {
    title: "This outcome payload does not match its variant",
    why: "The selected tag and payload disagree with the declared result type.",
    nextStep:
      "Match the tag and payload binding to its union declaration; handle payload-free variants without a value.",
  },
  T007: {
    title: "This pure rule is recursive",
    why: "The initial pure expression subset requires rules whose evaluation terminates without recursion.",
    nextStep:
      "Use a supported bounded flow or remove the recursion. No recursive proof is inferred.",
  },
  C001: {
    title: "This statement cannot be reached",
    why: "An earlier return ends this path before the statement can run.",
    nextStep:
      "Remove the unreachable statement or move it onto a path that reaches it; do not count it as work performed.",
  },
  C003: {
    title: "A path finishes without its promised result",
    why: "Callers cannot rely on the signature on this path.",
    nextStep:
      "Return the declared type on every reachable exit, including branches and error handling.",
  },
  C005: {
    title: "A returned value violates the result contract",
    why: "The modelled return does not satisfy the declared postcondition.",
    nextStep:
      "Correct the return path or revise the postcondition to express the intended guarantee.",
  },
  E002: {
    title: "A called component has an uncovered effect",
    why: "An indirect call crosses the caller’s declared effect boundary.",
    nextStep:
      "Follow the related call path and check the exact service and effect. Change the design or explicitly widen its declaration.",
  },
  O001: {
    title: "Resource ownership must be explicit",
    why: "The checker needs to know which component owes cleanup.",
    nextStep:
      "Declare take for a transfer or borrow for permitted temporary access, according to the intended ownership.",
  },
  O002: {
    title: "This settlement contract is invalid",
    why: "A cleanup promise must name the actual resource parameter and declared outcomes.",
    nextStep:
      "Correct the settlement declaration and cover success, each error, and cancellation when guaranteed.",
  },
  O005: {
    title: "This action is not allowed through a borrow",
    why: "Temporary access does not grant ownership or permission to consume the resource.",
    nextStep:
      "Keep cleanup and transfer with the owner, or change the interface to transfer ownership explicitly.",
  },
  O006: {
    title: "The callee has not established cleanup",
    why: "Transferring a resource moves its obligation; it does not discharge it.",
    nextStep:
      "Specify and check the callee’s settlement on every outcome and cancellation, or return ownership for the caller to settle.",
  },
  O007: {
    title: "This ownership pattern is outside the supported subset",
    why: "The current analysis cannot justify cleanup for this resource shape or aliasing pattern.",
    nextStep:
      "Use a directly owned resource in the documented subset, or retain the unresolved obligation explicitly.",
  },
  O008: {
    title: "Repeated resource changes need an invariant",
    why: "Mutating an outer resource across iterations requires reasoning this analysis does not support.",
    nextStep:
      "Model a resource settled within each iteration, or leave the loop obligation unresolved until an invariant is supported.",
  },
  O009: {
    title: "This resource production contract is invalid",
    why: "A created handle needs a declared resource type and compatible result.",
    nextStep:
      "Match the creates clause, resource declaration and returned outcome payload.",
  },
  R001: {
    title: "The lifecycle declaration is inconsistent",
    why: "Its states or transitions refer to an invalid or duplicated state.",
    nextStep:
      "Correct the state names and declare the intended initial, terminal and transition states.",
  },
  R002: {
    title: "This lifecycle transition is not permitted",
    why: "The resource may be in a state from which this change is illegal.",
    nextStep:
      "Follow the reported path and use a declared transition valid for every possible current state.",
  },
  R003: {
    title: "The callee requires a different resource state",
    why: "The passed resource does not meet its declared starting state.",
    nextStep:
      "Establish the required state before transfer, or revise the callee’s contract if it should accept this state.",
  },
  K001: {
    title: "This cost declaration mixes work and limits",
    why: "Abstract cost, concrete overhead and budgets have separate meanings.",
    nextStep:
      "Use cost for an abstract operation summary, overhead for additional concrete work and budget for a constraint.",
  },
  K004: {
    title: "This budget has no matching work metric",
    why: "A limit alone does not define the work being counted.",
    nextStep:
      "Declare work in the same metric as the budget, or correct the metric name. A missing metric is not zero work.",
  },
  K005: {
    title: "This metric needs a different cost model",
    why: "Elapsed time and peak memory cannot be added like total work counts.",
    nextStep:
      "Use independent additive work metrics here; keep latency or peak-memory claims unresolved.",
  },
  K006: {
    title: "This work budget still needs a bound",
    why: "The symbolic work is retained, but the checker could not establish the budget for every allowed input.",
    nextStep:
      "Add relevant cardinality bounds or simplify the budget expression, then check again. A missing bound is not zero work.",
  },
  D001: {
    title: "Independent rules repeat the same decision",
    why: "These resolved, alpha-renamed rule bodies express the same logic.",
    nextStep:
      "Consider one named rule used by both callers; confirm they should share the same business decision.",
  },
  V001: {
    title: "These entry conditions cannot hold together",
    why: "An impossible entry could make safety claims vacuously true.",
    nextStep:
      "Correct conflicting conditions or explicitly document that this entry is intentionally unreachable.",
  },
  V002: {
    title: "These return guarantees cannot hold together",
    why: "No result can satisfy these guarantees for the declared inputs and types. An impossible assumption cannot justify a later call.",
    nextStep:
      "Correct the conflicting guarantees or caller conditions, then check again. Operation guarantees describe assumptions, not verified implementation behaviour.",
  },
  B001: {
    title: "This behaviour cannot be lowered as requested",
    why: "The selected model is outside the supported finite behavioural subset.",
    nextStep:
      "Read the stated capability reason and adjust the model or explicit scope. Unsupported behaviour is not a passed check.",
  },
  B010: {
    title: "The provider protocol does not match the call",
    why: "Submission and observable outcomes must agree with the operation’s declared result.",
    nextStep:
      "Connect the actual submit event and every declared outcome; preserve unknown responses separately from provider effects.",
  },
  B011: {
    title: "An event leaves a state's declared range",
    why: "The source-replayed event assigns a value outside the finite domain declared for this state.",
    nextStep:
      "Inspect the final event and its guard. Prevent the out-of-range update, or revise the declared range if the larger value is intended.",
  },
  B012: {
    title: "A starting value is outside its range",
    why: "The event model cannot start in the state you declared.",
    nextStep:
      "Change the starting value or its allowed range so the initial state is valid. Keep the safety rules that describe your intended behaviour.",
  },
  B014: {
    title: "Some scope values were not used",
    why: "The source failed before every supplied scenario value could constrain execution. The unused entries do not invalidate a separately replayed counterexample.",
    nextStep:
      "Inspect the counterexample, then correct or remove the listed scope entries before relying on any remaining property result.",
  },
  B101: {
    title: "The checker could not be prepared",
    why: "An integration prerequisite or temporary workspace failed.",
    nextStep:
      "Inspect the reported path or prerequisite and run doctor before retrying.",
  },
  B102: {
    title: "The checker process could not run",
    why: "The executable failed to start or finish under its requested settings.",
    nextStep:
      "Check the executable path and reported process error; this is no verdict about the design.",
  },
  B103: {
    title: "The checker version does not match",
    why: "The adapter relies on a pinned tool version and validated distribution.",
    nextStep:
      "Install the documented local version or point to the matching executable or JAR.",
  },
  B104: {
    title: "The checker failed during execution",
    why: "A crash or unexpected exit does not establish a model violation.",
    nextStep:
      "Inspect the process details, verify the installation and retry with an explicit supported configuration.",
  },
  B105: {
    title: "The checker output could not be validated",
    why: "Unrecognised output cannot be used as trustworthy evidence.",
    nextStep:
      "Preserve the failure details and check the pinned adapter/tool versions. Do not interpret this run as successful.",
  },
  B106: {
    title: "The trace does not match its source model",
    why: "A mapping or replay check rejected the witness.",
    nextStep:
      "Use the frozen source from this run and investigate the translation mismatch before trusting the trace.",
  },
  B107: {
    title: "Checker cleanup did not finish cleanly",
    why: "The analysis evidence and cleanup failure are separate facts.",
    nextStep:
      "Inspect the reported remaining resources and stop any identified owned checker before retrying.",
  },
  B124: {
    title: "The checker exhausted its time budget",
    why: "The requested analysis has not finished; absence of a found violation is inconclusive.",
    nextStep:
      "Reduce the explicit scope or deliberately increase the time budget and rerun.",
  },
  B130: {
    title: "This check was cancelled",
    why: "No completion claim can be made for unfinished work.",
    nextStep:
      "Review retained completed evidence or rerun the cancelled check when ready.",
  },
  I001: {
    title: "The tool could not complete this request",
    why: "An internal or input/output failure interrupted analysis.",
    nextStep:
      "Keep the error details and source snapshot, correct any stated environment issue and retry.",
  },
  T002: {
    title: "This value does not match the required type",
    why: "The caller and the declared interface disagree about what is passed.",
    nextStep:
      "Compare the argument with the related declaration. Change the argument, or revise the contract if that is the intended design.",
  },
  T003: {
    title: "This call does not match its signature",
    why: "A component cannot be used as declared until its arguments agree with its interface.",
    nextStep:
      "Check the number and types of arguments against the related declaration.",
  },
  T005: {
    title: "This field does not match the declared data shape",
    why: "The value and its record definition disagree about which data is available.",
    nextStep:
      "Check the field name and the related record declaration. Make the data contract explicit.",
  },
  C002: {
    title: "This outcome needs an explicit decision",
    why: "The declared outcomes and the way this result is handled do not agree.",
    nextStep:
      "Handle every declared outcome, or explicitly propagate it through a compatible result type. Do not treat an unknown external outcome as effect-free failure.",
  },
  C004: {
    title: "This call can violate a required condition",
    why: "The caller does not satisfy the callee’s stated precondition on the reported path.",
    nextStep:
      "Establish the precondition before the call, or revise the contract if it is too restrictive.",
  },
  C006: {
    title: "Review these candidate call arguments",
    why: "The call's inferred scalar argument ranges include values that fail a required condition. The checker has not established that the arguments can occur together on a reachable source path.",
    nextStep:
      "Try the reported values, inspect the caller's guards and correlations, and establish the rule before calling. This review candidate is not a confirmed counterexample or a proof that the call is safe.",
  },
  C007: {
    title: "A caller rule remains unresolved",
    why: "The supported analysis could not establish the required condition and did not infer concrete failing arguments. This is an unresolved obligation, not a confirmed failure.",
    nextStep:
      "Inspect the linked caller rule and inputs. Add supported guards or retain the obligation explicitly; use Try inputs for individual examples without treating them as a proof.",
  },
  C008: {
    title: "This assertion blocks its continuation",
    why: "No state in the supported inferred path conditions can satisfy this assertion. No executable counterexample is claimed.",
    nextStep:
      "Review the assertion and earlier guards or caller rules. Use Try inputs to inspect executions; removing an unreachable path does not establish the rest of the design.",
  },
  C009: {
    title: "A violation depends on reaching this path",
    why: "The inferred values fail a contract, but the analysis has not validated that execution can reach this call or return. This is not a confirmed counterexample.",
    nextStep:
      "Inspect the preceding guards and calls, then use Try inputs to investigate concrete executions. Keep the obligation open until reachability or safety is established.",
  },
  E001: {
    title: "Call this operation as a separate step",
    why: "Operations cannot be called inside pure expressions. Their work must be visible as an explicit call statement.",
    nextStep:
      "In a flow, use call operation(input) as result; then use result in the expression. In a pure rule, move the operation to its caller and pass in the value.",
  },
  O003: {
    title: "This resource is used after ownership was transferred",
    why: "The caller can no longer assume that it controls the transferred resource.",
    nextStep:
      "Stop using the old owner’s reference, or model an explicit return of ownership.",
  },
  O004: {
    title: "A resource may be left unsettled",
    why: "A modelled exit does not establish cleanup or a valid transfer of the outstanding obligation.",
    nextStep:
      "Inspect the reported exit and resource origin. Account for success, failure and cancellation; transferring ownership is not the same as closing.",
  },
  K002: {
    title: "This work bound exceeds the budget",
    why: "The calculated work bound is above the budget declared for this flow.",
    nextStep:
      "Inspect the contributing calls and iteration bounds. Reduce unnecessary work, or explicitly reconsider whether the budget is appropriate.",
  },
  U001: {
    title: "A design decision is still missing",
    why: "Checks that depend on this unknown cannot establish their claims. Independent completed checks remain useful.",
    nextStep:
      "Specify what should happen in this case. Keep the unknown visible until the decision has actually been made.",
  },
  W001: {
    title: "This repeated call is worth investigating",
    why: "Repeating this call may multiply work. Repetition alone does not mean it can safely be removed.",
    nextStep:
      "Check stable inputs, consistency guarantees and intervening changes before considering moving the call. Moving this call outside its repeated block is not automatically safe.",
  },
};
export function findingPresenter(report: Report) {
  const sources = new Map(
    report.snapshot.files.map((s) => {
      const starts = [0];
      for (let i = 0; i < s.text.length; i++)
        if (s.text[i] === "\n") starts.push(i + 1);
      return [s.file, { ...s, starts }] as const;
    }),
  );
  function location(span: Span): SourceLocation {
    const source = sources.get(span.file);
    if (!source) return { ...span, line: null, column: null, excerpt: null };
    let lo = 0,
      hi = source.starts.length;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (source.starts[mid]! <= span.start) lo = mid;
      else hi = mid;
    }
    const start = source.starts[lo]!,
      end = source.starts[lo + 1] ?? source.text.length;
    return {
      ...span,
      line: lo + 1,
      column: span.start - start + 1,
      excerpt: source.text.slice(start, Math.min(end, start + 800)).trimEnd(),
    };
  }
  const key = (d: Finding) =>
    JSON.stringify([d.code, d.span.file, d.span.start, d.message]);
  const evidence = new Map<string, Set<string>>();
  for (const result of report.results)
    for (const diagnostic of result.diagnostics) {
      const id = key(diagnostic),
        notes = evidence.get(id) ?? new Set<string>();
      const method = {
        structural: "Derived from the declared types and control flow.",
        abstract_interpretation:
          "A conservative check of the modelled paths; the risk may need a feasibility check.",
        simulation: "Explored through sampled runs within the recorded limits.",
        finite_model_check:
          "Checked within the recorded finite model and bounds.",
        heuristic: "An investigation suggestion, not a proof.",
      }[result.method];
      const completion =
        result.completion === "complete"
          ? "This check finished."
          : result.completion === "incomplete"
            ? "Related checks remain incomplete until their missing conditions are resolved."
            : `This check did not finish: ${result.completion.replaceAll("_", " ")}.`;
      notes.add(`${method} ${completion}`);
      evidence.set(id, notes);
    }
  return (finding: Finding): ExplainedFinding => {
    const notes = [...(evidence.get(key(finding)) ?? [])];
    let help = guidance[finding.code] ?? {
      title: finding.message,
      why: "This finding concerns the declared model at the source location shown.",
      nextStep:
        "Inspect the source, related declarations and property evidence before changing the design.",
    };
    if (finding.code === "E001") {
      const expression = sources
        .get(finding.span.file)
        ?.text.slice(finding.span.start, finding.span.end);
      if (
        expression &&
        expression.length <= 400 &&
        /^[A-Za-z_][\w.]*\s*\(/.test(expression)
      )
        help = {
          ...help,
          nextStep: `In a flow, use call ${expression} as result; then use result in later expressions. In a pure rule, move this operation to its caller and pass the value into the rule.`,
        };
    }
    if (finding.code === "E002") {
      const effect = finding.message.match(
        /does not cover ([A-Za-z_][\w.]*)/,
      )?.[1];
      if (effect) {
        const pure = finding.message.startsWith("Pure rule"),
          name = finding.path?.[0];
        help = {
          title: pure
            ? "This pure decision changes something"
            : "A declared effect is missing",
          why: pure
            ? "Pure rules cannot perform service or resource effects."
            : `This path can perform ${effect}, which its interface does not declare.`,
          nextStep: pure
            ? `Move the ${effect} work into an operation or flow; keep the rule pure.`
            : `If this effect is intended, add ${effect} to effects(...)${name ? " on " + name : ""}. Otherwise remove the work that causes it. Ownership and cleanup still need their own checks.`,
        };
      }
    }
    if (finding.code === "P002")
      help = {
        ...help,
        nextStep: `${finding.message.replace(/\.$/, "")}. Correct this location first; use “Add a block” for a valid starting shape.`,
      };
    if (
      finding.code === "R002" &&
      finding.message.endsWith("(during cancellation cleanup)")
    ) {
      const transition = /Illegal transition [\w.]+: ([\w.]+) -> ([\w.]+)/.exec(
        finding.message,
      );
      help = {
        ...help,
        title: "Cancellation cleanup is not valid from every reachable state",
        why: "Cancellation can follow any earlier step, including a path that has already completed cleanup. This handler must work from every state it can encounter.",
        nextStep:
          transition && transition[1] === transition[2]
            ? `This path is already in ${transition![1]}. If cleanup can safely do nothing in that state, explicitly allow ${transition![1]} -> ${transition![2]} in the lifecycle. Otherwise change the handler to match the real API; do not assume repeated cleanup is harmless.`
            : "Inspect the reachable state in this finding and the related lifecycle. Make cancellation cleanup valid from that state, or change the preceding path. Do not assume cleanup can be repeated safely.",
      };
    }
    if (finding.code === "B001") {
      const operation = finding.message.match(
        /Operation (\w+) has external effects/,
      )?.[1];
      if (operation)
        help = {
          ...help,
          nextStep: `For ${operation}, model request/effect/response with a protocol if they can interleave. Only if treating the call as one indivisible step is intended, add atomic before its semicolon; this is an environment assumption.`,
        };
    }
    if (finding.code === "B010" && finding.message.startsWith("Invariant "))
      help = {
        title: "A modelled safety rule can fail",
        why: "The source-replayed trace reaches a state where this rule is false.",
        nextStep:
          "Follow the trace to the final event and inspect the related rule. Correct the behaviour, or revise the rule only if it does not describe the intended design.",
      };
    return {
      ...finding,
      ...help,
      location: location(finding.span),
      relatedLocations: finding.related.map(location),
      evidenceNote: notes.length
        ? [...new Set(notes)].join(". ")
        : "Source-level diagnostic. It is not evidence about a production implementation.",
    };
  };
}
