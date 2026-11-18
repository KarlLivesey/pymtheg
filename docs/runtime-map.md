# Current executable system map

Latest authoring extension: [finite event-model forms](machine-authoring-map.md)
share declaration preview/recovery and canonical parsing/checking. Source/MCP, four real backend probes, and the restart/counterexample browser
journey pass. [Cross-file type selection](declaration-type-import-map.md) also
passes its real import/restart/stale-source journey. Neither addition was part
of the frozen fourteenth review. See the current completion audit for broader
browser and accessibility qualifications.

The executable [type-discovery self-model](../examples/self/type-discovery.pym)
now captures the exact-limit decision: a retained-item cap cannot establish that
unread files contain nothing else. Its two-item/three-file abstraction exposes
the premature completion and exhausts nine states of the corrected model.
Production evidence is the separate 100,000/100,001 metadata regression; the
finite model is not presented as proof of the actual scanner implementation.

This is the maintained implementation overlay for the [initial self-specification](../design/initial-system-map.md).
The initial map was reviewed before compiler construction; [decisions](decisions.md),
[probes](../evidence/probes.md) and [loop record](progress.md) show the changes.
The language is a bounded design tool, not a universal proof engine.

## Components, interfaces and ownership

| Component | Actual interface / data passed | Owner, effects, failure boundary |
|---|---|---|
| CLI coordinator `src/cli/main.ts`, `coordinator.ts` | commands/options -> worker -> Report; optional BackendOptions | owns AbortController, worker, output writes; explicit terminal session and central exit policy |
| Snapshot/parser `src/language/project.ts`, `parser.ts` | `loadProject(path): Snapshot`; `parse(file,text): Parsed + diagnostics` | worker reads UTF-8 sources; canonical realpaths, frozen strings, SHA-256; read races bounded to 2 attempts; cycles unsupported; parse each file once |
| Lexer/AST `src/language/lexer.ts`, `ast.ts` | tokens -> declarations, expressions, structured blocks, finite machines | source-spanned data only; no executing specified effects; declaration recovery creates module-wide blocked state |
| Resolver `src/semantic/core.ts` | `typecheck(snapshot): ProjectIR` | one canonical typed declaration graph and ExprInfo map; two-pass signatures; nominal type IDs; diagnostics, holes, effects and dependency edges |
| Local pipeline `src/analysis/index.ts` | `analyseFile(file, notify): {ir,report}` | sequential passes in owned 512 MiB worker; append-only diagnostics/measurements; semantic declarations aren't rewritten by analyses |
| Costs `src/analysis/cost.ts` | typed blocks + abstract summaries -> per-metric AnalysisResult | bounded expression forms, path continuation/return summaries, recursion -> unknown; upper-bound excesses retain unvalidated path obligations; caller borrows IR |
| Rule comparison `src/analysis/rules.ts` | typed rules -> canonical hash buckets -> copy findings | alpha-renames parameters; retains nominal types/resolved callees/order; no all-pairs search |
| Repeated work `src/analysis/repeated.ts` | invocation sites + loop context + stability -> candidates | heuristic advice; never rewrites program; no batch advice without capacity contracts |
| Ownership `src/analysis/ownership.ts` | resource automata + structured blocks + per-outcome summaries | state-set joins, move/borrow state, every exit and explicit cancellation handler; trusted settlement is an assumption |
| Call contracts `src/analysis/contracts.ts` | typed calls + pre/post contracts -> discharged/violated/pending | signed scalar/affine facts, conservative Boolean joins, located infeasible assertions; typed abstract results and supported guarantees retain assumption provenance at consumers; unsupported proof visible |
| Feasibility `src/analysis/feasibility.ts` | entry constraints -> interval/Bool witness or contradiction | only supported conjunctive scalar fragment; all other logic unsupported; postconditions remain obligations |
| Lowering/reference semantics `src/behaviour/model.ts` | `lower(ir,entry): supported(model) / unsupported / incomplete`; `step`, `replay`; `modelDocument` for `emit --target json` | finite machine or source-flow graph + source event/state/property map; model hash over machine, mapping and flow graph, validated before mapping |
| Adapter `src/backends/adapter.ts` | typed IR + BackendOptions + AbortSignal -> property results | lowers in a worker, checks source-mapping identity, calls the explore runner (`method` exhaustive or sample) and maps each verdict to a result; only engine (CLI, Studio, MCP) |
| Process runner `src/backends/process.ts` | executable + argument array + deadline/cancel/output cap -> discriminated ProcessResult | detached POSIX process group; TERM then KILL; leader reaped; kills group even when leader exited retaining child pipes |
| Reporting `src/reporting/report.ts`, `publish.ts` | AnalysisResult[] -> same Report -> text/JSON; atomicWrite | no independent renderer verdict; JSON v1 schema; same-directory stage, fsync, rename, finally unlink |
| Shared semantics `src/shared/` | identity, scalar operators, evidence/purity/hoist policies | pure CLI name/extension values in identity-values.ts, re-exported by identity.ts (+ package bin/wrapper); no global current project/cache |
| Built-in engines `src/behaviour/explore.ts`, `explore-worker.ts`, `explore-runner.ts` | `GeneratedModel` (+ `ProjectIR` for flow replay) -> `ExploreResult` (per-property verdicts, `state-domains`, measurements) | exhaustive BFS (`stateBudget`, default 1,000,000) or seeded sampler; runs in an owned worker with a readiness handshake, signal and timeout; the runner awaits worker termination on every exit; uses the existing `initial`/`step`/`replay` semantics, never reparses |
| Storage boundary `src/storage/local.ts`, `layout.ts`, `graph.ts` | `storagePath(root, item, create?)`, `openDatabase`, `findProjectRoot`, `openProjectGraph` | only module that chooses project paths and opens SQLite; refuses old layouts and symlinked storage; creates `.pymtheg/rebuildable/.gitignore`; feature stores keep their schemas and transactions |
| Recorded history `src/storage/recorded-history.ts`, `writer.ts`, `paths.ts` | checkpoint/acknowledgement/withdrawal/draft transactions -> UUID registrations + receipts; `exportRecordedHistory()` | additive tables in the planning database, written inside the feature transaction; writer identity in `.pymtheg/local/writer.json`; order `(sequence, machine, actor, change UUID)` |
| Graph core `src/graph/` (`indexer.ts`, `store.ts`, `registry.ts`, `analysis.ts`, `identity.ts`, `tree-sitter.ts`, `conformance.ts`) | `indexProject(root, registry, store)` -> `IndexReport`; queries `findSymbols`, `outgoing`, `incoming`, `links`, `unresolved`, `ambiguous`, `neighbourhood` | language-neutral; strict UTF-8 capture; per-file atomic replacement; validates every module result before writing; SQLite schema 3; not wired to any command yet |
| Language modules `src/graph/languages/{go,rust,typescript}/` | default-exported `LanguageModule`: claims, context files, `parse`/`analyze`/`resolve` | discovered from the folder, no core list; Go and Rust parse with tree-sitter WASM grammars, TypeScript with the compiler over the captured snapshot; none runs a toolchain or project code |
| Vendored grammars `grammars/<lang>/` | `manifest.json`, patches, built `.wasm`, licence; `grammars/build.mjs` | Go only so far; the module loads the `.wasm` relative to its compiled file; `test/grammar-vendored.test.mjs` checks sha256, ABI and licence; rebuilding is a maintainer step |

`ProjectIR` contains the immutable snapshot, AST declarations, resolved symbols,
types/ExprInfo keyed by source span, labelled dependencies, holes, and transitive
effects. The same objects feed all analyses and lowering. Measurement counters and
returned finding collections are run-local; there is no persistent cache.
The AST remains in the canonical IR with typing maps; there is no parallel
checker-specific interpretation of flow calls or resource obligations.

## End-to-end result and identity flow

1. Coordinator validates arguments, owns signals, starts one worker.
2. Worker loads/hash/parses each realpath once (imports are parsed, not regex extracted).
3. Frozen snapshot notification precedes CPU typing; parent can terminate worker
   even while its synchronous algorithms are busy. A partial report notification
   preserves completed type/effect work before subsequent passes.
4. ProjectIR contains exact UTF-16 half-open spans. Lines/columns are one-based
   UTF-16 units, not bytes or Unicode code points. Snapshot hash qualifies all
   persisted node keys. Symbol IDs are canonical `file#declaration`; no overloads.
