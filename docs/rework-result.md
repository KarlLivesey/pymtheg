> Historical intermediate review. The reopened work is assessed in [the completion review](completion-review.md); the findings and counts below are preserved as earlier evidence.

# Rework result: useful paths added, readiness still open

The previous 9.5/10 product rating remains withdrawn. No replacement score is
assigned. This pass implemented concrete workflows and found defects that the
previous review missed; that is evidence for those workflows, not proof that the
whole product is good enough.

## What now works

- **Agent-facing MCP:** local stdio server, modern and legacy clients, root-confined
  source reads, checks of unsaved buffers, paged findings/properties/costs, real
  simulation/verification, source-mapped trace steps and cancellation.
- **Source scaffolds:** TypeScript records, tagged unions, resource interfaces and
  function signatures with empty bodies. Contracts come from the typed model.
  Unknown-dependent declarations are omitted explicitly. No business logic or
  fake return value is generated. Scaffolds remain unfinished application code.
- **Clearer findings:** problem, why it matters, what to consider next, source
  context, related declarations and a plain-language evidence explanation.
  Studio and MCP share this presentation.
- **More understandable state:** unresolved checks do not produce a green
  “Completed” design badge. Sampled results, finite checks and failures remain
  distinguishable. Old snapshots stay identified.
- **Relationships:** a bounded interactive dependency map uses actual IR edges;
  selecting a component shows its consumers and dependencies.
- **Purposeful trace navigation:** the failing condition is visible, with a direct
  jump to the failing step and original source.
- **Connection setup:** Studio's Connect agent dialog supplies this installation's
  actual MCP command/configuration, without installing it into another app.

## Evidence

The final checks used one completed build; tests did not rebuild files underneath
other test processes. Correctness uses protocol responses, source findings,
readiness signals and controlled cancellation, not tight timing assertions.

| Check | Observed result |
|---|---|
| `npm run build` | Core and web typechecks, production assets built |
| `node --test test/*.test.mjs` | 97 passed, 0 failed, 0 skipped |
| `node --test test/*.integration.mjs` | 35 passed, 0 failed, 0 skipped |
| `node scripts/gui-check.mjs` | Four bounded browser suites passed |
| Automated accessibility | No violations in workspace, Structure, Scenario, Guide or Connect agent scans |
| Installed package MCP smoke | Found hoisted Quint; checked source; emitted empty scaffold; found a real simulated assertion violation |

Logs: [`evidence/rework`](../evidence/rework). The same folder contains the
[generated scaffold](../evidence/rework/library-scaffold.ts),
[finding explanation](../evidence/rework/finding-explanation.png) and
[dependency view](../evidence/rework/checked-design.png).
Setup and protocol limits: [`mcp.md`](mcp.md).

The tests found and led to fixes for: a development-only Quint path, BigInt trace
comparison, stutter/event alignment, invalid/escaped MCP input handling, and
insufficient contrast in previously unscanned Structure labels. Historical test
results are preserved; earlier coverage should not be read as covering these
new cases.

## Substantial work still open

1. **Scenario authoring still exposes JSON.** A guided input/domain editor needs
   clear data shapes, assumptions, validation and understandable scope choices.
2. **Durable authoring and run history are limited.** Buffers and history do not
   provide robust recovery across browser/server restarts. This needs an explicit
   storage/conflict/privacy design before claiming a dependable daily workbench.
3. **Large-design investigation remains shallow.** The dependency view is useful
   locally, but cross-flow exploration, evidence filtering and comparison need
   fuller workflows with larger independently authored designs.
4. **Clarity coverage is incomplete.** Common findings have explanations; less
   common diagnostics still fall back to general guidance. That is not enough
   to claim every result is easy to understand.
5. **Scaffolding is a bounded first target.** It emits TypeScript and empty
   bodies; ownership/effects/preconditions are documentation obligations. It
   neither implements nor verifies application code.
6. **Usability has not been independently established.** Automated mechanics and
   accessibility scans are useful, but they cannot establish that an unfamiliar
   person can model and investigate a real program easily.

These are product gaps, not cosmetic deductions from an assumed 9.5 score.
The next work should address guided scenario authoring and dependable recovery,
then repeat end-to-end modelling with an unfamiliar real design. No publishing,
remote push or automatic changes to agent configuration were performed.
