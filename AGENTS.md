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
- No publishing, deployment, remote pushes or agent delegation without Karl's request,
  except for the standing review authorization below.
- Karl explicitly authorizes independent reviews and rechecks by Sol (Codex) and
  Opus (Claude), including the ongoing review/fix/review loop, without asking again
  for each review. Reviewers may inspect the project and build/test disposable
  copies. Their live-workspace writes must be limited to assigned review reports
  and evidence under evidence/. They may not change implementation or delegate
  further. Existing privacy, browser and resource restrictions still apply.
- Keep agent preview/browser access disabled. CLI/compiler checks need no browser.
  Follow Karl's pc-tools restrictions for any separately authorised browser work.
- Use CodeGraph first if a .codegraph directory exists; do not create an index.