5. Typed expressions retain nominal IDs/callees; dependencies propagate holes and
   semantic errors to consumers. Recovery taints a module, not a fabricated Any.
6. Results are property-specific: completion, method, outcome, assumptions,
   obligations, scope hashes/bounds/seed and witness status stay orthogonal.
7. Requested behaviour preflights an explicit finite machine or bounded structured
   flow. Recursion, parallelism and missing domains never become no-ops.
8. Parent compares disk content hashes before publication. Old evidence keeps
   frozen source text and source locations; staleFiles is visible and exits 2.
9. Atomic report/model writes preserve an existing file on interrupted staging.
   A model and its companion map are **individually** atomic, not a two-file
   transaction. Hashes identify their exact snapshot/model. A publication failure
   preserves available findings on stdout.

Local generated property IDs qualify the owning declaration and analysis goal.
Their hashes include the snapshot; behavioural property hashes include the source
invariant. Snapshot IDs invalidate reuse on any input change; stable cross-run
incremental property caching is deliberately deferred. Node IDs aren't edit-stable.
Source JSON integers are decimal strings; no conversion of local bounds to Number.

The canonical resolver also retains a bounded resource-name scope per structured
block (100 bindings plus the exact total). Studio projects this scope for resource
step choices instead of resolving local names independently. Scope membership is
not ownership liveness; the ownership analyser still checks transfer, borrowing,
transitions and every exit. Parser-owned identifier spans let visual edits preserve
comments inside statements. This metadata does not change analysis verdicts.

The visual document includes bounded child cards for type members and finite
machine states, events and invariants. They project the same declaration AST and
expression spans. Edits map nested field ranges recursively in the shared source
buffer; no independent event interpreter exists in the GUI. The source-step
interpreter and real backend still supply behavioural findings.

Standalone structural shape previews and callable-interface previews share a
type authoring context, comment-retention policy and source-edit/impact builder.
The standalone form persists its baseline and unfinished definition through the
existing recovery store. Resumption merges independent member changes; conflicting
edits or removal versus modification require a current/saved choice. Preview is
read-only, and application verifies every buffer's exact before-text before
changing any buffer. A new check supplies evidence for the edited design.

## Algorithms, guarantees and complexity

| Pass | Guarantee / limitations | Scaling and controls |
|---|---|---|
| Parse/load | real tokens, bounded recovery; explicit UTF-8 validation | O(source length) scanning, expression/block nesting 200, 2,048 selected files, 2 MiB/file, 8 MiB/project |
| Resolve/type | explicit signature/field/tag checks; missing type never Any | declaration maps + reference edges; diagnostics indexed to owning declarations rather than all-pairs scans |
| Effects | exact qualified target-set coverage for represented calls | reverse worklist propagates finite effect sets, including recursive flows; paths BFS when reporting |
| Outcome coverage | closed union exhaustiveness, whole-result propagation, lexical bindings | structured blocks; no inference about future external variants; no implicit exceptions |
| Ownership | conservative candidate leaks/invalid transitions; no general satisfiability | joins abstract state sets, not enumerated execution paths; loop-local resources only; outer resource mutation/transfer needs unsupported invariant |
| Costs | exact/upper/unknown per additive metric; budgets separate | memoised call summaries; unbounded recursion/depth >256 unknown; expression nodes cap 256 terms; no distribution into exponential polynomials |
| Rule copies | independent alpha-identical syntax, resolved symbols, equality in hash bucket | expected hashing work proportional to expression nodes; zero all-pairs comparisons; no general equivalence or near-copy search |
| Repeated work | candidates; hoist investigation gated on stability/input/mutation checks | one structured walk + hash grouping and effect-target index; per-target cache; deterministic visit counters; suggestions carry assumptions |
| Feasibility | conjunctive integer intervals/Bool values; explicit witness/contradiction | proportional to supported constraints; unsupported formulas remain visible |
| Behaviour | finite safety, simultaneous old-state updates, deadlock stutter | explicit domains; inherent state explosion; timeout and output caps; no fairness/liveness proof |
| Replay | every initial state/domain/guard/update/event and final violating property checked | proportional to trace length times machine size; ITF states capped at 10,001 |

Measurements in [benchmarks.json](../evidence/benchmarks.json) are observations,
not asymptotic proofs. Source counts, typed nodes, graph edges, rule visits, pair
comparisons, effect propagations, cost summaries and phase times are instrumented.
RSS is a point measurement, not peak memory. General CPU complexity, latency,
probabilities, amortisation and precise peak live memory are outside v0.

## Lifecycle and failure paths

- Session: loading -> worker analyses -> optional backend -> aggregation -> one
  Completed/Cancelled/Failed state. Completed says the coordinator produced a
  report, not that all analyses passed. Results carry failures independently.
- Worker: created -> running -> terminal/terminated -> joined before handoff.
  Cancellation terminates CPU work; completed partial results remain available.
- Built-in engine worker: created -> ready (handshake; `onReady` before start) ->
  searching -> result, or cancelled/timed out -> terminated and awaited. An
  interrupted worker supplies no counts or witnesses; every unviolated property is
  incomplete. The timer starts before readiness, so a worker that never becomes
  ready still times out.
- External process (output plugins, `git` for capture): prepared -> spawned ->
  exited, or TERM -> 100ms -> KILL. Group cleanup also runs after normal leader exit. The leader is reaped by Node;
  orphan descendant reaping is the OS's job. Descendants deliberately escaping a
  process group/session aren't contained by this POSIX mechanism (future cgroup
  containment); tests ensure normal inherited descendants are no longer running.
- Process output capture <=1 MiB; scope JSON <=16 MiB.
- Publication: unique same-directory 0600 staging -> fsync -> rename. No directory
  fsync/power-loss durability claim and no cross-file transaction guarantee.
- Adapter outcomes other than a verdict: unreadable scope file (B101),
  unsupported or incomplete lowering (B001), identity/replay mismatch (B106),
  state budget or domain boundary (B108), timeout (B124), cancellation (B130),
  worker/engine error (B104, `failed`). None becomes a successful check.
- Source machine updates leaving the declared data domain invalidate that model
  check; they are never silently disabled or clamped at the bound.

Behavioural checking needs no external program: the engines run in Node worker
threads (R1-A removed TLC, Quint and Java).

## Shared decisions and outstanding obligations

The source/operator table and source evaluator define scalar operations;
the behavioural preflight accepts exactly the operators that evaluator implements
(`scalarBinaryOperators`). `result()` enforces
establishment prerequisites; `exitStatus()` is the single exit policy. Coverage,
resource discharge and stability policies live with their analysis/shared
judgements. The report renderer formats existing evidence only.

Abstract operation costs/settlements are environment assumptions, not verified
adapter implementations. A declared concrete postcondition needs a future proof
backend. State-machine atomic events are modelling assumptions. Corrected checkout
assumes atomic successful cleanup; the separate late-effect model includes failed
compensation and pending reconciliation without claiming eventual completion.

See [support matrix](support.md), [decision ledger](decisions.md),
[traceability checklist](requirements.md) and [acceptance evidence](../evidence/acceptance.json).

Worker transfer duplicates some snapshot/IR data in the coordinator; the worker
heap limit is not a whole-process memory cap. The benchmark records point RSS,
not peak memory. Staleness compares frozen canonical file contents; source path
resolution (including import symlink targets) is assumed stable during a run.
These are explicit limits, not production containment/durability claims.

## Studio and source-flow extension

`src/studio/service.ts` owns a bounded ten-run history, serialised starts/saves,
worker cancellation and exact unsaved overlays. `server.ts` owns loopback HTTP,
authentication, source confinement and bounded request bodies. The browser uses
versioned reports and symbol/reference views; it never computes correctness
verdicts. Source navigation uses snapshot spans, including historical evidence.
`src/shared/config.ts` validates CLI/GUI scenario settings; `project/config.ts`
loads versioned project files. The indentation formatter preserves lexical tokens.

`behaviour/flow.ts` compiles structured control to instructions and implements
small source steps. It owns finite environments, tagged values, resource handles,
call frames and provider protocol states. Flow graph construction runs in an
owned worker. Protocol submission, provider events and response observations are
separate source-mapped edges. Background provider events remain possible after
caller cancellation/return. An invariant failure halts that path. The same source
transition function validates backend witnesses; no independent fixture model.

A finite graph includes all initial combinations in the declared scope and all
enabled successor steps until termination/deadlock. Claims concern only this
scope; resource/state/edge limits fail explicitly. Graph materialisation can be
exponential in independent state variables; no linear whole-analysis claim.

