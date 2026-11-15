# Five complete modelling journeys

All commands run locally after `npm run build`. Use the same files in Studio;
check, inspect the cited view, edit a buffer, rerun, then save. Deliberately bad
examples return exit 1; holes/unsupported requested claims return exit 2. That is
useful output, not an installation failure.

| Domain | Start and inspect | Refine and recheck | Evidence boundary |
|---|---|---|---|
| Pure algorithm | `check examples/mvp/algorithm.pym`: Work shows `N * N`, maximum 40,000 comparisons; Findings identifies independent rule copies | Replace a copied policy body with a call to the authoritative named rule, or reuse that rule at callers; the copy warning disappears without removing intended work | Annotated comparisons; no universal complexity inference |
| File-processing CLI | `check examples/mvp/files-buggy.pym`: follow the unclosed error exit and cancellation obligations | `check examples/mvp/files-fixed.pym`: success/error/cancellation settle the owned file; model parse failure before writing adapters | Conservative single-owner resource subset; no actual file IO from specifications |
| Background worker | `simulate examples/mvp/task-protocol.pym --entry retryJob --max-steps 30`: Trace separates submit/perform/lost ack/response/retry | Select `cautiousJob`: propagate unknown knowledge instead of blindly retrying. Use Verify for exhaustive finite safety | One shared finite provider, two attempts; no progress proof |
| Checkout/quotation | `check examples/mvp/checkout.pym`: Work shows 600 calls against budget 500, and payment reconciliation is unresolved. `simulate examples/mvp/checkout-double-charge.pym --entry Checkout --max-steps 12` shows capture uncertainty | Compare `checkout-stock-leak.pym`, `checkout-missing-refund.pym`, then `checkout-fixed.pym`; Trace identifies reservation/capture/cancellation effects. `checkout-late.pym` exposes compensation and late-effect decisions | Explicit finite checkout protocol, not production payments; unknown quote/payment decisions stay visible |
| Library lending | `emit examples/mvp/library.pym --entry lend --target json --scope examples/mvp/library.scope.json --out /tmp/library-model.json`, then `simulate` with the same entry/scope | Remove suspended/quota guards in a buffer: the assertion finds a forbidden loan. Restore guards and run Verify | Different domain: records, list cardinalities, pure reusable eligibility, tagged rejection outcomes |

`verify` and `simulate` use the built-in engines in the CLI, Studio and MCP.
No downloads happen implicitly.
Current version/scopes and validation commands are in `evidence/`.
