Legacy Pymtheg folders no longer block a project from opening. The refusal path is removed: storage and discovery ignore old entries, while init and doctor print one short stderr notice naming unused entries that are safe to delete. Nothing reads, migrates or deletes their contents.

Init reports the workspace name and root it opened, the metadata created, what to commit versus local ignored planning/caches, and the next doctor/Studio/MCP commands. Complete re-runs leave metadata unchanged; interrupted metadata publication can be completed without replacing settings or identity. Path/action errors and first-run help are clearer.

Nested folders and monorepo packages reuse the enclosing workspace; a nested Git root gets its own. No new independent nested-project option is added. The shared/ ignore policy is unchanged: planning is shared by explicit history export. The change note records the decisions needed before committing shared SQLite data.

Validation runs on the dev server only (Node 24.21.0), with logs under evidence/r1-b/. New readiness-based tests cover realistic directories, legacy data, nested roots, spaces, idempotency, interrupted init, permissions, and a scratch copy of this repository with fake legacy entries. They exercise doctor, fresh .pym check/verify/simulate, MCP and Studio startup/API without a browser. Existing test edits only replace removed refusal expectations, listed individually in docs/changes/R1-B.md.

Limits: graph-index CLI is not tested because PR 34 remains open on this base; intentionally invalid repository models are not claimed to pass project-wide analysis. No Studio/MCP/graph/backend files changed. Doctor receives only the notice call. src/reporting/explain.ts already uses the current settings path on main. Historical logs remain unchanged.

Checks on the dev server: `npm test` passed 2,581/2,581 with zero failures, skips or cancellations; `npm run format:check` passed; targeted initialization/storage tests passed 36/36. No flaky rerun was needed. Logs are committed under evidence/r1-b/.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
