# W1-A: ownership and behavioural checks agree on cancel cleanup

**Root cause.** The two checks applied the cancel-handler contract in
`docs/support.md` differently: "handler resource transitions are conditional on
acquisition and caller ownership". Flow exploration (`src/behaviour/flow.ts`)
skipped a handler transition only when the resource was not yet acquired. A
transition on a resource that had been transferred, settled by contract, or
borrowed was reported as a violation. The ownership analysis
(`src/analysis/ownership.ts`) skipped the handler when nothing was owned, but
reported `O003`/`O005` for transferred or borrowed resources when some other
resource was still owned.

**Which was wrong.** Mainly flow exploration, which gave false violations on
`examples/workbench/fulfilment.pym` and on the restic trial's
`backup-publication.v1-take-unlock.pym`. The ownership analysis was partly
wrong in the mixed case.

**Behaviour change.** In both checks, a cancel-handler `transition` on a
resource the flow does not own (borrowed, or already transferred) is skipped.
Handler cleanup of a resource the flow still owns is checked as before.
Handler calls that pass an already-transferred resource still disagree
(the ownership analysis is stricter); see `evidence/w1-a/diagnosis.md`.

No support level changes. The `docs/support.md` contract is unchanged, and
both checks now implement it.
