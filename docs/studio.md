# Pymtheg Studio

Build with `npm ci --ignore-scripts --no-audit --no-fund && npm run build` on
Node 24 LTS, then run `./pymtheg studio .` or `./pymtheg studio design.pym`.
Open the printed private session URL in Firefox. Studio binds only to loopback;
keep the token private. Ctrl-C closes the server and owned checkers. No account,
cloud service or production adapters are required. `./pymtheg doctor` explains
local tool availability. Set `PYM_TLC_JAR` before launch to enable real TLC runs.

## First modelling session

1. In an empty project, choose **Open architecture workspace** to start with a
   requirement or decision, or **Start with a recipe** for a small checked design.
   With existing source, choose a file in the explorer. A file argument opens it
   first; project configuration can also set `defaultFile`.
2. Use **Blocks** to edit inputs, outputs and steps, or switch to **Text**.
   **Add to this design** creates components, external operations, data shapes
   and resource lifecycles. Check with Ctrl/⌘ Enter. Declared network/filesystem
   effects are never executed against production services.
3. Select a finding to see the relevant source. Definition/F12 and
   References/Shift-F12 use resolved symbols from the current checked snapshot.
   Completion is Ctrl/⌘ Space; Format normalises indentation and excess blank
   lines while retaining tokens and comments. Save is Ctrl/⌘ S in either editor.
4. Look at Work for multiplied calls and assumptions; Structure for declarations,
   lifecycle transitions and reverse dependencies; Evidence for each property's
   completion, method and remaining obligations. Costs count declared metrics,
   not elapsed time.
5. Choose a flow or machine and open Scenario. Select a saved scenario or specify
   finite inputs/results, seed, steps and sample count. Simulate uses Quint;
   Verify uses TLC and the same source-derived model. Explore a counterexample
   in Trace. A sampled no-counterexample result does not become an exhaustive one.

The interface preserves unsaved edits across file switches. A run freezes all
buffers, so later edits make its evidence historical. Use “Back to editing” to
leave an old snapshot. Run History keeps ten sessions; cost comparison retains
each run's assumptions. It does not combine incompatible scopes into one proof.

External edits cannot be silently accepted by Save: expected-hash conflicts leave
your buffer intact. Reload disk lets you inspect the external text and choose
“Keep my buffer” or “Use disk version.” The latter explicitly replaces the edit
buffer. Drafts now recover after browser/server restart. Save still writes the original
source explicitly; automatic recovery never writes it. “Save separate copy”
preserves a conflicting buffer under a new path. Disk comparison and atomic replacement are separate system
calls; concurrent writers should coordinate rather than treat this as a filesystem
transaction lock.

## Edit with blocks

Choose **Blocks** beside Text to edit the same source as structured cards.
Inputs/output open the guided interface editor. Calls show their actual outcomes:
choose **Handle each outcome**, **Decide from this result** for a yes/no value, or
**Return this result** when its type fits. New branches contain open questions
until you decide their behaviour.

**Add a step** offers calls, decisions, repetition and resources. Creating a
resource adds a cleanup obligation. The state-change menu uses in-scope names;
the checker still judges ownership and allowed transitions. **Add cancellation
steps** creates an unanswered cleanup question, then you can add the required
resource actions. New steps go before a final return. Open menus and lifecycle
cards stay open while checking.

Undo works across Text and Blocks. Edits stay unsaved until Save, and the same
draft recovery applies. Exact source remains accessible on each card. Rich data
type/event-machine cards now edit existing field/payload types, state values,
event conditions/updates and invariants. Structural additions/removals and finite
state bounds still use Text. The [block-editor scope](block-editor-map.md) lists current limits.

## Compare planned and existing systems

Under **Architecture → Plan & code graphs**, choose Planned, Existing or Gaps.
Select plan and code checkpoints independently to compare versions. Capture
selected TypeScript/JavaScript files explicitly, inspect their retained source,
and link each planned record to the declarations that implement it. More than
one declaration can be linked; removing one keeps the others.

“Body present” means code was found, not that it satisfies the plan. Unlinked
work, stubs, changed code/design and unknown coverage remain distinct. No code
is executed during observation. Additional native language readers are pending;
see the [implementation-gap scope](implementation-gap-map.md).

## Scenarios and reproducibility

```json
{
  "version": 1,
  "defaultFile": "design.pym",
  "scenarios": {
    "small": {
      "file": "design.pym",
      "entry": "main",
      "seed": "42",
      "maxSteps": 30,
      "maxSamples": 1000,
      "timeoutMs": 45000,
      "scope": {"inputs":{"N":["0","1","2"]},"maxStates":5000}
    }
  }
}
```

`pymtheg simulate design.pym --scenario small` reproduces a saved scenario.
Explicit command flags override scenario defaults. GUI Scenario shows a command
and downloads the scope file; save source buffers before reproducing it. Empty
scope uses source-declared machine domains or complete supported default flow
domains. Nonempty machine scopes must list all domains exactly; they cannot
silently narrow them. For flows, `inputs` names entry parameters and `results`
names abstract operations (nested payload paths such as `read.Ok` are allowed).
Booleans/Unit/closed tags can be enumerated automatically. Lists, String and
unbounded integers need explicit values. Big integers can be decimal strings.
An explicit data scope is an assumption, not proof for values outside that scope.

