# Let a coding agent use Pymtheg

Pymtheg now exposes a **local MCP server**. The agent can check a design, understand
findings, explore a counterexample and generate TypeScript, Rust, Go or registered-plugin scaffolds.
The server runs the same compiler and checkers as the CLI. It does not silently
implement application logic, change source files or execute specified effects.

Build first:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
```

Configure your MCP client to launch the following process, substituting absolute
paths for your checkout and the project you want to check:

```json
{
  "mcpServers": {
    "pymtheg": {
      "command": "node",
      "args": ["/path/to/pymtheg/dist/cli/main.js", "mcp", "/path/to/project"]
    }
  }
}
```

This is a configuration example, not a change already made to your agent. No
client configuration was installed automatically. Stdio carries MCP messages
only; errors go to stderr. The client owns the process lifetime. Cancellation
and closing the connection stop owned analysis work. Root access is fixed at
launch; requests cannot escape to other projects.

For TLC verification, pass `PYM_TLC_JAR` in the configured process environment.
It must point to the pinned official JAR described in README.md. Simulation uses
the locally installed pinned Quint. A missing requested backend is a tool
failure with a retained run record, never a successful design check.

## A useful agent workflow

1. Call `project_info` to find files, saved scenarios and backend availability.
   Read `pymtheg://language/guide` if the agent needs the source grammar.
2. Call `check_design` with a `file`. For a proposed edit, include
   `buffers: {"file.pym": "proposed source"}`. Disk is unchanged.
3. Keep the returned `runId`. Call `read_run` with `section: "findings"`.
   Each finding includes the problem, why it matters, an action to consider,
   source context and related declarations. Check `section: "properties"` for
   incomplete results and assumptions; an empty error list is insufficient.
4. Correct the design and check the new buffer. Compare actual findings, not just
   exit codes. The old run remains attached to its old source snapshot.
5. When behavioural checking is useful, call `explore_behaviour` with `entry`,
   `method: "simulate"` or `"verify"`, and explicit scope/settings. Read the
   resulting trace; sampled and exhaustive evidence remain different methods.
6. Call `emit_scaffold` on the checked run when ready for source scaffolding.
   It returns types and functions with **fail-fast stubs** by default. Set
   `body: "empty"` for literal empty bodies.
   Review omissions and notes before using it as a starting point.

`read_source` returns bounded source lines. `read_run` supports `summary`,
`findings`, `properties`, `costs` and `trace`; `offset`/`limit` page the output.
A single property's ID narrows property/trace queries. Trace pages contain steps
with source operations, locations, values and the changes at each step. Results larger than
256 KiB are rejected explicitly; use smaller pages. Sources are limited to the
same supported project/file sizes as local checking. Run records expire when
the connection closes or after ten later records. Only the three newest typed models are retained for
scaffold generation; older reports remain readable. This is not persistent history.

## Understand what the results mean

- A design error is returned as a finding, not an MCP transport failure.
- An incomplete, unsupported, timed-out or cancelled property is **not passed**.
- Old results retain their source hash. Changed disk files are reported as stale;
  supplied buffer overlays are identified separately from disk sources.
- An abstract provider contract is an assumption. It is not evidence that a real
  external service behaves that way.
- A source-replayed counterexample agrees with the supported source semantics.
  It is still a counterexample to the selected finite model, not arbitrary code.

## Scaffold boundaries

Built-in targets are TypeScript, Rust and Go (`target` on `emit_scaffold`): record/union/resource types and operation/rule/flow
signatures. `Nat` and `Int` remain arbitrary-precision (`bigint`, Rust `num_bigint`, Go `math/big.Int`); natural-number bounds, effects,
preconditions and ownership remain documented obligations. No fake return values,
network calls or business decisions are generated. Unresolved declarations are
omitted explicitly. Generated names may be suffixed to avoid collisions.

Default stubs compile but fail with “Not implemented” on invocation. Literal
empty bodies are optional and may fail return checking. A syntactically valid scaffold is
not an implemented or verified program. To see a scaffold without an MCP client:

```sh
./pymtheg scaffold examples/mvp/library.pym
./pymtheg scaffold examples/mvp/library.pym --target rust --format json
```