## Agent-facing MCP interface (rework)

`src/mcp/server.ts` is a local stdio adapter, using the pinned official stable SDK
v2.4.0. `AgentWorkspace` owns a root-confined session, cancellation signal and
retained report/IR records. It calls the same production analysis worker and
backend adapter; it does not interpret or execute source effects. The existing
Studio path policy is reused. No MCP tool writes source or invokes arbitrary
commands. Findings are successful tool data even when they describe design
errors; protocol/tool failures remain distinct. Worker/backend cancellation
follows the incoming MCP request signal and shutdown closes owned work.

`src/reporting/explain.ts` adds plain-language explanations without changing
analysis verdicts. `src/contracts/scaffold.ts` maps checked types and signatures
to TypeScript/Rust/Go scaffolds with fail-fast function bodies by default. Omitted/unknown declarations
and source provenance remain visible. Scaffolds do not establish implementation
correctness; optional literal empty bodies may fail return checking.

## Durable workbench and investigation overlay

`studio/shapes.ts` derives bounded value descriptors from the canonical typed IR.
`ScopeEditor` offers explicit Bool/integer/string/record/list/tagged values; advanced
JSON remains available. `shared/config.ts` and behavioural preflight still validate
the resulting scope. Named scenarios use a configuration hash and atomic publication.

`studio/recovery.ts` owns two private SQLite databases, opened through the
storage boundary (`src/storage/`): unsaved drafts in `.pymtheg/shared/drafts.sqlite`
and the three-run cache in `.pymtheg/rebuildable/runs.sqlite`. Studio
initializes them lazily; MCP does not. Draft transactions compare a revision inside
`BEGIN IMMEDIATE`; a competing writer yields a conflict, never last-writer-wins.
Recovery stores base hashes and editor context separately from source. The GUI
reviews competing data before explicit retry, can download it, and can save a
conflicting source buffer to a new path. Three frozen runs persist; unfinished runs
restore as interrupted. Corrupt storage is retained and reported; local checking
continues. Cursor, selected file/tab/scenario/run context are recoverable.

`reporting/compare.ts` uses keyed counts for finding differences and exact BigInt
arithmetic for work differences. Different bounds, cost assumptions, unknown
maxima or incomplete estimates prohibit numeric reduction claims. Removed source
files and analysis-coverage changes are visible. Evidence and file filters are
linear scans; dependency maps build adjacency once per report, then traverse only
reachable edges. Views cap rendered rows and state that cap. No semantic cache.

## Language output and plugin boundary

`contracts/document.ts` projects the canonical typed IR once into versioned
`pymtheg.contracts/v1` declarations. It owns blocked-symbol exclusion and gathers
types, signatures, passing modes, source IDs/spans and obligations.
`contracts/scaffold.ts` dispatches built-in TypeScript/Rust/Go formatting. Target
name allocation is local; it never changes resolved source identity. Rust and Go
keep arbitrary precision and explain ownership mappings that their target cannot
automatically enforce. Shared `outputs.ts` defines the default fail-fast body
policy and optional empty mode, used consistently by CLI/MCP/Studio. Every callable
fails on use until implemented, including Unit returns. Native compiler tests cover
non-Unit returns; code output remains unfinished implementation, not proof.

`contracts/plugins.ts` executes an explicitly supplied local CLI module or a target
registered by `contracts/registry.ts` at Studio/MCP launch. Its
owned Node subprocess receives a JSON contract document, has a 256 MiB heap,
five-second resource deadline and nine-MiB output cap. The existing process owner
handles cancellation, timeout, leader exit and descendants. External output is
schema-validated and must map or explicitly omit every supplied declaration.
Target and API versions are checked. Plugin execution is trusted code, not a
security sandbox; source, project config, GUI and MCP requests cannot select executable
module paths. The registry fingerprints entry bytes and owns cancellation at shutdown. The output assurance distinguishes built-ins from plugin-declared
contracts. `examples/self/output.pym` exercises cleanup on each terminal outcome.

Studio retains at most three normalized contract documents in memory, indexed by
immutable run ID. Its download uses that run; an older recovered run must be
checked again rather than silently reanalysed against new source. MCP exposes the
built-in and explicitly registered targets from its retained typed model. Neither channel writes
implementation files or loads request-supplied plugins.

## First-use authoring audit (in progress)

`studio/recipes.ts` provides small source recipes, not a second semantic model.
The input/output and work-budget forms generate normal source; the production
parser and analyses check it immediately. Recipe updates stay in the unsaved
buffer and refuse to replace independent manual edits. `InterfaceHint` and call
completions describe inputs from the canonical run's symbol descriptors; stale
source is labelled rather than silently treated as current. Local checks ignore
backend-only scenario fields, so incomplete scenario editing cannot prevent an
offline check. Optional block snippets insert syntax with editable placeholders.

## Architecture holder and first-use audit refinements

`src/architecture` retains complete imported text documents and a separate
navigation/planning index. It never turns a foreign signature into a typed `.pym`
claim. `ArchitectureStore` owns a private SQLite database; v2 migrates v1 in one
transaction and stores unchanged document blobs once by content hash. Revisions
retain their document references and original text. Quotas are 10,000 revisions
and 512 MiB retained unique content plus indexes; hitting a quota rejects new
writes while leaving old revisions readable/exportable. No automatic eviction.
Inputs are bounded to 4,096 documents, 16 MiB per document, 64 MiB per import.
Index workers own CPU work and terminate on cancellation; the coordinator owns
writes. Expected-revision saves reject concurrent stale edits.

Native `pymtheg.plan/v1` records hold components, requirements, decisions, risks,
milestones, tests and evidence notes. Stable IDs connect them to foreign contracts
and each other. Status and evidence are recorded claims, with an explicit evidence
revision; they are never silently converted into established checker results.
Every field of imported documents remains retrievable, even when the navigation
index cannot understand it. Search includes document content; reverse links show
potential impact; revision comparison includes deletions and stable-ID renames.
MCP reads these records/documents with bounded pages and no write authority.

The first-use output trial is `tryFlow` over the same compiled flow and successor
relation, in an owned worker. It requires exactly one supplied value per declared
input, refuses nondeterministic choices, omits injected cancellation (stated as an
assumption), and stops at 10,000 source steps. Returned integers stay decimal
strings. This is one example result, not a proof. Results belong to a checked run;
the GUI cancels/rejects responses when the run or source changes.

Code completion uses typed signature descriptors. Calls insert explicit argument
holes, full Result handlers and statement punctuation; it does not guess values.
Last-checked interface help remains visible while editing and is labelled stale.
A new component's scaffold preview waits for that component's check, avoiding an
old-run preview race. Body holes remain visible in comments on usable signatures.

Architecture authoring drafts are separate from committed revisions. Their
SQLite row has a compare-and-swap version; a second writer receives a visible
conflict and cannot overwrite it. The browser coalesces changes to the latest
pending value without using timing as correctness, retains incomplete fields,
and offers explicit restore/discard after restart. A failed save offers a local
download and prevents silent continuation. Existing source draft recovery is
unchanged. A draft is limited to 16 MiB in addition to retained revision storage.

Shutdown refinement: repeated `StudioService.close()` calls now share one
cleanup promise. The architecture store's close is also idempotent. Focused
regressions preserve the last committed snapshot after cancelled/malformed
imports, preserve both versions after a stale editor fails, and retain the
recovery draft after invalid input. A closed session rejects new mutations.

The architecture draft writer is now a small shared state machine, exercised with
controlled promise acknowledgements. It permits one write in flight and keeps
only the latest queued value. Conflict or failure blocks further writes while
preserving the latest local text; a failed discard cannot replace the download
copy with null. Initialization ignores disposed reads. These checks do not rely
on a particular number of event-loop turns or a clock.

The planner remains mounted when the user switches to the source workspace, so
its unfinished form, pending save and conflict/download protection remain owned
by the same view. The held-request navigation regression checks this without a
startup delay. Architecture-only projects reopen in the architecture workspace.

Retained text uses a shared fatal UTF-8 decoder in source loading, source-staleness
checks, folder imports and browser uploads. A BOM is retained in the original
text and ignored only for JSON interpretation. Invalid uploads are rejected
before storage. Invalid byte edits are stale even when replacement decoding
would have produced the same visible character as the old valid source.

