# Continuing interface authoring

This is the implementation map for fifth-review G7, not a completion claim.

The checked ProjectIR is the authority for callable signatures, nominal types,
source identities and locations. Opening an interface editor reconstructs its
state from that IR; a recipe's former React state is not required after restart.
The parser retains exact name/parameter/effect spans so edits do not rediscover
boundaries with a second parser or rewrite a handwritten body.

The first vertical slice changes a callable signature by applying nonoverlapping
edits to its frozen source text. Body text, cancellation handlers, bounds,
pre/postconditions and unrelated declarations remain byte-exact. The result is a
proposed buffer, never an implicit disk write; the ordinary checker reports
newly affected callers and body references. Existing signature holes prevent
claims about that signature but do not invalidate unrelated interfaces.

Subsequent slices add referenced type-definition edits and project type reuse,
then Studio/MCP entry points and unfinished-form recovery. Named types carry their
resolved identity; selecting a type may add an explicit import, but cannot copy or
silently replace another definition with the same spelling. Shared definitions
must make their affected consumers visible before applying a proposed buffer.

The editor must refuse stale snapshot edits, show the source changes, preserve a
pending form until applied or explicitly discarded, and recheck through the same
worker. Unsupported shapes stay readable and receive a precise support reason.
No generated empty or fail-fast body replaces the user's body during interface
editing. General code refactoring and implementation generation are not inferred.

Evidence starts with a source-to-source regression: a parameter/type/effect change
must preserve an actual handwritten body and cancellation path, including Unicode
and comments, and the new source must be checked by the ordinary compiler.

Implemented after the fifth review:

- `visibleSymbols` is the resolver's canonical per-file visibility table. Forms
  use these resolved IDs, including nominal references. They do not infer scope
  from spelling or reparse source.
- Checked shared record/outcome definitions can be edited alongside a signature.
  New inline types become explicit declarations. A preview lists each file's
  original bytes/hash, proposed bytes, nonoverlapping spans and reverse-graph
  consumers. Studio validates **all** captured buffers before applying any of
  them. Applying changes buffers and rechecks; it never saves source implicitly.
- Unchanged signatures retain their original header comments. Changing a
  parameter list or type definition deliberately replaces that displayed span;
  comments inside the replaced span appear in the before/after preview. Body,
  cancellation and unrelated source text remain byte-identical.
- Unapplied interface forms persist in the existing recovery transaction. After
  a restart, Resume performs a fresh check and requires the same snapshot. A
  divergent snapshot leaves the form downloadable and explicitly discardable;
  no stale type definition is silently replayed over new source.
- New component forms and MCP recipes can reuse types from a checked design,
  adding explicit relative imports. This is the loaded import closure, not a
  claim that every unrelated file in a repository has been checked. MCP's
  `design_interface` exposes type inspection, description and preview only.

Evidence: `shared-interface-edit.test.mjs`, `interface-api.test.mjs`, the real
`studio-shared-interface.browser.mjs` restart journey, `studio-reuse-type.browser.mjs`
and the MCP stdio reuse/edit regression. General alias/resource definition editing,
implicit rename refactoring and arbitrary comment-preserving field surgery
remain outside the editing subset.

The new-component wizard now also persists its recipe, steps, field values and
path. It may retain temporarily blank type names; structural/depth/size limits
still apply, and strict source validation runs on creation or interface preview.
A restored wizard refreshes its checked type context. The real restart regression
finishes a partially typed record and creates checked source without a guide.

Staged safe resume records hashes of only the editable header spans and the
existing type declarations changed by a form. Body-only or unrelated edits can
carry the saved form forward after a fresh check. A changed header, changed type
or new comment inside an overwritten span refuses automatic resume and retains
the draft. Original baselines remain separate from current source; this is not an
implicit general merge. Older drafts without these hashes stay conservative.

Restored architecture forms keep their original edit baseline separate from the
currently displayed revision. The evidence shortcut selects the displayed
revision, not the old draft baseline. Evidence revisions are chosen by searchable
names and dates, with a retained unknown selection shown explicitly. Long-text
fields have stable accessible labels even after values are restored.
