# R1-C2 final evidence

Initial implementation commit a04d196565c85146008338ec3abed26dc1c01c47;
normal merge cfe54aa73c47064cffb23e03cb8e215f1f9d1553 has that commit and
main 8ab62b6f260e9bdbf537e17fd1bc88d37c356620 as its parents (verified with
git show). The final implementation is the subsequent PR head.

All installs/builds/tests/indexing ran on the dev server. Final mirror c2-f31d:

- `npm test`: 2,788 passed; zero failures, cancellations or skips.
- `npm run format:check`: passed.
- `node --test test/mcp-links*.test.mjs test/code-links.test.mjs test/mcp-design-loop.test.mjs test/mcp-graph*.test.mjs`: 40 passed; zero failures, cancellations or skips.

The final-*.log files are authoritative. pre-final-checks.txt records the earlier
successful iteration. history-negative.log is an intentional failing negative
control against the earlier architecture implementation: a controlled writer
intervenes during graph sync, and old history repeats today's path instead of
store.go / intermediate.go / store.go. The same regression passes in the final
suite. This is not a remaining test failure.

restic.mjs copies clean pinned c734245fd3ae9bcac8ab3aaafb4482d4b5d0ae92,
then drives the real stdio server. Three source-checked functions are ParseID
(internal/restic/id.go:21), (*Repository).LoadIndex (repository.go:717), and
(*packerManager).SaveBlob (packer_manager.go:116). Three links start ok; after
one ordinary source edit the result is two ok / one changed (body), without
automatic refresh. Four candidate callers are explicitly not followed.
17 MCP calls; maximum actual wire result 7,276 bytes, below 65,536.
See restic-summary.json, restic-transcript.json and restic-source-checks.json.
The summary's runtime source hashes match the final local source exactly;
source-verification.json records every SHA256 comparison.

The copied corpus is removed in the driver's finally block. Dev mirrors and
scratch c2-f31a/b/c/d were cleaned successfully; cleanup-*.log records exit 0.
No checks/workers remain running. Terminal-log trailing whitespace is normalized.
Redundant intermediate logs are omitted; their check summary is retained.

Limits: no cross-process indexing coordinator or automatic mutation retry;
legacy non-link operations can still access databases synchronously. Native SQLite
cleanup may wait for a native call. Oversized rows/results refuse rather than
claim completeness; library truncation cannot be paged away. Missing historical
bodies are explicitly unavailable and history journals grow. See the change note
and PR description for the full scope and inherited R1-D limitations.
