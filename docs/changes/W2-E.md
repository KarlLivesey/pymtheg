# W2-E: storage boundary and project layout

Implements mega-plan 3.1, 3.2 and 3.4, under D5/D6/D7. Local storage only;
no synchronization and no old-layout migration.

## Layout and contracts

- `.pymtheg/project.json`: stable workspace identity.
- `.pymtheg/settings.json`: project configuration and scenarios.
- `.pymtheg/shared/architecture.sqlite`: requirements, links, decisions,
  retained observations, checkpoint history and architecture authoring drafts.
- `.pymtheg/shared/drafts.sqlite`: unsaved Studio buffers and form/context drafts.
- `.pymtheg/rebuildable/graph.sqlite`: code graph cache.
- `.pymtheg/rebuildable/runs.sqlite`: bounded recent Studio execution cache.

Unsaved drafts are authored data, even though the previous implementation called
all of this "recovery". They deliberately stay in `shared/`: deleting rebuildable
state must not discard an unfinished design. Recent run results are derived,
can be rerun, and disappear on cache deletion. Export a report to retain it
independently. This supersedes the old single Studio recovery database location.
Planning history and its imported source snapshots remain durable and unchanged.

`src/storage/layout.ts` is the dependency-free path catalogue shared with identity
values. `src/storage/local.ts` owns project path selection, directory creation,
legacy detection, regular-file/sidecar validation and SQLite connection creation.
Feature stores retain their schemas, queries and transactions. The graph core's
explicit-path constructor remains public and unchanged; project callers use
`openProjectGraph(root, projectId)` from `src/storage/graph.ts`. Temporary immutable
read snapshots and conformance scratch databases still use explicit paths through
the same connection boundary; they are execution scratch, not retained project data.
Graph indexing callers should exclude `.pymtheg` using the existing directory
exclusion option; the graph core's traversal interface is unchanged.

Read-only path resolution creates nothing. Existing symlink storage directories,
files and SQLite sidecars are rejected, including dangling links. Old top-level
settings/architecture/Studio layouts are refused only when an operation reads or
writes managed project state in the resolved project root, even when new-layout
files coexist. This is not a blanket ban on commands inside an old-layout folder.

Commands that access that state refuse: `init`, `studio`, `mcp`,
`import-architecture` (including previews), `scaffold` (reads workspace identity),
`observe` captures (read identity, with or without `--retain`), `check` with
`--check-scope related|project`, and analysis commands using `--scenario` (read
settings). Plain file-scope `check`, `verify`, `simulate` and `emit`, without a
project scenario, do not consult managed storage and remain usable. `observe
--list`, `fmt`, `doctor`, help and version reporting also do not access that state.
Explicit report/output destinations and source formatting are separate user
requests; no implicit project storage is created by file-scope analysis.

