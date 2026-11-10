# Current completion audit — twenty-third review pending

The twenty-second independent review rates its frozen candidate **about 9.4 overall**.
Architecture/planning/history, Blocks and outputs/contracts/plugins reach 9.5 on that
candidate. These grades do not certify the repairs being validated below.
[Independent report](../evidence/product-audit/claude-architecture-twenty-second-review.md).

| Area | Twenty-second score |
|---|---:|
| Semantics and honest evidence | 9.2 |
| Architecture, planning and history | 9.5 |
| Blocks | 9.5 |
| Plan/code graphs | 9.3 |
| Agent MCP | 9.4 |
| Outputs, contracts and plugins | 9.5 |
| Recovery and concurrency | 9.4 |
| Scale | 9.3 |
| Accessibility and cross-browser | 9.3 |

## Repairs being validated

- Capture has an IPC-connected supervisor whose event loop never parses source.
  It reaps the parser and removes the private transfer directory on owner loss,
  including SIGKILL, SIGHUP and owner death while reading completed output. Startup
  cleanup removes marked transfers only when their owner is demonstrably dead.
  Unknown legacy or active directories are preserved. Capture has deterministic
  source/work/heap limits and cancellation, without a fixed wall-clock refusal.
- Contract findings can replay bounded source examples through the existing typed
  executor. A matching call and required condition become C004 with source inputs,
  explicit assumptions and source_replayed evidence. Unconfirmed candidates and
  unrepresented paths retain C006/C009 qualification. A different earlier failure
  cannot confirm a later call or a different condition. Example execution never
  establishes universal safety or adapter conformance.
- Unresolved symbol keys, mutable callable bindings, callback parameters and dynamic
  function choices do not borrow a compatible signature's declaration. Partition
  ambiguity includes owner-qualified method names. Reader v7 and partition v3 keep
  the changed observation identity explicit; historical observations stay readable.
- HTTP request, page and quota errors give appropriate status and concise guidance.
  Workspace navigation has separate, explicit destinations; automatic landing cannot
  turn an Architecture click into a request to leave. Connections expose record titles
  separately from stable IDs.

The final local suite passes **706/706**, the real compiler/backend suite passes
**96/96**, and formatting and the installed private-package smoke pass. The signed
call differential runs 6,000 programs/218,052 trials with no false established or
unconfirmed C004; all 1,726 reported source replays re-execute correctly. The only
C009 program without C004 in that sample is unreachable. A separate 720-program,
9,360-trial return differential has no false established result or invalid replay.
The final full/partition graph comparison on 3,059 real files has no invented or
differing resolved targets and no declaration mismatch. Both real corpora round-trip,
including a deliberately CPU-restricted 24.8 MB capture without a clock cutoff.
These are observations on bounded corpora and samples, not universal guarantees.

Evidence is retained under `evidence/product-audit/parent-n22-*`, including unsuccessful
development attempts. All **110/110 Chromium** and **110/110 WebKit** journeys pass on the identical final
candidate manifest `505375476fa344709ff8ef4721cf4fd2298291d8ccb6d8aa976d29a9f2cac476`.
[Exact validation](../evidence/product-audit/twenty-third-validation.json) retains
per-journey diagnostics and unsuccessful attempts. No new score is claimed.
Native/human screen-reader use remains unverified. No Firefox, headed browser,
virtual display, desktop change or resource-limit exception is used in this round.
The original historical operation-edit incident remains unresolved.
The [previous audit](completion-audit-before-twenty-second-remediation.md) preserves
its exact candidate and validation boundaries.
