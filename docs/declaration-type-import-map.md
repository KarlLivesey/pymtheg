# Reusing project types while creating declarations

Declaration creation supports searching project types, selecting the exact
declaration and previewing its import. Existing signature/type editing retains
its separately documented visibility policy. The source/GUI/MCP implementation
and its evidence are described below.

## First source boundary

Reuse the canonical IR and type writer. A creation preview may reference an
explicit symbol ID from another source already present in its checked snapshot.
It adds a relative whole-file import and preserves the original source bytes.
Existing signature/type editing keeps its current stricter policy unless this
capability is explicitly enabled. No type is guessed by name from other files.

An import also exposes the imported module's other declarations and transitive
imports. Before adding it, check the canonical visible-symbol maps for name
collisions, local new-definition collisions and a new cycle back to the target
file. Do not silently alias, shadow, or select a same-named declaration. Refuse
an incomplete chosen type with an actionable explanation. These checks borrow
the checked IR; they do not mutate it or implement another type resolver.

## Discovery and preview pipeline

The paged project-type catalogue distinguishes same-named types by
relative file and stable symbol ID. Incomplete discovery remains explicit. A
selection retains source provenance, survives paging/recovery and never grants
approval. Preview must capture the selected source closure alongside the target
buffer through the existing owned worker, validate selected source hashes, and
use that single resulting IR. A stale or removed selection requires refresh;
it must not silently switch to a replacement with the same name.

The existing text/undo/apply guard remains authoritative. Generated imports are
shown in the preview, adding no implementation logic. Existing/new component
and nested-type names must remain unambiguous after importing. Project-wide
search must not depend on importing every project into a clean file's checker.

## First probes

1. Select an unimported Order record by ID, create a component using it, and
   recheck the real generated source. Preserve the library and existing flow.
2. Two Order records: require identity and use precisely the selected one.
3. Import exposes an existing component/new local type name: refuse before
   mutation, rather than return misleading generated code.
4. Import would create a cycle: refuse with a clear route to reorganize types.
5. Chosen type is incomplete/removed/stale: no inferred replacement or pass.
6. Thousands of metadata rows, held preview, restart and a moved project: keep
   selection and expose limits; use state/response handshakes, never sleeps.

## Current implementation and evidence boundary

The source writer, guarded preview, project-type inventory, Studio/MCP APIs and
form integration are implemented in the working tree after the fourteenth
review was frozen. They are not part of that frozen review candidate.

Discovery parses source in an owned worker and returns bounded candidate
metadata, not typechecking evidence. It reads up to 10,000 files / 32 MiB, keeps
at most 16 MiB of type metadata and uses three session-pinned inventories.
Queries and type-kind filtering happen before paging. Incomplete or duplicate
source remains labelled; search never pretends the list proves a type valid.
The normal preview worker checks the chosen source closure together with the
unchanged target buffer in one IR. Explicit source hashes reject changed types.
Whole-file namespace collisions and cycles are refused before source mutation.

Selections store relative file/symbol identities and source hashes in the
recoverable form. Newly imported source hashes are checked again before applying
an edit; concurrent buffer changes retire that application. Ordinary Text and
source-save conflict checks still apply. Finding a type does not write a file,
mark it verified, or approve its use automatically.

Executed non-browser probes cover two same-named types, 1,000-type paging,
source errors, stale/removed selections, unsaved type files through real MCP,
cycle/collision refusal, preserved BOM/source bytes and discovery beyond the
editor's 8 MiB preload budget. `studio-declaration-imports.browser.mjs` now passes its actual
restart/stale-source/explicit-import journey in Chromium, Firefox and WebKit.
The first Chromium run exposed a real defect: unchanged cached source overrode
disk freshness. Shared unsaved-buffer filtering corrected it; the failure and
subsequent passing evidence remain separate. See the current completion audit
for exact broader-validation boundaries.

At the 100,000-type metadata cap, discovery now continues scanning within its
source budget until it can tell whether another type was omitted. Hitting an
exact cap is not itself incompleteness; stopping before a later type is. The
former early stop silently skipped later files and reported complete coverage.
An exact 100,000 / 100,001 regression and real API/MCP checks cover this boundary.

The decision is also represented in `examples/self/type-discovery.pym`. Real
TLC finds a three-event counterexample for `PrematureLimitStop` and exhausts
nine states without a violation for `InspectBeyondLimit`. That finite
abstraction keeps its smaller bounds explicit; it supplements the production
regression and does not establish implementation conformance.
