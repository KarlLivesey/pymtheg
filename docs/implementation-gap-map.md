# Versioned plan, existing code and gap graphs

Karl requires a graph of the planned system, a graph of what exists in the
repository, and a readable comparison across selected versions. This is an
addition to the release scope. Existing architecture history and manual
`implemented` labels do not satisfy it.

## Current capability and acceptance boundary

The workspace retains independent plan and code versions, explicit many-to-many
links, scoped graph/list views, per-link code review and simultaneous gap states.
The observed-code reader currently supports TypeScript and JavaScript; native
Rust, Go and Apex readers and generic reader plugins are not delivered. Code
body presence, stubs, signature differences and missing/unknown coverage stay
separate from behavioural conformance, which is not claimed.

Current tests and the 101-journey GUI record are linked from the
[current completion audit](current-completion-audit.md). Whole-product readiness
remains under independent review. The staged decisions below are retained as
history; older “planned” notes do not override this capability summary.

## Entities and evidence

- **Plan version:** an immutable architecture checkpoint plus the selected
  `.pym` snapshot. Existing IDs, source contracts and requirement links remain
  authoritative for intent.
- **Implementation version:** an immutable observation of selected repository
  files, their exact hashes, language-reader version, scope and optional Git
  commit. A dirty tree gets its own content identity; wall-clock order never
  defines equality or lineage.
- **Observed node:** a file-relative declaration identity, kind, qualified name,
  signature, body category and source span. Empty bodies, fail-fast stubs,
  declaration-only interfaces and actual body presence remain distinct facts.
- **Observed edge:** call, import, containment or type relationship, with a source
  span and resolution status. Dynamic or external targets remain unresolved;
  missing edges must not imply missing behaviour if the reader cannot resolve it.
- **Binding:** an explicit, revision-bound relation from a planned entity to an
  observed entity. Similar names are suggestions, not confirmed identity.
- **Gap:** no binding, missing bound entity in covered scope, declaration/stub,
  source change since accepted evidence, contract mismatch, unresolved coverage,
  or evidence requiring review. Code presence is not a behavioural proof.

## First implementation decisions

1. Add a language-neutral observed-graph schema and provider boundary. Existing
   output plugins remain separate: emitting code is not observing code.
2. Use the TypeScript compiler's parser and symbol resolver for the first real
   TypeScript/JavaScript reader. Do not approximate source declarations with
   regexes. Other languages can import the same observation schema; native
   readers must publish their support and uncertainty before being advertised.
3. Capture selected files once, then analyse their immutable text in an owned
   worker. Never execute the target project. Reader cancellation terminates the
   worker; partial discovery/parsing stays visible and cannot establish absence.
4. Preserve observations in the existing lossless architecture store and history
   export. Bindings and accepted implementation evidence belong to plan versions;
   refreshing code does not acknowledge a changed implementation automatically.
5. Separate node presence, signature evidence and behavioural evidence. Existing
   compiler-input generation may supply signature-check evidence only when a
   real check and its exact inputs are retained.
6. CLI and MCP expose the same snapshots and paged graphs/gaps. GUI presents
   Plan / Existing code / Gaps with independently selected version labels,
   scoped counts and accessible list alternatives to every graph interaction.
7. Default graph display is scoped to a selected component with bounded expansion.
   Do not render an entire large repository or compare every node pair.

## First probes and acceptance

| Probe | Required observation |
|---|---|
| Two files with renamed imports and a class method | Real declarations, source spans and resolved call edges from the parser |
| Declaration, empty body, fail-fast body and ordinary body | Four distinct body facts; none labels business behaviour proved |
| Same bytes on another machine | Relative IDs and identical content snapshot identity |
| One syntax-broken file next to a complete file | Partial coverage identified; complete file remains inspectable |
| Planned node bound to a deleted or excluded source | Missing only for covered scope; excluded/failed scope stays unknown |
| Code changes after a version was accepted | Old observation stays readable; gap appears against the new snapshot |
| Status says implemented but no code binding exists | Visible unconfirmed claim, not a completed implementation |
| TypeScript, Rust, Go and external provider imports | Shared schema; unsupported native readers are explicit |
| 10,000-node plan and observation | ID-indexed matching and bounded graph neighbourhoods, no all-pairs pass |
| CPU-heavy parse cancelled / files change mid-capture | Owned cleanup and stale evidence, never a complete observation |

## Delivery ledger

- Implemented first slice: observed-graph schema, real TS/JS parser/resolver,
  immutable explicit-file capture in an owned child process, and `pymtheg observe`.
  The first self-observation resolves real calls in the contract pipeline.
  Declaration and relationship coverage are separate; external calls remain
  unresolved. This slice is not yet the complete planned-versus-existing UI.