Upward discovery stops at the nearest `.pymtheg/` or Git root (including a Git
worktree's `.git` file). Legacy artifacts are examined only in the selected root,
not in unrelated parents or intermediate source folders. With neither boundary,
the requested starting directory is the root. Preserve/export old project state
with the previous version, then initialize a separate new project. No automatic
moves, deletion or fallback reads.
Internal document names such as `.pymtheg-source-contracts.json` are logical
snapshot keys inside the planning database, not additional files in the project.

## Minimal call-site changes outside owned files

- `src/project/config.ts`: resolve settings reads through the boundary.
- `src/architecture/store.ts`: select the planning directory and open its database
  through the boundary, including existing read-only snapshot handling.
- `src/studio/service.ts`: planning presence checks and scenario settings writes
  use the boundary's paths; initialize run history before reading its independent
  draft recovery view, and correct both settings-path suggestions.
- `src/graph/store.ts`: connection creation uses the boundary; no schema, query,
  indexing, language-module or public-interface changes.

## Explicitly deferred: all of 3.3

This chunk does not add machine/actor identity, a globally unique change/event ID,
author attribution, recorded-change events, causal order across machines or
cross-machine history ordering. Existing workspace UUIDs, graph IDs, content
hashes, checkpoint IDs, timestamps and local checkpoint sequence/parent order
retain their previous meanings. No two-machine correctness claim is made.
Auditing/normalizing every persisted path (including historical provenance and
Studio run/report paths) to project-relative paths also remains for 3.3. These
require a separate storage-format/history chunk rather than widening this one.

## Validation and follow-up

See `evidence/w2-e/README.md` and the complete command logs. The new tests prove
single-folder creation, idempotent identity, durable shared content and unsaved
drafts after cache deletion, identical graph regeneration, non-destructive old
layout refusal, symlink rejection and the absence of feature SQLite openers.

The initial required run had 2,189 passes and 31 failures caused by old layout
assumptions. Its complete output is preserved as
`evidence/w2-e/npm-test-initial-layout-failures.log`. The manager then authorized
existing tests, fixtures and test configuration to be updated on this branch.
The follow-up changes below only repoint physical storage and prepare its parent
directories; all original behavioural assertions remain. Exact root-directory
listings now check the single metadata directory and its complete file listing.
Old stored-format migration tests still exercise their original database versions
at the new path. Explicit old-layout refusal tests and historical import-inventory
fixtures remain unchanged. No production code changed during this follow-up.

User-facing hard-coded old configuration wording (including the forbidden
`src/reporting/explain.ts`) and current setup guides remain documentation follow-up.
All of 3.3 remains deferred, as accepted by the manager.

## Test and fixture file inventory

Every test/fixture/configuration file changed in this PR is listed below.
Browser controllers received only fixture-path edits and syntax checks; no browser
was launched.

| File | Reason |
|---|---|
| `.pymtheg/settings.json` (moved from `.pymtheg.json`) | Preserve the repository's scenario fixture bytes at the current configuration path. |
| `test/architecture-agent-readonly.test.mjs` | Inspect the read-only planning backup and directory at the new shared path. |
| `test/architecture-checkpoints.test.mjs` | Inspect checkpoints and create the legacy-schema database under the new shared directory. |
| `test/architecture-long-record-search.test.mjs` | Mutate the retained legacy projection in the relocated planning database. |
| `test/architecture-readonly.test.mjs` | Keep byte, permission and worker-cancellation checks on the relocated database. |
| `test/architecture.test.mjs` | Build the legacy-schema migration fixture at the new planning location. |
| `test/branch-v6-readonly.test.mjs` | Downgrade and inspect the relocated local planning database. |
| `test/checkpoint-order.test.mjs` | Delete the actual planning directory when resetting the partial-lineage fixture. |
| `test/config.test.mjs` | Create and discover scenarios under the metadata directory. |
| `test/identity-rename.test.mjs` | Expect the shared configuration identity to name the new settings path. |
| `test/implementation-capture.test.mjs` | Read retained observation bytes from the relocated planning database. |
| `test/implementation-comparison.test.mjs` | Compare read-only HTTP access against the relocated database bytes. |
| `test/implementation-mcp.test.mjs` | Keep graph paging and read-only retained-history byte checks on the new database. |
| `test/implementation-versions.test.mjs` | Keep version-search immutability checks on the new planning database. |
| `test/locale-portability.test.mjs` | Inject the corrupted blob into the actual relocated database. |
| `test/mcp-init.test.mjs` | Expect one root metadata directory and verify its complete settings/identity file listing. |
| `test/mcp-inventories.test.mjs` | Prepare large-inventory scenario configuration at the new settings path. |
| `test/mcp.test.mjs` | Check that read-only MCP operations do not create the new planning directory. |
| `test/plan-source-code-journey.test.mjs` | Track retained source-review bytes in the new planning database. |
| `test/project-documents.test.mjs` | Check that preview-only document imports do not create the relocated database. |
| `test/recovery.test.mjs` | Crash the writer against the actual shared draft database. |
| `test/source-contracts.test.mjs` | Keep preview and atomic source-link persistence checks on the relocated database. |
| `test/source-inventory.test.mjs` | Prepare source selection settings in the metadata directory. |
| `test/storage-boundary.test.mjs` | Add the storage boundary, cache deletion/regeneration, project-state legacy refusal and symlink safety acceptance tests. |
| `test/storage-review.test.mjs` | Pin file-scope versus project-state behaviour, lazy cache Git ignores, damaged-cache draft isolation and bounded root discovery. |
| `test/storage-v4.test.mjs` | Build the original v4 compaction/migration fixtures at the new planning path. |
| `test/studio-a11y.browser.mjs` | Copy the scenario fixture into the new settings directory. |
| `test/studio-entry-dirty-switch.browser.mjs` | Copy scenario settings to the new metadata location. |
| `test/studio-legacy-review.browser.mjs` | Downgrade the relocated local planning database for the legacy-review fixture. |
| `test/studio-scenario.browser.mjs` | Read saved scenario settings from the new configuration path. |
| `test/studio-unused-scope.browser.mjs` | Create the unused-scope scenario fixture at the new settings path. |
| `test/studio-version-search.browser.mjs` | Compare version-search reads against the relocated planning database. |
| `test/studio.browser.mjs` | Copy repository scenario settings into the new metadata directory. |
| `test/studio.test.mjs` | Repoint conflict settings, damaged draft storage and source-selection configuration fixtures. |
| `test/workspace-init.test.mjs` | Keep idempotence, configuration preservation, exact metadata listings and Git-ignore assertions on the new paths. |

## Fixture-update validation before round 1 review

The required foreground unit run passes: **2,220 passed, zero failures, zero
skipped**. The known abrupt-owner-death parser test passed in that run; no isolated
rerun was required. `npm run format:check` passes. The initial failed-run evidence
is retained under its historical filename; current logs use `npm-test.log` and
`format-check.log`. The 63-test targeted fixture run also passed. All modified
JavaScript controllers were syntax-checked, with no browser launched.

`PYM_TLC_JAR=/home/user/.t3/projects/pymtheg/evidence/project-fit/tools/tla2tools.jar npm run test:backend`
also completed in the foreground: **95 passed, zero failures, one skipped**
(96 total). The skipped case is `rust: real rich contracts compile with recursive
records, outcomes and arbitrary precision integers`; it reports compiler/dependency
unavailability or an exhausted resource budget. This remains unresolved compiler
conformance evidence, not a pass. All other backend cases ran successfully.
See `evidence/w2-e/backend-tests.log`. No check is left running.


## Round 1 review fixes

- File-scope analysis remains available inside old-layout projects. Tests run
  `check`, `verify` and `simulate` against old and new layouts and compare every
  project file byte for byte; project-scope `check` refuses the old layout.
- Every storage-boundary creator of `rebuildable/` creates a local `.gitignore`
  covering its files, without requiring initialization. Tests check independent
  graph/run creation and a real Studio check in a never-initialized Git repository.
- Run-cache open/schema/decode failures yield empty history and a warning naming
  `.pymtheg/rebuildable/runs.sqlite`. They do not disable shared draft recovery.
  A garbage-cache test restores and edits an unsaved draft through Studio while
  preserving the corrupt cache bytes. The cache is ignored for that session.
- Project discovery is bounded as described above. A stray home-folder legacy
  config cannot block initialization or discovery of a new, Git, or metadata-only
  project below it. Tests also distinguish intermediate files from root-owned data.
- Studio's two source-selection suggestions now name `.pymtheg/settings.json`.

### Remaining wording outside this chunk's permitted edits

- `src/reporting/explain.ts:54`: source-discovery repair advice names old settings.
- `docs/project-init.md:20,112,114`: creation, ignoring and commit instructions.
- `docs/studio.md:141,198`: recovery and planning database locations.
- `docs/runtime-map.md:219`: private recovery database location.
- `docs/support.md:192`: configuration support wording; fold in via the doc owner.
- `docs/decisions.md:192,257`: superseded settings/recovery decisions; annotate
  the current contract without erasing historical decisions.
- `docs/architecture-workspace-plan.md:74` and `docs/seventh-review-work.md:12`:
  old planning/storage descriptions; distinguish historical intent from current use.
- `docs/mega-plan.md:107`: S27's historical scattered-layout problem statement;
  preserve it as historical context, not current setup advice.

### Further work explicitly outside round 1

The explicit-path `openDatabase` API can bypass project path selection; the
runtime-import guard does not catch a re-export such as `export ... from
"node:sqlite"`; the rebuildable run cache has no `user_version` validation.
These are recorded follow-ups, not claims made by this chunk's current tests.
All of 3.3 remains deferred.

### Round 1 validation

The required foreground `npm test` run passes: **2,227 passed, zero failures,
zero skipped**. The parser-owner death test passed; no isolated retry was needed.
All **15 storage tests** and **23 targeted tests** pass, and
`npm run format:check` passes. Logs for this review round use the `round-1-`
prefix under `evidence/w2-e/`, preserving earlier validation logs unchanged.

The foreground backend rerun completed with exit 0: **95 passed, zero failures,
one skipped** (96 total). As before, the skipped Rust rich-contract compiler
case reports compiler/dependency unavailability or exhausted budget; that compiler
conformance evidence remains unresolved, not passed. The complete core/web/Vite
build also passed. See `round-1-backend-tests.log`. All checks have finished.