The command writes to stdout; it does not overwrite source files.

## Current limits and work remaining

The current connection is local stdio, with one analysis at a time. It has no
remote HTTP deployment, user accounts, cross-session run persistence, automatic
implementation generation or conformance proof. GUI explanations now share the
same presentation, but a broader usability redesign is still open. The old 9.5
product rating has been withdrawn; this MCP implementation is not a replacement
claim that the whole product is ready.

Agent views carry `viewSchema: "pymtheg.agent/v1"`. They preserve canonical report
IDs and evidence; they are a navigable view, not a second analysis engine.

Language plugins are documented in [output-plugins.md](output-plugins.md). The MCP
server accepts built-in and explicitly registered target IDs; it cannot load an agent-supplied executable
path. Register a trusted language at launch with `--plugin javascript=/absolute/emitter.mjs`. This keeps code execution outside the read-only design-tool interface.

The agent workflow resource now starts with a short worked process rather than
only a grammar. `pymtheg://language/syntax` retains the exact syntax reference.
`design_recipe` lists/generates the same first-use recipes; `try_inputs` returns
one deterministic checked-flow result. `read_architecture` pages summaries,
records, original documents, full-text matches and revision differences. Every
architecture read identifies a revision and labels imported/planning claims as
unverified. Use document character pages for large source records. None of these
tools saves source, changes architecture or loads an agent-supplied executable module.

For architecture planning, `read_architecture` now supports `kind` filtering and a
`work` section for missing criteria, broken links and evidence needing review.
Record results distinguish direct, transitive and planning consumers. Markdown
sections and supported catalogue routes/reviews/profiles/release data have stable
navigation IDs. Read-only backups are opened without migrations or permission
changes; legacy navigation indexes rebuild in memory in owned workers. None of
this makes an imported contract a checked `.pym` declaration.

`check_design` also accepts a new entry and imports supplied only in `buffers`;
those paths need not exist on disk. All paths remain confined to the launch root.
For `design_recipe`'s component recipe, inputs/output accept scalar names or
`{kind:"list",element:...}`, `{kind:"record",name,fields:[{name,type}]}`,
`{kind:"choice",name,variants:[{name,payload?}]}`, `{kind:"result",ok,error}`,
and `{kind:"named",name}`. Types are bounded to depth 5 / 128 nodes per input or
output, 20 fields/outcomes, 20 inputs and 20 effects. `effects` entries contain
`kind` and `target`. The generated source still passes through the canonical
parser/type checker; an unfinished body remains an explicit obligation.

`design_interface` inspects the checked type catalogue, describes a callable or
previews signature/shared-type edits with exact source preconditions and affected
consumers. It never writes. `design_recipe` accepts `contextRunId` and a new `file`
for a component that reuses checked named types through explicit relative imports.
Follow both with `check_design` on proposed buffers.

### Continuing interface edits in a large project

`check_design` defaults to `checkScope: "related"`: selected files, their imports
and discovered reverse callers. `entry` selects only the import closure; `project`
explicitly checks the configured source inventory. Unrelated files do not supply
errors to a related check. Discovery warnings describe skipped/unreadable files.
Interface IDs and file locations are project-relative (for example `src/orders.pym#Order`);
legacy absolute IDs remain accepted. Search matches names and relative paths.

1. `design_interface {action:"symbols", runId, query:"quote", offset:0, limit:20}`
   finds callable `symbolId`s across the checked project. Optional `file` restricts
   the listing. `total` and nullable `nextOffset` make paging explicit.
2. `design_interface {action:"describe", runId, symbolId}` returns the signature,
   source/snapshot hashes and `typeCount`. It does not include every type shape.
3. `design_interface {action:"types", runId, file:"quote.pym", query:"Customer"}`
   lists visible type metadata. Use `action:"type"` with the selected `symbolId`
   to retrieve one definition. Pages default to 20, maximum 100.
