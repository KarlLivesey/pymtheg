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
  final parser/transfer assertions. Both SIGKILL and SIGHUP remain covered.

Named 60-second outer safety budgets report missing evidence as unresolved
failures. They establish no timing property. Timeout cleanup advances pending
controlled deadlines; capture cleanup cancels production work. The socket,
processes and private directories are closed in cleanup paths. There are no
startup sleeps or assertions on elapsed time.

Reproduction scripts, raw check logs and the before/after repetition records are
in `evidence/w2-t/`. Historical incident logs did not identify their exact
schedules; these records prove reachable races in the original tests, rather
than claiming to reconstruct an unavailable historical trace.

Validation: both full `npm test` runs passed all 2,260 tests with the local TLC
JAR configured. `npm run format:check` passed. `npm run test:backend` exited zero:
95 passed, zero failed, one unresolved skip (`rust: real rich contracts compile`,
compiler/dependency unavailable or resource budget exhausted). That skipped
probe is not conformance evidence; the same limitation was recorded before W2-T.

Each targeted test passed 200 consecutive final-source runs under the induced
CPU load: 400 passes and zero safety-budget expirations. The experiment's
post-loop burner-join bookkeeping was corrected separately; its initial exit 13
after those 200 completed iterations and the corrected helper's clean exit are
both recorded. Final process scans found no remaining experiment processes.