Architecture continuity: an import preview owns frozen documents, index, source,
change summary and base-head ID. One preview per Studio session bounds retention;
commit uses compare-and-swap and never reinterprets an unreviewed payload. Record
updates merge onto current head only when that record is unchanged from its base.
Document updates use the analogous per-document hash comparison. Index v5 adds
conservative type references; source-qualified conflict identities stay distinct.
Read stores never migrate or update stored projections. Closed legacy WAL files
are read from a private temporary copy, removed when the read store closes; an
active legacy WAL is an explicit unsupported read boundary.

Index v8 additionally carries Markdown document/section identities, searchable
structured fields, route/command/review/profile/release records and a compact
native planning status projection. Open-work checks compare linked target hashes
against the recorded evidence revision; an unrelated later revision alone is not
staleness. Legacy indexes rebuild in owned workers for Studio/MCP reads. Read-only
legacy snapshots are invalidated when the original bytes or WAL change.

History archives retain immutable revision metadata, document references,
deduplicated source blobs and one recovery draft. Content hashes and revision
identities are validated before a transactional import. Existing current work
remains active, conflicting provenance/drafts refuse the import, and a prepared
GUI import checks its base revision. Transfer is limited to 64 MiB per archive;
storage remains bounded independently at 512 MiB. Original text is authoritative;
projection indexes are rebuilt rather than trusted from an archive.


## Reviewed source refreshes

`import-merge.ts` returns per-document conflicts for preview, or rejects them for
unreviewed mutation paths. Each resolution contains local and incoming hashes;
changed content invalidates the choice. Native/shared material cannot be replaced.
Keep-both puts incoming content under an explicit source-specific import path,
retains the local version, and lets ordinary ID-conflict reporting expose any
collisions. The preview token is unavailable for commit until all conflicts are
resolved. Successful commit still checks the workspace head. The UI caps inline
text previews and offers complete version downloads. No merge guesses a textual
resolution or silently rewrites planning IDs/links.

CLI `--source-id` selects the retained source independent of its current folder
location. `--preview` reports source IDs/conflicts; `--resolutions` supplies explicit
hash-bound choices. New Studio sources have distinct IDs and editable names.

Attention results carry authored/imported origin; authored issues are stably
partitioned first in linear passes. The source registry provides provenance,
with a visible legacy fallback for unregistered plans. Type-reference indexing
skips error-code lists while retaining their original data. Preview compares
native unresolved links before/after and exposes new breakage separately.

## Rolling history and interface authoring refinements (fourth review)

Storage v5 preserves original documents in content-addressed blobs and stores a
small rebuild marker per snapshot. A transactional migration from v1–v4 keeps
checkpoint IDs, names and recovery text. A durable insertion sequence orders local
saves independently of clock changes. New checkpoints record their actual active
parent; imported histories keep those links. Missing legacy lineage stays unknown,
not a guessed chain. Archive v2 accepts optional `parentId` (null means a known
root); validation rejects missing parents and cycles before publication. Merged
histories retain separate branches and the existing active version. The GUI shows
parent labels; list order is local save/import order, not a claim of cross-machine
wall-clock order. Read-only opens never migrate. Index rebuilds run in owned workers.

Source inventories are scoped per source ID. A keep-both resolution records both
the local fork and the tracked upstream copy; the next refresh follows that copy.
CLI previews and commits expose newly broken authored links. Registry field order
is canonical so a repeated identical import does not create a content difference.
Heading links preserve explicit anchors, whole requirement keys and unambiguous
same-title matches; matching copied body text alone cannot rebind a renamed heading.

`studio/interface-builder.ts` emits ordinary source for bounded records, lists,
named outcomes, Results, named reuse and effects. It validates authoring data,
not program semantics: generated text still goes through the one canonical IR.
Studio and MCP use that builder; missing implementation stays an explicit hole.
Parent validation also runs on the union of imported and stored parent metadata
inside the import transaction. An individually acyclic legacy archive cannot
introduce a cycle by omitting a parent already known by the destination.

## Planning-scale impact and historical evidence

`architectureImpact` traverses reverse edges and partitions the reachable IDs
using membership sets. The returned planning list retains traversal order;
partitioning does not repeatedly scan that list. The graph work uses memory
proportional to vertices/edges and reachable IDs, not all pairs of planning records.

`architecture/work.ts` accepts historical `EvidenceSnapshot` values containing
only the checkpoint ID and relevant `{id, contentHash}` rows. The Studio/MCP work
service collects the referenced targets per evidence checkpoint, reads one
baseline at a time and retains only that projection. The store's bounded cache
may retain full indexes; the work request does not accumulate every full index
in a separate history map. Stale/unknown/unscoped evidence uses the same existing
judgement function. Missing baseline versus missing target remains distinguishable.

Historical index reconstruction still depends on source/index size and the
number of requested checkpoints. The projection reduces retained state; it is
not a claim that every historical query is constant-time or fully incremental.

## Continuing authoring boundaries

`ProjectIR.visibleSymbols` is produced by the same resolver used by typechecking.
`studio/signature.ts` describes signatures/types from that IR and proposes source
edits. A preview owns no source writes and carries exact per-file before bytes and
hashes. Studio validates every captured buffer before one atomic React-state update,
then requests the normal worker. Form recovery retains the edit and snapshot ID;
reopening against different source requires explicit review rather than replay.
New-component imports use the same checked type IDs; MCP shares the planner.

Routine import checkpoint elision happens inside the store's existing transaction,
after the expected-head check and before quota consumption. Named checkpoints are
unaffected. Branch presentation derives from recorded parents rather than import
order or clock time. Plugin registration and emission each use the owned process
runner; a metadata probe never executes a synthetic design's business operations.

Staged type authoring separates catalogue metadata from on-demand definitions.
Both read ProjectIR; no second parser or write side effect exists. The API response
carries snapshot/type/source identities before a loaded definition may enter a form.

Linked-title review compares current names to only the linked rows retained from
one earlier revision per link, chosen by `linkComparisonBase`
(`src/architecture/schema.ts`): the link's baseline (`linkBaselines`, set by the
server when the link is added) if it has one, else `linkReviewRevision` (set only
by explicit acknowledgement), else the proposal's `originRevision`. See
[W2-H](changes/W2-H.md). Evidence revision checks
remain separate. Acknowledging names does not assert correctness or refresh evidence.

## Continuing authoring after the sixth review

Studio/MCP related checks discover reverse importers inside the owned analysis
worker, then load only the selected import closure and its callers into one
snapshot and ProjectIR. Unrelated discovery failures are warnings. Explicit
project scope checks the configured source inventory. CLI and behavioural entry checks still use their import closure. The GUI
filters completion names through the IR visibility map; a bounded CodeMirror
transaction history maps live cursors to checked scopes. Changed headers or
uncertain scope leave input holes. MCP pages interface identities before loading
individual definitions; reverse impact starts with changed callables and types.

Architecture branch reviews are separate durable metadata keyed by branch tip
and reviewed current checkpoint, portable in history and visible read-only over
MCP. They are not merge or verification records. Link-review reminders compare
both names and content hashes. Type editing preserves source comments and
reports their changed placement explicitly.

The architecture work view keys rendered evidence to its completed revision.
Pending, failed and superseded work requests cannot render the clean-result
message. A failed request retains an explicit retry action; it is never treated
as an empty successful findings array.

Locale-independent snapshot checksums are defined once in
`architecture/manifest.ts`. History/bundle v3 carries this checksum separately
from preserved legacy snapshot IDs. Store reads and exports verify a recorded
content checksum where present. Legacy records with unrecorded ordering expose
that limitation rather than inventing a matching original checksum.

`examples/self/authoring.pym` compares 512,000 repeated node visits with 8,192
cached visits under its explicit reference/type bounds and models 64-record
metadata chunks. Its abstract operations declare zero for the unrelated metric,
so the checker never guesses it. The finite completion/cancellation model has
no counterexample under the built-in exhaustive search (TLC, when this was
written, counted eight reachable states); this is not a proof of implementation
conformance. `test/self-authoring.test.mjs` detects drift between the modelled
bounds and the configured guided-shape/chunk limits.

## Review audit and maintained code interfaces

Storage v7 keeps separately identified branch acknowledgements and withdrawal
metadata. The active pair projection is derived from unwithdrawn records;
withdrawal survives stale archives. Legacy pair-only imports map to deterministic
unattributed identities. Review ordering never uses wall-clock timestamps.
Overview responses return counts; individual review records are paged on demand.
This metadata does not merge architecture revisions or prove their compatibility.

