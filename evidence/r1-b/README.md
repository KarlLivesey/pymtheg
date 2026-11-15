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


## Round 1: fresh standard install/test path

New mirror: r1b-review-f8d19c. Unlike the initial run above, no full build or
web assets are present. Commands:

- `npm ci --ignore-scripts`: round1-npm-ci.log.
- `python3 evidence/r1-b/without-java.py npm test`: round1-npm-test.log.
- `npm run format:check`: round1-format-check.log.
- `python3 evidence/r1-b/without-java.py node --test
  '--test-name-pattern=name and ownership|read-only metadata|printed next'
  test/project-init-clean.test.mjs`: round1-message-tests.log.

without-java.py removes PYM_TLC_JAR, creates a unique PATH of existing executable
symlinks excluding java, asserts Java cannot be found, and asserts no dist-web
exists before or after the check. It removes that PATH directory on completion.
Graph index/search smoke is now included after merging PR 34. Intentionally
broken repository fixtures may yield an incomplete index, which the repository
smoke asserts explicitly rather than reporting those analyses as clean.


Final rerun uses another fresh mirror, r1b-review-final-b61ca7:

- `npm ci --ignore-scripts`: round1-final-npm-ci.log.
- `python3 evidence/r1-b/without-java.py npm test`: round1-final-npm-test.log.
- `npm run format:check`: round1-final-format-check.log, passed.

The first round1-npm-test.log run includes an obsolete legacy-refusal assertion
newly merged from PR 34. That assertion is updated in the final rerun; both logs
are retained. The separate Java-hidden init run in round1-init-tests.log passed
all 14 tests (including repository graph index/query); round1-message-tests.log
passed all three message/shell regressions. Neither run built web assets.


The initial round-1 full run completed with 2,641 passed, one failed (only the
merged obsolete refusal assertion), and two skipped external TLC cases. The two
skips explicitly require PYM_TLC_JAR and Java and remain unresolved external
backend evidence, never passed analyses, in this Java-hidden validation.


Final result: round1-final-npm-test.log exits 0 with 2,642 passed, zero failed or
cancelled, and two external TLC cases skipped (unresolved, not a pass).
round1-final-format-check.log passes. Both dev-server mirrors are cleaned after
all checks and child processes have finished.