Externally effectful operations require an explicit `atomic` assumption or a
linked protocol for behavioural checking. Linked `protocol` operations obtain their responses from the declared provider
machine. A `results` override cannot replace a linked protocol. The first slice
supports parameterless non-resource protocol operations, sequential calls, one
shared machine instance and finite events. Request, effect, delivery and unknown
knowledge remain separate. No eventual-completion/fairness claim is made.

## Evidence and sharing

History exports a versioned report, optionally including source text. Paths,
assumptions and trace values remain in source-free exports; review them before
sharing. Imported reports are labelled historical/imported; they have not been
rerun or authenticated by this workspace. Invalid report schemas are rejected.
A completed session means that the tool finished, not that every design property
was proved. Missing backends, unsupported features, cancellation and timeouts
remain explicit in Evidence. The GUI and CLI use the same compiler and backend.

Local limits: 2,048 selected source files, 2 MiB/file, 8 MiB/request, ten runs.
The browser lists up to 10,000 paths, preloads at most 8 MiB and loads other files
on demand. Checks include the selected file, imports and discovered reverse
callers. Unrelated files do not contribute errors. Flow graph
budgets are deterministic state/edge counts. Backend deadlines are resource
budgets; exhaustion is unresolved evidence. Browser acceptance uses observable
UI states, and the entire controller runs within Karl's bounded `pc-tools`
helper. No T3 preview is enabled.

## Recovery and larger designs

Studio stores unsaved drafts and selected context in
`.pymtheg/shared/drafts.sqlite`, and the latest three frozen runs in
`.pymtheg/rebuildable/runs.sqlite`. Both are private to the project and ignored
by Git. The databases contain source text and trace values: they are local
recovery, not encrypted storage. Unsaved drafts are authored data, so they sit
under `shared/`; deleting `.pymtheg/rebuildable/` loses only the run cache, which
can be rerun. Keep `.pymtheg/shared/` with the project when moving workstations.
Stop Studio before deliberately deleting the drafts database to discard recovery.
An unreadable run cache gives an empty run history and a warning naming
`.pymtheg/rebuildable/runs.sqlite`; draft recovery stays available.
Closing/reopening Studio restores drafts without changing original `.pym` files.
The footer confirms acknowledged saves; a failed save remains visible. If another
window writes first, “Review recovery and retry” shows that saved draft and allows
you to download it before explicitly choosing this window. A later competing edit
causes another conflict rather than overwriting it silently. Damaged storage is
not reset automatically; source inspection and checking remain usable.

The Scenario form derives input shapes from the checked design. Choose concrete
records, lists, strings and tagged outcomes without editing JSON, save a named
scenario to the project, then reproduce it with `--scenario NAME`. Advanced JSON
is still available. Source changes may require new domains; the real engine
rejects incompatible scope values. These are finite examples, not universal input
coverage. Long forms retain their Apply action while scrolling.

For imported designs, filter the file list, select a component in Structure and
follow its direct dependencies. The impact count includes transitive consumers.
Evidence filters isolate incomplete claims without hiding independent completed
ones. Compare retains each run’s frozen source; identical findings are counted
individually. Work reductions are shown only for compatible bounds and cost
assumptions. Missing findings in an incomplete or different-coverage run are not
proofs of a fix. See `examples/workbench/system.pym` for a seven-file example.

## Code scaffolds

In **Code**, choose **Output language** and **Download scaffold** to export
TypeScript, Rust or Go from the selected run. Bodies default to fail-fast stubs; **Function bodies** also offers literal empty bodies,
and omitted declarations are counted in the confirmation. They need real return
values, failure handling and cleanup before they implement anything. The CLI
additionally supports explicit trusted language-emitter plugins; see
[output-plugins.md](output-plugins.md).

## Keep the whole architecture

Select **Architecture** in the header. **Add planning record** captures a
requirement, decision, risk, component, milestone, test or evidence note. Give it
an owner, say how completion will be recognised, and link the parts it affects.
Its status is a recorded claim; it is not automatically a checker proof.

**Import documents** retains selected text documents and unfamiliar fields.
For a complete design folder, use `pymtheg import-architecture SOURCE --into
PROJECT --name "Baseline"`; inspect the stored import inventory for exclusions.
Documents stay attached to immutable revisions. Source files in the original
folder are never edited by this import. Supported catalogues get a navigable
index; unsupported or conflicting catalogues remain complete documents with
visible index warnings. Search in Documents searches the content as well as names.

Edits save a new revision. Drafts are kept separately and offered for explicit
recovery after restart; they never silently become accepted architecture.
Competing draft writers receive a conflict and can download their local text.
**Export complete architecture** exports every document in the selected revision;
import that JSON bundle to move the snapshot. Other retained revisions remain in
the local database; the snapshot export does not include the entire history.