Code output supports separate generated contracts and implementation stubs.
TypeScript/Go interfaces and Rust traits let an ordinary compiler reject signature
drift while user implementation files remain untouched. A portable manifest
compares declaration contracts; it does not establish behavioural conformance.
Plugins explicitly confirm contracts mode and obey the configured launch deadline.

Discovery measurements distinguish selected-module parses from extra discovery
parses, visited directory entries and directory-list attempts. The source-count
limit is not a bound on unrelated filesystem entries. Static include prefixes
prune impossible subtrees; `examples/self/discovery.pym` compares the work with
and without entering a generated tree, against actual loader counters in a
controlled fixture. No elapsed-time guarantee is inferred.

`mcp/emissions.ts` retains immutable generated source/manifest/details strings in
a bounded session-owned store. `emit_scaffold` generates once and returns either
a complete response or a paging handle. `read_scaffold` returns bounded,
Unicode-safe text chunks with whole-section hashes and original snapshot IDs.
Reads never invoke the emitter. Shutdown clears retained artifacts; old handles
fail explicitly after eviction. No persistent semantic cache or automatic file
write is introduced.

Related local checks now partition the single canonical IR's results. The selected
entry/import closure controls its verdict; a reverse dependency walk identifies
consumer declarations, with unresolved-name owners retained conservatively.
Consumer evidence is separate in reports and paged MCP reads. Unrelated declarations
inside a consumer file do not acquire a requested property just by sharing that file.
The report retains the shared frozen source snapshot; no source is reparsed for
this partition. File-level discovery warnings remain visible on the selected run.

Inventory and caller discovery traverse breadth-first, preserving root source
visibility at their explicit caps. Interface impact previews carry a completeness
flag and the discovery warning when some source could not be inspected. They
cannot claim an exhaustive affected set in that state.

Continued interface drafts use a three-way merge against their saved baseline,
including parameter order. Conflicting fields require a choice before the form
can continue; independent changes from both versions are retained. Linked-target
repair similarly remains explicit: an ambiguous move leaves the old ID unresolved,
and a chosen replacement can be compared against retained pre-move content before
saving. These authoring operations do not establish implementation conformance.

## Post-ninth recovery and agent provenance

Related parser failures are retained even when no declaration survives; broken
loaded importers also make impact completeness false. MCP architecture search
pages are pinned to a revision, include total/nextOffset, and require the revision
for continuation. Property IDs, diagnostic spans, stale paths and trace locations
are project-relative at the MCP boundary. Canonical IR IDs and modelled values
remain unchanged.

Relationship text normalizes line endings in every Markdown block and prose wraps
around code while preserving code interiors. Formatting-only comparisons are
labelled. Edited moves with matching new headings are candidates for explicit
review, never permission to bind an old link to replacement text. Opening a
planning form does not save a draft until the user changes it; real edits retain
the same recovery protocol.

## Retained document reading (after the tenth freeze)

Studio's Markdown reading view uses pinned react-markdown/remark-gfm to render
React elements. It does not evaluate raw HTML or load images. Relative links
resolve only against documents retained in the displayed revision. External
links require a click and have no opener/referrer. Source text remains exact,
with a full download and Unicode-safe pages using the shared text pager.
Rendered previews have an explicit 128,000-character cap. This view does not
change architecture identities, indexes, content hashes or verification status.

The cost analyser passes its current lexical size bindings into every invocation
summary. Budget comparisons use shared-input polynomial differences, not independent
maxima. The bounded comparator returns covered/exceeded/unresolved and preserves
candidate assignments and pending obligations in evidence. Positive abstract-bound
findings remain distinguished from replayed execution witnesses. The operation
counter is deterministic and shared across all budget comparisons in one analysis.

Source-linked planning projects declarations and dependencies from the canonical
IR inside the analysis worker. `source-contracts.ts` centralizes normalization,
relative identities and expectation hashes. Studio retains bounded session
catalogues for paged read-only choices. Plan saves retain source catalogue history
and per-plan expectations in one architecture checkpoint; current-source drift is
computed without modifying that checkpoint. HTTP work requests propagate abort
signals to source capture. The GUI distinguishes selection from explicit review.

Post-eleventh-freeze follow-up: source-review validation distinguishes semantic
expectations, exact displayed declaration text, and publication-time file hashes.
Selected roots define review scope; their imported dependencies come from the
same captured IR. Adjacency sets deduplicate repeated references. The API marks
source-refresh conflicts separately from architecture-record conflicts so the
GUI offers the matching recovery action. See `post-eleventh-freeze-self-audit.md`.

Coordinator-side freshness checks now use bounded asynchronous regular-file
reads and the parser's shared per-file byte limit. Nonblocking opens prevent a
source replaced by a FIFO from waiting for a writer. Invalid UTF-8, missing,
nonregular and oversized files are stale; cancellation remains cancellation.
CLI, Studio and MCP pass their request signals through this check, including
retrieval of an existing agent run. This is a sampled filesystem check, not a
lock against an uncooperative writer.

`shared/source-read.ts` now supplies both worker-side bounded synchronous reads
and coordinator-side asynchronous reads. Both use `shared/source-limits.ts`,
nonblocking opens, regular-file checks and a byte counter during reading, so a
pre-read stat is not the only limit enforcement. Initial parsing, discovery,
lazy Studio/MCP source reading and freshness comparisons share that policy.

## Eleventh-review source continuity and output boundaries

Source attention captures explicitly linked roots in batches with one canonical
IR per batch. Failed/missing roots are isolated, conflicting versions are marked
unavailable, and unrelated plan findings remain useful. Durable selections carry
exact declaration-text hashes and semantic dependency expectations; transient
catalogue eviction cannot invalidate a restored draft. Source comparisons require
a named plan or explicitly say no comparison is available.

The worker computes advisory replacement-shape hashes while projecting source
contracts. Looking up a missing source link compares stored hashes in the selected
catalogue and emits at most ten suggestions with their full count and scope.
Only the top-level name is excluded; the user reviews text and dependencies before
replacing a link. Saved choices remain subject to source revalidation. The editor
revalidates opened files and keeps dirty-buffer conflicts explicit.

Output projection converts canonical IR coordinates once into portable contract
documents shared by built-ins/plugins/manifests. Source text remains unchanged.
Output name allocation reserves exact spellings before normalizing Rust names.

The implementation-check generator consumes complete built-in contract output
plus explicit module/type coordinates. CLI, MCP and Studio expose the same
compiler-input-only result. TypeScript's exact-input helper, Go's pointer-interface
assertion and Rust's trait bound are independently compiled before/after an added
input. Generating the file never runs a compiler or writes application source;
users include it in their ordinary build. Plugin-specific checks remain explicit
future capabilities rather than guessed compatibility.

## Post-twelfth projection boundaries

`contracts/document.ts` supplies all captured source paths to the common coordinate projection. `contracts/expression.ts` formats existing AST expressions without reparsing or evaluation. Contract notes retain source-level environment/resource promises. `behaviour/trial.ts` preserves the FlowProgram assumption set on completed and unresolved exits. `TryInputs` owns and retires requests when inputs change, and pages assumptions in the response. Source execution and worker ownership are unchanged. The input-race and assumption-display GUI tests now pass; broader GUI validation remains pending.

When an open file is deleted externally, Studio retains and reopens its buffer
with an explicit missing-file state. A supplied entry buffer can be analysed
without a disk file; canonical project-root checks still apply. Saving it again
requires a create-only request, so a newly occupied path is refused. Recovery
and ordinary buffer ownership remain unchanged; no source file is recreated
merely by opening or checking the buffer.

## Shared-source block editing

The canonical parser retains body and question-literal ranges. `studio/block-model`
projects that existing IR; it neither reads nor reparses source. `block-document`
validates the transport and applies guarded source transactions. Field edits map
all retained spans; structural edits request the ordinary checker before more
structural editing. Partial parsing retains raw source and does not imply an empty
complete component. Projection is capped at 1,200 blocks, with explicit truncation;
GUI declaration paging and a nesting limit bound rendered cards.

Studio keeps CodeMirror mounted across Text/Blocks modes. External source edits
therefore share its undo history and existing recovery/conflict policy. New blocks
contain explicit unknowns. Leading notes move with the following step; removal
retains notes. The recovery context also remembers editor mode. Check responses
cannot replace a newer locally edited block model. The block API uses the retained
run IR and validates the requested path against the project root.