4. `action:"preview"` takes `symbolId`, the returned `sourceHash`, and an `edit`:
   `{name, inputs:[{name,type,mode:"value"}], output, effects:[{kind,target}]}`.
   Types are primitive strings or `{kind:"named",name,symbolId}`,
   `{kind:"list",element}`, `{kind:"result",ok,error}`, or named record/choice
   shapes documented by `design_recipe`. Studio drafts may contain
   `{kind:"unselected"}` for unanswered slots; preview requires a concrete type
   and reports the affected input/field instead of emitting partial source. Optional
   `typeEdits:[{symbolId,definition}]` changes a selected shared definition.
   The response lists changed files and potentially affected consumers.
5. Check every returned `files[].text` in related scope, using a `buffers` map keyed by each `files[].file`. A preview preserves bodies; it
   does not automatically rewrite callers or establish their compatibility.

For a standalone data shape, `action:"preview_type"` takes its `symbolId`,
the `sourceHash` returned by `action:"type"`, and a record/choice `edit`.
It supports adding/removing members and nested definitions without inventing a
callable. It returns the same source-edit and affected-definition preview. The
type name remains fixed; the tool never writes files or silently updates callers.

All pages belong to the immutable run snapshot. Start a new check for new edits.

Architecture summaries separate `branchesNeedingReview`, `reviewedBranches` and
`unknownLineage`. Review acknowledgement preserves both histories and the current
head; it is not a merge or proof. Plan work can also report `changed-target` when
a linked heading keeps its title but its contents change. Repeated relations to
one changed target generate a single evidence reminder.

For maintained implementations, `emit_scaffold {runId, target, mode:"contracts"}`
returns interface/trait declarations without business bodies. Keep these in a
separate generated file. The response's `contractManifest` can be retained and
compared with a later export using `compareContractManifests`; CLI `scaffold
--check BASELINE.json` provides the same comparison. The compiler checks signature
compatibility; Pymtheg does not infer correctness of handwritten code.

Architecture branch arrays in `summary` are bounded by `offset`/`limit` and include
counts. Use `section:"branches"`, optionally `branchState:"unreviewed"`,
`"reviewed"` or `"unknown"`, for ordinary paged navigation. Use
`section:"branch_reviews", id: CHECKPOINT` to read acknowledgement/withdrawal
records. Other sections return branch counts rather than repeating every branch.
These architecture-reading tools remain read-only. The explicit implementation
observation/link tools below write local versioned metadata.

MCP result summaries distinguish `structuralFindings` from `counterexamples`
with actual behavioural traces or source-replayed call/return failures. A
source-replayed failure is counted as a counterexample, rather than counted again
as a structural finding. The property evidence fields retain their original meanings.

When independent reviewers withdraw the same acknowledgement, its summary has
`withdrawalCount`. Retrieve all retained explanations with
`section:"branch_withdrawals", id: ACKNOWLEDGEMENT_ID, offset, limit`.
This uses separate bounded pages rather than expanding every review summary.

## Large generated outputs

`emit_scaffold` returns complete source for small outputs. If `requiresPaging` is
true, it returns an `emissionId` and section sizes instead of an oversized reply.
Call `read_scaffold {emissionId, section:"source", offset:0}`; append `text` and
follow `nextOffset` until it is null. `section:"manifest"` returns the comparison
baseline as JSON text; `section:"details"` returns JSON containing symbol maps,
notes, dependencies and omissions. Each section carries a whole-text UTF-8
SHA-256 `contentHash`, character/byte counts and the original snapshot ID.

Offsets are UTF-16 code units. Use the returned offset; pages do not split a
Unicode character. These reads never execute the emitter again. Eight artifacts
and 32 MiB of serialized output are retained per server session. An expired
handle fails explicitly; regenerate it (and recheck if its typed run has expired).
Artifact retrieval is not a claim that generated implementations work.

For larger projects, project_info returns an inventoryId and bounded files.
Continue with that ID, section="files" and nextOffset; use section="configuration"
for exact configuration text pages. A fresh call without the ID captures a new
inventory. scenarioNamesTruncated marks shortened name previews; full scenario
keys are retained in configuration. Inventory expiry asks for a fresh capture.

Related checks return the selected entry/import closure's verdict. The summary's
consumers count reports separate affected-caller findings. Read these with
read_run section="consumer_findings" or "consumer_properties"; they are never
silently merged into the selected file's headline. Project scope requests the
whole selected source set, so its verdict includes those declarations.

## Initialized projects