- Implemented and exercised: persistence, explicit many-to-many bindings, gap comparison, independent version selectors.
- Implemented and exercised: GUI graph/list views and MCP paging/agent workflow.
- Planned: additional native readers and generic provider import.
- Existing and retained: architecture checkpoint history, source contracts,
  source-linked plans, explicit compiler-check generation and underlying audits.

No 9.5 rating has been assigned. The current summary above and completion audit
distinguish implemented capabilities from deliberately unsupported readers and
unverified usability.

## Persistence and comparison decision (next slice)

Store the active observation and explicit bindings as internal native architecture
documents, covered by the existing atomic checkpoint/history/archive machinery.
Each observation creates a named checkpoint; older code graphs stay readable in
those checkpoints. A binding stores the selected plan's semantic content hash,
observed declaration/body hashes and observation identity. It is never inferred
from a similar name. Document refreshes preserve these native records.

The initial comparison reports unlinked plan, missing observed declaration in
covered scope, unknown coverage, declaration/empty/fail-fast body, code body
present, changed plan, or changed code. “Body present” is a structural observation,
not “implemented correctly”. Contract-equivalence across source languages and
behavioural conformance remain separate evidence, not inferred from a binding.
The GUI must show independently selected plan/code checkpoint names, source
coverage and a list alternative to its scoped graph. CLI/MCP page the same model.

### Working vertical slice

The named code snapshot and explicit plan/code links now persist in native
architecture documents and survive restart/history export. CLI `observe --retain`
retains a code version; Studio offers Planned system / Existing code / Implementation
gaps and independent checkpoint selectors. MCP exposes paged `read_implementation`
plus explicit metadata-writing capture/link tools. Source remains unchanged.

The first real browser journey captures a stub, links a requirement, captures an
implementation edit, then selects the earlier code version. Its states are
`fail-fast` and `code-changed`, not verified. That journey and automated axe check
pass; source-body review and subsequent refinements need their own final evidence.
Multiple-link add/remove, keyboard/narrow layout and version-switch journeys now
pass; graph queries run in an owned cancellable worker. Broader imported-history,
large-project discovery, additional reader/provider support and full linking-form
recovery remain open. No readiness score is assigned.

Each plan may retain up to 20 explicit declaration bindings (100,000 total).
An unfinished or changed part keeps the aggregate gap visible. New links record
an intent hash that includes design content and semantic source expectations;
status and administrative review metadata do not create false implementation drift.
Legacy links retain their old entity hash until explicitly renewed.

## Choosing source in a rolling project

The next capture improvement is a read-only, paged candidate-file inventory.
It lists regular TS/JS paths without reading or executing their contents; it is
not an implementation observation and must not imply that listed files parse.
Walk the requested project-relative directory breadth-first, skip dependency,
generated and hidden directories using the shared directory policy, and do not
follow discovered symlinks. Explicit captures remain available for excluded paths.

Bound file, directory and directory-entry counts, yield cooperatively and close
directory handles on cancellation. Return the exact counts and explicit warnings
when discovery is incomplete. A session-pinned inventory supports filtering and
paging without rescanning or silently mixing two inventories. Selection remains
explicit and the existing capture revalidates each selected file's bytes.

## Live source versus retained comparisons

A graph compares its selected saved plan and code checkpoints. Editing a linked
`.pym` contract on disk raises a live Needs attention item; it does not rewrite
the expectations recorded in an older plan. Explicitly accepting that contract
change updates the plan's intent, which marks its existing code link as changed.
An older selected checkpoint remains readable with its original comparison.
“Body present” means only that a body was observed, never that it conforms.

`plan-source-code-journey.test.mjs` exercises this full path through the production
service: link plan/source/code, edit a transitive input type, inspect attention,
accept the source change, see implementation drift, restart, and reopen the
original versions. Reads leave the stored history and implementation untouched.


New v9 captures also record lexical module bindings and observed dependencies.
A reviewed link can show **Dependency changed** when a constant or transitively
resolved callee changes while the linked function stays the same. The comparison
shows retained before/after dependency excerpts. Accepting the current link renews
only its review. This covers captured lexical references and resolved calls/types;
dynamic, external and cross-partition dependencies remain unknown. Older links
start this tracking only after a fresh capture and explicit review.


Receiver annotations and casts are not runtime target identities. Their method
calls, typed spreads, getter-returned functions, replacement constructors and
virtual/inherited receivers remain conservative where the actual callable cannot
be established. An isolated parse partition does not assume a `this` receiver has
no overriding class elsewhere. Static function initializers and ordinary concrete
object/class calls retain their controls. These limits affect relationship coverage,
not retained declaration/source completeness.