The database is `.pymtheg/shared/architecture.sqlite`. Unchanged document
content is shared between revisions. Limits are explicit: 64 MiB/import,
16 MiB/document, 10,000 revisions and 512 MiB retained content/indexes, plus one
16 MiB recovery draft. Quotas reject new writes; they do not evict old designs.

From a stored contract, **Propose a change** creates a linked decision with its
owner and baseline revision already filled in. Describe the intended change and
its acceptance criteria, then save the decision. The original contract remains
intact; a proposal does not silently alter source or count as implementation.

Architecture imports first show a preview. Add documents preserves other sources;
refresh an explicitly chosen source to update only its documents. Native plans
stay in the working architecture. A changed head invalidates the preview.
Historical views identify themselves. Independent edits rebase; conflicting
edits offer a comparison before choosing the version to continue editing.
Closing a form keeps its unfinished draft.

Needs attention lists missing acceptance checks, broken targets and evidence
whose linked records changed. Export this revision saves one snapshot; Export all
history saves revision labels, original documents and recovery text in a
validated, deduplicated archive. Bring the archive back through Import documents.
A 64 MiB transfer limit is explicit; stored history is never evicted automatically.

Source refresh conflicts show your current text and incoming text for each affected
document. Choose keep current, use incoming, or keep both, then **Review resolved
import**. Nothing is saved until **Save reviewed import**. Native planning and
shared-source content cannot be replaced through a conflict choice; keep both
retains incoming material in a separate imported document. Full versions can be
downloaded when the inline preview is truncated. A later edit invalidates the
choice and requires another review. Give new sources recognisable names in the
import form; refresh selects the stored identity even if a folder moved.

Needs attention shows **Your planning work** first. Imported records and mapping
gaps are expandable separately. Import preview highlights newly broken native
links in addition to overall mapping counts. Unresolved imported types are
coverage limitations, not a claim that the original project is invalid.

The component recipe now separates **Inputs**, **Return value** and optional
**Effects**. Records, lists and named success/error outcomes have nested controls;
a defined record or outcome can be reused from a dropdown. Selecting a recipe
collapses the initial choices; **Change starting point** reopens them. Generated
text remains inspectable and is checked with the ordinary compiler.

Extra output languages can be registered by the person launching Studio:
`pymtheg studio PROJECT --plugin javascript=/absolute/emitter.mjs`.
They appear in the scaffold selector and must honour the selected body policy.
No imported document or browser request can register executable modules.

Revision context shows the parent of a new saved checkpoint. Importing another
history preserves its separate branches; the list is local save/import order,
not a claim of globally synchronised timestamps. Old histories with no parent
metadata are labelled as unknown. Imported document sections are surfaced beside
native planning work and retain their declared, unverified status.

The Documents and decisions list starts with authored/imported design documents.
Expandable **Workspace data files** exposes the retained planning JSON and import
metadata separately. Metadata stays readable and exportable, but changes go
through planning/import controls rather than a document editor.

### Keep an unfinished code link

Choosing a declaration or entering its reason starts a draft for that planned
record. Switching records does not copy the reason or selection. The graph's
**Unfinished links** section shows when local recovery has acknowledged the
draft and lets you resume or discard it. A restart retains it; reviewing the
current source is still required before saving. Saving a link removes only that
record's draft. A changed plan or code version is identified for renewed review.

The code capture form can browse files without reading their contents. Search,
page and select the candidate paths, then use **Read files and retain version**
to capture source explicitly. Refreshing the candidate list keeps selections.
Unsupported languages still need an observation provider.

### Edit a data shape

In Blocks, expand a data-shape card and choose **Add or remove fields and
outcomes**. Preview the changes and affected declarations before applying them
to the unsaved source. Closing preserves the unfinished form; restart and
independent current edits are handled through the same reviewed merge policy as
interface editing. Use **Add to this design** for a new component, operation, data shape or
resource lifecycle. Advanced definitions remain available in Text.

### Add a part of the design

In Blocks, choose **Add to this design**. Choose a component, external operation,
data shape or resource lifecycle. Complete the labelled inputs, fields or states,
preview the new source, then choose **Add to editor and check**. Save is separate.

Closing keeps the unfinished form. Resume it from the workspace banner after a
restart; use **Discard declaration form** only when you want to start over.
The form never restores an approved preview. Missing effects, unknown work and
resource obligations remain findings from the ordinary checker.

GUI test scripts use the browser installed for the pinned Playwright dependency.
Install it with `node node_modules/playwright/cli.js install chromium`, or provide
`PYM_CHROMIUM` with an explicit executable. `PLAYWRIGHT_BROWSERS_PATH` supports
an isolated installation directory. The full runner forwards its resolved path
through `pc-tools headless`; no GUI correctness assertion uses elapsed time.

### Find earlier plan and code versions

In **Plan & code graphs**, use the separate search boxes for plan checkpoints
and code captures. Search covers retained history, not just the currently
displayed options. Filter plan checkpoints to design changes or link updates
when the list is busy. The selection stays put while you search; changing the
selected checkpoint is explicit. Duplicate names show date and identity.

If history changes while paging, refresh that version list. The earlier graph
and source remain available; no capture or review occurs merely from browsing.
