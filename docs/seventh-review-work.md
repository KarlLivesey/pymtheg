# Seventh review follow-up

The seventh independent report remains unchanged and rejects readiness. Its
highest-priority regression is being corrected before further breadth work.

## Scope and workspace inventory

A local check now follows the selected source's import closure and discovered
reverse importers. It does not typecheck unrelated files. Discovery reuses parsed
snapshots, reports unreadable/skipped files as inventory warnings, and excludes
`evidence/` and `research/` by default. An explicit source include list can opt
those folders in. `.pymtheg.json` accepts `sources.include` / `sources.exclude`
relative glob lists. Entry files and required imports remain checkable directly.
MCP `checkScope: "entry"` requests the import closure only; `"project"` is an
explicit whole-source-set check. The default is `"related"`.

The file browser no longer shares the analysis file limit. It lists up to 10,000
paths, renders 200 at a time with search, and preloads at most 8 MiB of ordinary
source text. Other files load on demand; selected/recovery sources are prioritized.
Unreadable files produce inventory notes rather than an offline/empty workspace.
Analysis itself remains bounded by 8 MiB and 2,048 selected files.

Focused evidence: `related-scope.test.mjs`, `source-inventory.test.mjs`, and the
existing Studio/interface tests. GUI verification is recorded separately.

Other seventh-review findings—relative symbol search/IDs, simultaneous move and
replacement, scaffold regeneration, link diff/normalization, resume conflicts,
report labels, internal search noise, formatting and final polish—remain open.

The scope/inventory fixes pass 289 local tests and the actual 271-file GUI
journey, including an undecodable neighbour, unrelated errors, bounded file-list
rendering and deferred source loading. Startup sends only edited buffers; an
initial-state baseline race was found by the large GUI check and corrected.

Relative interface search and portable MCP interface IDs are now being checked.
The typed IR keeps canonical internal IDs; the MCP boundary accepts and returns
root-relative `file.pym#name` IDs, while preserving support for existing absolute
IDs. Search uses the name plus project-relative path and ranks name matches first.

F2 now passes 16 MCP tests and the actual 1,000-type editor journey. F3 is
corrected for unique byte-identical moves even when the vacated path is replaced
in the same refresh, including explicit anchors and input order permutations.
Moved relationships show old/new paths; the plan form loads retained old/current
content side by side. `seventh-link-comparison-gui.txt` records the GUI check.

F4 now has separate contract output and versioned drift baselines. Three native
compiler consumer probes accept matching handwritten implementations and reject
incompatible return types after regeneration; implementation bytes stay intact.
CLI/plugin boundary tests and the actual baseline/change/compare GUI pass.
These changes do not establish a 9.5 rating; remaining review items and broader
regression checks are still open.

Further focused fixes: saved-form rename conflict comparison; structural finding
versus trace counts; internal-document search exclusion; long-type wrapping and
continuation indentation; repeat notices for relocated comments; native-link
errors naming affected plans and unique targets; configurable plugin deadlines;
paged MCP branch lists; and v7 auditable, withdrawable branch acknowledgements.
Empty-Architecture accessibility and 390px layout have now been exercised. The
first expanded local consolidation passed 300 tests; later review-metadata changes
still require a new consolidated run. No 9.5 claim is made.

Current consolidated evidence: 303/303 local tests and 67/67 real integration
tests, zero skips. The only failing local check in the preceding run asserted
old rename-message wording; the fix retains the explicit-anchor guidance and
also identifies affected plans. The expanded branch GUI records and withdraws
review notes while preserving the active architecture. A final directory-access
edge case now makes inaccessible neighbours visible as discovery warnings,
rather than disconnecting the selected source; that narrow change is checked
separately before the GUI sweep.

Final pre-review state: 304/304 local tests, 67/67 full real integrations and all
45 registered GUI journeys passed. After the sweep, the final branch-form style
and the implementation-note/contract-note distinction received focused visual,
unit, compiler and installed-package checks. Formatting is clean. Sources are
frozen separately for the eighth review; no self-awarded 9.5 rating.
