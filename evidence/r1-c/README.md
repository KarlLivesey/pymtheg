# R1-C evidence

This root records the initial `127b7508` implementation. For the current inline
follow-up, checks and calls-per-question, see [inline/README.md](inline/README.md).
The initial 17-call transcript below is historical.

Base: `7b0caaa8a87f44eb053d1e43ecf32c08f3865061` (origin/main when this branch
was created). Worktree branch: r1-c-mcp-graph. Source changes are confined to
src/mcp, with new tests/fixtures, docs and this evidence. No graph export was
needed and R1-A's engine/status lines were not changed.

Heavy commands run through pymtheg-dev, never on the workstation. Mirrors used:
r1c-73c371-a1 and r1c-73c371-final. The latter held an intermediate check while the
former ran the final corrected source. Each is cleaned after its work ends.
The server supplies Node 24.21.0 and the pinned language/Java tools and TLC JAR;
this is not R1-A's separate Java-free release proof. Worktree git/gh stay local;
read-only corpus Git provenance checks run on the disposable server copy.

Final commands: npm ci --ignore-scripts; npm run build:core; npm test;
npm run format:check; node --test test/mcp-graph*.test.mjs
 test/mcp-design-loop*.test.mjs; node evidence/r1-c/restic.mjs.
All checks are foreground. No startup sleeps, elapsed-time assertions, skipped
incomplete evidence, agents, browser use or package publishing.

## Tests and corrections

- New stdio tests: mixed init-free Go/Rust/TypeScript graph, all actions, failed
  whole files (named on every result page), candidate membership, possible
  callers, reasons/legend/exact details, ambiguity, positional/stable selectors,
  edits/no-sync, truncation, size bounds and per-session handles.
- Controlled worker readiness: busy rejection, cancellation/join, expiry, a held
  error during cleanup, unexpected exit after a purported result, session close.
  The worker cannot naturally finish before the requested release/termination.
- Design loop: initialized fresh project as setup; thereafter MCP plus ordinary
  source edits only. New design -> diagnostic/hint -> fix/check -> file-based
  try_inputs -> finite verification -> simulation. Complete, method-correct
  evidence is required; unsupported/resource exhaustion is not a pass.
- Documentation blocks execute verbatim; exercised names are compared with real
  listTools. Every registered tool has a checked example, including deliberately
  refused legacy link operations with correct plan: prefixes. The old tools do
  not implement the forthcoming Go/Rust requirement join.
- Regression subset also runs unchanged test/mcp.test.mjs and
  test/mcp-loop-soundness.test.mjs; 30 passed after the guard correction.

An intermediate full run had 2,600 passes / 2 failures. My first try_inputs guard
incorrectly checked every report diagnostic, blocking source-replayed contract
violations as if they were type errors. The two unchanged assertions were:

- mcp-loop-soundness: negative-list example expected violated, got incomplete.
- mcp.test: replay-confirmed bad input expected violated, got incomplete.

The guard now checks canonical parse/type diagnostics only for the new file form;
legacy run-ID replay remains unchanged. A new file-form contract violation is
also pinned. No assertion was weakened. This regression was fixed wholly inside
src/mcp. Final logs replace superseded iteration outputs; tool transcripts
retain the investigation. Full-suite/format/focused final results are below.

## Corpus

restic.mjs copies the clean read-only server corpus c734245 into a unique
PYM_SCRATCH directory, makes only the copy writable, and drives the real built
stdio server through index + five agent questions. Every tool response's byte
size includes text plus structuredContent and must be <=65,536. Graph work uses
executeGraph; independent source reads only validate answers, not compute them.

Questions: ParseID declaration; its callers; its callees; possible callers of
SaverUnpacked.SaveUnpacked; bounded two-level ParseID impact. Checks read pinned
Go source at internal/restic/id.go:21, internal/data/snapshot_find.go:98 and
internal/restic/id.go:26. hex.DecodeString stays unresolved. Possible callers
remain separate. Bounded impact explicitly says truncated, never absence/proof.

Artifacts: restic-summary.json (counts/sizes), restic-transcript.json (compact raw
MCP replies), restic-source-checks.json, restic-manifest.json (pin/source hashes),
restic-cleanup.txt; design-loop.json; documented-calls.json; regression-tests.log;
final build/npm-test/format-check/focused-tests logs. Drivers and source fixtures
make the session reproducible. The copied corpus/database and MCP server/client
are removed in finally. Dev-clean logs record mirror removal afterwards.

## Final result

- **npm test: 2,602 passed**, zero failures/cancellations/skips.
- **format:check passed**; **7 new focused tests passed** again.
- **30 focused + unchanged MCP regressions passed** after the replay guard fix.
- **19 registered tool names** covered by executable documentation examples.
- Restic: **559 files, 7,356 symbols, 63,088 links**, zero failed/partial files;
  21,686 unresolved, 1,484 candidate sets remain. Index plus five questions use
  17 MCP calls; all succeed. Maximum tool result **37,288 bytes**, below 65,536.
  Three source checks pass. Impact is explicitly truncated at depth/result bounds.
- Source hashes match the final corpus run (verification.json). The copied corpus
  and both mirrors are removed; no work remains running. Cleanup commands exited 0.

The intermediate failure excerpt is retained for the two corrected regressions.
Trailing whitespace in that diagnostic excerpt is normalized only for Git diff
cleanliness; the terminal blank line in build.log is also normalized. Failure
values, stack text and results are unchanged. This is the initial
release's MCP slice, not proof of whole-product readiness or corpus-wide accuracy.