## Versioned implementation comparison

`implementation/workspace.ts` stores the observed graph and explicit bindings as
native documents in the existing checkpoint store. An observation preserves older
checkpoints; a link captures the planned semantic hash and observed declaration/body
hashes. Refresh cannot silently acknowledge either changing. Page comparison runs
in an owned worker, terminated on request cancellation or Studio shutdown. It
classifies code presence, stubs, missing covered declarations, unknown coverage and
plan/code drift; it never concludes behavioural correctness. GUI and agent tools
share this model and retain independent plan/code revision coordinates.

## Agent cancellation and candidate-plan impact

The agent coordinator retains the active cancellation signal. A successor request
waits for an already-cancelled predecessor's cleanup; live overlapping analyses
are still refused. The active-slot cleanup is identity-guarded and shutdown cannot
start a successor. This is checked with an explicit cleanup handshake, not timing.

Local agent checks ask the same analysis worker for its source catalogue. Candidate
plan impact compares recorded expectations with that immutable catalogue, scoped
to the files actually captured by the run. Plans outside that scope are counted
separately. Results are retained with the run and paged through `read_run` rather
than recomputed against later disk contents. A missing catalogue, read failure or
impact budget limit remains explicit; it does not upgrade the underlying check.

## Post-thirteenth visual-edit and link-draft transactions

A structural Blocks action computes source from the checked projection, asks
the existing formatter for canonical source, then revalidates that the component
is still mounted and its file/text are unchanged. Only then does it enter the
shared buffer and request a check. Formatting failure leaves source untouched.
Focus restoration waits for the matching checked document and does not reclaim
focus the user deliberately moved elsewhere.

Call outcome affordances are derived from a reverse pass over each canonical
statement scope, retaining direct match/decision/return uses of the call's binding.
Nested scopes are independent. This avoids repeated suffix scans; it does not
establish complete handling or path coverage. Input clearing uses a stored
explicit-unknown source projection for both answered and unanswered call inputs.

The existing recovery coordinator also owns bounded implementation-link drafts.
Each plan ID gets its own target, reason, plan hash and observation/version
context. The graph derives its form from that record rather than global mutable
note/target fields. Successful linking clears only that draft; switching records
never transfers its contents. Restoring a draft resets review approval. Source
versions and current server validation remain authoritative when applying links.

## Declaration creation

`declaration-data.ts` validates bounded recoverable authoring data, not a second
program model. `declaration-authoring.ts` uses the existing ProjectIR, type
writer, shared `signature-source.ts` validation and source-edit preview to
append a declaration. The formatter reads only newly generated syntax. Existing
source is not reprinted. Duplicate visible names are refused. Previously
unresolved references can acquire new targets, so creation reports impact as
incomplete until a normal recheck.

Studio `/api/declaration` and MCP `design_interface` creation/create actions
share this service. The form uses generation checks and component lifetime
guards; applying uses the normal buffer/hash guard. Recovery retains one
unfinished form, including incomplete names. Existing source remains protected
by the same disk-save conflict checks. The interface-open action now passes its
supplied declaration ID into a fresh check, rather than dropping a click while
another run temporarily clears the current symbol list.

The test browser resolver uses the version installed for the pinned Playwright
dependency or an explicit executable override. The full GUI runner passes that
path as an argument to the bounded helper's environment and records it. It does
not rely on inherited variables surviving the systemd boundary.

## Version catalogue and reviewed checkpoints

`implementation/versions.ts` operates on sequence-ordered checkpoint metadata.
It filters before paging, classifies shared source tags once, counts duplicate
labels and returns a hash over the catalogue plus active selection. It does not
decode observed graphs or parse retained documents. The store exposes its active
checkpoint ID directly. Existing readonly-store freshness checks remain intact.

The two GUI selectors maintain independent query/filter/page state. Requests
are cancelled on replacement; catalogue-hash mismatches require an explicit
refresh, and changing a filter does not change the selected source snapshot.
Names, dates and shortened IDs distinguish duplicate labels without ordering by
clock time. Code-view summary counts describe observed bodies, while gap-view
counts describe plan-to-code relationships.

New bindings record the existing checkpoint used for review. Identical repeated
reviews preserve that reference and do not create no-op history. No old binding
is modified just by reading it. The optional reference is a prerequisite for
source comparison, not a substitute for validating the source hashes.

### Linked-code review

`implementation/comparison-protocol.ts` defines the shared Studio/MCP request
and response. The service reads the selected plan, code and directly referenced
reviewed checkpoint; `query-runner` owns worker cancellation and schema validation.
`comparison.ts`, `code-difference.ts` and `relationship-difference.ts` validate the
selected pair and produce bounded source/call-site differences. The review dialog
never edits a link form merely to inspect another declaration. Acceptance uses
the existing exact-revision `bindImplementation` transaction. No read acknowledges
a change. Native plan fields have a readable projection; original records remain
available. See `implementation-review-map.md` for complexity, limits and failure
semantics.

### Existing resource authoring

`studio/resource-authoring.ts` shares the declaration schema and canonical
resource writer between creation and editing. It describes the checked AST,
previews source edits through the existing reverse dependency closure, and
preserves labelled prior comments. `DeclarationEditor` has an explicit edit
mode; its recoverable draft retains the resource name and structured baseline.
Changed concurrent rules require a visible choice. Unchanged or unrelated source
uses a fresh source hash; applying still passes the shared buffer transaction
guard. Studio and MCP never save source during a preview.

### Cross-file declaration types (working tree; GUI validation pending)

Type discovery uses the canonical parser in the owned query worker and records
source hashes, identity and explicit omission/syntax status. It does not emit
typechecking evidence. Project type pages retain one immutable inventory and
filter before paging. Declaration previews validate selected identities/hashes
in a fresh single IR including those sources, borrowing the shared type writer
to generate whole-file imports. Namespace collisions and new import cycles are
refused. `baseSnapshotId` binds the preview to the target's original form, while
`snapshotId` identifies the expanded checked source set. Newly imported source
hashes are revalidated before applying; all writes still use shared buffer and
Save guards. See `declaration-type-import-map.md` and `type-import-validation.json`.

## Operation-rule authoring (post-fifteenth freeze)

`declaration-data.ts` owns bounded optional precondition/guarantee arrays, shared
by Studio recovery and MCP. `authoring-expression.ts` uses the normal parser to
check that each authored field contains one expression; event-model fields use
the same boundary. Blank fields become explicit unknowns. This only parses
new authoring text, never reparses a source snapshot inside an analysis pass.
`declaration-authoring.ts` emits the rules into the new operation; the next
normal checked snapshot supplies all name/type/contract meaning.
`OperationRulesEditor` edits raw bounded fields through the same recoverable
form transaction. Abstract guarantees retain environment-assumption provenance.

The source/MCP/restart suite and the focused operation-rule GUI journey pass
in Chromium, Firefox and WebKit. See
[operation-contract-authoring-map.md](operation-contract-authoring-map.md).

The executable `contract-authoring.pym` self-model captures a separate policy:
parsing/previewing is not checking, unresolved rules cannot publish as complete,
and a late check of an old version cannot certify current edits. It uses three
abstract source versions. Source replay and bounded backend results supplement,
rather than replace, implementation tests for these conditions.

### Existing numeric event-state ranges

Parser-owned signed-literal spans feed `block-model.ts` range metadata.
`range-data.ts` owns the bounded durable draft schema and atomic guarded edit;
`numeric-range.ts` shares authoring validation with new-machine creation.
`StateRangeEditor` writes only draft state until explicit Apply, then uses the
normal buffer/check/undo path. Main recovery and dirty/unload indicators include
range drafts, including stale/orphaned states; no extra source parse is added
to analyses. See `state-range-authoring-map.md`.

### Unanswered type-choice drafts (after the sixteenth freeze)

`InterfaceType` includes draft-only `{kind:"unselected"}`. The bounded shared
validator accepts it only in draft mode and carries field/input context into
errors. `interfaceTypeSource` independently refuses it, so a skipped preflight
cannot emit this as language syntax. The main declaration/interface/type
recovery records already retain these shapes. `InterfaceTypeEditor` projects
explicit choice placeholders for new inputs/fields/list items/payloads.
Source/recovery/MCP validation passes; the updated GUI journeys await the
independent reviewer's browser handoff.

Conflict screens use `interface-description.ts` for readable draft text, including
unanswered slots. They must not call the strict source emitter to display an
incomplete form. Source emission and complete validation remain unchanged;
actual component-render regressions cover both conflict screens.

