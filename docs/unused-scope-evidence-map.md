# Keep source counterexamples when a scope entry is unused

Sixteenth review N5 found that `flowGraph` discarded a fully constructed graph
when a result-scope entry was unused. A precondition failure can prevent that
operation from returning, so the very failure being investigated made the
scope entry unused and hid its counterexample.

## Contract

- Continue to reject unknown scope settings, invalid used values, resource-limit
  exhaustion and unused entries on graphs with no source violation.
- If a completed finite graph contains a source violation, retain it and attach
  every unused entry as a configuration issue. Do not remove the unused keys from
  the recorded scope or pretend they constrained execution.
- The usual backend and source replay must still produce/validate the witness.
  A known graph error alone does not fabricate a backend counterexample.
- Report the scope issues separately. A witnessed violated property remains a
  complete source-replayed counterexample. Other property results with scope
  issues remain inconclusive, including a sampled run that has not reached the
  failure. The aggregate cannot become a pass.
- Model identity includes the retained graph and its issues. Plain model emission
  refuses an invalid scope, since emitting an artifact is not a counterexample
  exploration. Keep CLI/MCP/Studio result meaning aligned.

## Probes

Use `mk ensures result > 5`, then a derived negative argument to `need requires
v > 0`, with explicit `mk` and `need` results. Confirm need's unused results do
not hide the call-contract witness in Quint or TLC. Test a short sampled run,
a corrected source, a typo-only safe scope, and invalid used values. Preserve
all assumptions, unused-key messages, source paths and requested bounds.

## Verified first boundary

The original failure is retained in `parent-unused-scope-before.txt`. The source
replay/graph tests pass, and six real Quint/TLC/emission checks pass in
`parent-unused-scope-real-final.txt`. MCP and the Studio scenario/trace journey
also pass. A short sampled run reports incomplete results, never a pass; model
emission with the invalid scope produces no artifact.

The first two corrected fixtures accidentally depended on local propagation of
abstract result facts, which remains the separate N9 gap. Their backend safety
checks passed but the aggregate correctly stayed incomplete. Those failed
expectations are retained; the final control calls `need(1)` so its aggregate
pass tests scope handling independently of N9.