Run `pymtheg init .` in an existing or empty project. When the MCP client launches
`pymtheg mcp` with its working directory inside that project, the server discovers
the nearest `.pymtheg/project.json`; the directory argument is optional.
`project_info.workspace` contains its portable ID/name. The connection is still
restricted to that root. With no source files yet, agents can use recipes or
check proposed buffers without saving them. To connect from another working
directory, keep an explicit project path in the client configuration.

Architecture search pages return `total`, `offset`, `limit`, `matches` and
`nextOffset`. Preserve the returned `revision` for continuation; offsets without
a revision are refused. The architecture reader accepts up to 50 items per page.
`read_run` accepts the project-relative property IDs it returns, including for
traces; spans and stale-file locations are relative too. Generated code replies
include a `baseline` coverage statement so partial output cannot look like a
complete baseline merely because some code was generated.

To connect planning to the real design, use `read_architecture` with
`section: "source_contracts"` to page checked `.pym` declarations. Each target has
an ID such as `source:design/payments.pym#charge`. Follow it with
`section: "source_contract", id: "source:design/payments.pym#charge"`; supplying
`sourceSnapshotId` keeps the result pinned to the same check. These reads also
work before any architecture database exists. `sourceTargets` can select known
components for a bounded check in a large project. Retained plans use the same
IDs, with per-plan semantic expectations and source hashes. A relationship is
recorded intent, not proof that the component satisfies the requirement.


## Versioned implementation graphs

`read_implementation` is read-only. Start with `section:"versions"` and page its
checkpoint list with `offset`/`limit`. For the graph use `section:"graph"`,
`mode:"planned"|"existing"|"gaps"`, and optionally `planRevision`, `codeRevision`,
`query`, `offset`, `limit`. Results carry exact checkpoint IDs and declaration/
relationship coverage. To inspect retained source, add a `detailId` from the page
and page its text with `characterOffset`. Code presence is not correctness proof.

Use `section:"files"` to discover candidate TS/JS source paths without reading
or checking their contents. Optional `directory` scopes the first request; later
pages/filter requests retain the returned `inventoryId` with `query`, `offset`
and `limit`. Omit `inventoryId` to refresh. Three inventories are retained per
session. Root files precede descendants; dependency/output/hidden directories
are excluded and discovered symlinks are not followed. Explicit limits and
warnings remain visible. Pass selected paths to `observe_implementation` to
capture their actual source; file discovery does not create an architecture store.

Three tools explicitly write **local architecture metadata**, never application source:

- `observe_implementation {files:["src/service.ts"], label:"Before retry change", expectedRevision:ID_OR_NULL}`
  captures selected TS/JS source in an owned child process and retains a named checkpoint.
  Take `expectedRevision` from the versions response. No target code is executed.
- `link_implementation {revision,planId,planHash,nodeId,observationId,note,reviewed:true}` links
  the exact reviewed plan and observed declaration. Obtain these values from graph
  pages, inspect their source, then call the tool explicitly. It does not set the
  plan's status to implemented or establish behavioural conformance.
- `unlink_implementation` removes one explicit plan/declaration pair under its
  revision guard. Other bindings and historical checkpoints remain intact.

These mutation tools return a compact `revision` receipt (identity, snapshot
hash, counts and warning count). Read documents, records and graphs through the
paged tools instead of expecting a full architecture copy after every mutation.
`reviewed:true` is an explicit caller acknowledgement, not verification evidence.

Old observations remain in architecture history. Empty bodies, fail-fast stubs,
changed plan/code and missing/unknown scope are distinguished. Native readers for
other languages remain open scope. Multiple code bindings are supported: up to
20 per plan and 100,000 total. Adding a different pair never replaces an existing
one; renewing the same pair updates only its reviewed baseline.

`check_design` now includes `planImpact`: the architecture checkpoint used,
source-scoped affected-plan count, the count of linked plans outside the run's
scope, and the first 20 issues. Read `read_run {runId, section:"plan_impact"}`
with `offset`/`limit` for the retained full result. It compares the proposed
buffers, not a fresh disk read; a comment-only edit does not change semantic
expectations. `complete` refers to the scoped impact calculation, not a proof
of all plans or program behaviour.

