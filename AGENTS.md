# Pymtheg working rules

- Read README.md and the relevant docs/runtime-map.md, docs/support.md and
  docs/decisions.md sections before changing semantic boundaries.
- Keep loops small: one observable hypothesis, a narrow change, a fast meaningful
  check, and inspected output. Aim for 2–5 minutes. Do not weaken acceptance criteria
  to make a loop look successful.
- Correctness must not depend on computer speed. Use source findings, deterministic
  operation counts, readiness handshakes and controlled clocks. Do not assert tight
  elapsed-time limits or use startup sleeps. Benchmark timings are observations.
- CPU cancellation tests use the production coordinator with a worker that cannot
  naturally finish before cancellation. Real backend resource-budget exhaustion
  means unresolved evidence, explicitly reported; never a passed property.
- Keep one typed ProjectIR and source snapshot. Analyses and lowering must not
  reparse sources or implement conflicting outcome, cost or ownership semantics.
- Preserve historical research and logs. Put new implementation evidence in evidence/.
- Update the support matrix and decision ledger when contracts or support change.
- Build work follows docs/build-plan.md. Builders work in their own worktrees on
  one assigned chunk, push its branch and open a pull request. Reviewers review
  one pull request and do not change its branch. The manager merges passing pull
  requests into main. Builders and reviewers do not start further agents.
- No package publishing or deployment without Karl's request.
- Keep agent preview/browser access disabled. CLI/compiler checks need no browser.
  Follow Karl's pc-tools restrictions for any separately authorised browser work.
- Use CodeGraph first if a .codegraph directory exists; do not create an index.
