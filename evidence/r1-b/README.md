# R1-B validation

All dependency installation, formatting computation, build and tests ran on the
dev server using `pymtheg-dev --name r1b-ac57534c -- COMMAND`. Node is pinned to
24.21.0; the wrapper supplies PYM_TLC_JAR and scratch storage. No browser was used.
Editing, git and gh stayed local. Repeat commands used --no-sync only after the
working tree had been mirrored.

Commands and captured output:

- `npm ci --ignore-scripts`: npm-ci.log
- `npm run build`: build.log (includes web assets needed by doctor)
- `node --test test/project-init-clean.test.mjs test/workspace-init.test.mjs test/storage-boundary.test.mjs test/storage-review.test.mjs`:
  targeted-tests.log, 36 passed, zero failed or skipped.
- `npm test`: npm-test.log, 2,581 passed, zero failed, skipped or cancelled.
  No flaky rerun was needed.
- `npm run format:check`: format-check.log, passed.

The new tests launch the real CLI, MCP stdio handshake, and Studio HTTP service.
Startup is awaited through protocol/output readiness; services are shut down and
awaited. Temporary fixtures use unique directories under server PYM_SCRATCH.
The repository scratch copy excludes evidence and research entirely, along with
builds, dependencies and existing managed/legacy folders. repository-settings.json
is a fixture taken with `git show HEAD:.pymtheg/settings.json`; it restores tracked
settings excluded by the wrapper's mirror rules. Fake legacy data is created in
scratch; no actual checkout's legacy data is inspected or modified.

PR 34 was open during validation, so the graph index CLI is not on this base.