Architecture `search` also returns `recordMatches` with native planning IDs and
names, `recordTotal`, and `nextRecordOffset`, using the same page offset/limit.
Document matches remain separately paged. `planId` on `source_contract` selects
the named plan's recorded expectation; omitting it does not assert freshness.

### Add a declaration without writing source

Use `design_interface {action:"creation", runId, file:"design.pym"}` to obtain
the file's current `sourceHash` and a page of visible types. `query`, `offset`
and `limit` work here too; `total` and `nextOffset` describe the matched catalogue. Then use
`{action:"create", runId, file:"design.pym", sourceHash, edit: ...}`.
The `edit` is one of:

- `{kind:"component", signature:{name, inputs, output, effects}}`
- `{kind:"operation", signature:{name, inputs, output, effects}, costs:[], atomic:false, requires:[], ensures:[]}`
- `{kind:"type", definition:{kind:"record", name, fields}}` (or a choice shape)
- `{kind:"resource", name, states, initial, terminal, transitions:[{from,to}]}`
- `{kind:"machine", name, states:[{name,type,min,max,initial}], events:[{name,guard,updates:[{state,value}]}], invariants:[{name,expression}]}`

Event-model state types are `Bool`, `Nat` and `Int`; numeric `min`/`max` are
inclusive decimal strings. Use empty `min`/`max` for Bool. Expression fields
are Pymtheg expressions; blank expressions generate explicit unresolved
questions. Events update simultaneously from the old state. The authoring form
allows 20 states, events, safety rules and updates per event, with at most 1,000
characters per expression. Normal checks and backend limits still apply.

Inputs use the existing structured type format and optional
`mode:"value"|"borrow"|"take"`. Constant costs use `{metric,count,quality}`,
where count is a decimal string and quality is `"exact"` or `"upper"`.
Operation creation also accepts optional `requires` and `ensures` arrays of
expression strings (at most 20 rules per array and 1,000 characters per rule).
A blank added rule becomes an explicit unknown; omitting the array declares no
such rules. Preconditions are demands on callers. Guarantees from abstract
operations remain assumptions about the external implementation, not proofs.
The returned value is named `result`, as in `"result >= amount"`.

The result is a source preview, never a file write. Names are create-only.
Recheck the returned source to discover effects on previously unresolved
references; the preview deliberately reports incomplete impact for new names.

To start without constructing that JSON by hand, request a shared Studio template:

```json
{"action":"creation","runId":"CURRENT_RUN","file":"main.pym","declarationKind":"operation"}
```

The response includes `declarationKinds` with labels/purposes, the current
`sourceHash`, and `template.edit` with editable example fields. Change that edit,
then send it to `action:"create"` with the same file, run ID and source hash.
The five kinds are `component`, `operation`, `type`, `resource` and `machine`.
Example values are starting points for authoring, not inferred project facts.
Template retrieval and preview never write source or approve an assumption.

### Find a retained implementation version

`read_implementation {section:"versions", query:"release", category:"code", offset:0, limit:20}`
filters before paging. Categories are `all`, `design`, `code` and `links`.
The authoritative page is `items`, with `total`, `nextOffset` and `catalogHash`.
Pass that hash for subsequent pages; if history changes, refresh the catalogue.
Optional `selectedId` returns that checkpoint's metadata even when it falls
outside the filter. These reads do not capture code, create history or approve
an implementation. The older `plans`/`observations` fields remain compatibility
views.

`compare_implementation` takes `planRevision`, `codeRevision`, `planId` and
`nodeId` from graph results. It compares exactly that retained link against its
reviewed checkpoint and pages relationship changes with `offset`/`limit`. Code
sides expose `fileHash`, `declarationHash` and `bodyHash` separately; `sourceHash`
is the legacy alias for `fileHash`, not a declaration freshness check. It
returns the current plan hash, retained reason and snapshot identity for an
explicit `link_implementation` review if `reviewAllowed` is true. Reads never
acknowledge changes. Missing legacy/history baselines stay unavailable; inspect
current source before explicitly establishing a new baseline.

`design_interface` also accepts `resource` to inspect a checked lifecycle and
`preview_resource` with its `symbolId`, `sourceHash` and structured `edit` to
preview new rules. It preserves the resource identity and never rewrites uses or
saves source. Recheck the returned buffer to inspect actual affected callers.

