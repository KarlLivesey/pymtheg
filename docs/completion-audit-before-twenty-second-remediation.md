# Current completion audit — twenty-second review pending

The twenty-first independent review rates its frozen candidate **about 9.3 overall**.
Blocks and outputs/contracts/plugins reach 9.5. The remaining areas have not reached
the target. These are the independent grades before the repairs below.
[Independent report](../evidence/product-audit/claude-architecture-twenty-first-review.md).

| Area | Twenty-first score |
|---|---:|
| Semantics and honest evidence | 9.2 |
| Architecture, planning and history | 9.3 |
| Blocks | 9.5 |
| Plan/code graphs | 9.4 |
| Agent MCP | 9.3 |
| Outputs, contracts and plugins | 9.5 |
| Recovery and concurrency | 9.4 |
| Scale | 9.0 |
| Accessibility and cross-browser | 9.2 |

## Repairs being validated

- Capture parsing runs in a bounded child process. Native V8 allocation failures
  cannot abort Studio; they trigger sequential bounded parse partitions. Snapshot
  hashing consumes each file's provenance incrementally rather than one giant string.
- Archive preview decodes every distinct retained code version before committing.
  Invalid compressed parts cannot enter through history or bundle import. Plan
  metadata reads do not decode unrelated active code; a damaged legacy code version
  does not prevent a fresh capture or selection of a healthy historical version.
- Conditional contract violations are C009 pending obligations when source-path
  reachability has not been validated. They are not complete counterexamples.
  Safety proofs using conservative ranges remain available. Single-variable affine
  guards include signed constants, addition/subtraction and constant multiplication,
  with integer rounding. General nonlinear/correlated reachability stays unsupported.
- Folder imports share a visible-document policy: dotfiles and hidden directories
  are excluded by CLI and Studio. Previously retained hidden documents are preserved
  on folder refresh; missing transport entries cannot silently remove them.
- Partitioned graphs leave names declared in more than one partition unresolved.
  This deliberately also withholds some otherwise locally resolvable edges.
- Request validation, store contention and invalid archive messages identify the
  operation and next action. CLI capture receipts expose partition limitations.
  A user's early workspace choice takes precedence over the automatic landing view.

The final local suite passes **697/697**, the real compiler/backend suite passes
**96/96**, formatting and the private installed-package smoke pass. The full
Chromium sweep passes **110/110** on candidate manifest
`7c7cf9beb2a02dc08777abaa96956aaf76f54da45d72027b0e988bba63d247a7`.
WebKit also passes **110/110**, with the identical candidate manifest. The
[exact validation](../evidence/product-audit/twenty-second-validation.json) records
every journey and the unsuccessful development attempts. A new signed-domain differential run
executes 6,000 programs (5,865 distinct) and 219,140 trials with no false established
result; 22 C006 candidates had no observed violating trial and remain explicitly
unvalidated, not confirmed counterexamples. The 24.8 MB corpus round-trips in one
full parse; the 21 MB corpus round-trips through eight fallback partitions. These
are corpus observations, not universal capacity or timing guarantees.

Focused tests, fresh corpora and unsuccessful development attempts are retained
under `evidence/product-audit/parent-n21-*`. No new score is claimed before the next
independent review.

Native/human screen-reader use remains unverified. Guidepup, browser accessibility
objects, keyboard and axe evidence are distinct. No Firefox, headed browser,
virtual display, desktop change or resource-limit exception is used in this round.
The historical operation-edit incident remains unresolved; passing later journeys
does not retroactively establish its cause. Earlier failures and reviews are retained.
The [previous audit](completion-audit-before-twenty-first-remediation.md) preserves
its exact candidate and validation boundaries.
