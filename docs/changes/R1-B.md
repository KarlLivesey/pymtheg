# R1-B: clean project initialisation

Legacy state is dead data under D7. The storage boundary no longer refuses it;
all commands and project discovery behave as if it were absent. Only init and
doctor emit one short stderr notice naming legacy entries at the resolved root.
Detection inspects entry names, never reads their contents, and never deletes or
migrates anything. JSON stdout stays machine-readable.

Init identifies the workspace and root, reports created metadata and unchanged
re-runs, explains what to commit and what stays local, and suggests doctor,
Studio and MCP. Help and no-argument output point to init. Missing metadata after
an interrupted init is completed without replacing identity or settings. Complete
re-runs do not even stage temporary files. Errors name the affected path and an
action. Unpublished staging files remain untouched and ignored.

A folder inside an initialized project reuses it. A nested Git root gets its own
workspace. An explicit independent nested project option is possible later work.
No new option is added here.

## Scope and policy

The CLI change is confined to init. Doctor receives only the legacy notice call;
its existing tool checks are unchanged. No Studio, MCP, graph or backend files
are edited. The old-path advice in src/reporting/explain.ts was already corrected
to .pymtheg/settings.json on main. Active legacy-layout guidance is corrected in
docs/project-init.md.

The existing ignore policy is preserved: shared/ and rebuildable/ are ignored.
Init creates metadata only; databases are lazy. Planning is shared by explicit
history export, not by committing the SQLite database. Committing shared/ would
need an owner decision on concurrent SQLite changes and conflict resolution,
plus a defined portable export format and merge/import behaviour; removing the
ignore rule alone would not provide safe collaboration.

## Validation and limits

New test/project-init-clean.test.mjs covers empty Git and non-Git directories,
mixed Go/Rust/TypeScript code with docs, ignored and untracked legacy entries,
spaces, repeat byte-identical init, nested package reuse, independent nested Git
roots, interrupted steps, read-only directories and malformed settings. Real
CLI doctor, file-scope check/verify/simulate, project check, MCP handshake and
Studio readiness/API checks run without a browser or startup sleeps. A scratch
copy of this repository with fake legacy entries exercises the same journey;
real legacy folders are never touched. The scratch copy excludes evidence and
research and restores tracked settings from a fixture. This does not claim that
all intentionally invalid repository models pass a project-wide check.

Existing test files changed only to replace obsolete refusal expectations:

- test/storage-boundary.test.mjs: assert stores open beside legacy entries and
  preserve their bytes instead of refusing them.
- test/storage-review.test.mjs: assert project-scope checks succeed beside legacy
  entries without changing the file tree.
- test/graph-command.test.mjs (merged from PR 34): replace its legacy refusal
  expectation with indexing beside an untouched legacy folder; retain explicit
  incomplete status and failed-file assertions for its deliberately broken fixture.

Round 1 merges origin/main, including PRs 34 and 31. After-init tests now index
the graph and query an actual probe symbol. The repository copy contains
intentionally malformed language fixtures, so that smoke explicitly allows and
asserts an incomplete index with named failed files; it does not claim a clean
analysis of those fixtures. No graph implementation changes are included.
All installation, build and test commands run on the dev server through
pymtheg-dev; see evidence/r1-b for commands and results.

Initial dev-server checks (with a full build and Java available): `npm test` passed 2,581 tests, zero failures, skips or
cancellations; `npm run format:check` passed. Targeted initialization/storage
checks passed 36 tests with zero failures or skips. No flaky rerun was needed.


## Round 1 corrections since 9e1f5e09

The first green run used existing dist-web assets and dev-server Java, hiding an
unnecessary dependency in seven new tests. Doctor tests now assert exit success,
parseable schema/checks, the legacy notice, and readiness of any metadata/storage
checks. Current doctor exposes tool checks only, so workspace identity and settings
are validated directly. Missing Java/TLC/Quint or web assets do not fail init tests.

The init error wrapper now handles permission failures only. Name and ownership
errors pass through cleanly without repair advice. Settings validation has a
specific path and repair message. Read-only metadata names the directory as not
writable, without exposing staging filenames or the CLI's misleading read error.
The printed Studio/MCP next commands use shell single quoting, including escaping
embedded quotes. Three new tests pin the requested name errors, read-only metadata,
and literal shell parsing of paths containing dollar signs, backticks and quotes.

Validation uses a new mirror r1b-review-f8d19c, npm ci --ignore-scripts, then
npm test with PYM_TLC_JAR unset and a PATH containing no java executable.
No full/web build runs; the harness asserts dist-web is absent before and after.
The restricted PATH contains symlinks to other existing tools, preserving the
pinned Node/Go/Rust versions. See round1-* logs and without-java.py in evidence.


Final round-1 results: fresh npm ci + npm test passed with 2,642 passed, zero
failed/cancelled, and two external TLC cases skipped because Java and the JAR
override were intentionally absent. These skips are unresolved backend checks,
not passed analyses. Format check passed; separate no-Java/no-web init smoke
passed all 14 tests and the focused message/quoting run passed all three.
The earlier round-1 full run had only the merged obsolete graph refusal assertion
failing (2,641 passed, one failed, two skipped); both outputs are retained.
