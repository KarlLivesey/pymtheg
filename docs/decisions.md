# v0 decisions and adversarial review

Published before compiler implementation, 8 November 2026. The preserved
[initial map](../design/initial-system-map.md) is the prerequisite design, not
implementation evidence. This ledger refines its contracts. No approval gate.

## Settled boundaries

- TypeScript strict on Node 24 LTS; one package. (Amended in R1-A at Karl's
  request: Node 24 or newer, no upper bound; mega-plan 8.1.) Hand-written lexer/Pratt
  expression parser and recursive descent declarations/blocks: no framework,
  actual token spans and declaration-level recovery. UTF-16 half-open offsets,
  one-based UTF-16 columns. Whole file recovery holes taint that module; explicit
  expression/statement unknowns taint only their dependency closure.
- Source canonical paths identify modules. Unique names per module, explicit
  `import "path.pym";` brings declarations into scope; ambiguity is an error.
  Cycles are diagnosed (unsupported v0), diamonds load once. Symbol IDs combine
  canonical file and declaration name. Node IDs are snapshot-qualified offsets.
- Mathematical integers use bigint; JSON integers are decimal strings. Primitive
  Bool/Int/Nat/String/Unit, nominal records/unions, List<T>, Result<T,E>.
  Nat accepts nonnegative integer literals and embeds into Int; no other implicit coercions.
  Unions have optionally one payload; Result expands to Ok(T) plus error union.
  Match and `propagate value;` are the only outcome elimination mechanisms.
- Abstract `op` cost summaries are environment assumptions. Concrete `flow`
  costs derive from body plus explicitly named `overhead`; `budget` constrains,
  never adds work. No separate total annotation on concrete bodies. Each metric
  is independent. All loop/retry compositions with variable stopping are upper
  bounds; zero loops eliminate unreachable unknown costs. Unbounded recursive
  call SCCs have unknown costs. No arbitrary algebra expansion.
- Own/take and lexical read borrow only. Resources are explicit automata.
  All exits, including match alternatives/cancellation, preserve obligations.
  Transfer records a new obligation owner; abstract callees require `settles`
  summaries indexed by each result alternative and Cancelled. Absence leaves
  an obligation pending. No general aliasing or owned collections.
- `retry A on Variant { ... }` means at most A total executions. Local accounting
  is a conservative upper bound; retry outcomes must be declared result tags.
  Cancellation is an explicit alternative `on cancel { ... }` on a flow; checks
  conservatively observe it at every statement boundary. No hidden cleanup.
- Shared expression operators are pure left-to-right; &&/|| short circuit.
  No floating point, eval, division, user generic definitions or rule recursion.
  Simple literal contradictory requirements are diagnosed; other pre/post
  conditions remain pending logical obligations, not established contracts.
- Behaviour v0 is an explicit `machine` within the same project IR. Its finite
  state variables have declared closed integer/boolean domains. Guarded events
  have simultaneous assignments from the old state. Events are declared atomic
  assumptions. Split request/effect/response as separate events when necessary.
  Structured flows are locally analysed but not implicitly compiled to machines.
  No liveness/fairness proof. Unsupported lowering returns status 2.
- (Superseded: Quint and TLC were removed; see "TLC, Quint and Java removed" at
  the end of this ledger.) Quint 0.33.1 TypeScript simulation is mandatory integration; TLC invocation
  through Quint requires the Apalache distribution and is probed explicitly.
  Missing requested engine is integration failure, never skipped success.
  Counterexample replay uses the source machine transition relation, checks
  initial state, event IDs, domains and invariant failure. Renames/reordering do
  not alter semantics. No hardcoded domain identifiers.
- Parent coordinator owns signals, child process groups, deadlines, temporary
  directories, snapshots and atomic output replacement. CPU analyses execute in
  an owned worker so the parent remains signal-responsive. No cross-run cache.
  Backend output is bounded; timeout/crash/malformed output never means violation.

## Break-the-design walks

| Scenario | Required handling / design consequence |
|---|---|
| Incomplete checkout + complete pure flow | dependency closure blocks checkout only; per-symbol evidence |
| Edit during check | immutable read content; hash comparison marks stale before publication |
| Parser recovery feeds cost/type | recovery hole blocks affected module, no fabricated Unit/zero |
| Transfer to failing callee | per-outcome settlement obligations including cancellation; move != close |
| Unknown external effect then retry/cancel | tagged OutcomeUnknown; machine pending/provider/observed separate |
| Budget added as work | grammar has separate summary/overhead/budget fields; regression checks |
| Loop zero/early return/unknown body | zero skips; continuing/returned path summaries, conservative max |
| Unbounded recursion | effects fixed point; cost unknown; behavioural preflight rejects |
| 10,000 duplicate rules | canonical hash buckets; linear node instrumentation, no all-pairs |
| Backend hangs/crashes/invalid/descendants | process group kill even after leader exit; bounded output and reaping |
| CPU analysis blocks Ctrl-C | owned worker terminated by coordinator; cancellation report retained |
| Renderer sees incomplete pass | shared evidence constructor rejects established+incomplete |

## Remaining semantic risks

General shared aliases, borrow escape, collection ownership, recursive bounds,
SMT feasibility, latency/peak-memory metrics, symbolic dependent loops, temporal
fairness, flow-to-machine synthesis, implementation conformance, incremental
caching, near-copy heuristics and other backend translations are deferred.
Backend trace replay tests a supported finite transition relation, not a proof
of general translation correctness. External operation summaries are assumptions.

## Probe-driven refinement: direct TLC