### Unused-scope evidence

`flowGraph` retains unused-key issues only when its complete graph contains a
source violation. The issues are included in the hashed flow model.
`reporting/scope-issues.ts` makes an explicit configuration result. The backend
adapter keeps replayed counterexamples and marks other properties incomplete;
CLI model emission reports the issue and does not publish an artifact.

### Retained code parts after the seventeenth review

`implementation/storage.ts` partitions one validated observed graph by source
provenance, retaining the exact original array order in manifest runs. The active
native snapshot contains only current parts; `ArchitectureStore` reuses unchanged
content blobs across checkpoints. The manifest binds every part hash. Reads of
legacy monolithic observations remain pure. User architecture documents and
reserved code parts have separate count budgets (4,096 / 10,000); existing byte,
archive and retained-content bounds remain in force. Capture receipts report new
and reused bytes. The 1,006-file retention/export probe and its two separately
refused AST-budget attempts are under `parent-s17-code-storage/`.

### Seventeenth-review analysis and authoring refinements

`analysis/contract-candidate.ts` samples bounded scalar call-argument ranges using
the canonical fact evaluator. C006 is a warning/review candidate; the property's
inconclusive status, outstanding obligation and unvalidated witness remain.
It never supplies reachability evidence or discharges a precondition.

Operation descriptions expose clause origins; the form keeps each original index
with its field and sends that mapping to the guarded rewrite. Removed rule notes
are marked, surviving clauses keep their spans, and empty owned lines disappear.
A renamed/deleted operation returns a located, actionable 409 and leaves the saved
form downloadable. Preview triggers remain focusable with aria-disabled while
requests are pending, and repeated activation is guarded.

Reader v4 adds target-origin metadata without promoting unresolved edges to
resolved. Graph and CLI views distinguish builtin/package/local-binding origins
from unknown targets and display normalized target names and truncation notices.
Evidence presentation strips the local project-root prefix while persisted
reports keep original provenance. Medium-width headers use an intentional action
row; decorative brand lettering is hidden from the accessible name.

### Eighteenth-review extension

`implementation/design-attention.ts` projects saved native/source expectations
into the existing source-attention comparison. Studio supplies read-only current
catalogue results to the owned graph query worker; gap counts and link comparisons
share that data. Historical checkpoint text is retained independently.
`implementation/part-codec.ts` encodes per-file v2 graph dictionaries and tuples,
then the existing provenance/order/hash validators reconstruct the public graph.
TS/JS capture budgets report per-file coverage and retain source on AST exhaustion.
The capture child process uses a source-byte-derived 512–1024 MiB heap; analysis/query
workers keep their existing bounds. Contract suspension comes from transitive typed
IR effects and feeds built-in TypeScript plus the example JavaScript emitter.

### Nineteenth-review extension

`analysis/contracts.ts` reads loop element/count types from `ir.info`; it does not
reparse iteration syntax. Facts include bounded scalar exclusions and source
binding IDs for immutable alias predicates. Differential tests use `tryFlow` on
the same typed snapshot to reject contradictory established call contracts.
`architecture/work.ts` owns document/record link reviews and `source-work.ts` owns
source expectations; the two cannot generate competing acknowledgements.
`implementation/capture.ts` names unread oversized paths in `omittedFiles` without
invented hashes. Schema, storage, CLI and MCP preserve partial coverage. The Vite
build uses `--configLoader runner`, avoiding bundled-config temp writes through
shared dependency symlinks.


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
condition and 64,000 executed source steps per condition, with at most 1,000
steps per trial. Unrelated flows do not share or consume this allowance. A bounded
256-entry replay cache charges cached steps to the same per-condition allowance. Samples include scalar path bounds, source/condition
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

## Project-fit follow-up after the twenty-third review

Architecture index v17 retains complete lowercased supported record search text,
including headings, native planning data and source-contract bodies. Stored v16
projections rebuild through the existing owned index worker; read-only rebuilds
preserve the database and document identities.

`shared/integer-literal.ts` gives candidate and witness collectors the same exact
signed-literal interpretation. `contract-witness.ts` selects examples by stable
parameter name, individual input variations and diagonal/product samples within
the existing deterministic budgets. `tryFlow` permits incomplete typed prefixes;
`compileFlow` continues to reject holes by default for whole behavioural checking.
The source executor stops if a selected path actually reaches a hole. Analysis
results retain incomplete obligations independently of a replayed counterexample.

TS/JS reader v8 checks receiver aliases/mutations and repeated module-export writes
before permitting symbol or signature resolution. Object literal methods inherit
their binding scope. `ObservationInputError` separates invalid source choices from
server failures, while capture fallback records confirmed heap exhaustion versus
an unexplained process signal. Storage, source and heap budgets are unchanged.

`SourcePlanLinks` collects current per-link availability before enabling a source
review. A missing link remains editable as history and can be removed or replaced.
MCP summary counts include source-replayed call/return counterexamples, without
also classifying them as structural findings.

`web/src/useDraftUpdate.ts` composes accepted local form updates before a parent
render commits them. `InterfaceTypeEditor` updates only the current compound-kind
branch and field/variant slot; `RecipeFields` composes those changes with sibling
inputs, output and effects. The helper owns no source or semantic interpretation.
Its current value is replaced when new parent props commit. The controlled
pending-render browser fixture supplies a deterministic negative control using
retained old source, independently of machine speed.


## Twenty-fourth review follow-up boundary

Contract witness dimensions follow lexical parameter-use roles, tracking shadowed
loop, match and local bindings. Unused parameters use one representative; input
names and declaration order do not set sampling priority. Search remains bounded
and incomplete. MCP `try_inputs` returns the exact failed call/return span and
condition under `result.violation`; only provenance paths are made relative, and
model values (including fields named `file`) remain unchanged.

Reader `typescript-ast/v9` withholds targets from dynamic destructuring, default
and typed receiver parameters, receiver mutation, repeated `var` declarations,
some CommonJS export aliases and direct prototype mutation. Review 25 found gaps
in reflective and forwarded receiver writes; the v10 boundary below supersedes
those v9 coverage claims. Ordinary static aliases
and class calls retain their target identities. This is conservative observation,
not complete JavaScript runtime dispatch analysis. Older graphs remain readable.

New observations retain lexical module bindings and `references` edges. Explicit
implementation reviews save an observed dependency fingerprint, calculated once
per graph through cycle-aware component hashes. Constants and transitively resolved
callees can produce `dependency-changed` even when the linked function's own text
is unchanged. Comparisons include retained dependency source excerpts (2,000
characters per side, first 100 changed dependencies). Captured lexical references
and resolved calls/types are the scope: dynamic, external and cross-partition
relationships remain unknown. Old reviews have no inferred dependency baseline;
a new explicit review starts this tracking. Neither an unchanged fingerprint nor
review acceptance establishes behaviour or conformance.

Architecture index v18 searches decoded field values and full retained source
rather than escaped JSON/schema keys; literal retained-document search remains
separate. v17 bundles remain accepted, and read-only reindexing preserves original
bytes and database contents. Missing architecture revisions/documents return 404;
invalid search bounds return 400. Capture memory attribution requires a native
abort plus a fatal V8 out-of-memory banner. A filename containing `heap` does not
trigger fallback, and an unexplained signal keeps its unknown cause.


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


Receiver annotations and casts are not runtime target identities. Their method
calls, typed spreads, getter-returned functions, replacement constructors and
virtual/inherited receivers remain conservative where the actual callable cannot
be established. An isolated parse partition does not assume a `this` receiver has
no overriding class elsewhere. Static function initializers and ordinary concrete
object/class calls retain their controls. These limits affect relationship coverage,
not retained declaration/source completeness.


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


## Review 28: implicit mutation and opaque namespace values

`implementation/mutations.ts` collects decorator applications as implicit writes
and class escapes. `implementation/typescript.ts` explicitly resolves literal
dynamic-import namespaces, including default export assignments and nested
values, without requiring Promise library types. Its CommonJS forwarding graph
checks captured barrel sources before cached target resolution. Decorated class
members reference their decorator application for retained dependency review.
Literal-typed property keys identify their actual writers. Reader identity is v13.

`implementation/partitions.ts` v8 preserves opaque default values even when named
exports coexist. Their module spans carry uncertainty across partitions; they
are not confident call/reference targets. Escaped CommonJS default namespaces
also invalidate require consumers. Nonliteral imports, eval and arbitrary runtime
loading are outside static tracking; read-only dynamic imports can be withheld
conservatively. Historical observations are not reinterpreted in place.

