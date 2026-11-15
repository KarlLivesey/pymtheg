# PR 40 main integration

Normal merge of main `7e5b4cc5e685a5419ec6297b00d1e2452942a428` into previous
PR 40 head `b5d5cd701cd286e405fe6bd163f04a62ca73fe2d`. No rebase/force push.
Main includes the backend removal and Rust recall work; no extra feature changes.

The two conflicts were resolved as follows:

- docs/mcp.md keeps the executed R1-C session, file-based try_inputs and inline/
  paged graph examples. It describes the built-in verify/simulate engines and has
  one explanation of property/summary exhaustiveness. Executed examples assert
  true for verify, false for simulate and the clean-simulate non-proof wording.
- src/mcp/workspace.ts retains main's constructor/backend removal, built-in method
  dispatch, results.exhaustive aggregation and clean-simulate meaning. It keeps
  R1-C graph initialization/cleanup. Relative to main, only the graph additions
  remain in that file; none of the removed backend fields/wording is restored.

The design-loop test adds only property/summary exhaustiveness assertions and a
check of the clean-simulate meaning. No graph, try_inputs or other logic changed.
No removed-backend reference remains in src/mcp or the MCP guide.

Fresh dev mirror r1cm-a71; npm ci --ignore-scripts first. All commands foreground
on the dev server, no workstation install/build/test, browser or agents:

- npm test: **2,747 passed**, zero failures/cancellations/skips.
- npm run format:check: **passed**.
- R1C_EVIDENCE="$PWD/evidence/r1-c/main-integration"
  node --test test/mcp*.test.mjs: **40 passed**, zero failures/cancellations/skips.

Both the design loop and every documented call execute against the real stdio
server. design-loop.json records the replies; documented-calls.json records the
executed calls/sizes, covering all 19 registered tool names. No corpus run was
requested or repeated; earlier corpus evidence remains historical at its pinned
head. verification.json pins the resolved/tested files. Terminal trailing
whitespace alone is normalized in logs. The mirror/test scratch are cleaned.
W3-M2 was already committed/pushed at b878f1e2 before this integration; its branch
was not edited during the job and is restored after pushing this merge.
