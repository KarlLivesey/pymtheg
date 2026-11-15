Legacy Pymtheg folders no longer block a project from opening. The refusal path is removed: storage and discovery ignore old entries, while init and doctor print one short stderr notice naming unused entries that are safe to delete. Nothing reads, migrates or deletes their contents.

Init reports the workspace name and root it opened, metadata created, what to commit versus local ignored planning/caches, and the next doctor/Studio/MCP commands. Complete re-runs leave metadata unchanged; interrupted publication can complete without replacing settings or identity. Nested folders and monorepo packages reuse the enclosing workspace; a nested Git root gets its own. No independent nested-project option is added. The shared/ ignore policy is unchanged: planning is shared by explicit history export.

Round 1 fixes since 9e1f5e09:

- Merge origin/main normally, including PRs 34 and 31. Add real graph index/search smoke checks after init, including in the repository copy.
- Doctor tests assert success, JSON shape, notices and init-owned metadata/settings. They tolerate missing external tools and web assets. The first green run had a full build and Java available; fresh-mirror validation now removes those assumptions.
- Name and ownership errors pass through cleanly without metadata repair advice. Only settings validation receives that guidance; permission failures name the directory as not writable, without leaking a staging filename or being rewritten as a read failure.
- Printed Studio/MCP commands safely quote roots containing shell metacharacters. New regression tests cover the three requested user-input messages, read-only metadata, and literal shell argument parsing.
- The merged graph test's obsolete legacy-refusal expectation now asserts indexing beside untouched legacy state. Each existing test edit is listed in docs/changes/R1-B.md.

Validation runs only on the dev server (Node 24.21.0). New smoke tests cover realistic directories, ignored/untracked legacy data, nesting, spaces, idempotency, interruptions, permissions and a scratch copy of this repository with fake legacy entries. They exercise doctor, fresh .pym check/verify/simulate, graph, MCP and Studio startup/API without a browser.

Limits: deliberately invalid repository fixtures are not claimed to pass project-wide modelling or graph analysis. The repository graph smoke explicitly accepts an incomplete index with named failed files and queries a known probe symbol; the small clean fixtures require a clean index. No Studio/MCP/graph/backend source files changed. Doctor receives only the notice call. Historical logs remain intact.

Checks: final fresh-mirror npm test passed with 2,642 passed, zero failed/cancelled and two external TLC cases skipped (Java/JAR unavailable; unresolved backend evidence, not passes). Results are recorded in evidence/r1-b/round1-final-*.log. Separate Java-hidden/no-web init smoke passed 14/14, and message/quoting regressions passed 3/3. Fresh mirrors use npm ci --ignore-scripts followed by npm test, with PYM_TLC_JAR unset and Java absent from PATH; no full/web build runs. Formatting passed. The initial round-1 full run caught the merged PR 34 legacy assertion; its log is retained beside the corrected rerun.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
