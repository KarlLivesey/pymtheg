# PR 40 inline-result follow-up

Relative to `127b7508679de45adf1e9e6ad09dd87ba8f66c78`, normal merge
`51a2e9ccbdeb27b800822c24cd4e02a2943a0334` brings main at
`350b70cee19dfa6ef2b3e60a4fbe2503d8e38fa3`. These are the merge's two
parents (verified with git log). No PR 38 dependency was added.

All installs/builds/tests/indexing ran on the dev server through mirror `r1ci40`.
Commands: npm ci --ignore-scripts; npm run build:core; npm test;
npm run format:check; node --test test/mcp-graph*.test.mjs
 test/mcp-design-loop*.test.mjs test/mcp.test.mjs test/mcp-loop-soundness.test.mjs;
R1C_EVIDENCE="$PWD/evidence/r1-c/inline" node evidence/r1-c/restic.mjs.
All foreground work completed before hand-back.

- Full suite: **2,676 passed**, zero failures/cancellations/skips.
- Format check passed.
- Focused MCP regression suite: **33 passed**, zero failures/cancellations/skips.
  Includes all documented examples executed against real stdio, design iteration,
  graph certainty/paging/edits, and existing lifecycle/disconnect tests.
- Three new controlled-worker tests explicitly choose completion or deadline
  expiry. They prove inline equals graph_result, fallback carries progress,
  one-worker rejection, wait:false bypasses the deadline, and request cancellation
  joins the worker and clears the deadline. No timing assertions/sleeps.

The updated restic driver uses a clean disposable copy of pinned
`c734245fd3ae9bcac8ab3aaafb4482d4b5d0ae92`. Index uses wait:false deliberately:
two calls, 616 + 3,348 bytes. Each warm question below completed inline:

| Question | Calls | Response bytes (text + structuredContent) |
| --- | ---: | ---: |
| ParseID declaration | 1 | 6,348 |
| ParseID call sites | 1 | 37,288 |
| ParseID callees | 1 | 10,020 |
| Possible SaverUnpacked.SaveUnpacked callers | 1 | 6,272 |
| Two-level ParseID impact | 1 | 20,118 |

**7 calls total including index**, versus the historical 17-call driver. This
records observations, not a speed/inline guarantee. The updated questions select
the first links/possible_callers page directly and omit the old auxiliary symbol
and legend requests. The two SaverUnpacked callers remain possible/unresolved;
hex.DecodeString remains unresolved. Impact remains explicitly truncated.
All response sizes are below 65,536 bytes. Three independent source checks pass:
ParseID definition (id.go:21), call (snapshot_find.go:98), callee (id.go:26).
Counts remain 559 files / 7,356 symbols / 63,088 links; no failed/partial files;
21,686 unresolved and 1,484 candidate sets. This is no corpus-wide accuracy claim.

restic-summary.json contains exact per-call bytes/counts; restic-transcript.json
contains raw compact response bodies; source-checks and manifest retain pin and
source provenance. verification.json confirms every recorded source hash matches
the local source. The copy/database and MCP client/server were removed in finally
(restic-cleanup.txt). dev-clean.log records subsequent mirror/scratch removal.
The npm-test log's trailing blank/whitespace-only lines are normalized for Git;
assertion output and counts are unchanged. Root evidence is historical.
