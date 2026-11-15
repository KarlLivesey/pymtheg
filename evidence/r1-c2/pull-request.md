Adds two agent tools over the existing requirement-to-code library: `requirement_links` (explicit create/add/remove/refresh/list/check/requirements_for/unlinked/history actions) and `link_result` (progress/pages/cancel). Names, qualified names, positions and literal graph symbol references pass through unchanged. Non-ok links include differences, suggestions, failed-file names and next actions in the first page; ambiguous adds list matches without writing. Moved is unconfirmed until refreshed unless allowMoved is explicit. Candidate/possible callers are named separately and never followed as definite. Suggestions are never applied.

All link operations run in owned workers, isolating SQLite's synchronous 30-second lock wait from the MCP event loop. Default waiting is bounded to five seconds, then a running handle is returned; completed work returns inline. Graph/link workers exclude each other per connection. Cancellation/disconnect joins workers but cannot undo committed writes: interrupted mutations must be reconciled before retry. Actual wire results cap at 64 KiB, pages default 20/max 100, three compact jobs are retained at <=8 MiB each. Counts, truncation, coverage and continuations stay explicit; unlinked symbol search has a separate bound. Check never claims all good from incomplete/failed/stale graph coverage; libraryPassed preserves the library's narrower verdict.

Four library fixes (no schema/storage-boundary change):

- failed or partial same-language sources force twins:null at link/refresh, including refresh of otherwise unchanged code;
- history uses receipt-content hashes and retained previous references, showing each entry's own path. The actual preceding row body is journalled even if another writer updates during graph sync. Legacy/lost intermediate bodies explicitly say historical path unavailable, never today's path;
- Rust r#ident is distinguished from raw strings when scanning outer attributes;
- Go directives separated from declarations by blank lines are fingerprinted, bounded by the previous declaration/non-comment code.

Normally merged main 8ab62b6f (PR 40) in cfe54aa7. All dependent items are included: stdio graph refs accepted unchanged for Go/Rust/TS; graph decidedBy/toolchain state/no-sync warning preserved and compared with real opted-in Go CLI JSON; check_design includes a bounded first finding page with reasons, locations and hints, with full read_run continuation. The review extras prioritize the requested failed file, give database collisions clear structured retry guidance, and fix stale R1-C wording. No server signal/shutdown-hook changes.

Final dev-server checks: `npm test` **2,788 passed**, focused MCP/link/graph/design tests **40 passed**, and `npm run format:check` **passed**; zero failures, cancellations or skips. Restic: **17 MCP calls**, maximum actual wire response **7,276 bytes**. All dev mirrors and scratch cleaned.

Validation and exact source hashes are recorded in evidence/r1-c2/README.md. All installation/build/test/indexing work runs on the dev server. Real stdio tests cover the mixed-language edit/check/refresh/rename/failure/rebuild loop and all actions, default ambiguous matches, paging/byte bounds, a lock-holder descriptor handshake with concurrent responsive MCP calls, controlled worker cleanup, two-server indexing/recovery, source certainty and the executed guide. A deterministic negative control reproduced the intervening-writer history bug; the same assertion passes after the fix. No timing assertion establishes correctness.

The restic run copies clean c734245, indexes through MCP, links three requirements to real functions using graph references, independently checks three source locations, then edits one body. Check returns one changed/two ok and does not auto-refresh. Exact replies and byte sizes are retained; copied corpus and mirrors are cleaned.

Not done / known limits:

- No `.pym` declaration join, satisfaction/conformance proof, Studio link UI, planning-archive link round-trip, automatic suggestions, new language accuracy or package publication.
- No cross-process index coordinator. First indexing across connections can still collide; errors now say wait/reconcile/retry. No automatic mutation retry is safe after an unknown commit outcome.
- Link actions are isolated; legacy non-link tools may still have synchronous database work. A worker in native SQLite can need that call to return before cleanup finishes. Link progress reports library execution, not per-file index progress.
- Pages cannot recover library/core truncation. Oversized single rows/global metadata/retained results refuse rather than silently pass. Long preview text is explicitly clipped; paths/IDs stay exact.
- Historical paths not retained by older writers or lost from a concurrent journal branch are explicitly unavailable. Journals grow with refreshes. Fingerprint/text/formatting, ordinal and move limitations remain those documented in R1-D.
- Graph references survive incremental indexing but can reset if graph.sqlite is deleted. Durable link identity uses path/kind/qualified identity and fingerprint; current references are in resolved current fields, stored hints are historical.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
