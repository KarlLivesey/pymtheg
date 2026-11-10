# Finite event models in Blocks

Status: source writer, recoverable form, MCP and real backend probes are
implemented. The real GUI restart/counterexample/correction journey passes
in Chromium, Firefox and WebKit. Existing Text machine semantics remain
authoritative. This extension was not part of the frozen fourteenth review.

## Journey and ownership

Choose **Add to this design → Event model**. Describe state values, the events
that can change them, and safety rules that should always hold. Preview the
generated source and apply to the same unsaved buffer. Check or simulate the
model using existing controls; counterexamples retain original source mappings.
No new execution engine or second visual language is introduced.

The structured draft belongs to the existing declaration form and recovery
record. Source remains authoritative after application. Existing source/hash,
preview-generation, recovery and undo guards must apply unchanged. Initial
support creates machines; it does not rewrite existing machine declarations.

## Semantics and limits

- State types: Bool, Nat and Int. Numbers require explicit inclusive finite
  bounds; backwards bounds and negative Nat domains are refused before preview.
- Events have a guard and simultaneous state assignments, using existing
  old-state semantics. Unassigned state stays unchanged. There is no event
  ordering, fairness or eventual-completion promise.
- Blank value, guard and safety-expression fields become named `unknown`
  expressions, never zero/false/true or a vacuous pass. Blank names remain
  editable drafts but must be supplied before preview.
- Expression fields accept existing Pymtheg expressions, with visible examples.
  The real parser validates field boundaries; a field cannot inject a second
  declaration or statement. Name/type/finite-backend checking remains in the
  canonical checker, not in browser code.
- At most 20 states, 20 events, 20 assignments per event and 20 safety rules.
  Draft fields retain incomplete values; explicit caps refuse expansion without
  evicting work. Numeric values remain decimal strings until BigInt validation.
- Source creation is limited to 256 KiB. User expressions and generated names
  are shown in the ordinary preview. No source is saved automatically.

## First probes

1. Create a count model, increment twice and violate `count <= 1`; obtain a real
   source-mapped finite counterexample. Change the guard and recheck.
2. Leave guard/value/rule blank; emitted source parses but claims stay incomplete.
3. Try backwards/missing ranges, missing assignment targets, duplicate names,
   expression injection and stale preview hashes. Refuse without changing source.
4. Restart with an unfinished numeric field, recover it, apply, switch to Text
   and undo. Navigate form using a keyboard at narrow and normal sizes.

Source, real-backend and browser evidence for these probes is recorded below.

## Evidence so far

`machine-authoring.test.mjs` verifies explicit unresolved expressions, invalid
range/target/duplicate/injection refusal, preserved source and a source-replayed
counterexample. `machine-authoring-mcp.test.mjs` exercises the real agent server
and confirms unsaved output remains unresolved until its questions are answered.
`machine-authoring.integration.mjs` has four passing real Quint/TLC checks with
no skips: both engines find the two-step violation; the corrected guard has no
violation within sampled/finite scope respectively. The first integration probe
used the wrong report location field; its failure is retained separately from
the corrected run in `evidence/product-audit/parent-machine-authoring-backend*.txt`.

Passing browser journey: `studio-machine-authoring.browser.mjs` covers unfinished-field
restart, keyboard focus after structural changes, narrow layout/accessibility,
the real counterexample and an existing Blocks guard edit to fix it. Passing
runs do not establish a new independent readiness score; the current audit
retains cross-browser and assistive-technology limitations.
