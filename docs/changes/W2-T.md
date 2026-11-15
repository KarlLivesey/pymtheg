# W2-T: deterministic process ownership tests

The two process regressions now use readiness/completion handshakes and controlled
process deadlines. No production process policy or support contract changes.

- The timeout fixture registered its child's `exit` listener inside its own TERM
  handler. Group TERM can reap that child before the leader handles TERM. The
  fixture then waits for an event already delivered. Its manual clock never
  advanced the 100 ms KILL grace, allowing an unlimited hang. The replacement
  waits for descendant IPC readiness, deliberately ignores TERM, and explicitly
  fires both deadline and grace. Cancellation exercises the same controlled
  escalation. Descendant termination is observed in `/proc`, not assumed to
  coincide with leader completion.
- The owner-death test assumed removal of the source-transfer directory proved
  supervisor completion. A concurrent capture's `reapStaleCaptures()` may remove
  a dead owner's transfer while its supervisor has not yet run. The parser may
  still exist. A test-only Node preload observes the production supervisor's
  `beforeExit` through a private Unix socket after its ordinary cleanup has
  drained. The test forces the competing-reaper ordering with SIGSTOP, observes
  the stopped state, removes the dead owner's transfer, proves the parser is
  still present, then resumes and waits for supervisor completion before its
  final parser/transfer assertions. A separate supervisor-only case runs no
  reaper after owner death, waits for STOPPED, then requires ENOENT for the transfer and ESRCH for
  the parser. Its private TMPDIR prevents unrelated startup reapers masking a
  missing supervisor deletion. Both cases cover SIGKILL and SIGHUP.

Named 60-second outer safety budgets report missing evidence as unresolved
failures. They establish no timing property. On a process safety failure, test
cleanup discovers uniquely tagged fixture leaves/groups through `/proc` and
sends SIGKILL directly, independently of production signaling/escalation. It then
advances pending controlled finish callbacks; capture cleanup cancels production work. The socket,
processes and private directories are closed in cleanup paths. There are no
startup sleeps or assertions on elapsed time.

Reproduction scripts, raw check logs and the before/after repetition records are
in `evidence/w2-t/`. Historical incident logs did not identify their exact
schedules; these records prove reachable races in the original tests, rather
than claiming to reconstruct an unavailable historical trace.

Initial-head validation: both full `npm test` runs passed all 2,260 tests with the local TLC
JAR configured. `npm run format:check` passed. `npm run test:backend` exited zero:
95 passed, zero failed, one unresolved skip (`rust: real rich contracts compile`,
compiler/dependency unavailable or resource budget exhausted). That skipped
probe is not conformance evidence; the same limitation was recorded before W2-T.

At the initial head, each targeted test passed 200 consecutive runs under the induced
CPU load: 400 passes and zero safety-budget expirations. The experiment's
post-loop burner-join bookkeeping was corrected separately; its initial exit 13
after those 200 completed iterations and the corrected helper's clean exit are
both recorded. Final process scans found no remaining experiment processes.

Round-1 correction: added supervisor-only cleanup checks for both owner-death
signals, isolated from startup reapers, and independent test-side SIGKILL cleanup.
Disabling supervisor deletion now fails the ENOENT assertion. Leader-only signals
and a disabled KILL escalation each fail at the named safety budget, exit the test
file and leave zero tagged processes. All generated mutations were restored.
After merging origin/main normally, both full suites passed 2,260/2,260 with no
skips, formatting passed, and both COMPLETE process-test files passed 100 runs
each under two CPU burners on CPU 0 (1,200 passes, no failures/skips/safety
expirations). The controller exited zero, source hashes matched and final
`pgrep`/tag scans were clean. Round-1 records are in `evidence/w2-t/round-1/`.