`test/implementation-implicit-mutation.test.mjs` covers decorator dispatch and
body dependencies, static/dynamic namespace default values, grouped partitions,
CommonJS barrel controls and const-key writers. Existing full/split precision,
retention/transfer, query and comparison suites retain their original quotas.
No Pymtheg semantic analysis, witness budget or source executor changed here.


## Review 29: exports-object alias closure

Reader v15 retains whole-module object aliases independently of symbol-call
resolution. A module.exports member write in a forwarding file qualifies the
connected shared objects, including direct source consumers. Observation metadata
moduleObjectAliases and escapedImports.moduleObject carry this uncertainty;
partition v9 computed that closure for recorded qualifiers. Review 30 found
missing out-of-part require qualifiers; the v16/v10 repair below closes that gap.
This is flow-insensitive and does not claim every declaration was actually written.
Class-local reference edges retain captured member-decorator dependencies for
sibling callers without restoring uncertain runtime call targets.
The new export-object-alias tests execute the small CommonJS fixtures to establish
which callable really runs, then compare full/split capture and storage round-trips.
No Pymtheg language semantics, witness budget or executor changed.


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


Review-32 repair: `implementation/partitions.ts` owns the shared provenance
qualifier. `qualifyObservation` applies it to default reader output without import
recovery; `combinePartitions` additionally merges contexts and recovers supported
imports. Reader v18 / partition v12 preserve direct same-file lexical identities
under mutable-class and incomplete-origin qualifiers. The source origin collector
retains object-literal export member forwards, including shorthand symbols.
Studio renders its one analysis navigation bar before report-dependent toolbar
and source content; the registered regeneration journey gates the initial report
at 1440/768/390 px. See review-32-follow-up for retained evidence and limitations.


Review-33 UI repair: analysis buttons identify analysis-content; a user-triggered
layout effect reveals/focuses its newly committed view only in the stacked layout.
The Editor highlight palette explicitly darkens type tags using @lezer/highlight.
Tablet header actions wrap rather than overflow. Registered contracts-regeneration,
a11y and header-layout journeys cover these boundaries. Reader algorithms and
identities remain v18/v12; only the misleading qualifyObservation comment changed.
See support.md for the separate default-full-parse recall cost.


Review-34 boundary: mutations.instanceClassForThis distinguishes instance lexical
this from static/object/dynamic contexts. typescript.markInstanceMember tracks
actual member declarations; target() preserves constructor identity while checking
member writes, constructor chains and incomplete files. Member lookup is cached
and budgeted. Reader v19/partition v13 retain explicit uncertainty. UI source
scrolling preserves a minimum editor surface; tablet work-area scrolling keeps
Save/navigation stationary, and source guidance collapses. Registered header
journey covers the full width band plus laptop/tablet editing and analysis hit
testing. All resolution gains/losses and intermediate failures are retained in
review-34-follow-up.


Review-35 repair map: typescript.markInstanceMember positively classifies the
instance write before markReceiver can exempt it; unknown origins propagate
class uncertainty. mutations.receiver follows constructor/prototype and binding
origins. Nested InterfaceTypeEditor/RecipeFields send functional edits through
to useDraftState at the owning form. Interface guidance/actions follow the text
surface. query-worker validates inputs before comparisonWorkingGraph retains the
complete selected dependency closure and direct relationships; query paging
keeps full observations. storage preflights parts before one-at-a-time decoding
and validateObservedGraphProvenance checks assembled identities/counts. Reader
v20 / partition v14. Validation and scoped resolution costs are recorded in
review-35-follow-up; no new independent score until review 36.


Review-36 repair: inheritanceOrigins retains owner/base identities or imported
class slots. The shared qualifier follows class-only inheritanceForwards and
propagates uncertainty to bases across partitions. The instance-origin cache
uses the existing assignment-origin table, and prototype/constructor escapes
retain receiver uncertainty. Reader v21/partition v15. Routine save feedback is
inside the reserved file-state slot; short stacked screens use page scrolling.
The header journey verifies visible editor lines after saving. Final evidence
and preserved failed attempts are under review-36-follow-up.

Final review-36 repair validation: the 2,107-file corpus loses four resolved
calls in Playwright sw.bundle.js inside escaped-base-class scope; zero
calls are gained or retargeted. Scoped full src/ajv/Quint have zero
resolution changes. All 38 reported wrong targets are withheld, and
established acceptance checks pass. Exact deltas and checks are in
evidence/product-audit/review-36-follow-up/validation.json. Independent
sign-off is pending; unchanged reviewed areas carry review36 evidence.

## Rebuild components (merged through W2-C2)

The mega-plan rebuild adds parts that the CLI, MCP and Studio mostly do not use
yet. The built-in engines (`verify`/`simulate` in the CLI, Studio and MCP) and
the storage boundary (every command that touches project state) are on a command
path.

**Engines.** `adapter.ts` has one engine path. It lowers the model as before,
calls `runExplore`, and maps each `PropertyVerdict` to a report
result: `violated` -> counterexample after source replay; `passed` ->
`no_counterexample (finite_model_check)`; `no_violation_found` ->
`no_counterexample (simulation)`; `incomplete` -> inconclusive with the limit
named; a worker/engine error -> `failed` with B104. MCP (`src/mcp/workspace.ts`)
and Studio (`src/studio/service.ts`) call the same adapter with `method`
`exhaustive` (verify) or `sample` (simulate).

**Storage.** `src/storage/layout.ts` is the dependency-free path catalogue
(`marker`, `settings`, `planning`, `drafts`, `graph`, `runs`). `storagePath()`
checks the layout before every path it returns, so old-layout refusal happens at
the first managed-state access. Read paths create nothing. `findProjectRoot()`
stops at the nearest `.pymtheg/` or `.git`. The planning store
(`src/architecture/store.ts`) opens the shared database through the boundary and
calls `RecordedHistory` inside its existing transactions; a failed feature
transaction rolls back its receipts. Studio's recovery store opens drafts and the
run cache separately, so a damaged run cache cannot disable draft recovery.

**Graph indexing.** `indexProject` walks the root (skipping `.git`,
`node_modules`, `.codegraph` and supplied exclusions; symlinks are not
followed), captures bytes and strict UTF-8 text, assigns each path to one module
by claim specificity, then per module: `parse` for changed files and for failed
files without a stored content-failure marker (`graph_parse_failures`, keyed by
hash, module and version), `analyze` over the whole snapshot on every run, and
`resolve` over all symbols and files and this module's parsed links, decoded
afresh from storage for each module (independent records, nothing kept between
modules), plus a deep copy of the context files. The store caches no decoded
file records (C-2). `failedFiles()` reads the failed source
files back; derived links are compared and written per row. Results are validated before any write;
module exceptions are reported in `errors`, `analysisErrors` or
`resolutionErrors` and leave earlier valid facts in place; storage failures
propagate. Symbol IDs hash project, module, path, kind, scoped identity and
ordinal, never positions. Native compiler or tree-sitter state is never persisted.

**Language modules.** Go (`extract.ts`, `resolve.ts`, `gomod.ts`, `failure.ts`)
reads `go.mod`/`go.work` as context and resolves Go's scoping, import and
selector rules over the snapshot. Rust (`parse.ts`, `resolve.ts`, `cargo.ts`,
`toml.ts`, `cfg.ts`) reads `Cargo.toml` as context with its own TOML reader and
resolves modules, imports, paths and first-step inherent dot calls. TypeScript
(`project.ts`, `extract.ts`, `symbols.ts`, `rename.ts`, `taint.ts`, `judge.ts`) is
analyze-only: one compiler program per owning config over a snapshot-only host.
`workspace.ts` builds virtual install links from captured manifests and the
compiler resolves their entries and any project references. Lexical references
use compiler declaration identities and retain one site per owner and binding.
`rename.ts` renames locally bound `require`/`module`/`exports` before the compiler
sees them; `taint.ts` and `judge.ts` decide which links depend on a failed file.
All three apply the whole-file rule. Support levels are in
[support.md](support.md#code-graph).

**Grammars.** The Go module loads `grammars/go/tree-sitter-go.wasm`; Rust loads
the npm `tree-sitter-rust` grammar through `tagsFromPackage`. One parser instance
per process per grammar is kept alive; trees are deleted after each extraction.