For new declarations, `design_interface` action `creation_types` searches types
across project source files. Retain the returned `file`, `symbolId` and
`sourceHash` as `typeSelections` when calling action `create`. Pages use
`inventoryId`; `refresh: true` rebuilds the list, and `typeKind` can restrict
results to records, choices or resources. Candidate metadata is not a proof:
the create preview checks the chosen imports and rejects changed source.

### Edit an existing operation's rules and work summaries

Use `design_interface {action:"operation", runId, symbolId}` to read its current
`definition`, `origins` and `sourceHash`. Then call `action:"preview_operation"` with that
hash and an edited definition: `{requires:[expression], ensures:[expression],
costs:[{metric,quality:"exact"|"upper",expression}], origins:{requires:[indexOrNull],ensures:[indexOrNull],costs:[indexOrNull]}}`.
Keep each original index with its edited clause when removing an earlier clause;
use null for additions. The origins arrays must match their edited arrays.
This preserves the association between a surviving rule and its source notes.
Expressions are strings;
blank added expressions remain explicit unknowns. The returned source preview
identifies affected callers and never writes files. Signatures, effects, bounds,
atomicity and provider/resource clauses are retained. An edit that would erase
an embedded comment is refused with a Text-editing explanation. Return guarantees
and costs remain declared assumptions about external work.

The `design_interface` actions `operation` and `preview_operation` also accept
flow/component IDs. Their descriptions include caller rules, return obligations,
named `budgets` (`metric`, `expression`) and `bounds` (`parameter`, `maximum` as a
nonnegative integer string). Preserve the returned `origins` for edited/deleted
rules. Preview remains unsaved and hash guarded. Component guarantees are checked
obligations, while external operation guarantees remain assumptions.

`read_implementation` gap counts/rows now include `design-changed` and
`design-unknown` alongside code states. Its link comparison returns `design`
issues and bounded current source, with the selected retained design kept
separately. Live source checks never update expectations or accept a link.
For a flow ID, work-summary rows in `costs` describe concrete `overhead`; the
shared preview writes the clause appropriate to the checked declaration kind.

Unestablished caller rules appear in findings even when no scalar witness is
available: C007 explicitly says no concrete arguments were inferred. C006 remains
an unvalidated candidate, with only the rule-relevant inputs listed. A signed
list element never inherits a nonnegative loop-index assumption.

Oversized code files are omitted with named partial-coverage limits; discovery
warns about the 2 MiB per-file bound before capture. Read the graph's coverage and
limits after capture. `design.current[].fileHash` is the exact file hash;
`declarationHash` is the normalized checked declaration/dependency identity.
`sourceHash` remains a legacy alias for the file hash, not declaration freshness.

Source-design drift acknowledgement is currently a human action in Studio's plan
editor. MCP agents can inspect the change and propose source/contract edits, but
cannot acknowledge a plan's source expectations. Re-linking implementation code
reviews only that pair; it does not accept changed design expectations.

Replay-confirmed contract properties include source examples with a portable
`entry` ID such as `design.pym#checkout`, inputs, the exact failed condition,
steps and assumptions. Pass that entry and those inputs directly to `try_inputs`
with the same `runId`; unique entry names remain accepted. A trial uses the retained
source snapshot and never silently rechecks a newer buffer or edits an old report.


`try_inputs` includes `result.violation` for a source violation: `code`, `message`,
the failed source `span`, and an optional rule `condition` span. Locations are
project-relative; returned model values remain exact. This lets an agent check
that replay reached the intended call rather than an earlier failure.
Implementation gaps may include `dependency-changed`; `compare_implementation`
returns `dependencies` with availability, changed captured bindings/callees,
retained source excerpts, counts and explicit coverage limitations. Legacy reviews
have no dependency baseline until a new capture is explicitly reviewed.

Architecture search is literal text search. Double quotes and backslashes are
ordinary characters, not query operators: `npm test` searches those words together,
while `"npm test"` requires retained quote characters too. Use the unquoted phrase
when the document does not contain quotes. Record search indexes decoded values;
the separate literal-document search also searches retained schema text.
