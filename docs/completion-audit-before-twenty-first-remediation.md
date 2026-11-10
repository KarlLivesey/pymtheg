# Current completion audit — twenty-first review pending

The twentieth independent review rates its frozen candidate **about 9.2 overall**.
Outputs/contracts/plugins and recovery/concurrency reach 9.5; seven areas remain
below the target. These grades do not certify the repairs in progress below.
[Independent report](../evidence/product-audit/claude-architecture-twentieth-review.md).

| Area | Twentieth score |
|---|---:|
| Semantics and honest evidence | 9.0 |
| Architecture, planning and history | 9.4 |
| Blocks | 9.4 |
| Plan/code graphs | 9.3 |
| Agent MCP | 9.2 |
| Outputs, contracts and plugins | 9.5 |
| Recovery and concurrency | 9.5 |
| Scale | 9.0 |
| Accessibility and cross-browser | 8.9 |

## Repairs after the twentieth review

- Constant-folded negative bounds refine guards, assertions, aliases and caller
  rules in either orientation. Boolean comparisons and supported disjunctions
  retain conservative facts. C006 messages retain original argument positions.
- Infeasible assertions emit located C008 findings with unresolved feasibility and
  assumption provenance. Upper-bound budget excesses no longer claim complete
  executable counterexamples; they still fail acceptance.
- Code comparisons expose fileHash separately from declarationHash/bodyHash. The
  source finder stays open for many-to-many linking. Omission and race messages
  describe the actual operation.
- Every registered browser journey can select Chromium or WebKit. The controller
  retains page/crash/console information, cached DOM, pending requests and observed
  event-loop delays. File-chooser interception starts before keyboard input.
- A bounded sequential partition fallback combines large code captures in one
  version and graph. Relationships between partitions remain explicitly unknown.
  Optional compressed code parts preserve existing byte/graph/archive quotas,
  bounded decompression and legacy readers.

The final candidate passes **686 local tests, 96 real compiler/backend tests, all
110 registered Chromium journeys and all 110 registered WebKit journeys**, with
formatting and the private installed-package smoke passing. Every final browser
group matches candidate manifest
`50a38deb32d40c273f86cec2fdb2bb2ad61c3519910d2e06a402a1ade616bffb`.
[Exact validation and retained unsuccessful attempts](../evidence/product-audit/twenty-first-validation.json).

The real 23,190,539-byte, 1,453-file corpus captures in one version, exports/imports
and pages through the production query worker. The separate 12.3 MB minified set
does too. Aggregate expansion is checked before any decompression. These are
corpus-specific observations, not universal capacity or timing promises.

The wider WebKit run found a real source-refresh issue: CLI and native folder
uploads disagreed about private/generated exclusion metadata. Normalisation now
prevents those audit-only differences from creating revisions, preserving legacy
bytes on no-op refresh. Real source relocation and document changes stay visible.
The final full sweeps include that repair.

The old operation-edit startup failure remains historically unresolved; the old
log lacks diagnostics. Fresh instrumented Chromium and WebKit journeys pass.
The report-import race is independently reproduced as late chooser interception;
its test is repaired without changing product behavior. Neither historical failure
is erased or retroactively called a pass.

Unsuccessful development groups are retained. WebKit uses the same WCAG rules in
single-page axe mode with an exact one-frame assertion, explicit context cleanup
and one software-rendering thread. Shared resource limits are unchanged. A native
WPE abort and an earlier inconclusive simulation are recorded; passing later
checks does not establish their original causes. The lifecycle restart test now
waits for acknowledgement of its actual final edited field.

Native/human screen-reader use remains unverified. Guidepup, browser-tree, axe and
keyboard evidence are separate from that. No Firefox, headed browser, virtual
display, desktop change or resource-limit exception is used in this round.

No replacement score or overall 9.5 sign-off is claimed. The previous audit is
[preserved](completion-audit-before-twentieth-remediation.md), together with every
independent report and earlier unsuccessful attempt.
