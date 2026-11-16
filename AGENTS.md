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
- Heavy work runs on the dev server, not on the workstation (Karl, 15 November
  2026): dependency installs, builds, the test suite, compiler checks
  (`go`, `cargo`, `rustc`), grammar builds and corpus indexing. From the
  worktree run `pymtheg-dev --name <unique-name> -- <command>`; it mirrors the
  working tree to the server and runs the command there with the pinned
  toolchains and `PYM_TLC_JAR` set. Pinned corpora are on the server, clean
  and read-only, at `~/pymtheg-dev/corpora/vector` and `…/restic` (copy, never
  edit). Use `$PYM_SCRATCH` for scratch, and `pymtheg-dev --name <name>
  --clean` when finished. Editing, git and `gh` stay local.
- No package publishing or deployment without Karl's request.
- Assume everything put into Git will be public (Karl, 16 November 2026): no
  private project names or findings, personal details, home paths, machine
  addresses or credentials in files, file names, branch names, commit messages
  or pull requests. Private material that must sit in a checkout goes under
  the ignored `/private/` or in an ignored local file, checked untracked with
  `git status`; the ignore rule and its comment must not spell the secret.
  Tests read private values from an ignored file and report only file and line.
- Keep agent preview/browser access disabled. CLI/compiler checks need no browser.
  Follow Karl's pc-tools restrictions for any separately authorised browser work.
- Use CodeGraph first if a .codegraph directory exists; do not create an index.