(Superseded: TLC and Quint were removed in R1-A; see "TLC, Quint and Java
removed" at the end of this ledger.)

The first generic machine emitted valid Quint and TLA+. Quint's TypeScript
simulator produced a real counterexample. Direct TLC parsed the generated model
but its management socket was blocked in the restrictive sandbox; that is an
integration environment failure. v0 verification therefore has a direct TLC
adapter (same finite IR, expression operator table and replay) and pins the
v1.7.4 JAR digest. It does not use or claim to exercise Quint-to-TLA+ compilation.
Quint simulation remains the required real Quint integration. This avoids an
implicit Apalache download/server lifecycle entirely. Exhaustive claims require
TLC's explicit successful completion marker, not just exit 0.

Backend domain violations invalidate the source-model check rather than silently
cutting transitions at a scope boundary. Structured-flow lowering, logical
contract proof and nonliteral feasibility remain explicitly unsupported.

## Implemented refinements after adversarial tests

- A variable's positive *upper* cardinality bound never establishes a nonempty
  loop. If all iterations return, a zero-length execution can still reach later
  work. Dedicated black-box regressions cover this and a zero-bounded variable.
- Rules with recursive dependency cycles are rejected; flow recursion resolves
  but costs stay unknown. A 256-call inference depth limit produces incomplete
  cost evidence instead of exhausting the host stack.
- Rule grouping visits canonical expression nodes and checks equal canonical
  strings in hash buckets. Resolved symbol/type identities remain in the key.
  No commutative or short-circuit reordering. Near-copy comparison is deferred.
- Lifecycle creation/transition/settlement requires `state.ResourceType` effects.
  Borrow mutation and resource-valued call results are rejected. Resource return
  aliases/owned result collections are outside this ownership subset; no silent
  obligation is dropped. Concrete-callee settlement is checked, abstract callee
  settlement is a visible trusted contract on every outcome and cancellation.
- A cancellation handler can name a locally declared `own` resource. If it has
  not yet been acquired at that observation point, its cleanup action is absent.
  If it was transferred, the caller does not clean it up again. Terminal cleanup
  must be explicitly idempotent in the resource automaton when needed.
- Literal and conjunctive scalar integer interval/Bool entry constraints have
  a feasibility witness or contradiction. Disjunction and general logic are
  explicitly unsupported. Concrete postconditions are pending proof obligations.
- All counterexamples are replayed against initial state, domains, enabled guard,
  simultaneous pre-state updates, event IDs and a failing source invariant.
  Model/snapshot hash mismatch invalidates mapping. Reports retain frozen source
  text; changes on disk set staleFiles and exit 2, preserving completed old work.
- Finite-machine domains use exact supported integer interchange bounds; larger
  source integers remain valid locally and fail behavioural preflight explicitly.
- Metric names denote additive work counters. `latency`, `peak_memory` and
  `peak_live_bytes` are rejected until their distinct algebras are implemented.
- No cleanup exception is silently treated as successful: temporary cleanup
  failures append a separate failed result while preserving checker records.

## Gap ledger at handoff

| ID | Disposition | Evidence / remaining boundary |
|---|---|---|
| D01 syntax/outcomes | resolved for v0 | grammar, parser/span/type/outcome tests |
| D02 ownership size | resolved bounded subset | read borrow/single owner/per-outcome settlement; general aliases and owned results deferred |
| D03 partial IR | resolved for explicit holes | core CLI isolation test; parser recovery blocks its module |
| D04 non-vacuity | partial | interval/Bool witness and contradiction; general feasibility unsupported |
| D05 atomicity/lost response | resolved finite slice | generated checkout request/effect/delivery events, real source-replayed witnesses |
| D06 compensation/late effects | partial | checkout-late source tested by Quint; safety only, no fair eventual-completion claim |
| D07 semantic correspondence | partial evidence | two unrelated models + renamed/reordered variants + simultaneous-update/corrupt-trace tests; no general equivalence proof |
| D08 recursion | explicit boundary | pure-rule cycles rejected; flow cost unknown; no recursive lowering |
| D09 duplicate scaling | resolved exact-copy slice | 10,000-rule node counters, hash buckets, no all-pairs; near-copy suggestions deferred |
| D10 tool cleanup | resolved POSIX inherited-group slice | process/session tests; session-escaping descendants require future cgroup containment |
| D11 drift/cache | snapshot drift implemented; caching deferred | frozen source hashes/text and stale result indication; no implementation conformance |
| D12 name/publication | name kept; package publishable (PUB-2) | identity constants; npm package `pymtheg` without `"private": true`, with public metadata; publishing is a manual owner step; no branding work |
| D13 CPU cancellation | resolved owned-worker strategy | production coordinator + ready-signalled indefinitely CPU-bound worker; no timing assertion; initial real-source measurement retained as historical loop evidence |

## Deterministic validation refinement

Karl explicitly required speed-independent tests. Process tests now inject a
controlled clock and trigger deadline/cancellation after readiness, not a guessed
startup duration. CPU termination uses the exact production coordinator with an
indefinitely computing worker fixture; it cannot race natural completion. Timing
observations are informational. The old five-second CPU watchdog was removed.
Real checker integration budgets are resource limits: timeout means unresolved
evidence and an explicitly skipped integration assertion, never correctness.

Final semantic review also rejects scalar Result error domains, error unions
redefining Ok, nested/inferred resource containers, and built-in type shadowing.
Identifier names such as constructor/__proto__ cannot access prototype values in
symbolic bounds. Call preconditions with constant scalar arguments are checked;
others remain obligations. Abstract postconditions are trusted contracts; concrete
postcondition proofs remain unsupported.

The last source-map probe forged a valid in-file span pointing at the wrong event.
It failed before the fix. Validation now matches the exact typed source machine
and its authoritative event/variable/property map, not just span range checks.
Model identity includes the checker configuration as well as Q/TLA text. Both
bounds and decoded trace dictionaries handle prototype-named identifiers safely.
Repeated-work consistency advice now uses a per-flow effect index and per-target
cache; deterministic effect-visit tests prevent a hidden all-pairs scan.

## 1.0 work in progress: structured execution and Studio

The F01–F13 contract in `1.0-contract.md` supersedes the earlier roadmap as the
release gate; the product has not earned its final score. The current runtime
adds resource-returning `creates result`, source `assert`, finite structured-flow
execution, branch-sensitive scalar/affine contracts, and a local Studio. Earlier
v0 limitations above remain historical context, not the current feature matrix.

Studio runs borrow a frozen overlay of unsaved buffers through the same compiler
worker. Save uses an expected disk hash; a conflict preserves both disk and buffer.
Events carry monotone run sequence numbers. The host confines canonical paths,
requires a per-session bearer token and rejects foreign origins. Browser validators
are precompiled: CSP does not require `unsafe-eval`.

`.pymtheg.json` version 1 names scenarios and a default file (superseded location:
the file is now `.pymtheg/settings.json`; see
[single project folder](#single-project-folder-d5-d6-d7)). GUI and CLI share
validation for seed, steps, samples, timeout and finite scope. An empty scope means
use source-declared machine domains or default supported flow domains; a nonempty
machine override must match all declared domains exactly. Scenario integer values
can remain decimal strings. CPU lowering runs in an owned worker, with explicit
state/edge limits; exceeding them is incomplete, not a truncated successful check.

Current structured abstract operations choose atomic contract results. They do not
yet provide request/effect/response interleaving. Linking operations to explicit
finite environment protocols is an outstanding mandatory 1.0 gap.

### Linked protocol slice (implementation loop 20)

Chosen syntax: `op send() -> Result<Unit,E> effects(network.Queue) protocol Wire
{ submit request; outcome Ok(unit) when response == 1; outcome OutcomeUnknown
when response == 2; };`. `Wire` is an ordinary typed finite `machine`. Protocol
predicates/results read its scalar state; they cannot invoke effects. Its submit
event is enabled only at the call. Remaining events interleave with source steps,
including after cancellation/return, so pending provider work is not erased.

One shared machine instance per declaration, sequential calls, no overlapping
caller requests in this slice. Submission is one observable step; provider events
are separate steps; an enabled outcome is a separate response-observation step.
All machine invariants are included in the combined safety check. Source spans
identify call, provider event and outcome observation. No fairness/progress claim.
Resource-taking/producing protocol ops and parameterised provider state are outside
this first linked slice and must fail preflight explicitly. All result alternatives
must be declared in the protocol, even if their guard is currently false. An
unknown response never undoes a provider effect. Repeated submit semantics are
specified by the user's machine; Pymtheg supplies no implicit idempotency.

### Final adversarial refinements

- Explicit finite input values cannot exceed declared cardinalities or carry
  unknown record fields. `inputs` and `results` have separate namespaces; unused
  scope keys are errors, not silently ignored spelling mistakes.
- Abstract postconditions restrict their finite result domain; concrete and pure
  rule contracts are evaluated. A rule precondition failure remains a source
  counterexample, not a host-language exception or successful no-op.
- Empty property families are not emitted as five superficial safety passes. A
  flow without explicit obligations gets only `executionSafe`, with a visible
  assumption that no business-safety assertion was exercised.
- Studio has per-document bounded undo history; changing files or opening a
  historical snapshot cannot apply another file's edits. The original volatile workspace was superseded by transactional draft recovery
  described below. Source saves remain explicit.
- Accessibility checks identified low-contrast labels and invalid `aria-selected`
  use. Navigation uses toggle-button semantics, dialogs isolate background content,
  and contrast is checked with pinned axe tooling, not visual confidence alone.


Final 1.0 review and the evidence-linked F01–F13 status are in `1.0-status.md`.
Legacy v0 deferred wording above is preserved as decision history; current syntax
and support are defined in `grammar.md` and `support.md`. Externally effectful
abstract operations require an explicit atomic assumption or a linked protocol
for behavioural checking. Scope validation is shared by emit and backend checks.

## Guided scenario and durable-workspace decisions

Scenario forms use finite value descriptors derived from the canonical typed IR,
not a second parser or inferred JavaScript types. Common primitive, record, list
and tagged/Result values get guided controls; the source checker remains the
semantic authority. Recursive/unsupported descriptors are explicit. Raw JSON is
an advanced escape hatch, not the default. Named scenarios use the existing
versioned project configuration and expected-hash saves.

Durable GUI state will live in a project-local `.pymtheg-studio/` directory with
private file permissions (superseded location: drafts are now
`.pymtheg/shared/drafts.sqlite` and recent runs `.pymtheg/rebuildable/runs.sqlite`;
see [single project folder](#single-project-folder-d5-d6-d7)). It is recovery data, never the original `.pym` source.
Draft state records the original disk hash so edits on disk can be detected on
restore. Writes are queued and atomically replaced. Revision conflicts and failed
writes are visible. Saved run evidence retains its frozen sources; interrupted
runs restore as interrupted rather than successful. Recovery is bounded and does
not silently discard an unsaved draft to keep a newer run. No MCP tool acquires
source-writing authority from this feature.

Recovery storage refinement: Node 24's built-in SQLite is available in the target
runtime. Use SQLite transactions rather than pretending that a JSON hash check
plus rename is a multi-process transaction. A private project-local database owns
one revisioned draft record and bounded run records; transaction rollback and
SQLite locking protect cooperating Studio instances and crash recovery. No native
third-party dependency or system installation is required. Initialization is lazy
and specific to Studio so the MCP read-only connection does not create recovery
files. Recovery failures remain visible and do not prevent source inspection.

Recovery review keeps the losing writer’s current buffers intact. It reads the
latest database revision, exposes the other draft for review/download, and only
resumes writes after an explicit choice. The resumed write still compares that
revision transactionally. Source conflicts offer save-copy with create-only
semantics. No “overwrite anyway” bypass was added. Finding comparisons are
multisets keyed by source/code/message, not sets; otherwise two equal errors
shrinking to one would disappear from the difference report. These are report
differences, never an automatic assertion that an error was fixed.

## Extensible code output

Karl requested arbitrary language output, initially TypeScript, Rust and Go. A
versioned normalized contract document separates semantic extraction from target
syntax. Output plugins are explicit CLI-loaded trusted modules, run in bounded
owned subprocesses; there is no project-driven auto-loading or MCP-supplied
executable path. One builder excludes unresolved contracts and preserves source
identity for every emitter. Plugins may explicitly omit unsupported declarations
but cannot silently drop them. Built-ins now default to fail-fast bodies (superseding the original empty-body decision) and declare dependency
and representation limitations; no integer range is narrowed implicitly. The
public API and fourth-target JavaScript example are in `output-plugins.md`.

The executable output-process self-model initially rejected cancellation cleanup
after normal reaping (`Reaped -> Reaped`). This exposed an idempotence requirement,
not a reason to ignore the cancellation path. The production process owner
already treats an absent process group as cleaned up; the lifecycle model now
permits repeated reaping. Both terminal paths still retain the cleanup duty.

## Reopened usability decision

The first-time user should obtain a useful result without learning syntax from a
manual. Goal-based recipes, input/output forms, immediate real checks and inline
expected-input guidance replace the former blank-editor dead end. Generated
recipes are normal source and use the same checker. Editing recipe choices must
not overwrite manual source edits or save the buffer silently. Syntax snippets
are authoring aids, not inferred business logic. The previous 9.5 assessment is
under whole-product review rather than used as evidence for these changes.

## Whole-product review: signatures and unfinished bodies

A complete declared signature remains useful when its implementation body contains
an explicit unknown. Code scaffolding now retains that signature and prints the
open decision as a comment; it does not upgrade the source analysis verdict.
Unresolved signature types, invalid headers, recovered syntax and duplicate
identities still prevent output. This corrects the former overly broad rule that
removed an interface merely because its intentionally empty body was undecided.

## Architecture and first-use corrections after independent audit

- Store the whole imported design, with unknown fields and original documents;
  a derived call graph is insufficient. Keep native planning records and foreign
  source claims separate from the typed `.pym` semantic IR.
- Use content-addressed document blobs with transactional revision references.
  The initial copy-per-revision/64-revision prototype was not suitable for rolling
  projects. Migration preserves documents; quota failures preserve read access.
- Record every stable-ID relationship, including unresolved targets, without
  claiming that a link proves fulfilment or implementation.
- Direct input examples use existing source-step semantics, reject unused input
  names, and never choose an arbitrary external outcome. Cancel old UI requests
  rather than presenting an old result as belonging to the current edit.
- Completion arguments are explicit unknowns until supplied. Result handlers are
  generated from the declared variant set. Missing-effect guidance names the
  actual service/resource, and bounded spelling hints never resolve a name.

Foreign JSON numeric literals need a separate display boundary: ordinary
`JSON.parse` rounds large integers and fine decimal values. Architecture views
now retain noninteger/unsafe numeric literals as `{"$exactNumber":"source"}`
records, with an explicit warning and unchanged original documents. They are not
coerced into `.pym` values or used as proof evidence. Navigation-index version 3
rebuilds earlier indexes from the retained documents; incoming v2 bundles remain
accepted and are reindexed rather than trusted.

## Architecture continuity after the second independent review

Imports now merge by retained source identity. Studio prepares one session-owned
immutable preview and commits that exact document set only against its original
head. A newer preview replaces the previous one; shutdown drops it. No preview
creates persistent storage. Native documents survive source refresh. Source
registry metadata travels in revision exports.

Native record edits compare the edited record at the draft base with the current
head, allowing unrelated changes. Raw document edits compare that document's hash.
A same-target change is a 409 conflict, preserving the draft and both revisions.
Closing the editor retains recovery content; only explicit discard or successful
save clears it. New-document names avoid existing paths.

Architecture writers now use SQLite rollback journalling so read-only browsing
does not require creating WAL sidecars. A closed legacy WAL-format database is
read via a session-owned temporary immutable snapshot; active legacy WAL journals
are rejected with a checkpoint instruction rather than ignored. Read-only opens
do not change permissions, migrate schemas, or persist rebuilt navigation indexes.

Navigation index v5 adds conservative references from declared foreign type
fields, argument/return/error shapes and qualified type names. Unsupported names
remain unresolved with coverage notices. Direct, transitive and planning consumers
are presented separately. These are dependency navigation claims, not a foreign
language parser or a type correctness proof.

## Working-set review, navigation and portability

Index v8 replaces v5–v7 intermediate navigation projections. It adds Markdown
heading identities, catalogue-level records, structured-field search and native
planning metadata. The original documents remain unchanged. Names entered in
link forms must resolve uniquely; dangling imported links remain visible.
Same-record conflicts show base/current/draft and require an explicit choice of
new base before saving. Input trials own separate bounded workers, independent
of architecture writes. Legacy navigation rebuilding is moved off the event loop.

Portable history validates every blob hash and revision hash and commits metadata,
references and recovery in one transaction. Existing active work is preserved.
Same-content revisions with conflicting provenance, or conflicting recovery
text, are refused rather than silently replaced. The GUI previews the archive and
compares current head at commit. This format has a 64 MiB transfer limit; it is not
an unbounded repository backup mechanism.

## Default scaffold bodies after the third audit

Karl selected compile-ready fail-fast stubs instead of literal empty bodies.
The shared output policy defaults all built-in callables, including Unit, to
throw/todo!/panic with “Not implemented”. CLI, MCP and Studio expose explicit
empty mode. Plugins retain their v1 API and report `plugin_defined`; the host
must not claim or rewrite their body policy. This supersedes the earlier
empty-body default above. Compilation still requires declared dependencies
(e.g. num-bigint for Rust integers); it does not establish contract conformance.

## Stable heading links and evidence scope

Heading content includes descendant sections through the next heading of the
same or higher level. A change below a requirement therefore invalidates its
linked evidence. Snapshot-bound `.pymtheg-heading-identities.json` (superseded as a
project file: the name is now a logical document key inside
`.pymtheg/shared/architecture.sqlite`, and a root file of that name is an old layout;
see [single project folder](#single-project-folder-d5-d6-d7)) preserves IDs
through unambiguous anchors, requirement keys, title/body matches or unique
nonempty bodies. Removed IDs are retired, never reassigned by ordinal position.
Ambiguous edits create new IDs rather than silently guessing; inferred continuity
is navigation metadata, not proof of unchanged intent. Import metadata cannot
overwrite the workspace registry; registry preparation/indexing uses the owned
worker. This does not yet provide an interactive ambiguity resolution workflow.

## Attention relevance and catalogue type references

Index version 12 stops interpreting `errors` and `allowedErrors` labels as type
references. Their original content remains retained and searchable. `args` and
`returns` still contribute conservative type references; unknown notation remains
an explicit coverage warning. Needs attention shows native/authored planning first,
with imported mapping gaps separately expandable. Source registry ownership, not
file-name guesses, defines provenance; legacy unregistered planning stays visible.
Import previews report newly broken native links separately from aggregate imported
gaps. Neither classification proves logical validity or completeness.

## Conflict resolution and source movement

Refresh conflicts must be reviewable, not a throw-only dead end. Local/incoming
hash-bound choices are explicit; keep-local advances the upstream baseline,
keep-both retains incoming content separately, and incoming replacement is forbidden
for native/shared documents. Unresolved previews cannot commit. Source identity
is independent of the current folder through CLI --source-id and Studio source
selection. Bundle plans enter the same review instead of replacing native plans.
Duplicate definitions that changed or moved cannot be matched by a stale positional
index during edit review: the draft is retained and the intended definition must
be reopened. Fully automatic semantic merge and multiple simultaneous native
drafts remain outside the present supported workflow.


## Recursive output representation and primitive names

A target-specific iterative SCC pass identifies cyclic inline storage. Rust uses
Box for those references; Go uses pointers for recursive records, while interfaces
and slices already provide indirection. Acyclic fields and callable signatures
keep direct named types. This is a representation decision, not an implementation
or proof of valid construction. Go nil safety and ownership remain obligations.
Primitive identifier allocation prevents user declarations from capturing Bool
or other primitive meanings in generated source. Real compilers exercise recursive,
mutually recursive, list-recursive, acyclic and primitive-name collision cases.


## Tracked copies after keep-both imports

Source entries now distinguish their original sourcePath from the retained path.
Keep-both records a local divergence and moves source tracking to the incoming copy;
it does not promote imported text to native planning. Unchanged upstream refreshes
are no-ops, changed upstream refreshes update the tracked copy, and edits to that
copy still require hash-bound conflict review. Local forks retain origin metadata.
Synthetic folder inventories are named per source ID so unrelated imports cannot
conflict on the tool's own metadata. CLI previews and commits expose newly broken
native links; a committed import with such links returns status 2 and `committed:true`.

## Fourth-review corrections: history, imports and output authoring

- Repeated equal content still creates a named checkpoint. Sequence numbers,
  not clock timestamps or random IDs, determine local history order. Storage v5
  additionally records each new checkpoint's active parent. Imported branches
  retain their own parentage; legacy parentage is unknown. Archive cycle/missing
  parent validation is linear in checkpoint/parent counts, without recursive DFS.
- Keep-both retains a local fork and a separately tracked incoming copy. Source
  inventories use source-specific paths. Canonical registry serialization avoids
  false snapshot differences on unchanged imports.
- Body equality does not establish heading identity. Renames require an explicit
  anchor or preserved whole requirement key; same-title matching remains subject
  to ambiguity checks. Adding an anchor before renaming is a supported two-save
  route that preserves linked evidence without silently moving it.
- Output emitters receive a body-policy request. Built-ins and the shipped JS
  example default to fail-fast even for Unit. Studio/MCP may use only targets
  explicitly registered by the launching user; entry bytes are pinned per session.
  This is trusted local execution, not a sandbox or proof of plugin correctness.
- Rich no-syntax interface forms and MCP recipes support bounded nested types and
  declared effects; the canonical parser/typechecker remains the authority.

## Fifth-review parent fixes

These changes were independently reproduced, checked in a temporary candidate,
and integrated after the fifth review completed.

- Go visibility must follow the public source interface. A leading underscore
  is an ordinary source spelling, not an instruction to hide the generated Go
  declaration. Exported-name allocation removes that prefix, handles empty or
  numeric remainders, and uses the existing collision allocator.
- Impact partitioning uses a Set for membership and preserves the existing
  result order. The 2,000-plan regression checks consumers and deterministic
  membership work rather than measuring wall time.
- Historical evidence consumers need prior target identities and content hashes,
  not complete historical indexes. `EvidenceSnapshot` makes that boundary explicit.
  Empty projections still retain checkpoint identity so unscoped and unknown
  evidence cannot collapse together.
- Type selectors receive their own full-width line. The 1100/1440 browser checks
  measure selected-text fit with the loaded font, and the normal source/scaffold
  journey remains the functional acceptance check.

Index v15 narrows inferred heading identity keys to compact tokens such as R03,
R03-NORMAL and NFR-7. Spaced numbered prose (Option 1, Step 2) cannot silently
carry an old identity to another option. Explicit anchors retain their meaning
through renumbering. Older archive index versions remain importable; original
source and old checkpoints are preserved.

## Fifth-review follow-ups: continuing edits and rolling sources

The resolver now exposes its visibility table in ProjectIR so authoring uses
resolved nominal identities. Shared-type edits are explicit multi-file buffer
previews, with all-file precondition checking and visible reverse dependencies.
No body or cancellation implementation is generated during an interface edit.
Unapplied editing forms persist with snapshot provenance; source divergence
requires manual review and retains a downloadable draft.

Routine imports may skip an unchanged checkpoint inside the store transaction.
An explicit named CLI import and Studio's dedicated named-checkpoint action still
record equal-content saves. Source matching by canonical folder ID preserves its
custom label. Overlapping new folder paths require choosing a retained source ID
or explicitly requesting `--new-source`; this is a conservative relocation hint,
not automatic identity inference. CLI imports that newly break native links now
stop before saving unless `--allow-broken-links` was explicitly supplied.

A unique byte-identical removed/added Markdown document pair can carry heading
identities through a file move. Copies, multiple identical candidates and edited
moves do not establish identity. Unsupported moves remain visible through the
broken-link preview. Branch tips outside the active ancestry appear separately
in the GUI and MCP, with unknown legacy lineage labelled as such.

Plugin registration now imports the explicitly trusted module in an owned bounded
process and validates its API version, target and extension before advertising it.
This executes module initialisation, not its emitter, and does not certify emitted
syntax or business meaning. Entry bytes are checked before and after registration
and again before generation.

## Staged after sixth candidate: large catalogues and linked-title review

The interface catalogue exposes identities/locations first. A requested type
uses one frozen IR to load its definition; opening a signature does not expand
every visible type. Search/pagination bounds the initial list and type dropdown.
Edits to loaded definitions retain per-file source preconditions and body preservation.

Native plans may retain a separate linkReviewRevision. New links use the supplied
source revision (superseded: since W2-H a new link gets a server-set *baseline*,
never a review; see [a link's baseline is not a review](#a-links-baseline-is-not-a-review)); explicit review acknowledgement changes that revision, not the
original proposal's originRevision. A retitled target produces a review reminder,
not a proof the link is wrong. Unavailable review revisions remain visible.
The historical projection adds target names while still retaining only linked
rows. Index v16 carries the additional plan review metadata and accepts v15 archives.

Plugin and source byte boundaries use the same strict UTF-8 decoder. The plugin
runner accumulates bounded raw chunks before decoding once, so split code points
are preserved and input work is linear in received bytes. MCP source reads reject
malformed bytes instead of presenting replacement text.

The emitter and registry expose an in-process ProcessClock seam for controlled
lifecycle tests. Production calls omit it and retain the five-second deadline;
JSON/MCP clients cannot replace the clock. Unit tests drive expiry/escalation only
after explicit child readiness, so CPU speed does not decide the expected outcome.

## Sixth-review: source-aware authoring and project checks

Completion selection maps the live CodeMirror position back to the exact checked
text using at most 128 retained transactions. Ordinary body edits retain scope;
changed headers, brace edits, missing history or unmatched snapshots leave explicit
holes. Call scopes use half-open spans. This is authoring assistance, not a second
parser or inferred proof of the current buffer.

Studio local checks include every eligible `.pym` file under the project root
(including supplied virtual buffers), in one canonical snapshot/IR. Hidden folders,
node_modules and dist retain the existing browser exclusion policy. The same file
is parsed once even through import diamonds. Interface impact starts from the
edited callable and shared types. Behavioural exploration and CLI `check FILE`
retain their selected entry/import closure. MCP `check_design` defaults to project
scope; `checkScope: "entry"` explicitly asks for an isolated slice. Unrelated errors
remain visible in project scope without invalidating independent property evidence.
Unresolved match types do not fabricate secondary unknown-variant findings.

MCP interface discovery is paged metadata (20 default, maximum 100). `symbols`
returns callable IDs, `types` returns visible type IDs; both accept query/offset.
`describe` returns one signature and a type count, not the complete catalogue.
`type` loads one selected definition. Exact snapshot IDs qualify all pages.

## Sixth-review: review meaning and retain author comments

Link-review baselines compare both target titles and content hashes (including
heading subsections). A title-stable change asks the linked plan to review its
relationship even when it has no evidence. Evidence-backed records keep their
separate stale-evidence judgement; duplicate relations to one target produce one
reminder.

Storage v6 adds scoped branch acknowledgements. A review records the exact branch
tip and the current checkpoint it was compared against. It never changes the
active design or merges source. Descendants of the reviewed current checkpoint
inherit that acknowledgement; a new tip on the remote branch needs another
review. Archives retain these relationships, validate referenced checkpoints,
and bound total reviews to 10,000. Unknown legacy lineage appears separately
and cannot be asserted to be a divergent branch. Read-only v1–v5 stores remain
readable without migration.

Shared type rewrites retain interior line comments verbatim above the rewritten
declaration and explain the move in the preview. They do not guess which renamed
field a prose comment describes. New colliding heading IDs keep a readable path
and heading prefix plus a digest suffix; retained IDs are never rewritten merely
to make their spelling match a moved document.

## Locale-independent content identity and portable format v3

Identity ordering uses explicit code-unit comparison, not the host's locale.
Portable history v3 separates preserved snapshot IDs from canonical `contentHash`
checksums. Old history v1/v2 is checked against the document order it carried,
then normalized; its checkpoint/snapshot IDs are preserved. Import refuses a
matching stored snapshot ID with different content. Unchanged refreshes compare
canonical document sets so upgrading an old identity does not create a checkpoint.

New projection markers and bundle v3 carry the canonical content checksum.
Legacy database records without this marker are still readable without writes;
if their original locale ordering cannot be reconstructed, the index warns that
only the individual document hashes were validated. New exports bind the retained
bytes with the v3 checksum. Legacy bundle v1/v2 retains its original locale-based
checksum path; non-ASCII bundles from another locale should be re-exported as v3.
This does not claim authentication against an author who can rewrite an entire
self-contained archive. It does reject conflicting identities/content during merge.

## Bounded guided shape expansion

A compact nominal type DAG must not expand exponentially into input controls.
Each guided shape visits at most 512 nodes; Studio shares an 8,192-node budget
and a cache keyed by resolved type identity across metadata construction. Exceeding
that authoring budget produces an explicit unsupported guided shape, without
changing the typed IR or local analysis evidence. Metadata construction yields
to the coordinator every 64 declarations and checks cancellation. Cancelling
this phase preserves already completed findings with a cancelled session state.

## Seventh-review: related scopes, portable lookup and retained links

Related checking supersedes the sixth-review default whole-project scan: selected
imports and discovered reverse callers share one IR; unrelated broken files do not
contribute errors. Inventory is independently paged/lazy. MCP interface lookup
uses relative IDs and names/relative paths, not the absolute root directory.

Heading continuity first matches unique byte-identical documents across the whole
refresh, including simultaneous old-path replacement. The replacement cannot
reuse IDs transferred to the moved original. Ambiguous copies still do not prove
identity. Relationship review names moved paths and can load previous/current
retained target text on demand; acknowledgement does not refresh evidence.

## Separate generated contracts from implementation

The next output slice adds an explicit contracts mode: exported TypeScript
interface, Rust trait, or Go interface plus data declarations. Users implement
these in separate files. Default output remains fail-fast stubs. Plugins must
explicitly confirm contracts mode; legacy emitters cannot silently emit stubs.
A versioned portable manifest records exported declaration contracts, excluding
source coordinates/snapshot IDs. Comparing manifests reports added/removed/changed
interfaces; it does not infer correctness of implementation bodies. Generated
source and manifests are preview/download outputs, never automatic rewrites of
handwritten files. Compiler consumer probes must demonstrate both acceptance of
matching implementations and rejection after a signature change.

## Seventh-review: review records and output budgets

Branch acknowledgements must retain who reviewed which pair of checkpoints and
why, and support withdrawal without deleting the audit trail. Storage v7 adds
individually identified acknowledgement records with monotonic withdrawal
metadata. Portable archives merge identical acknowledgement IDs and preserve
withdrawals; legacy pair-only records remain explicitly unattributed. A review
still does not merge branches. Review ordering never depends on timestamps.
MCP branch listings are paged independently of unrelated architecture responses.

Output-plugin resource deadlines are now explicit launch configuration
(`--plugin-timeout`, default 5s, maximum 120s), carried into copied agent setup.
Correctness does not depend on meeting that deadline: expiry remains an output
integration failure. Tests control deadlines instead of assuming machine speed.

Contract manifests distinguish signature/obligation notes from implementation
progress notes. Finishing a body-only open decision must not look like a signature
change. Built-in emitted comments still retain the original notes. Manifest JSON
is size/structure bounded before Studio formats an imported comparison baseline.

Related-scope discovery also catches inaccessible neighbouring directories; their
paths remain visible in warnings. Failure to open the selected root/source remains
an error. This does not claim that undiscoverable callers were checked.

## Code output is not checking history

The dedicated Code view contains generated interfaces/stubs, comparison baselines
and code-output previews. History contains prior check snapshots and report export.
Recipe actions link directly to Code. The eighth frozen review candidate predates
this navigation correction; browser verification is deferred until that review
releases its browser resources. No semantic analysis or output policy changes.

## Concurrent withdrawal explanations

Two reviewers can independently withdraw the same acknowledgement for different
reasons. These are compatible state changes, not an identity conflict. Imports
retain the union of their explanations in deterministic content order; a repeated
archive does not duplicate them or reactivate the review. The original review's
identity, reviewer and rationale remain immutable. Distinct original metadata
under the same acknowledgement ID is still a conflict.

Withdrawal explanation count is bounded to 10,000 in an archive/store operation.
Review-summary pages contain a count and one explanation; additional explanations
have separate bounded pages for both Studio and MCP. This avoids expanding every
review into the overview response. The eighth frozen candidate predates this
self-audit fix; its reproduction remains in post-eighth/concurrent-withdrawals-before.json.

Legacy v6 review pairs are projected read-only using the same deterministic IDs
as writable migration. Missing author/reason/date remain missing. A user can
inspect and then intentionally withdraw the legacy review without first making
an unrelated architecture edit. Read-only projection writes no migration state.

Mixed-language source discovery skips `target` and `vendor` by default. Explicit
source include lists opt them in, subject to the actual glob. A shared static-
prefix test safely prunes directories that cannot contain an included path;
unrestricted wildcard prefixes retain conservative traversal. This is discovery
policy only: a selected source and its required imports are still analysed.

## Bounded MCP code-output retrieval

Large scaffold responses can exceed the MCP reply budget even when the checked
source is within its supported limits. Generation remains one explicit operation.
The server retains up to eight generated artifacts / 32 MiB of serialized output
per session. Small responses remain complete; larger ones return an artifact ID,
counts and an explicit read-tool hint. Source, manifest JSON and details JSON have
bounded character pages, exact UTF-8 hashes and snapshot provenance. Pages never
re-run the emitter, mix generations, write source or infer implementation success.
Evicted artifacts fail explicitly; shutdown releases retained strings. Character
boundaries preserve Unicode surrogate pairs. This is session retention, not a
persistent semantic cache.

## Eighth review: inventory paging and baseline preservation

MCP project_info captures bounded browsing metadata independently of later checks.
Clients retain inventoryId while paging files, warnings, names or configuration;
configuration pages preserve the exact JSON text. Oversized scenario names are
explicitly labelled previews, with full keys in configuration. The initial call
must remain usable for every accepted scenario name. Three inventories / 32 MiB
are retained per session, then expire explicitly. This is not an analysis cache.

Contract baseline publication refuses a design with errors or omitted contracts
unless --allow-incomplete is explicit. Refusal preserves the previous file;
publication remains atomic and cancellation-aware. Parse recovery without any
surviving declaration is unknown coverage, not an empty complete interface.
Comparison treats omissions in either baseline as unknown coverage: unmatched
entries cannot be asserted added/removed on the side whose coverage is missing.

## Eighth review: selected results and caller evidence

A related check's selected entry/import closure has its own verdict. Reverse
consumers remain useful separate evidence, not failures attributed to the selected
file. The canonical IR is unchanged; only requested result projection changes.
MCP exposes consumer_findings/consumer_properties, and Studio labels affected
caller findings explicitly. Unresolved-name owners in related source are retained
as potential consumers because a removed/renamed symbol no longer has a resolved
edge. CLI --check-scope entry|related|project makes the selection explicit; the
historical CLI default is entry. Project scope still checks all loaded declarations.

Source discovery and Studio inventories use breadth-first traversal, with root
sources considered before descendants. Existing caps remain explicit. Impact
previews expose affectedComplete=false and a notice for any discovery warning.

Relationship review normalizes line endings, trailing spaces and paragraph soft
wraps only in simple Markdown prose. Code/HTML/table/inline-code contexts remain
conservative and whitespace-sensitive after line-ending normalization. This is
an advisory relationship signal; evidence freshness still follows exact content.
Linked comparison renders bounded line replacements with explicit truncation.

Saved interface continuation now performs a three-way field merge. Independent
current edits and saved additions combine. Concurrent changes to one input,
output, effects or name require an explicit current/saved choice. Saved shared
type edits also require explicit review; current source is never silently reset.

## Eighth review: moving targets and readable outputs

Possible edited moves are not proven identities. When old heading content appears
at new paths alongside a changed old path, the old link stays unresolved and the
import warning names candidate paths. The plan editor can explicitly replace a
link while comparing old and chosen content. No similarity score silently moves it.

Manifest comparison matches a unique declaration kind/name across file paths;
ambiguous names stay unmatched. It compares target-independent interface contracts,
not emitted syntax or implementation behavior, and reports field-level changes.
Rewritten type comments retain explicit previous-member context rather than being
silently attached to a new final variant. Rich compiler regressions use real locked
num-bigint 0.4.6 (now 0.4.8, W2-Q), not synthetic stand-in definitions.

## Initialized project identity (post-ninth freeze)

Karl requested a CodeGraph-like init command and shared awareness in MCP/Studio,
primarily for empty new projects, optionally importing existing documentation.
A portable UUID/name lives in .pymtheg/project.json. Configuration remains separate
and unchanged when present. Atomic create-only publication gives concurrent
initializers one identity; reads are write-free. No source/template plans are
invented. Nearest-marker discovery sets the root for Studio and MCP, which expose
the same identity without maintaining a global registry.

Conventional documentation discovery is a filtered use of the existing text
importer. Default initialization previews only; --import-docs explicitly commits
through the existing source-scoped merge/heading/index/revision contracts.
Repeated unchanged refreshes do not add checkpoints. The published ninth frozen
candidate predates this feature and the related parser-recovery follow-up.

## Post-ninth search and recovery decisions

Architecture search retains the read_architecture 50-item MCP limit (the store
accepts up to 100). Every search response reports total, offset and nextOffset;
continuation requires the returned revision. Changing the active revision cannot
silently mix a search. MCP result provenance uses relative paths without rewriting
model values or source text; internal snapshot identities remain exact. Edited
moves sharing a heading title only suggest a repair, with the old identity left
unresolved. This prefers explicit review over silent retargeting.

Opening an unchanged planning form creates no recovery draft. Once a user edits,
recovery continues to retain their work, including later reversions. Parser/type
guidance suggests supported spelling without accepting another language's syntax.

## Readable retained documents

An imported design should be readable without interpreting Markdown punctuation.
The post-tenth-freeze reading view retains exact source as a separate mode and
download. Raw HTML is escaped; remote images are not fetched. This is presentation,
not semantic interpretation. Missing local links explain the missing retained
path rather than navigating the live filesystem. CommonMark/GFM parsing is pinned
to MIT-licensed maintained packages rather than adding a handwritten parser.
Large rendered previews are bounded explicitly; source pages remain complete.

## Pointwise resource budgets (post-tenth semantic audit)

A cost expression describes work as a function of the same source inputs used by
its budget. Comparing max(work) with max(budget) is unsound: a smaller allowed
input can have a smaller budget. Missing numeric bounds must not silently turn a
budget into an established check.

Resolve budgets pointwise over nonnegative cardinalities. Normalize supported
additive/multiplicative cost polynomials, preserving shared variables; a signed
work-minus-budget upper bound at or below zero establishes coverage. Maximum
work alternatives must each satisfy the budget. Polynomial expansion has explicit
term, degree, alternative and operation caps; exhaustion is unresolved, not zero.
Constant budgets retain the existing concrete-bound check. Comparisons that cannot
be established keep the computed symbolic work but carry a pending budget
obligation. A positive conservative difference may indicate excess rather than a
concrete feasible execution; diagnostics must retain that distinction.

Regression probes: unconstrained n against budget 5; constant work 5 against
budget n with 0 <= n <= 10; and 2*n+1 against 3*n+2 without a numeric population
bound. The first two previously reported established. The last must remain useful
through a genuine pointwise comparison, not through skipped checking.

## Stable output identities and exact input checks

Initialized project roots flow through the frozen source snapshot into contract
projection. CLI scaffolding discovers that root; changing the entry file alone
cannot rename every declaration. Uninitialized standalone files retain the legacy
common-source-root convention. MCP output symbols and spans are projected to the
same project-relative coordinate system without rewriting emitted source text.

TypeScript permits fewer method parameters under ordinary interface assignment.
Contracts-only output therefore provides the type-only PymthegImplementation
check, which must be applied by the implementation file; the GUI and generated
comments say so. Go likewise needs its ordinary interface assertion. Neither is
presented as behavioural conformance or silently installed into handwritten code.

## Source-linked planning (post-tenth review)

Native source targets use project-relative `source:file#declaration` identity.
The existing owned analysis worker projects the canonical IR once; synchronous
normalization never runs on the coordinator. Source reads remain write-free.
Plan saves retain the selected source and dependency expectations atomically.
The retained catalogue also preserves earlier expectation hashes, so reviewing
one plan cannot replace the source another plan still relies on. Selecting a
source and reviewing all source changes are separate actions. Both are checked
for stale source before save. Partial source is never a passed requirement.

Nested initialization reuses the nearest initialized ancestor. Initialization
creates an ignore file inside local architecture storage; the SQLite database
is created only by an actual architecture write. Portable history export is the
sharing boundary; the live database is local state, not a team merge format.

## Rolling documentation selection and repair

An init-created documentation source retains `selection: project-documents`.
CLI and Studio folder refreshes preserve that filter instead of changing the
meaning of a source when switching interfaces. Browser folder names do not
replace an established absolute source location. Generated-directory exclusions
are recorded at their directory boundary; Studio's own recovery directory is
excluded from import-change metadata. No-op refresh still means no checkpoint.

Project setup resolves document conflicts inline using the existing hash-bound
choices. CLI init exposes the same resolutions and an explicit broken-link
acceptance flag. Conflict resolution produces another preview, not an implicit
commit. Source changes between preview and application invalidate choices.
Edited-move candidates are retained separately from heading identity and remain
suggestions. Repairing a plan's link clears that plan's pending move candidate.

## Eleventh review: output names and portable coordinates

Output renaming preserves already-valid spellings before allocating transformed
ones. Rust callables, parameters and fields use snake case; normalization of
`orderId` cannot steal an existing `order_id`. TypeScript reserved parameters use
a meaningful `Value` suffix with the same collision policy. Original source
names remain in provenance notes.

The typed-IR to output boundary projects declaration IDs, referenced type IDs and
source spans to one project-relative coordinate system. Initialized projects use
their root; standalone inputs use their common source directory. The plugin
payload, built-in mappings and contract manifests share this projection. Model
text, canonical analysis IDs and snapshot hashes remain unchanged. A portable
output document carries `sourceRoot: "."`; emitters must return supplied IDs
verbatim. Regenerating output may rename identifiers previously normalized
inconsistently, so implementation code still requires explicit review.

## Eleventh review: opening edited source and tracking local forks

Opening a clean source re-reads its current bytes, including navigation from a
plan. Unsaved buffers retain their previous base and require explicit conflict
resolution after outside edits. Opening a file never silently overwrites a draft.

A plan linked to a kept local document also monitors its separately tracked
upstream copy. Changes/removal since its relationship-review revision create an
attention item. The plan keeps its chosen local link. Acknowledgement does not
merge text or refresh evidence. Review compares the whole upstream document
conservatively when a precise corresponding section is unavailable.

## Post-twelfth corrections: contract and trial evidence

Standalone output roots use every captured source file, including recovered files without declarations. Explicit project roots remain authoritative; no source is reread. Exported notes retain cost quality, declared stability/atomicity/fresh creation and allowed resource transitions. Constraint expressions render from the existing AST, preserving values/grouping while ignoring comments, whitespace and redundant parentheses. This is structural normalization, not algebraic equivalence. Older baselines may show a one-time difference; review and replace them explicitly without rewriting history.

Input trials preserve assumptions accumulated by the shared interpreter, including on unresolved paths. They still omit cancellation injection and prove no universal property. Editing an input retires its pending request. GUI assumptions are expandable and paged. The isolated build, 425 local tests and nine compiler integrations pass. The two focused GUI tests now pass; the next full GUI sweep remains pending.

## Twelfth review: scope failures and retain historical links

Source-attention failures belong to their recorded source file, never to every
expectation merely because a diagnostic has code L003. Previously captured
dependency paths are checked separately so a missing import can be identified
as missing. Individual source details report completeness for their own closure;
global discovery warnings remain explicit limitations.

An ordinary planning edit with the same set of source targets preserves its
recorded expectations and source hashes without requiring those targets to
still exist. It does not acknowledge any source change. Explicit source-review
requests retain live-target validation. New links still require available
targets. Mixed edits that add links while retaining broken ones remain an open
follow-up, recorded in the twelfth remediation ledger.

## Twelfth review: deleted buffers and empty documentation sources

A deleted source file can remain an explicit in-memory analysis input. Opening
it never writes source. The editor identifies the missing path and offers a
separate copy or create-only recreation, preserving the same root confinement
and occupied-path safeguards as other saves.

An empty tracked documentation source remains a refresh, not a new empty
project. Its removals use the ordinary preview, link-regression gate and retained
history. Human change summaries exclude Pymtheg's import bookkeeping; the full
ledger remains available to the importer. Setup transport preserves the change
summary rather than dropping it during schema validation.

## Visual editor transactions and recovery

Visual controls project the checked IR into editable source ranges. They never
introduce a second executable model. An edit to a field uses the original range
and text, maps affected ranges, and updates the shared source buffer immediately.
A structural edit requests the real checker; controls cannot apply stale offsets.
Old responses cannot replace a newer local field edit. Invalid input stays visible
in its field while the source/check exposes the error. The same editor history
handles undo in either mode, and recovery retains source plus mode. Future rich
visual data/resource/event controls must follow this same transaction boundary.

Agent checks retain the candidate catalogue generated by their existing worker,
then compare only recorded source expectations within the captured source files.
Out-of-scope plans remain unassessed. Up to 10,000 impact issues are retained with
an explicit completeness flag; transport pages never silently imply that all
planning records were checked. Cancellation wins even during this last phase.

Parser guidance for JavaScript-style await, bare calls, optional result shorthand
and reassignment rejects the same unsupported forms as before, with concrete
alternatives. A valid identifier named `await` remains valid in expressions; only
the unsupported juxtaposition `await operation(...)` gets the special guidance.

## Per-component source expectations

A plan's source baselines must retain which linked root introduced each dependency.
An aggregate map cannot safely remove one root while another is unavailable, nor
represent different reviewed expectations for a shared dependency. Save a per-root
expectation/hash map; keep the aggregate fields for compatible readers. A retained
root is copied without re-acknowledging its source; a new or explicitly reviewed
root is captured through the normal worker. Removing a root removes only its map.

For legacy records, recover a root map only when retained catalogue hashes match
its recorded expectations, including the dependency-bearing declaration hashes.
Otherwise retain a conservative superset and flag that attribution needs review.
Never silently discard a potentially retained dependency or insist on a live
missing file merely to save an ordinary status edit. Source-attention comparison
must use each root's baseline and deduplicate shared findings.

Grouped source review now uses one analysis worker with explicit additional entry
files, rather than one snapshot per selected root. A plan may select up to 500
roots; the unchanged parser/worker bounds (2,048 loaded files, 8 MiB source and
owned cancellation) still apply to their combined import closure. Exceeding a
bound cannot establish complete evidence. This removes the separate 32-file root
limit and repeated parsing of shared imports; broad project-wide search remains
a separate indexing decision.

Implementation links distinguish intent from administrative review metadata.
For native planning records, intent includes their title, detail, acceptance,
relations, custom design fields and the recorded semantic source expectations.
Status, evidence notes/revision pointers, raw source hashes and the representation
of per-root provenance are administrative and do not by themselves invalidate a
code link. Reordering relation sets does not change intent. Older links retain
their original entity-content comparison until explicitly renewed; new links
record the intent-hash mode. This is structural change detection, not a proof
that prose or implementation behaviour is equivalent.

Implementation bindings are many-to-many: adding a declaration adds or renews
that exact plan/declaration pair, never replaces a different pair. The first
bounded UI supports up to 20 declarations per planned record and 100,000 total
bindings; larger plans must be divided before adding more. Each pair retains its
own reviewed plan/code hashes. A plan's aggregate status keeps any missing,
changed, unknown or unfinished part visible. Removing a pair is an explicit,
revision-guarded metadata edit, including when its code has disappeared.

A missing expression immediately before a structural delimiter can be represented
as a zero-width recovered expression hole, while retaining its enclosing flow and
block ranges. The parser still emits an error; the source stays recovered and its
claims remain incomplete. This lets an empty block-editor field survive a fresh
parse/restart without keeping a second saved AST as semantic truth. Recovery must
leave the delimiter for its enclosing construct and must never invent a value,
zero bound or successful result. Other syntax failures keep declaration recovery.

Visual resource authoring reads bounded block scopes from the canonical resolver.
It does not reconstruct local declarations or infer ownership in the browser.
Choosing a declared destination can still produce an illegal-transition finding;
in-scope resources can still be borrowed or moved. Creating a resource creates an
obligation, not cleanup. Adding cancellation starts with an explicit unknown.
Step insertion goes before a trailing return/propagate and keeps that exit's
leading notes attached. Resource state/rule previews and choice lists have explicit
caps and totals; the original definition remains available in Text.

Standalone shape editing shares type spelling, reference validation, comment
retention and source/impact projection with interface editing. Preview never
writes source. Draft recovery merges independent members and requires explicit
choices for conflicting edits or deletion versus modification; incomplete
duplicate names must remain intact rather than collapse during merge. Recovered
syntax anywhere in the captured impact scope prevents a complete-impact claim.

Candidate code-file discovery is metadata only, not code observation. It streams
directory entries with cooperative cancellation and does not follow discovered
symlinks. Limits are 10,000 files, 5,000 directories and 100,000 entries; omissions
remain explicit. Three session-pinned inventories support pages and relative-path
search without repeated scans. Capture separately validates and reads selected
paths. Discovery does not create an architecture database or execute source.

## Thirteenth-review follow-up: one source and explicit unfinished links

Use the canonical formatter for structural visual edits instead of maintaining
a second indentation policy in the browser. This is an explicit source-authoring
operation; it does not reparse once per analyser. Format/check transport may fail,
so pending edits must validate the original buffer and component lifetime before
application. Navigation and newer source win over late responses.

Keep implementation-link drafts in the existing local recovery record, keyed by
planned entity identity. Persist the original source context and user text, never
a review checkbox. Fresh acknowledgement refers to the currently displayed
plan/code; it cannot be inferred from opening a saved draft. Do not silently drop
other drafts after one link is saved. Resource limits reject new drafts rather
than evicting unfinished work.

## Create-only declaration forms

New declarations append to source through a source-hash-bound preview; existing
names refuse creation rather than switching into edit mode. Reuse the signature
and nested type writer, and keep explicit work/atomicity assumptions separate
from bodies. Resource state-name edits update unambiguous form references;
removing a state removes its cleanup membership and leaves any invalid initial
or transition choices visible for correction.

One unfinished creation form is retained. Resuming always obtains current
source/type context and a new preview; there is no recovered approval bit.
Large invalid form changes are refused before replacing the retained form.
Existing resource definition editing and full event/machine authoring are
separate, still-open controls.

## Per-link implementation review baseline

Use a retained checkpoint reference and validate the binding's snapshot and node
hashes before comparing. Do not silently recover a legacy/lost baseline by name
or search through history. Present unavailable history honestly and allow a
separate explicit review of the available current version. Reviewing one pair
retains its existing reason and changes no other pair or unfinished authoring
form. Source/relationship differences are structural evidence, not conformance
proof. Diff work shares the owned query worker and deterministic display bounds.

## Existing resource lifecycle authoring

A lifecycle edit retains the resource identity and does not migrate state uses.
Shared validation prevents create/edit semantics drifting. Recovery compares the
structured lifecycle, so unrelated source comments do not force a rules conflict;
changed rules are shown beside the user's edit and need an explicit choice.
Source hash and buffer guards remain authoritative at preview/apply. Existing
notes are retained with their old line provenance when a definition is rebuilt.

## Cross-file type selection during declaration creation

Search results describe parser-discovered candidates, never a universal verified
type catalogue. Reuse requires explicit nominal identity and source provenance.
A preview checks the selected source closure through the ordinary worker/IR;
adding a whole-file import must not silently shadow names or create a cycle.
Existing signature/type editing retains its stricter visibility policy. Keep
original and expanded snapshot identities distinct and validate imported source
hashes again before applying. Source/API/MCP and the real GUI restart/stale-source/import checks pass;
current audit records the exact browser coverage.

## Missing delimiter feedback

When a required semicolon is followed by a clear statement/declaration boundary,
the parser reports a zero-width insertion location after the previous token.
Comments and whitespace stay untouched. Ambiguous tokens retain the ordinary
expected-token diagnostic. This changes feedback only: no delimiter is inserted,
the malformed declaration is still recovered, and dependent evidence remains
incomplete. The same finding and location feed CLI and Studio explanations.

## Event-model declaration forms

Finite machine creation shares the existing source-preview and recovery
transaction. Numeric bounds stay decimal strings and are validated with BigInt;
empty expression fields become explicit unknowns. The ordinary parser checks
individual authored expression boundaries; the canonical IR/checker still owns
typing and lowering. No second browser expression evaluator is introduced.
State renames never rewrite arbitrary expressions by text replacement. Existing
machine definitions still use their checked field cards or Text. The real GUI restart/counterexample/correction journey now passes; current
audit records the exact browser coverage.

## Shared declaration starting points

The declaration-kind registry owns the GUI labels, purposes and MCP creation
choices. Both entry points use `initialDeclaration` for fresh editable examples;
agents can request one kind without downloading all shapes or consulting a
separate grammar guide. These are authoring defaults, not inferred project facts
or approved assumptions. The normal source-hash preview and checker still apply.

## Simultaneous implementation conditions (fourteenth review)

A plan/code link can have several independent problems. `statuses` retains all
applicable conditions; the legacy `status` is the highest-priority condition,
with missing code and unknown coverage preceding plan/code changes. Each link's
reasons are retained independently, and record conditions aggregate all links.
Counts describe condition membership rather than a disjoint partition of rows.
GUI lists show all conditions; compact graph labels announce additional ones.

Unsaved import validation receives only changed editor buffers. Cached copies
of unchanged files cannot override freshness checks against disk. A real type
import/restart/stale-source browser journey exposed and verifies this boundary.

After applying a source form, focus is a request against the exact target
file/text. Blocks waits for that checked document before focusing its named
card; Text returns focus to its editor. Navigation, newer edits or a user's
existing focus invalidate or supersede the request. Modal cleanup never relies
only on a DOM opener that may have been replaced by the recheck.

The formatter now uses LF offsets consistently and retains at most one blank
line between source lines. Tokens and comment text are preserved; deliberate
runs of blank lines are no longer part of the formatting contract. Bounded code
diffs report how many lines of the changed region were omitted on each side;
long individual lines can still be shortened separately. Old retained source
bytes are never reformatted by viewing a comparison.


## Source dialogs own keyboard commands

Every source declaration dialog participates in the shared modal boundary.
Background navigation/editor regions are inert, and Blocks save shortcuts
are detached while the dialog is open. A browser regression instruments actual
fetch calls during Ctrl/Meta-S; absence of an accidental save is asserted after
the key handler completes, without a timeout-based negative assertion. Apply
still hands focus to the matching checked source card after the dialog closes.

## Operation precondition and guarantee fields

Operation creation may carry bounded optional expression arrays. Omission means
no additional rule; adding a blank field means an unresolved expression, never
implicit truth. Event and contract authoring share one real-parser boundary
validator. It checks field containment only, not names/types/proofs; canonical
analysis continues to decide those. An abstract guarantee is a labelled
environment assumption. Existing drafts without the new arrays remain valid.

## Feasibility witnesses in human reports

Feasibility analysis retains mathematical integers as BigInt in memory. Text
rendering uses the same decimal-string-aware serializer as JSON reports, rather
than raw JSON.stringify. Presentation does not coerce witnesses to floating-point
numbers or change evidence status. Real CLI tests cover positive and negative
integers beyond the safe-number range and preserve a violating call's exit code.

## Behavioural evidence for abstract guarantees

Restricting abstract operation outcomes with `ensures` must add an explicit
per-operation postcondition assumption to the flow's evidence. Generic
"abstract outcomes/effects" wording is insufficient on its own when a safety
result depends on an unverified external guarantee. This changes evidence
wording, not which outcomes the source semantics permits.

## Atomic range forms retain unfinished input

Numeric event-state bounds are a single explicit form transaction. Partial input
is a bounded durable draft, not parser-invalid source. State identity uses the
machine/state name pair plus source-state hash, never an absolute path or list
index. Both current bound spans and the state hash must still match before
application. Generic changes inside the state invalidate the projection until
rechecking; unrelated edits preserve it. The form shares range validation with
machine creation and source undo with Text. A source-confirmed range violation
remains a design error; widening a range does not establish a safety rule.

## Unanswered type choices belong to drafts, not source

New authoring value slots no longer silently mean Text. The shared authoring
shape has a draft-only `unselected` member. Recovery accepts it, while complete
validation and the common type writer refuse it with the field/input name.
This adds no language type or checker semantics. Legacy selected forms and
labelled example templates retain their existing values. Interface/creation
previews cannot generate partial source from an unanswered slot.

Draft presentation is separate from source spelling: conflict review must show
unanswered values without emitting them or throwing. `describeDraftType`
validates the bounded draft shape and returns explanatory text. Both source
writers and complete preview validation continue to reject unselected types.

## Unused scope entries do not erase source failures

A fully constructed finite flow graph that contains a source violation retains
unused-scope issues rather than throwing the graph away. Backends still need to
find the witness, and source replay still validates it. Configuration issues are
reported separately (B014); non-violated properties remain incomplete while the
scope is invalid. Safe graphs with unused entries and invalid used values remain
rejected. Plain model emission refuses the invalid scope and publishes nothing.


## Carry assumptions to the consuming check

Abstract scalar return guarantees may narrow the existing interval/Bool facts
only after all preconditions are established and the declaration is unblocked.
The shared feasibility fragment first rejects known contradictory guarantees.
Concrete flow postconditions never become facts merely because they were written.
Assumption provenance follows referenced facts and branch conditions into consuming
calls and return evidence, rather than decorating a producer call that proves
nothing about its output. Unsupported relations are not silently solved.

Formatter parse failures are language errors (exit 1), identify the first real
source location, and never write the malformed file. Repeated related spans are
rendered once; a range-caused invariant failure directs attention to the assigning
event without hiding either independently replayed finding.


Conjunctive guarantees must remain consistent after substituting actual call
inputs. A supported narrowing checks each conjunct against accumulated facts;
an impossible call-specific contract yields V002 rather than a fabricated return.
Boolean equality constraints share entry-feasibility handling. A pure helper's
body supplies facts only when its own preconditions are established, preserving
the same boundary through nested contract expressions. Bounded truth-table
comparison is independent evidence for this fragment, not a universal proof.


## Provisional names and stable compatibility identities

The public CLI/source suffix now have a dependency-free shared definition in
`shared/identity-values.ts`. Node's existing identity module re-exports the same
object; browser forms import the pure values without Node crypto. Discovery,
scenario validation, recipe/collision filenames and generated commands use this
definition. There is no runtime rename setting. Tests load the consumers with a
different provisional CLI/suffix and verify their behavior.

Storage directories, report schemas and history identities remain compatibility
formats. Changing the public name must not silently abandon existing project
state. Package bin metadata, launcher, docs and visual branding are explicit
release edits; storage changes require a separate migration decision.

## Per-file retained code versions (seventeenth review)

The first observed-code store used one pretty-printed graph document per capture.
That crossed the 16 MiB document bound on a doubled real codebase and duplicated
unchanged graphs until full history crossed 64 MiB. New captures keep a compact
`pymtheg.observed-parts/v1` manifest plus `pymtheg.observed-file/v1` parts keyed by
source path. Content-addressed architecture blobs deduplicate unchanged parts;
only the small manifest carries version labels and array-order runs. Reconstructing
an observation checks each part hash, source provenance and complete ordering,
then validates the original public observed-graph schema. Legacy observations
remain readable without migration writes. Removed parts leave the active snapshot
and native inventory; immutable history preserves their old blobs.

The architecture-document count remains 4,096. Reserved code parts have a separate
10,000-file count; snapshot/history validators enforce both. Byte and retention
limits remain 16 MiB per part, 64 MiB per snapshot/archive and 512 MiB retained
content, with no automatic eviction. Capture retains the 32 MiB source and bounded
AST-work limits. This is bounded storage, not an unbounded repository backup.
Capture receipts report novel/reused blob bytes including version metadata.
A mixed 1,006-file real-source corpus with nine labels and one changed file fits
portable history and reopens every version. Larger repeated full-source copies
hit the existing AST work limit; their refused runs are retained, not counted as
successful captures.

## Candidate arguments and stable operation clauses (seventeenth review)

A supported scalar precondition with a mixed inferred input range now exposes a
located C006 review warning and bounded candidate arguments. Sampling is capped
at 256 combinations of at most eight scalar arguments; unsupported values stay
pending. The candidate fails the rule under the existing typed fact evaluator,
but independent argument ranges can lose correlations and path reachability.
The result therefore remains inconclusive with an explicitly unvalidated witness.
It does not become a confirmed counterexample, discharge an obligation or justify
an assumed guarantee. CLI, Studio findings and agent reads retain that distinction.

Operation descriptions now expose original clause indices. New forms retain those
indices through field edits, removal, additions and draft recovery; added clauses
use null. The rewrite validates indices and edits each surviving original span,
so deleting an earlier rule or cost cannot move another rule onto its note.
Removed inline notes are explicitly marked as belonging to a removed clause;
empty owned lines are removed. Legacy clients without indices match unchanged
clauses before using remaining positional slots. Clients editing and deleting
clauses together should supply origins to preserve their intended association.
Explicitly rebasing an entire saved form onto changed source still requires the
existing source comparison and choice; it is not an automatic semantic merge.

## Observed target origins (reader v4)

The TS/JS reader retains project resolution separately from target origin.
Unresolved calls/imports may be identified as known unshadowed builtins, external
package imports, local bindings or unknown targets. A shadowed global is a local
binding or resolved project symbol, never presumed a builtin. Origin is navigation
metadata: it does not establish the runtime target or complete relationships.
Whitespace in chained target labels is normalized without changing source or IDs.
Reader v4 has a new snapshot identity; older graphs remain readable. Graph pages
retain names/origins and disclose both record-list and page-edge truncation.

## Headless reader navigation and constrained test workers

Guidepup Virtual Screen Reader 0.33.0 is pinned as a development dependency. It
simulates reader navigation and actions in the real headless app; browser-native
accessibility snapshots independently check roles/names and background exclusion.
It does not replace native screen-reader or human-user testing. Tests use bounded
navigation counts, modal-cycle detection and actual source/focus results. They
never rely on startup sleeps or relax product acceptance to fit a resource limit.

The Firefox core identifies a failed SwComposite thread creation (EAGAIN) before
navigation. A test-only profile bounds content pools, disables prelaunch and
renderer multithreading, and uses software rendering. The Go-based test bundler
uses GOMAXPROCS=1 to fit the shared one-core/task budget. No pc-tools limit,
user desktop setting or security sandbox changes. Resource exhaustion remains
explicitly unresolved rather than a passed assertion. At Karl's direction, no
further Firefox investigation is part of this loop.

## Eighteenth review: continuations, live design and bounded code observations

Contract analysis returns surviving facts from each block. Early returns remove
paths; surviving alternatives join by interval hull and shared Bool knowledge.
Loop execution is never presumed. Candidate call arguments remain unvalidated for
joint reachability. Bounds name actual inputs; unknown names cannot introduce
implicit proof facts.

The implementation view keeps its selected immutable design and code checkpoints,
and separately checks current design through the existing canonical source
catalogue. Native plans use their own expectations; directly bound design nodes
use their retained dependency closure. Current design drift/uncertainty coexists
with every code status. Reading a graph never accepts a changed expectation.
The displayed design declaration is original `.pym`, not serialized IR.

The typed contract projection marks transitive remote/io suspension once.
TypeScript emits Promise results and async fail-fast stubs for those callables;
local/pure callables stay synchronous. Plugins receive the same maySuspend flag.
This is a target representation, not a claim that effects are implemented.

Observed file v2 uses bounded dictionary references and tuples, with source file
provenance implicit per part. Legacy v1 parts and monolithic graphs remain readable.
Expanded graphs still pass the public validator. AST visits scale deterministically
with captured bytes (2M minimum, 16M maximum), with per-file limits and explicit
partial coverage on exhaustion. The capture worker heap scales from 512 to 1024
MiB with captured source bytes; exhaustion names file/byte counts and narrowing
advice. This does not change browser cgroups or source/storage transfer limits.

Component contract forms reuse the canonical metadata spans and guarded source
preview. Named budgets/bounds preserve notes; ambiguous legacy rule edits require
origins rather than guessing comment ownership. A parameter rename warns explicitly
about retained body/contract references; it does not silently rewrite identifiers.
Recovery ownership changes are pushed to other windows without changing their
source save bases or overwriting their buffers.

## Nineteenth review: typed iteration and one review authority

Contract-loop facts come from the resolved count type in the canonical IR. A list
iteration binds an element, not an index: Int stays unbounded in sign, Nat is
nonnegative, Bool is Boolean and unsupported shapes stay unknown. A cardinality
iteration binds [0, max(count)-1]; a known zero count has no body obligations.
Assertions constrain continuing paths. Bounded scalar exclusions avoid suggesting
values removed by guards. Immutable Boolean aliases carry the expression and its
source binding identities, so later interval refinement keeps the same meaning
while a different binding cannot inherit the predicate. This is bounded scalar
reasoning, not a general theorem prover.

C006 retains its candidate-only meaning and unvalidated witness. Candidate search
uses the rule's referenced scalar inputs, rather than refusing a realistic signature
because an unrelated input is a string or record. C007 exposes a still-unestablished
rule when no concrete candidate is inferred. Neither warning is a confirmed trace.

Source-link review uses per-plan source expectations exclusively; the historical
Markdown/record target comparison skips source links. Evidence freshness remains
separate, so reviewing a changed source does not re-verify old test evidence.

Oversized code is explicitly omitted before parsing, with name, size and reason
in the observed graph. No content/hash is fabricated for unread bytes. Capture
scope includes the omission, coverage is partial and CLI exits 2 when a partial
observation is available. Successfully read files retain their own complete
coverage. Portable history preserves these omission records. Source output guards
cover requested, captured and omitted paths, including existing symlink aliases.

New source folders are previewed without writes and created on explicit Save or
Create, after project confinement and source-policy checks. Operation metadata
insertion owns preceding whitespace at the insertion boundary to avoid generating
formatter failures without reformatting unrelated source. Vite uses the runner
config loader; reviewer build copies must keep their cache/temp directories private.

## Twentieth review: signed refinement and evidence boundaries

Fact refinement folds integer constants with the same affine representation as
comparisons, including negative bounds in either orientation. Boolean equality
retains an immutable alias's predicate. Disjunctive continuations join alternatives
conservatively; at most 32 explicitly excluded integer values are retained.
Infeasible assertions emit C008 with an unresolved feasibility result and assumption
provenance, rather than silently omitting the unreachable continuation. This is
not a replayed counterexample. C006 messages retain original argument positions
when unrelated formal parameters are excluded from a candidate.

An upper work bound above a budget still fails acceptance, but is inconclusive
with an unvalidated witness and an explicit path-feasibility obligation. A bound
comparison alone cannot establish an executable counterexample. Exact straight-line
cost derivations retain their existing representation.

Code capture first attempts its normal whole-scope parse within the unchanged
512–1024 MiB worker heaps. On worker-memory exhaustion, whole source files are
partitioned deterministically into 3 MiB contexts and captured sequentially. One
version combines all successful partitions' declarations and existing edges.
Cross-partition relationships are not inferred; the graph explicitly has partial
relationship coverage. No partial version is retained if a partition fails or the
combined graph exceeds the existing node, edge, snapshot or storage quotas.

Large v2 dictionary parts may be stored in v3 deflate/base64 envelopes to avoid
archive growth from JSON escaping. Expansion is bounded to the existing 16 MiB
part maximum, checks the exact byte count and accepts only one v2 payload (no nested
compression). Old parts are read without migration or rewriting. Storage quotas
continue to measure the actual retained and exported bytes. Both writers and
readers also enforce a 64 MiB aggregate expanded-part bound. Readers preflight
all declared expansion sizes before decompressing any part, so many individually
bounded compressed parts cannot cause unbounded aggregate allocation.

The GUI harness forwards its explicit engine to each bounded child. Its diagnostic
controller retains console/crash events, recent DOM, pending requests and observed
controller/in-process-server event-loop delays. These timers collect diagnostics;
they are not acceptance criteria. File-chooser interception starts before keyboard
interaction. Virtual-reader and browser-tree evidence remains distinct from native
screen-reader use, and no Firefox or desktop exception is introduced.

Full WebKit coverage additionally found transport-specific import metadata drift:
folder pickers can omit hidden/private paths that CLI discovery reports. Persisted
inventory exclusions now retain source-relevant entries, with private/generated
ones canonicalised away. On refresh, semantically equal old/new metadata preserves
the prior bytes, including legacy inventories. Incoming browser folder names still
cannot relocate an absolute CLI source. Real source repoints and document-set
changes remain changes; historical records are never rewritten.


## Twenty-first review: process isolation and import preflight

Code capture owns a bounded child process rather than a worker thread. Input is
per-file JSONL; output is the existing bounded manifest/parts representation.
Cancellation and deadline cleanup own the entire child process group. Native V8
allocation failure triggers bounded sequential partitions without aborting the
caller. Incremental snapshot hashing avoids one aggregate source string. Reader
v6 changes capture identity; old observations remain readable. Partition reader v2
withholds targets whose declaration names occur in multiple partitions, including
ambient/merged globals. All cross-partition relationships remain explicitly partial.

History validation decodes every distinct code document set before commit; bundle
preview applies the same decoder. Hash validity alone is insufficient. Plan-only
metadata and a selected code checkpoint decode independently, so unrelated damaged
legacy code cannot block a new capture or healthy historical read. Existing byte,
count and retention quotas remain unchanged; no data is evicted automatically.

C009 qualifies a violated condition on an unvalidated source path. Branches,
iterations, caller requirements and concrete calls may overapproximate reachable
states; a false condition there is pending, never a complete counterexample.
Abstract operation results retain their explicit assumption provenance. Supported
single-variable affine comparisons refine integer ranges with sign reversal and
floor/ceiling division. Safety established over those conservative ranges remains
valid; no general nonlinear or source-reachability proof is claimed.

Folder discovery excludes dotfile documents consistently across CLI and browser
transports. Hidden content retained by an older folder import is preserved on
refresh rather than interpreted as deleted. Individual explicit file imports and
ordinary document editing remain available. Runtime exclusion metadata is normalized
at every path segment; visible document edits/removals remain reviewable.


## Twenty-second review: source witnesses and capture ownership

Capture now separates the source owner, an IPC-connected supervisor and the parser.
Only the parser performs TypeScript work. The supervisor reaps its process group
and removes the transfer on owner disconnect or cancellation; it stays alive while
the owner reads the completed receipt. Unexpected supervisor exit also triggers
owner-side parser cleanup. New transfers have a small owner marker. Startup cleanup
checks directory ownership, regular bounded marker files and a demonstrably dead
PID; active and unknown legacy paths are never inferred to be removable.

There is no fixed wall-clock capture cutoff. Existing source, AST-work, graph,
heap and storage bounds remain, and users can cancel. Resource exhaustion still
cannot become a successful complete observation. Native allocation failure uses
the existing bounded partition fallback. Reader v7 leaves unresolved computed keys,
mutable callable bindings, callback parameters and dynamic function choices unknown;
TypeScript structural signature compatibility is not runtime target identity.
Partition reader v3 also withholds ambiguous owner-qualified methods.

Contract witness search uses the canonical typed source executor, never reparsing
or running application code. It tries at most 64 source input combinations for a
condition, 256 new trials per analysis and 100,000 total executed steps, with at
most 1,000 steps per trial. Samples include scalar path bounds, source/condition
literals, Booleans and bounded simple compound examples. Unsupported or exhausted
search remains pending. Only a replay that fails the exact call and required
condition promotes a finding to C004/source_replayed with its inputs and assumptions.
It is one concrete counterexample, not proof for every input. A previous assertion
or call failure cannot confirm a later condition. MCP translates only witness
provenance; modelled input values remain exact.

Architecture and Design editor are explicit, idempotent destinations. Connection
labels use retained record/declaration names while keeping stable IDs as data.
Malformed requests remain 400, export quota refusal is 413 with narrowing guidance,
and store contention is 503. Validator locations are retained without raw Zod arrays.


The same bounded replay also confirms return-guarantee failures as C005. Its
finding points to the exact failing guarantee, with source inputs and assumptions;
it does not attribute an unexecuted return to another path's witness. Unreachable
returns remain qualified. A previous failing assertion or call cannot confirm a
return guarantee that execution never reaches.


Report comparisons also inspect session completion, and Studio comparisons inspect
the containing run status. A cancelled typed-only report is incomplete even when
all properties it emitted finished. A missing shared work estimate is reported as
missing comparison evidence, not unchanged work. The investigation journey waits
for exact submitted run IDs and includes coordinator-event-controlled cancellation.

## Project-fit follow-up: complete search and qualified source witnesses

Assessments of private trial projects are kept outside the repository. No live
project is migrated by this follow-up.

Architecture index v17 indexes the complete supported record text rather than a
64 KiB prefix. Heading sections and retained source contracts also have complete
search projections. Existing document/snapshot/index-visit bounds remain; no
search truncation is hidden behind a successful index. Older projections rebuild
from immutable retained originals, and v16 bundles remain accepted. Reads do not
rewrite the database or historical document bytes.

The source witness sampler normalizes signed integer literals before collecting
adjacent values. It orders parameters by stable name, varies each input before
Cartesian products, and includes diagonal combinations. The existing 64 examples
per condition, 256 new trials per analysis, 100,000 total steps and 1,000 steps per
trial bounds remain. Search exhaustion stays unresolved; parameter renaming and
unrepresented input shapes can still affect which examples fit the budget.

Input trials and contract witnesses may execute a typed prefix before an
unfinished placeholder. Type errors and recovered syntax still block execution.
Reaching a hole stops the trial as unsupported; it never fabricates a value or
skips an instruction. Whole behavioural lowering still rejects incomplete source.
Only the exact call/condition or return condition that actually fails can confirm
a witness, and unresolved source remains incomplete outside that counterexample.
MCP summaries count these source-replayed witnesses as counterexamples.

Reader v8 applies ambiguity and mutation checks to object receivers and repeated
CommonJS exports as well as callable bindings. Object-literal method identities
include their binding scope. The changed reader identity prevents treating a new
interpretation as an unchanged old code version; historical observations remain
readable. Dynamic receiver choices are unresolved, not guessed from a compatible
TypeScript signature.

Missing or ambiguous source links cannot be acknowledged as current in Studio.
Their historical link can still be saved, including a superseded plan, without
renewing review. Remove or explicitly replace a missing target before reviewing.
Invalid observation choices use a typed input error and HTTP 400. History quota
advice points to supported individual-revision export rather than a nonexistent
revision-subset operation.

Partition fallback now retains its initiating reason. A diagnostic-confirmed heap
failure is distinct from an unexplained signal or native abort; SIGKILL alone is
not proof of memory exhaustion. The same bounded fallback may preserve declarations
while leaving cross-partition relationships unknown. A 24.9 MB real-package probe
still partitions. Releasing compiler context before graph validation did not change
that result, so that experiment was reverted; its inputs, diff and results remain
in evidence. No memory limit was raised and no missing relationship is claimed absent.

### Pending nested authoring edits

The follow-up WebKit sweep saved an old default field name after a name/type edit.
The failed run is retained. A controlled pending-render fixture reproduces that
same loss with the retained old editor; a merely successful rerun is not treated
as a repair. Type and recipe fields now compose each accepted local edit against
the pending draft until the parent commits new props. New committed props still
replace that draft. Existing source baseline, preview, recovery and save-conflict
checks are unchanged. The regression covers both nested field-name/type edits and
sibling input-name/output-type edits, then creates actual checked source.


## Review 24: stable witness allowances and observed dependency review

Witness attempts belong to a condition, with lexical parameter-use ordering and
cache costs charged identically to fresh executions. This removes dependence on
alpha-renaming and unrelated project conditions without increasing the per-condition
64-example/64,000-step allowance. Bounded misses remain unresolved.

Dependency review uses captured lexical bindings and resolved relationships, with
iterative strongly connected components for cyclic graphs. It does not substitute
whole-file hashes for dependency evidence or silently reparse historical source.
Legacy captures/reviews remain readable without this baseline. Reader v9 adds
mutation/alias conservatism; its identity changes when interpretation changes.
Comparisons expose concrete retained dependency edits while explicitly qualifying
uncaptured runtime dependencies. Index v18 projects decoded authored search values;
older indexes rebuild read-only and older bundle versions remain accepted.


### Bounded import recovery and lossless code-part storage

Partition reader v4 resolves explicit named/default/namespace ES module imports
against captured export identities and the complete selected file inventory.
TypeScript's module resolver uses that inventory; no uncaptured file is read and
no application code is executed. Dynamic exported function choices and unobserved
relationships remain unresolved. Import-syntax names are not runtime references.
Recovered targets are checked against a full parse on retained real source.
Other cross-partition relationships remain unknown, so the combined graph stays
partial. Existing source, AST, heap, graph and retained-byte limits are unchanged.

The reader no longer borrows a structurally compatible call signature to choose
a runtime target. Static object destructuring follows the actual initializer;
literal-key methods use their declared property symbol. Unsupported values remain
unresolved instead of borrowing another function's signature.

Code dictionary parts v4 can derive a declaration hash from its exact retained
signature when the hash matches, rather than storing a duplicate digest. Provider
hashes that differ remain explicit. Older v1/v2 and compressed v3 parts remain
readable; the v3 compression envelope can contain one v2 or v4 dictionary part,
never nested compression. The same 16 MiB per-part and 64 MiB aggregate expanded
bounds are enforced before decoding. This is lossless storage, not raised quotas.
Lexical references retain only their first source site per owner/target pair;
call-site counts remain separate from these dependency-pair counts.


## Review 25: mutation provenance, scoped partitions and witness priorities

The review-25 reader was `typescript-ast/v10`; partitioned captures use
`typescript-ast-partitioned/v5` and dependencies use `lexical-v2`. Imported live
bindings share canonical mutation identities. Captured direct Object/Reflect
mutation APIs, destructuring write targets and writes forwarded through local
helper parameters withhold uncertain callable targets. This is a bounded analysis
of captured syntax, not complete JavaScript alias/escape analysis or execution of
external helpers. Budget exhaustion withholds targets and reports partial coverage.

Namespace constant reads, whole-enum declarations and captured binding writers
contribute dependency evidence. Writer changes retain concrete source excerpts;
module-level writes do not substitute a whole-file hash. Dynamic or uncaptured
writes remain unknown. Mutable exports can retain dependency references without
being recovered as confident call targets across partitions. Type references identify
declarations independently of runtime mutation; they do not establish dispatch.

Private declarations in external modules retain their resolved relationships when
another partition contains a private declaration with the same name. Global scripts
and global/module augmentations retain the ambiguity safeguard. Legacy captures
without scope metadata keep the older conservative treatment. No missing global
or cross-partition relationship is claimed absent. Code dictionary v4 retains the
optional scope flag and omits unused edge slots losslessly; all existing expansion,
heap, source, graph and storage bounds remain unchanged.

Witness dimensions now use canonical self-marked expression contexts, flattening
and sorting Boolean conjunction/disjunction contexts. Numeric and text candidates
are relevant to each input's uses and the target condition. Unused literal lets
no longer fill candidate slots. Lexical aliases/shadowing remain explicit. The
64 examples, 64,000 source steps per condition and 1,000 steps per trial are
unchanged; bounded misses still remain unresolved. Only execution of the original
typed IR at the exact condition confirms a counterexample. The retained fuzz runs
exercise renaming, parameter order, conjunction swaps, unused literal padding and
unrelated earlier flows; they are not a proof of arbitrary program equivalence.

Architecture index v19 includes located planning-schema warnings (first four
fields plus an omitted count). Older indexes rebuild from retained originals
without rewriting them. Explicit unknown implementation and review-history
revisions return 404; the default empty implementation workspace remains empty.
Historical index v18 bundles remain readable.

Captured writes through static imports are retained as explicit provenance across
partitions. Merging withholds calls into the affected exported declaration and
connects its dependency baseline to the captured writer. Top-level write excerpts
remain separate from unrelated module source. Global collision checks remain
conservative; private module names do not become global merely through partitioning.


## Review 26: escaped receivers and canonical source-witness priorities

The review-26 observations used reader `typescript-ast/v11` and partition reader v6.
A receiver that escapes through an array/object container, argument, constructor,
return value or captured `this` write no longer supplies a confident method target.
This is deliberately conservative: even a read-only helper can make its receiver
unresolved unless the reader establishes the binding remains local. Scalar copies
are not object escapes. Passing a callable does not change its direct callable
identity; mutable properties of that callable remain separate. Static direct calls,
ordinary local receivers and unambiguous CommonJS aliases retain controls.
Captured imported escape metadata propagates across partitions without inventing write
provenance. Old observations remain readable. No application code is executed.

This supersedes v10's narrower helper/reflection coverage: v10 did not cover
constructors, destructured/arguments parameters, callback/container propagation
or every Object/Reflect alias. The new boundary is escape conservatism, not an
enumeration claiming complete mutation or JavaScript runtime analysis. Dynamic
and uncaptured relationships remain unknown; source/body presence is not conformance.

Module-level destructured bindings retain their initializer dependencies. Captured
class-static member writers contribute fingerprints and exact retained excerpts.
Linked records state when their declaration has unresolved outgoing calls whose
changes cannot be tracked; that information does not fabricate a changed dependency
or prevent an explicit review of the available evidence.

Witness priorities use canonical atomic comparison contexts, independent of
Boolean nesting, mirrored operand order and negation. Bounded pure-rule expansion
uses resolved declarations from the same typed IR. Shared integer-affine semantics
supplies normalized comparison keys and inverse boundary candidates, including
related-input boundaries. Candidate ranking gives these boundaries precedence
over incidental arithmetic literals. A target-input marker avoids ties with
unrelated earlier calls. Boolean companions and related boundary assignments fit
inside the same 64 attempts, 64,000 source steps per condition and 1,000 per trial.

These transformations affect sampling only: the original typed source executor
must still reach and fail the exact reported call/condition before a finding is
confirmed. No canonicalized guard is substituted into execution or proof.
Rule/context traversal is deterministically bounded; arbitrary logic, large
candidate spaces and exhausted search remain unresolved. The tested invariances
are not a claim of complete semantic equivalence or universal proof.


## Review 27: classified object uses and resolved guard facts

Reader v12 classifies every runtime expression use: only recognized local reads,
aliases, scalar copies and captured call receivers retain method certainty. An
unclassified object use withholds it. Logical/concise returns, defaults, fields,
yield/template/JSX positions therefore do not rely on a separate escape-position
allowlist. An escaped or patched instance invalidates internal class `this` dispatch;
constructor origins propagate across partitions (v7). This is a bounded, conservative
source reader, not complete JavaScript runtime analysis. Read-only-looking helpers
can still produce unknown targets; unresolved edges are visible on linked records.

Direct require alias paths share captured CommonJS ambiguity checks before cached
resolution. Review 28 found that CommonJS barrels bypassed those checks; the
current boundary and repairs are recorded below.
Older captured graphs remain readable. Destructured initializer calls, literal
static element writes and captured instance-field writers now contribute dependency
evidence. Comparisons show a declaration's own edit when a captured dependency
cycle makes that edit part of its fingerprint, avoiding an unexplained empty list.

Local range refinement now projects bounded resolved pure-rule bodies from the
same typed IR, after checking the rule's own preconditions. It does not reparse or
replace source execution. The existing guard refinement and exact source replay
consume consistent rule meaning. Projections are bounded at 12,000 visits/depth 64;
unsupported or exhausted cases remain unknown. No proof comes from sampling.

Witness search varies at most eight relevant input dimensions, prioritizing the
condition's inputs, and holds other declared inputs at valid representative values.
Unused formal parameters no longer consume that allowance. Context keys are only
built for source-mentioned parameters. The 64 trials, 64,000 source steps per
condition, 1,000 per trial and numeric candidate caps remain unchanged; unsupported
representative values or larger relevant spaces can still leave a bounded miss.

Captured module namespaces propagate escape to exported mutable values, including
anonymous default classes. Whole CommonJS module escapes also invalidate other
require consumers. An escaped import lacking a retained export identity withholds
that source's callables conservatively. Class expressions remain unknown instead
of borrowing an enclosing class's this identity. These limits are independent of
method body presence and remain visible as unresolved relationships.


## Review 28: implicit mutation channels and CommonJS barrels

Reader `typescript-ast/v13` withholds constructor/method certainty for decorated
classes, and decorated members expose their containing class as escaped. This
is conservative: decorators are never executed or assumed to preserve a value.
Methods of a class with a captured class decorator retain references to that
application and its captured decorator dependencies, so decorator-body edits
have retained before/after excerpts even when dispatch is unresolved. External
decorator bodies remain unknown.

Literal dynamic `import()` namespaces (including literal templates) conservatively
expose the captured module's mutable exports, even for a read-only import. This
does not rely on Promise library types: await, then callbacks and destructuring
share the same source identity, and escaped module metadata crosses partitions.
Nonliteral module specifiers are not resolved. No runtime module is loaded.

CommonJS checks follow captured require forwarding through barrel chains and
check the resolved declaration's file before a cached target can be used. Review 29
found a remaining shared-object member-write case in that boundary; the current
qualification is recorded below. Single unconditional callable controls remain. Arbitrary runtime loaders and external
module changes remain unknown, and direct eval is outside static dependency
tracking. Observing a body is not evidence of complete runtime call coverage.

Literal-typed string/number element keys contribute their actual binding writers
to dependency fingerprints. These changes preserve old observations as historical
evidence; they do not retrofit new relationships into them.

Namespace collection includes default-export assignments themselves, recursively
following object/instance values rather than losing unnamed default object
identities. Captured CommonJS namespace escapes invalidate its mutable default
exports object for require consumers; named ES module callable identities remain
distinct from receiver mutability. These are captured-source boundaries, not
runtime loading or a guarantee about arbitrary module specifiers.

Partition reader v8 retains opaque default exports even alongside named exports.
A captured module span is an uncertainty marker for such a value, not a resolved
call/reference target; the combiner uses it to withhold affected methods when
the namespace escapes in another part. This includes API and consumer files
sharing one partition while the patching import belongs to another.


## Review 29: shared CommonJS exports objects and decorator dependencies

Reader v15 records captured whole-module forwarding via literal require calls,
including local variable aliases. A file that both forwards module.exports and
writes one of its members qualifies the shared exports objects in both
directions. This covers direct source consumers and barrel consumers, without
assuming the source contains a second textual write. The analysis is conservative
and flow-insensitive; it does not execute modules or infer loader order. A write
through the detached exports alias is not treated as a write to the forwarded
object. Pure forwarding still has resolved callable controls.

Whole-module alias paths and explicit module-object escape qualifiers are retained
in observation metadata. Partition reader v9 followed that alias closure across
parts for recorded qualifiers. Review 30 found that writes through an out-of-part
require could lack those qualifiers; the v16/v10 repair below closes that gap. moduleObject denotes uncertainty about a mutable
CommonJS exports object, not a confirmed write to every declaration in the file.
Older observations without this optional metadata remain readable. Arbitrary
loaders, nonliteral specifiers and runtime mutations outside captured source
remain unknown.

For a class declaration with captured member decorators, its members retain
conservative references through the class to those decorator applications.
Sibling runtime dispatch remains unresolved, while edits to captured decorator
bodies have exact retained dependency excerpts. Other classes stay separate.
Within the decorated class, a sibling edit may conservatively flag more than
one member. Class expressions remain outside this dependency reconstruction.


## Capture startup cleanup across PID namespaces

Capture-owner markers v2 retain the Linux boot identity and PID namespace as well
as the owner PID. Startup cleanup deletes a marked transfer only when that scope
matches the cleaning process and the owner is absent there. Different namespaces,
different boots, v1 markers without a scope, and unavailable scope information are
preserved. A missing PID in one namespace is not evidence that an owner in another
namespace died. The IPC supervisor still cleans its own transfer on normal close,
cancellation or owner death; scoped startup recovery is an additional safeguard.

Pre-delegation hardening also qualifies assignment to the exports binding in a
whole-module forwarding file. Reattaching exports (including the chained
exports = module.exports = require form) can expose the shared object, unlike
merely writing through a detached exports alias. Pure and detached controls
remain. Earlier thirtieth and browser records remain preserved but superseded;
only the final source fingerprint and thirtieth-final input are authoritative.

Shared-object qualification also propagates uncertainty from reflective writes
and unclassified module.exports escapes through the same alias closure. It is
not restricted to textual member assignments: Object.assign, Reflect.set and
passing the shared object to a helper must qualify direct source consumers too.
The retained probe exposed those neighbours; executable full/grouped/split
regressions cover all three, without resolving uncertain calls.


## Review 30: CommonJS writes outside a parse partition

Review 30 found that v15/v9 dropped a CommonJS write when its required module
was outside the writer's parse partition. The earlier shared-object propagation
claims applied to retained metadata, not all syntactic writes; that gap is fixed
in reader `typescript-ast/v16` and partition reader
`typescript-ast-partitioned/v10`.

Literal require origins retain a resolved source path even when no local
SourceFile exists. The mutation collector retains syntactic write targets without
a TypeScript symbol. CommonJS writes and escapes carry module-object uncertainty;
the merge seeds its shared-object alias closure from both records before recovering
imports. The immediate-require writers tested for review 30 qualified API and consumer
files in another partition. Review 31 found late-assignment and member-forward
gaps plus an unreported resolution cost; the v17/v11 repair below supersedes
that coverage claim.
This is conservative, flow-insensitive uncertainty about shared objects, not a
claim that every member was written. Older observations remain readable.

Regressions execute 28 retained runtime fixtures and check every set partition,
six isolated writer forms and six production fallback layouts. Pure forwarding,
detached exports and unrelated-write full-parse controls remain. Three previously
withheld control fixtures remain withheld. Dynamic/nonliteral loaders and mutations
outside captured source remain unknown; this repair adds no general claim of
cross-partition call-resolution completeness. Partial captures remain labelled.
No Pymtheg language analysis, witness search, evaluator or emitter changed.


## Review 31: scoped CommonJS mutation provenance and stable analysis tabs

Reader `typescript-ast/v17` records all captured literal-require assignment sources,
including late assignments, without treating rebinding a local as a write to its
initializer. Nested access keeps the first exported member. `moduleMemberAliases`
records captured member forwards, and partition reader v11 propagates matching
member mutations through those forwards and whole-module aliases. `moduleObject`
qualifies an actual namespace mutation/escape; `memberObject` qualifies an object
reached through a member. Ordinary reads and passed callable values do not become
whole-file mutations. Unknown exported objects retain conservative method coverage;
file-private helper functions remain separate. Declared classes whose runtime body
is unavailable remain uncertain when their member value escapes; constructor
identity controls for implemented classes remain.

The pinned TypeScript binder's CommonJS source-module symbol supplies export-slot
identities even when getSymbolAtLocation(SourceFile) does not. Nested metadata
follows source object literals, not arbitrary inferred type trees. `commonjsFiles`
and member qualifiers are optional, strictly validated metadata; earlier observations
remain readable. This is bounded, flow-insensitive observation, not runtime dispatch
completeness. Arbitrary or aliased loaders, module.require, eval and uncaptured
runtime effects can leave otherwise static consumer targets resolved. Capturing
such source does not prove their absence or implementation conformance.

Review 31 measured 1,211 lost resolved calls despite equal edge totals. That cost
was omitted from the parent summary. Repair evidence now records resolved-to-
unresolved, unresolved-to-resolved, retargeted and added/removed edges by kind,
plus strict full/split precision on identical real CommonJS scopes and byte groups.
Current numbers live in review-31-follow-up; no blanket claim of zero recall cost.

Analysis tabs precede content that arrives after a check. The contract-regeneration
journey gates the initial report with a readiness handshake and asserts the bar's
position before and after it. The old WebKit assets fail the same assertion by
98 px; focused tests of the new layout pass in both engines. The historical click
failure's exact cause remains unproven. Browser limits and Firefox exclusion remain.

Export metadata uses the reader's deterministic visit budgets. If that pass
exhausts a budget, the file is explicitly listed in optional opaqueExportFiles
metadata with a located diagnostic and partial coverage; its call targets stay
uncertain during partition merging. This exceptional budget state can also
withhold private helpers. Ordinary known export mutations retain their narrower
export-root scope. No wall-clock threshold decides correctness or raises limits.


## Review 32: one qualifier for default and partitioned observations

Reader `typescript-ast/v18` and partition reader v12 share the captured-origin
qualifier closure. Default observations apply it without partition import recovery
or a partition limitation. This closes the tested late-assigned member-holder
write regression and helper/reflective holder neighbours. Direct object-literal
exports retain member aliases, including shorthand properties. These are captured
source relationships, not runtime loader-order or arbitrary alias completeness.

An incomplete origin pass still withholds namespace/import-dependent calls across
the observation, including otherwise unrelated parts, because the missing origin
could write them. Direct same-file lexical function/class/arrow identities remain
when the parser already resolved them; no discarded target is invented. The same
lexical exception applies inside mutable class spans, keeping local functions and
constructors separate from exported object members. Unknown export budgets still
have an explicit partial limitation. The earlier review-31 claim that arbitrary
private helpers survive incomplete-origin merging was too broad.

The single analysis navigation bar now precedes the toolbar and source panes,
including their mobile stacked layout. The controlled initial-report regression
covers 1440, 768 and 390 px in both engines, with pointer and keyboard navigation.
The sealed v17 WebKit assets reproduce a 272 px shift at 390 px; v18 assets keep
the bar fixed. Historical incident causes remain unproven.

Current repair evidence is in review-32-follow-up, including every set partition,
production full/fallback cases, conservative controls and resolved-call deltas.
No language semantics, witness search, evaluator or capture lifecycle changed.


## Review 33: visible mobile activation and explicit default-reader cost

At stacked workspace widths (up to 920 px), activating an analysis tab moves
focus to its named analysis region and scrolls that selected content into view.
Every navigation button identifies its controlled region. Desktop activation
keeps focus on the navigation button. No automatic check or report moves focus.
The initial-report position handshake remains; the 390 px regression additionally
requires visible, focused content for pointer, Enter, Space and the current tab.

Editor type tokens use an explicit darker palette against both plain and active
line backgrounds. The highlight tag dependency is pinned directly at the already
installed version. Accessibility checks now include a separate project whose
first/current line contains Int and Bool at 1440 and 390 px. Connected header
actions wrap within the tablet viewport; 768 px is checked in workspace and
architecture modes, including WebKit.

Reader v18 / partition v12 behavior is unchanged. Shared provenance qualification
can withhold existing full-parser targets, not just partitioned ones. In the
retained public package scopes, default full parsing v17 -> v18 loses 6 resolved
super() calls in ajv (1150 -> 1144) and 69 in Quint (995 -> 926), with no gains or
retargets. These are separate from the combined large graph's +929 calls / 0
losses versus v17. The earlier 429/429 ajv figure compares v18 full and partitioned
outputs on a smaller 64 KiB-group scope; it does not establish zero default-path
cost. Same-file super() is outside the bare-name lexical exception. Captured
links retain their unresolved-call caveat. The inaccurate source comment is fixed.

Other conservative limitations remain: object-literal module holders can withhold
all calls even without a writer, full and partitioned paths can differ on a bare
local callable, and incomplete-origin limitation text can be duplicated. No
confidently wrong target is claimed repaired by these UI-only changes. Current
evidence lives in review-33-follow-up; semantic differential and capture/graph
scale evidence are explicitly carried when the implementation is unchanged.


## Review 34: usable editing surfaces and instance-field provenance

Text editing retains an 18rem minimum (over ten current code lines). Source
panes contain their scroll overflow; stacked rows use natural content heights.
At tablet widths the work area scrolls while navigation/Save stay outside it.
Phone layouts retain page scrolling. Interface guidance is collapsible and its
Edit inputs and output action stays directly available. Header wrapping includes
601–719px; the registered journey sweeps 320–1440px every 20px in workspace and
Architecture, edits at common laptop/tablet sizes with current/expanded hints,
and checks that focused analysis content is not covered by the source pane.

Reader typescript-ast/v19 and partition reader v13 distinguish lexical instance
fields from constructor identity. Known instance-member assignments mark the
actual declarations, including JavaScript synthetic-property cases. A write to
this.x does not itself rebind the constructor. The v19 repair intended to keep unknown keys, reflection, escaped receivers,
static/dynamic this and changed constructor/prototype chains conservative.
Review 35 found cast/constructor-alias gaps in that exception; the v20 boundary
below supersedes this claim. Method dispatch still needs
a stable captured receiver; there is no general runtime dispatch guarantee.
Declaration-budget incompleteness qualifies namespace provenance; independent
local targets survive, while incomplete files cannot supply definite targets.

Fresh full-parse v18 -> v19 call changes on identical scopes: own src +9/-0;
ajv +105/-16; Quint +58/-1, with zero retargets. The losses are super calls newly
withheld by constructor-chain uncertainty. Large partitioned capture gains 1,256
calls and withholds 35, with zero retargets;11 edges disappear and130 appear, and
57 binding nodes are added. Every call change is retained with its source span.
All 1,256 gains agree with separate full parses: 1,181 single-file and 75 cross-file
contexts (including full ajv for 24 unresolved reduced-context cases). An initial
whole-package diagnostic exceeded its memory bound; the refusal is retained.
The earlier ten residual same-file super calls still remain unknown.

On identical 64KiB groups, full/split resolved calls are ajv 447/447, Playwright
client 268/268 and utils 655/655, with zero invented/conflicting targets. These
counts are scope-specific and do not establish complete coverage. The actual
refund regression now has constructor, cancelValue and refund dependencies and
flags the fee change. 23 runtime/dependency regressions accompany this boundary.

Info findings retained: an MCP race loser can receive SQLite's busy message
while store integrity remains protected; WebKit's native selection can paint
type tokens at4.31:1 despite the higher plain/current/finding-line palette.
Object-literal holder over-qualification, conservative full/split differences,
duplicate limitations and earlier documented semantic limits remain.

The final constructor-return guard also covers unnamed default-exported and expression classes using the class type symbol. A constructor returning a different object cannot lend its original method target. Two additional runtime controls cover TypeScript and JavaScript. The initial thirty-fifth seal is preserved as superseded evidence; the corrected review input is thirty-fifth-final.


## Review 35: conservative write provenance and bounded comparison working sets

Review 35 found wrong positive method targets in v19. Its earlier claim that
constructor/prototype mutations always stay conservative was too broad. Reader
`typescript-ast/v20` / partition reader v14 require positive instance-member
classification before exempting a receiver from class uncertainty. Casts,
non-null and satisfies wrappers share instance-origin unwrapping. Constructor,
prototype/destructuring controls covered the retained v20 cases. Review36
found remaining assignment-only containers and subclass-to-base gaps; v21 below
supersedes the broader inherited/container claim. Twenty-one negative runtime controls include the thirteen reported
regressions, an older destructured-constructor case and seven adjacent shapes.
These checks establish those captured-source cases, not arbitrary dispatch
completeness. A positive computed-receiver control also prevents unrelated
function identities from being discarded. Instance-origin scanning is cached by
source node; an interrupted walk clears its cache before propagating the budget
refusal. Known scalar instance-field initialization still keeps constructors.

Nested type editors now send edit functions to one owning draft. No nested
per-editor pending ref is reset from a potentially older parent prop. Recipe,
declaration, signature and shared-type forms compose accepted edits from that
owner's latest value. A deterministic stale-parent control reproduced the exact
Quote -> Outputsuccess loss with the old source and preserves Quote with the
new source. This establishes the lost-update mechanism; the precise scheduling
of the original registered WebKit failure remains unconfirmed.

Comparison decoding preflights all part hashes and expansion bounds, then
validates one part at a time. Assembled graph provenance/count checks reuse
validated objects rather than cloning all nodes and edges again. After full
validation, comparison retains the selected declaration's entire dependency
closure and direct relationships as an internal working set; graph paging,
retained observations and exported history keep the complete graph. Fingerprint,
cycle, dependency-excerpt and whole-comparison equivalence regressions cover this
projection. Exact path/text-identical documents can share a decoded graph;
matching revision IDs alone cannot bypass decoding or tamper checks. Production
workers retain the 512 MiB cap. Diagnostic hooks report decoded graph counts and
phase heap observations, and tests can only lower the cap. Heap samples are
observations, not proof that every accepted graph fits within the cap.

The editor precedes supplementary actions and interface guidance. Short desktop
layouts compact the mode selector. The header journey now measures viewport and
ancestor clipping, not only editor height: ten lines on tested default desktop
screens down to 600px height, and ten lines after reaching the scrollable stacked
editor. It also checks expanded hints and analysis occlusion. Smaller physical
viewports still require scrolling; no universal minimum visible-line claim.

The earlier instance-field regression count was 23, not 21. Review-35 evidence,
failed/insensitive diagnostics and subsequent checks live in review-35-follow-up.
Known semantic, conservative graph, SQLite-busy and native-selection limitations
remain. No manual-later project pilot or real-software descriptor test was started.


## Review 36 repair: inherited prototype uncertainty

Reader `typescript-ast/v21` and partition reader v15 retain `inheritanceOrigins`
for captured classes and class-valued bindings. Escaped/mutated subclass values
qualify their captured bases transitively, including bases imported in another
parse partition. ES re-export forwarding is retained separately as
`inheritanceForwards`; it qualifies class chains and does not turn ordinary
function exports into writes. Local source initializers, later assignments and
binding elements feed the cached instance-origin scan. Constructor/prototype
values escaping through containers retain the receiver's uncertainty.

The 38 review-36 runtime cases are regressions, checked in full parsing and every
set partition in both merge orders. Existing instance-field and stable-call
controls remain. Optional provenance survives retained storage/history and has
identity validation. This is conservative source observation; dynamic loaders,
uncaptured runtime mutation and implementation conformance remain outside it.
Older observations stay historical and are not rewritten.

Routine saves update the reserved file-state slot instead of inserting a notice
above the editor. It preserves an explicit Unsaved state for newer buffered edits
and announces successful saves when the workspace is active. Short stacked
701–920px screens up to650px high use page scrolling so the text area can be
reached without clipping. Registered layout checks measure actual visible lines
before and after real saves, including1024x600 and720x500. Errors and recovery
notices still retain their own messages.

See review-36-follow-up for final validation, resolution costs and preserved
failed checks. Review36's eight9.5 areas remain the latest independent result;
graphs are awaiting a focused repair/sign-off recheck. No new project pilot,
theoretical descriptors or exploratory audit has been started.

Final review-36 repair validation: the 2,107-file corpus loses four resolved
calls in Playwright sw.bundle.js inside escaped-base-class scope; zero
calls are gained or retargeted. Scoped full src/ajv/Quint have zero
resolution changes. All 38 reported wrong targets are withheld, and
established acceptance checks pass. Exact deltas and checks are in
evidence/product-audit/review-36-follow-up/validation.json. Independent
sign-off is pending; unchanged reviewed areas carry review36 evidence.

## Rebuild plan decisions (10–13 November 2026)

Decisions made for the mega plan (kept privately) while building it, as recorded in
the [build plan](build-plan.md) (sections 9–10). IDs D1–D18 follow the mega plan's
table; D16 and D17 are also in that table. Each entry says who decided (Karl, the
owner; or the manager), what was decided, why, and what it rules out. Text in
quotation marks attributed to Karl is copied from the build plan, where it is
shown in quotation marks as his; everything else is a summary. Earlier entries in
this ledger stay as written; where one is superseded, it says so and links here.

### Built-in engines are the CLI default (D2, in progress)

**Decided:** D2 is Karl's (no Java, no TLC JAR, no Quint; built-in engines). The
W2-A chunk made `verify` and `simulate` run built-in engines (exhaustive
breadth-first search; seeded sampler) in a worker, with one verdict per invariant
and a named state budget. **Why:** D2, and TLC's stack overflow on flow checks and
stop-at-first-violation behaviour. **Rules out:** a sampled run reported as an
exhaustive pass; a budget-limited run reported as a pass. TLC and Quint remain
selectable, and MCP and Studio still use them, until the removal chunk.
(Superseded by "TLC, Quint and Java removed" below.)

### Single project folder (D5, D6, D7)

**Decided:** D5–D7 are Karl's: everything Pymtheg stores for a project lives under
one `.pymtheg/` folder (D5), local storage designed so a central database can be
added later (D6), no backwards compatibility (D7). The W2-E chunk implemented them:
`project.json`, `settings.json`, `shared/` (requirements, links, decisions,
history, unsaved drafts), `rebuildable/` (code graph cache, recent runs) and
`local/` (writer identity), with one storage boundary (`src/storage/`) choosing
paths and opening every database. Unsaved drafts are shared, not rebuildable,
because deleting rebuildable state must not discard an unfinished design. Old
layouts are refused, not migrated; file-scope analysis that touches no project
state still works in an old-layout folder. **Why:** project data was scattered
over four locations (S27). **Rules out:** migration of old layouts, fallback
reads, automatic moves or deletion, and features opening SQLite directly.
Supersedes the `.pymtheg.json` and `.pymtheg-studio/` locations named earlier in
this ledger.

### Stable global IDs and recorded history (3.3, first slice)

**Decided (W2-E2; the ruling is recorded by the manager in the build plan):** shared
records get a random UUID alongside their existing local ID; edits keep it; a
recorded removal keeps the old UUID as a tombstone; **a key that reappears after
removal gets a new UUID with a `previous` reference to its predecessor; there is
no restore workflow.** Changes are recorded as receipts with change UUID, author,
machine, actor, time and a database sequence, ordered by
`(sequence, machine, actor, change UUID)`. **Why:** records from two machines must
be told apart and ordered (mega-plan 3.3) without rewriting existing IDs.
**Rules out:** ordering by timestamp or author name; guessing a move or rename from
equal text; treating the order across independent stores as causality.

### A link's baseline is not a review

**Decided (W2-H, merged by the manager):** a planning record's document link gets
a server-set baseline (`linkBaselines`) when it is added; `linkReviewRevision` is
set only by explicit acknowledgement and must name a real revision. A new link
whose target is absent from the edit's base revision is refused with 409.
**Why:** filling the review field on save recorded reviews nobody made (S26).
**Rules out:** a server-invented review; hiding a target change made between the
version the user saw and the save.

### D16: a language's own build chain may be required

**Decided (Karl, 11 November 2026, amending D8):** a language's own default build
chain may be required to index it (Rust needs `cargo`, Go needs `go`), which a
developer's machine is assumed to have; what stays ruled out is an unrelated
runtime (nobody installs Java to get Go data). This is the mega-plan's D16 entry,
not a quotation. **Consequences (manager, recorded with D16):** the hand-written Go
and Rust modules are the no-toolchain fallback; they stay sound and aim only for
structure-level accuracy, and an area where review keeps finding wrong definite
links is downgraded to candidates or unresolved, not re-proved. Precision comes
from later toolchain chunks. Tools outside the default build chain
(`rust-analyzer`, `gopls`) are optional extras unless Karl says otherwise.
**Rules out:** an unrelated runtime as an indexing requirement. Supersedes, as a
reason in itself, the mega-plan Stage 4 line that set rust-analyzer aside because
it needs language toolchains.

### C-1 Rust lookup reuse and cancellation

An incomplete path lookup can be reused within one resolver pass when the
module, visibility and configuration inputs match and its recorded recursion
tests still have the same answers.
Cache eviction leaves the resolver free to compute the same lookup afresh.
The import depth boundary reports an unresolved reason when it prevents
resolution. The graph coordinator owns the Rust CPU worker for each
cancellable phase and awaits termination before returning cancellation.
[C-1 change note](changes/C-1.md)

### Unreadable code is failed; the unit is the file

**Decided (Karl, 11 November 2026, for all language modules):** unreadable code is
invalid code, and invalid code has failed. On granularity, Karl: "the target is the
file and the file is invalid so what target?" A file with any syntax error is
reported failed and contributes no symbols and no links. A link whose site lies in
unreadable text, or whose target would be in a failed file or reached through one,
is failed: `unresolved` with reason `invalid-code`, the name kept, no target, no
candidate and no would-be target. In the build plan's words, "Probably this,
unverified" with the target named is reserved for valid code whose resolution
needs information the module lacks. A
failed link says why; Karl: "these imports are broken because the file they import
is broken". Each failed link records the failed file(s) that caused it
(`data.cause`), as a cause, never as a target. A failed file's package, crate or
program may contain unseen declarations. **Why:** agents index working trees
mid-edit (manager, W2-B round 8), and per-declaration salvage of broken files kept
producing wrong links in review. **Rules out:** lexical recovery, partial-file
symbols and would-be targets for syntax errors (all deleted from the modules).

Further rulings under this rule, each the manager's:

- **Cause propagation** (manager, W2-B round 14): a link that depends on a lookup
  ending in `invalid-code` is itself `invalid-code` with the same cause, never a
  fallback candidate set.
- **Only certain causes** (manager, W2-B round 16): `invalid-code` is asserted only
  when dependence on a failed file is certain, because a wrong cause is worse than
  a missing one; otherwise the link stays plain unresolved.
- **Rust failed-file reason only where it could change the answer** (C-15,
  19 November 2026): a failed file only adds declarations, so a Rust link
  stopped by something visible keeps that reason alone;
  `failed-file-unseen-declarations` is recorded where a lookup reached a
  failed file, where its impls could supply the answer, or where nothing else
  explains a miss. No outcome changes. **Why:** the blanket label made the
  coverage plan count about 300,000 links as failed-file misses that a
  diagnostic build with the failed files emptied did not release.
- **TypeScript programs with a failed file** (manager, ruling on W2-D, 12 November
  2026, after round 14): the failed file contributes nothing; `invalid-code` with a
  cause is best-effort attribution; every other link carries
  `no-unseen-declarations`, which means unverified.
- **Surface wording** (manager, from W2-C round 6): a file Pymtheg's parser cannot
  read is reported as "could not be parsed by Pymtheg", not as broken, unless the
  language's own parser agrees.
- **Internal errors** (W2-U, cut by the manager from the W2-M review): an
  internal error in a module (a defect in Pymtheg or a resource limit) is reported
  as such and retried, never as invalid code.
- **Content failures are stored, operational failures retried** (W2-M, cut by the
  manager from the W2-B round 14 backlog): a syntax failure returned by a module's
  `parse` is cached against the file's content hash, module ID and module version
  and not parsed again until one changes; anything a module marks
  `failureKind: "transient"`, any thrown parser exception and any project-analysis
  failure is retried. The core never classifies a failure by its wording. **Why:**
  a project with one broken file was never an all-unchanged re-index, yet a crash
  must not be remembered as invalid code. **Rules out:** caching a failure that
  depends on the environment rather than the file's text.

### Candidate sets must be honest about completeness

**Decided (manager, rule adopted for all language modules from the W2-B and W2-D
reviews, 11 November 2026; sharpened after W2-B round 4):** a **closed** set
contains every possible target and is closed only when provably complete with
every member provably possible. A set that cannot be complete (a type outside the
project could be the target, or the receiver's type is unknown) is either
unresolved with the known targets kept, or marked **open** with the reason on the
link; it still lists every project target. Being open excuses only targets outside
the project. A member that is possible but unproven may appear only in an open set.
A visibility rule alone does not prove closure when an outside package can import
the package and embed an implementer. Would-be target lists are capped with a
count and a reason, never truncated (manager, from W2-C round 6). **Rules out:** a
candidate list read as exhaustive without its open marker; a guessed single pick.

Related ruling (manager, W2-B round 15): the no-toolchain modules must be right for
code that compiles; a definite link on code the type checker rejects is outside
the contract. A wrong definite link in a program the compiler accepts always
blocks.

### D17: toolchain-backed links are opt-in per project

**Decided (Karl, 12 November 2026):** "yes for recommendations", and keep it
simple. This accepted the recommendations of the W2-K and W2-L investigations
(summary): using a language's own toolchain for exact links is an explicit
per-project opt-in; every other project gets the hand-written modules, which never
run anything. No sandbox chunk for now. Offline by default: missing dependencies
are reported as missing. Go: cgo off. One build configuration to start, and every
toolchain-backed link is keyed by the configuration it came from. The toolchain
route reads the language's installation and dependency cache and writes only a
throwaway cache, never the project. **Why (manager's decision on W2-L, 12
November 2026):** running a toolchain on a project is as trusted as building it,
and five review rounds found five different escapes from the prototype sandbox.
**Rules out:** running a toolchain on a project automatically; downloads by
default; presenting the closed environment as a security boundary;
`rust-analyzer` unless Karl asks. The escape tables in [W2-L](changes/W2-L.md)
remain the requirements should a sandbox be wanted. Not built yet.

### D18: close enough for now

**Decided (Karl, 12 November 2026):** "we need to at some point say it's close
enough for now and it's further work; we don't need 100% coverage, just 100% of
things that should be used." As recorded with the ruling (reviewers' common
brief): a review finding blocks only if it is a wrong result or failed check in a
code shape real projects write (it occurs in a test corpus, is a mainstream idiom,
or real public code does it). A wrong result that needs an exotic but legal shape
is logged as a known limit and does not block. False claims in change notes,
failed checks, out-of-ownership changes and regressions in real shapes still
block. Context, Karl: "I'm going to be using this in some complicated rust
projects/go projects (database and filesystem)". The manager took this to mean
systems-code idioms (macros, cfg/feature/platform gating, unsafe, FFI, generics,
large workspaces; Go build tags, cgo, generics, many-implementer interfaces) count
as real shapes. Follow-up, Karl: "I want a good attempt at covering anything then
I'll ask my tools to build their designs in it and we can see if it covers all of
our use cases or not." Real use by the owner's tools is the coverage test; gaps
found there become fix chunks. **Why:** one pull request went eighteen review
rounds, the last six each finding one rarer shape absent from the test corpus.
**Rules out:** blocking on exotic shapes; treating "known limit" as permission for
wrong results in real shapes. Lesson recorded by the manager under D18 (13
November 2026): measure a cheap, same-class fix on the corpus before asking for
it.

### E4: unseen code does not rebind `derive` or standard macros (Rust)

**Decided (ruling E4, W2-C, 12 November 2026; the build plan names no author, and
W2-C's note calls it owner-selected):** `derive` and `global_allocator` are
shadowed only by a binding visible in captured source; unseen code (a bare
`#[macro_use] extern crate` whose crate is not captured, opaque macro output) is
assumed not to bind them. Clarification (W2-C round 11): a named
`#[macro_use(derive)] extern crate` is a visible binding and does shadow. `test`
and `bench` stay strict. **Why:** the strict rule cost 11,730 definite links
(34.7%) on Vector, nearly all for a possibility real code does not use.
**Extension (manager, 13 November 2026, W2-C2 round 2):** a failed file or
unverified module in a textual macro chain is unseen code and is assumed not to
define a macro named like one of the standard macros, so the standard-macro
exemption stays on across such chains. **Rules out:** treating every
builtin-looking attribute or standard macro name as possibly replaced. **Known
limit:** a counterexample to either assumption can give a wrong definite link; both
are pinned in known-limit tests, and D17's toolchain route is the exact answer.

### Own builds of tree-sitter grammars

**Decided (manager, plan from the W2-P investigation):** where a grammar rejects
valid code and the fix exists only as unmerged upstream pull requests, Pymtheg
builds its own grammar `.wasm` from a pinned upstream commit plus committed patch
files, with the build script, tool versions and sha256 checked in, and gates a
change on a pinned corpus (every file that parsed before gives identical output;
every other change is explained by newly read files). The files live in top-level
`grammars/<language>/` (W2-S); the language module loads its `.wasm` relative to
its compiled file. **Why:** under the whole-file rule a grammar gap fails whole
valid files (Vector 11, restic 1), and no newer npm release exists. **Rules out:**
an install hook or native build for end users; a patch that changes the trees of
files that already parse (PR #190 for Go was rejected on that ground); token
rewriting of source except sound error-site repairs. Done for Go (v0.25.0 + #202 +
#198); Rust is still the npm 0.24.0 grammar.

### Code links store identity, never a resolved target

**Decided (R1-D, 15 November 2026, under D19; revised after review round 1):**
a requirement ↔ code-symbol link is shared planning data. It stores the graph's
position-independent identity (language, project-relative path, kind, scoped
identity, ordinal), a fingerprint of the symbol's source at link time, and the
same-identity symbols that existed in other files at that time (`twins`).
**Fingerprint rule:** the fingerprinted text is the symbol's own graph range,
plus, for Rust, its outer `#[...]` attributes (found by a lexer scan back to the
previous item boundary) and, for Go, the `//go:`/`//export` directive lines
directly above it. TypeScript ranges already include `export` and decorators.
Doc comments are never included. In that text, CRLF is read as LF and trailing
spaces/tabs at line ends are dropped; every other character counts. A formatter
run therefore reads as `changed` (cleared by refresh), and a change inside a
literal or an attribute is never `ok`. The
link does not store a graph row; the graph's symbol ID is a hint only. State is
recomputed against the current graph each time.

**What a link is (ruling, PR 38 round 2):** a link identifies a symbol by
project-relative path + qualified name + kind, and verifies it by the text
fingerprint. A symbol at the recorded path with that identity and identical text
is the linked symbol, whatever file it came from. Provenance is not part of a
link and is not detected.

A link is never dropped or retargeted by resolution. `moved` requires
established continuity, all of the following:

- the recorded file is gone;
- exactly one same-identity symbol has identical text at a path that held no
  twin;
- no twin on record has identical text (identical copies make every path's
  occupancy unprovable, so such a link is never `moved`, only `missing` with
  all copies suggested);
- no failed file could hide another candidate.

Anything else is `missing`, with suggestions. `link check` fails on `moved`
unless `--allow-moved` is given, because a move is unconfirmed until refreshed.
Only an explicit refresh re-records a link's target. A link into a failed file
is `unverifiable`, and a new link into a file that did not parse cleanly is
refused.

**Why:** the graph is rebuildable and can be deleted at any time. Mega-plan
stage 5 says "a suggested match … is not a link until confirmed", and decision
"Unreadable code is failed" applies. Go and TypeScript identities carry no
package or file, so a shared name is not continuity: in review, restic's
`splitPath` and `PruneOptions` renames were reported as moves to unrelated
`cmd/restic` symbols. **Rules out:**

- auto-relinking renamed or moved symbols;
- treating a same-name symbol as the same symbol;
- token-aware or whitespace-insensitive fingerprints in this chunk;
- keeping links in `.pymtheg/rebuildable/`.

### TLC, Quint and Java removed (D2, D7; R1-A)

**Decided (Karl's D2 and D7; carried out by R1-A, mega-plan 2.9):** the built-in
exhaustive search and seeded sampler are the only behavioural engines, for the
CLI, Studio and MCP. The TLC and Quint adapters, the generated TLA+ and Quint
text, `emit --target quint`, `--backend`, `--quint`, `--tlc-jar`, `PYM_TLC_JAR`,
the `@informalsystems/quint` dependency, the `doctor` Java/TLC/Quint checks, the
Studio and MCP `tools` status field and the agent connection's `env` field were
deleted, not deprecated. `emit --target json` writes the lowered model the engines
check. `doctor` runs the real engines on a built-in probe and checks Node,
`node:sqlite` storage, the code graph (one-line Go, Rust and TypeScript files
indexed through the production registry, so each module loads its own vendored
grammar or compiler) and the Studio build; Node 24 or newer, no upper bound
(Karl, mega-plan 8.1). JSON behaviour results carry `exhaustive`. A built-in
worker or engine error is a failure (`B104`, exit 3), not an incomplete run; the
external-process codes B102, B103, B105 and B107 are gone. Options belonging to
another command are rejected. **Why:** D2 (no Java, no TLC JAR, no Quint) and the
initial-release definition that `npx pymtheg` runs on a clean machine with neither;
the W2-A differential found no conclusive disagreement with TLC. **Rules out:**
any external checker, runtime or download for behavioural checking; a compatibility
path for the removed options or fields. **Known limits:** see
[R1-A](changes/R1-A.md).

### Pymtheg's own licence: MIT (LIC-1)

**Decided (Karl, 15 November 2026):** Pymtheg is licensed under the MIT License,
copyright Karl Livesey. **History:** the owner first asked about GPLv2-only,
which was ruled out because of Apache-2.0 runtime dependencies (`typescript`,
the MCP SDK). He then chose the Reciprocal Public License 1.5 for share-back,
including internal use and plugins; his goals then, in his words: "the main
thing I want is code etc back and to be allowed to use that code on the
project"; "I also want it to cover internal usage ie company x download it
modify it and distribute that internally"; "you can make plugins but must be
source available for us to intergrate into the core". The review of the RPL-1.5
text (PR 46, rounds 1 and 2) showed that the plugin rule could not be made
certain without a modified, renamed licence, and that the licence carries
duties for users and the owner and a default US (Colorado) arbitration clause.
The owner then chose MIT: "ah fuck it we'll just go MIT". **What MIT means:**
anyone may use, change and redistribute Pymtheg, including in closed products,
keeping the copyright and licence notice; there is no share-back duty. **Rules
out:** the RPL-1.5 output exception and plugin statement (removed with
`LICENSE-EXCEPTIONS.md`). The package `license` field, the own-licence line in
`docs/licences.md` and per-file SPDX tags follow in LIC-2; `"private": true` and
publishing remain the owner's decisions. See [LIC-1](changes/LIC-1.md).

**LIC-2 (16 November 2026):** the per-file tag is the single line
`SPDX-License-Identifier: MIT` on first-party source files; fixtures,
generated files, vendored grammars and `examples/` are not tagged. See
[LIC-2](changes/LIC-2.md).

### The first planning write initialises an uninitialised project (R1-J)

**Decided (R1-J, 16 November 2026):** a planning write — `pymtheg link`
`requirement`, `add`, `remove` or `refresh`, MCP `requirement_links` with those
actions, `observe_implementation` or `link_implementation` — in a folder with no
`.pymtheg/project.json` first runs the same routine as `pymtheg init` with no
options (`initializeWorkspace`: identity named after the folder, default
settings, `.pymtheg/.gitignore`; documentation is not imported). **Why:** the
R1-G trials found these writes leaving `.pymtheg/shared/architecture.sqlite`
and `.pymtheg/local/writer.json` in a project with no identity, settings or
ignore file, so Git saw the database and `project_info` reported no workspace.
Init needs no choice an agent must make (its only options, the name and the
documentation import, have defaults), so refusing would only add a step. The
CLI link commands had the same fault through the same library and now behave
identically. **Rules out:** planning databases in an uninitialised folder; a
separate MCP init tool for this chunk. Graph indexing alone still initialises
nothing; its rebuildable cache ignores itself. Old-layout folders still refuse
nothing.

### Callers' class counts are totals (R1-J)

**Decided (R1-J):** `callers` reports `classCounts` as totals independent of
the item limit: `definite` and `candidateSet` are exact (one indexed count
query); `unresolved` possible callers, which must be classified one by one, are
counted up to 1,000 (or the query limit, if larger). `countsTruncated` now means
there are more possible callers than that bound, and `countBound` gives it. Items
stay bounded by the limit. **Why:** MCP's limit is at most 100, so it
reported `unresolved: 100, countsTruncated: true` where the CLI (default limit
1,000) reported the real 441. **Rules out:** counts that depend on the page
size. Impact's per-frontier counts are unchanged (still capped at the limit).

### The package is publishable (PUB-2)

**Decided (Karl, 17 November 2026):** Pymtheg is to be published to npm as
`pymtheg`, starting at version `0.1.0` (not `1.0.0`), which `--version`, the MCP
server info, `doctor` and reports read from `identity.version`. `package.json`
no longer has `"private": true` and now carries `description`, `keywords`, `homepage`, `bugs`, `repository`,
`author` (the copyright holder named in `LICENSE`) and
`"publishConfig": {"access": "public"}`. The shipped file list is unchanged. The
owner publishes by hand, following "Publishing" in `CONTRIBUTING.md`; no script
or CI job publishes. **Why:** the initial release is `npx pymtheg` on a clean
machine, which needs the package on the registry. This supersedes "`"private":
true` and publishing remain the owner's decisions" (LIC-1) and the deferred D12
row. **Rules out:** automated publishing. The acceptance gate still installs
only the tarball it builds and reports `npx pymtheg` from the registry as not
verified; the package-contents test allows the owner's name only in the licence
texts and the top-level `author` field. See [PUB-2](changes/PUB-2.md).

## C-3: TypeScript lexical bindings and workspace packages

TypeScript graph identities for local declarations include anonymous callback
sites and enclosing blocks. Requirement links report ambiguous continuity when
an edit leaves indistinguishable siblings. Existing references to plain local
bindings record the enclosing symbol and the binding's name and span. Plain
locals grant no additional symbol or link rows. Parameter values, import
shadows and local callable declarations with detected writes stay unresolved
at call sites.

The snapshot host supplies virtual links for proven local package installs.
TypeScript resolves the entry point with the importing file's compiler options
and resolution mode. References can redirect declaration outputs to source when
the compiler establishes the correspondence. Missing build output remains
unresolved with a distinct reason when a compiler lookup probes an explicitly
configured output directory.
Relative extension lookup retains the release's module-file edge. The release's
call declaration rule applies equally to relative imports, workspace imports
and aliases.

### C-7 TypeScript member and type-parameter targets

An existing generic reference stores the enclosing symbol and the name and
span of the type parameter in `data.localBinding`. The span distinguishes
shadowed parameters and separate overloads. Graph queries can use the
enclosing declaration and the binding location without a separate symbol row
for each parameter.

New object member symbols have position-independent identities scoped to
their owner and the static member path. They are available to search and
requirement links. Existing source links keep their enclosing symbols and
the new member symbols add no containment links. For a literal member call,
the checker supplies the declarations. A property symbol from a union can
omit an alternative that comes only from an index signature. Such a lookup
stays unresolved because it lacks a named declaration for that alternative.

For a new literal-member link, the checker binds the names, and the source
must establish which object literals can produce the receiver. Structurally
identical returns, branches and assignments can share one checker symbol.
Each producing literal needs its own named member for a complete candidate
set. Opaque reads, including array selections and mutable class fields, leave
the new link unresolved. The rule for existing literal anchors continues to
apply at sites main already resolved.

Factory fallthrough and bare returns contribute `undefined` to this source
proof. Static object binding patterns read the selected property and consider
their defaults on undefined results. A receiver can escape to another call
and still retain its static declaration. Interprocedural aliasing writes
through open index signatures or helper calls are outside this rule.

### Indexing holds one copy of the graph at a time (C-2)

**Decided (C-2):** the graph store no longer keeps decoded file records between
reads; every read decodes fresh, independent records. Resolution reads the graph
afresh for each module and drops it before the next, instead of reading it once
and deep-copying it (`structuredClone`) for every module. The module gets the
records as read only from a store that declares `independentReads`; any other
`GraphStorage` still gets a deep copy. Added-link validation reads only the
files that receive added links, and the closing report counts
rows instead of decoding every symbol and link. **Why:** the decoded-file cache
kept every source text and parse result alive for the whole run, and resolution
held the cache, the indexer's own copy, each module's clone and the store's
re-validation copy at once. Large and mixed checkouts (the TypeScript compiler
repository, Turborepo, T3 Code at `b387e3a1`) ran out of Node's default heap.
**Trade:** this supersedes W2-I's "unchanged subsequent invocations reuse
decoded records". A store reused for a second index now decodes each file
again in each phase that needs records: a number of times linear in files
and modules, instead of zero. The CLI opens a new store for every command, so
it never had that reuse. **Rules out:**
store-level caches of decoded records and per-module whole-graph clones.

### Library targets are graph entries with their own outcome (C-5)

**Decided (C-5, on the owner's ruling "libraries are linkable to a certain
extent as in your code to a library"):** a link may target a library outside
the checkout. A library target has an ecosystem, a unit, an optional symbol, a
version only when the checkout's manifest states it, and a required evidence
kind; its id hashes ecosystem, unit, version and symbol, so it is the same in
every project. A link whose only target is a library target has the outcome
`library`, distinct from `resolved` (a checkout target); a candidate set may mix
checkout symbols and library targets. Targets are rows of their own
(`graph_library_targets`, role `target` or `candidate`), so uses of a unit or a
symbol are one index read; `pymtheg graph uses UNIT [SYMBOL]` and MCP action
`uses` ask that question. The store refuses a library target without a known
evidence kind, a unit-only kind with a symbol, and a `glob-import` as a definite
target, or a `declaring-owner` without the member. `declaring-owner` records
a member whose declaring owner the module has proven (after alias, deref,
trait or embedding selection, or from the type checker); a target guessed
from the receiver's type alone is never recorded. A version must name the
manifest or lockfile of the target's ecosystem, by file name, in the snapshot that states it (`versionSource`, a clean
context file); the store checks that file is there, never the module's
semantic proof, which the conformance kit and the language chunks' reviews
carry. Graph schema 3 becomes 4: a schema-3
graph is migrated in place (rows unchanged, new table and resolution triggers),
so 0.1.0 indexes are kept, not rebuilt; 0.1.0 refuses a schema-4 graph. The
coverage export credits a stored library target as stored (level 2 with a
symbol, level 1 without) and reconstructs identities only for links without one.
**Why:** coverage level 2 credits a link to a library when the graph names the
unit and the symbol; until now the graph had nowhere to say so, and the measure
rebuilt identities from whatever each module happened to record. **Rules out:**
reading dependency sources, network access, version resolution beyond the
manifest, library targets inferred from the receiver's type alone, and showing a
library target as a missing local symbol. **Owner decision (C-5 review):** Go
builtins (`len`, `append`, `make`, …) recorded as `go-std` `builtin` targets
with evidence `declared-builtin` count as identified library targets at
level 2. **Open:** once the Go, Rust and TypeScript
items record library targets, the export's reconstruction can be limited to
schema-3 graphs. See [C-5](changes/C-5.md).

### C-11 TypeScript and JavaScript library declarations

Library members reached through a checker type name their selected declaration.
An ECMAScript declaration names unit `es`, and a web declaration names unit
`dom`. With a missing dependency declaration, lexical bindings prove written
export names. A member reached through an arbitrary imported value names the
unit only. The proof does not come from the receiver's package. Existing sites
and checkout symbols retain their identities. Stored library outcomes replace
coverage reconstruction for TypeScript module 23 onward. See [C-11](changes/C-11.md).

Review revision 26 applies captured Deno maps before choosing a unit. Installed
declarations, captured type packages or an importing manifest's external
dependency can establish that a declaration describes an outside package.
Lexical outside identity can survive unrelated unreadable declarations.
Direct writes to a module object in the same file withhold that member's
symbol while preserving the unit. Module 27 also records written namespace
selections in qualified import aliases and type-only ambient heritage.
Module 28 requires positive package-route evidence. An explicitly named
registry or a dependency up through the workspace boundary can supply
that evidence. Bare builtins can have a declared npm alternative. The
program's missing global type declarations limit which bundled globals
can be definite, using documented Node globals to name alternatives.
Module 29 extends that proof to type positions and typed receivers. The
compiler's explicit ambient types selection takes precedence over manifest
inference. Source type references and positive file-local Node runtime evidence
count independently. Missing environment types can overlap web declarations.
Missing test and tooling types affect their own documented globals. An npm
alias or captured pnpm or Bun catalog supplies the registry name and can supply an
exact pin with its source path.

### Go imports follow the go command, not its pattern rules (C-8)

**Decided (C-8):** a Go import resolves as the go command resolves it
(checked with Go 1.27.4, `evidence/c-8/go-import-rules.sh`): the modules
that may provide the package are the main modules and the modules they
require, through their replacements; a `replace` of a module that is not
required does nothing; a local replacement (`./x`, `../x`, `.` and `..`,
as `modfile.IsDirectoryPath` reads them) counts only when its directory has a
captured go.mod; a package is there only with a file Go can build (`ignore`
is never set); two modules that both provide it are an ambiguous import,
unresolved with `import-destination-uncertain`. A package under a
`testdata`, `_x` or `.x` directory is imported like any other, and a module
may sit under such a directory. A conversion to a pointer type (`(*T)(x)`)
links to `T` as `T(x)` does; its value has type `*T`, so its members are
`T`'s, and under more than one `*` or when `T` is itself a pointer type it
has none. A call through a function declared in several build variants has
one answer only when the variants cover every build of the calling file and
agree. Every build test (variant calls, C-4's selection over types declared
in several variants, methods per variant, buildable files) counts every name
as a free tag (`-tags=freebsd` on Linux, `-tags=cgo` with cgo disabled), with
one of Go's port GOOS and GOARCH values true and `import "C"` needing cgo
enabled; C-4's one-GOOS solver is gone. Go module version 29. **Why:** the go command skips those directories only when
it expands `./...` patterns and builds explicit imports of them; the earlier
rule called them forbidden, which left protobuf-go's generated test
packages, cli/cli's `.github` modules and all of gopls
(`replace golang.org/x/tools => ..`) outside the checkout. **Supersedes:** the
support matrix's "imports Go forbids (`testdata`)", and the reading that a
`replace` alone makes a destination. **Rules out:** results of
type-parameter type without stored type arguments; one definite target for a
call whose build-variant callees return different named types. See
[C-8](changes/C-8.md).

### Rust locals, generic parameters and inferred receivers (C-10)

**Decided (C-10, manager brief):** a Rust reference that the graph already
records to a proven local binding, parameter or `self` targets the enclosing
function, with the binding's name and declaration span in `data.localBinding`,
as TypeScript does since C-3; a bare generic type or const parameter targets
its declaring item. No symbols or link sites are added. A dot call on an owned
receiver may now be definite at the autoref step (`&self`, `&mut self`), not
only at the first probe step, when every trait that could supply an earlier
candidate is known not to: the standard prelude and blanket traits by their
complete method lists (hidden methods included), checkout traits by name, the
traits the type implements or derives, and every import in scope; anything the
module cannot see (an import outside the checkout and the standard library, an
unknown macro, a non-standard derive or attribute macro in reach, a failed
file) leaves the call unresolved. Receiver types come from written
declarations only (annotations, struct literals, written return and field
types, `?` on a written standard wrapper, `.await` on `async fn`).
**Why:** most Rust links on locals and owned receivers were unresolved although
the source proves them; the brief asked for them under the never-wrong rule.
**Rules out:** inference through generics, closures, iterator adaptors or
associated types; trait-method targets (even of checkout traits); `Box`,
`Rc`, `Arc` and `Deref` receivers; library method owners (a later chunk).
Several reviewed tests that pinned the old first-step-only outcome now expect
the method rustc selects; [C-10](changes/C-10.md) lists each.

### Graph writes use a write-ahead log on local disks (C-6)

**Decided (C-6):** from its first write, a writable graph connection on a Linux
local filesystem, running a SQLite that has the write-ahead-log reset fix
(3.51.3, 3.53.0 or later, or the backports 3.50.7 and 3.44.6: Node 24.15.0+,
25.9.0+, 26), switches the file to SQLite's write-ahead log with
`synchronous=NORMAL` and a checkpoint every 10,000 pages. Writes keep one
commit per file; commits are not synced. The completion record is committed
with `synchronous=FULL`. When its last writer closes, the file returns to the
rollback journal, with a full sync. If a reader or another connection that has
read since the log started is still open at that moment, the file stays in
log format until the next index that closes alone. If another connection prevents the switch in, the
connection keeps the rollback journal with a full sync per commit, as before,
without waiting. Elsewhere, including an unknown SQLite version, a writer
never writes in a write-ahead log: it first folds a left-over log back
(retrying for up to the 30-second writer wait, since SQLite does not wait for
this switch), and otherwise fails as "database is locked". **Why:** synced
commits, one per file, dominated cold indexing; Embassy and swc ran out of the
sweep's 60 minutes writing analysed facts. A write-ahead log also lets readers
read while a writer commits. **Safety argument:** after a crash or power loss,
a database in a write-ahead log is the state after some prefix of its commits.
The log is append-only and checksummed, it is synced before a checkpoint
copies it into the database, and the database is synced before the log is
reused. Every graph write deletes the completion record (triggers), an index
deletes it before its first write, and writes it last. So any surviving prefix
either ends before the index started (the previous completed index, trusted
only for the inputs it records) or has no completion record (reported
incomplete; the next sync rebuilds it), or the index completed. **Trade:** an
index cut short by a power loss loses its unsynced writes, which it would
redo anyway. A store whose writer was killed stays in write-ahead-log format
until a writer closes it normally. A reader in a directory it cannot write
cannot open it in that state. **Rules out:** more writes per commit (batches
or one transaction per phase: W3-P1 measured readers and second writers locked
out, and under a write-ahead log batches of 64 were no faster), and
`synchronous=OFF` (the database itself may be corrupted by a power loss).
See [C-6](changes/C-6.md).

### C-9 Rust library paths

Rust records the final written path through a proven import, qualified crate
path or edition prelude binding as a library target. A Cargo alias names the
package from the manifest. A lockfile version needs the owning package's
dependency edge, or an exact requirement can name the manifest version.
The resolver keeps the named export when a dependency re-exports it. For an
associated call it needs a named trait or proof of the declaring member.
An explicit `use` in a module protects a proven namespace binding from
opaque items in that module, since rustc rejects duplicate bindings there.
Captured Cargo directory-source replacements use checkout resolution. The
configuration maps registry indexes or Git URLs and ref selectors to a
directory source. A proven package selection is required to resolve inside it.
Rust coverage now credits recorded targets on graphs made by the supporting
module version. See [C-9](changes/C-9.md).

### C-12 Rust lexical macro scope

The resolver can clear an opaque expansion for one name when captured
declarative arms and their reachable macro definitions bound the names that
expansion can introduce. Standard macros with expression or literal outputs
and recognized built-in derives have documented output bounds. A second pass
can also resolve using the assumption that a proven external macro
introduces only input names or, for a derive or attribute, names formed
from whole case-insensitive components of input item names. Function-like
macros need an item identifier in their input. The link records
`rust-external-macro-name` in `data.assumes`. The coverage export counts those
links separately and includes them in Level 2 when they have a checkout target
or a named library target. A captured macro definition, a competing glob, an
unproven macro binding and a layout expansion keep their source requirements.
See [C-12](changes/C-12.md).

### C-24 Rust determinism, unlocked registry facades, inherent impl crates

A Rust lookup that meets a cycle cut at a lookup still on the stack is an
answer for that entry point only; it is reused only under the same
ancestor tests, never memoised as context-free, so no answer depends on
the order the store lists rows in (which follows the random project id).
With no lockfile, a dependency declared by registry version requirement
alone resolves from the default registry, together with the facade's own
registry dependencies, unless the root manifest patches or replaces the
crate or a captured Cargo config anywhere in the checkout sets `paths`,
`[source]` or `[patch]`. A macro link names a verified registry facade's
export without the implementing crate's source; expansion proofs still
need it. An unplaced inherent impl adds a possible method only to types
of its own crate (Rust E0116); trait impls are unaffected.
[C-24](changes/C-24.md)

### C-18 Rust macro identity

The lexical scope retry checks the binding that Rust would use during macro
expansion. A type or bang macro cannot take an attribute-sub-namespace name.
A competing glob requires either a readable lookup or an established outer
binding for which rustc would reject the ambiguity. Qualified external names
follow existing Cargo dependency edges through aliases and named exports.
Qualified paths and named imports identify the export in compiling code
with verified registry provenance. Positive feature facts can identify
namespace facets. A re-export needs registry provenance for both the
facade and its implementation. Unverified implementations leave the
expansion opaque without a supported output proof. Verified identities feed the C-12 effect rules and its existing
external effect assumption. [C-18](changes/C-18.md)

### C-14 Go library targets

Go records a library target where the source proves the package and, for a
symbol, the name: an import of a package no checkout module provides or may
provide; an exported name through the one import that binds its qualifier;
an unshadowed builtin call (unit `builtin`). An unnamed dependency import is
taken to bind its conventional name (last path element without a major
version suffix or `go-` prefix), because the package clause is not in the
checkout; a qualifier that matches no import's conventional name, or more
than one, is not followed. **Trade:** two unnamed imports whose package
clauses are each other's conventional names would be crossed; no real
project writes that, and goimports adds a name wherever clause and path
differ. A member of a library-typed value is not given the receiver's unit:
the member may be promoted from an embedded type of another package
(`*exec.ExitError`'s `ExitCode` is `os`'s), so source-only it is unresolved
with `library-member-unproven`, and the opt-in toolchain route names its
declaring owner. Vendored modules are checkout code, never library. See
[C-14](changes/C-14.md).

### C-16 Ambient test globals and member ownership

A compiler program can identify a supported ambient test global from a
selected type entry, a source reference or a side-effect import with package
evidence. An explicit lexical binding wins. Conflicting modelled framework
providers form a candidate set. A known unmodelled ambient type request leaves
the shared name unresolved and records the request. For a member, the
checker-selected declaration is the source of `declaring-owner` evidence.
When the declaration is unavailable, an annotation that names an imported
receiver type can establish the package unit. The program-wide Node overlap
rules also apply to checker-selected members reached through the new aliases
and selectors. [C-16](changes/C-16.md)

### C-17 Go standard-library members

Go resolves members of standard-library types source-only from a table of
the standard library's exported API generated from one pinned Go release
and shipped with the package, rather than reading GOROOT (which would make
the default route need Go). A member is recorded with the declaring owner
Go's selector rule gives (promotion through embedding included; an
unexported owner such as `testing.common` as Go reports it, and
`graph uses` maps the exported type to it). The table keeps only what is
identical on every platform Go supports, and a member is used only when it
is in every Go release the module may be built with (its `go` directive
and later): Go's compatibility promise makes later releases supersets, so
the table answers for older ones. **Trade:** platform-specific members
(`syscall`, some `os` and `net` fields) and members newer than the
directive stay unresolved even where the project's own build constraint
would allow them. A standard-library interface value's method is recorded
as the interface's method (the static callee): the source-only route cannot
list implementers outside the checkout. See [C-17](changes/C-17.md).

### C-20 Installed TypeScript declaration inputs

The TypeScript compiler host can read the installed declarations it selects
under the checkout boundary. These inputs never enter the checkout symbol
inventory. A selected declaration identifies its package and member. The
installed package manifest supplies the version and its provenance. Merged
Node and DOM declarations retain both candidates when both are possible.
Resolver probes include absent inputs so a new installation invalidates a
bare cache. A package exposed by the physical installation takes precedence
over inferred workspace links. A captured competing test type request is
settled by the checker's declarations for the selected symbol. The C-16 guard
still covers missing requests made by checkout code or its compiler config.
Installed declarations contribute only via the checker. [C-20](changes/C-20.md)
