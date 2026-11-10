# Eleventh review remediation

The frozen candidate scored about 8.4 overall, with no 9.5 area. Its 2,240-file
manifest remains unchanged. Main-workspace self-audit changes after that freeze
are separately recorded in `post-eleventh-freeze-self-audit.md`.

## E11-1: source attention cannot fail globally

Plan attention is not one all-or-nothing whole-project proof. Capture the actual
linked roots in bounded batches, each with one canonical typed IR and frozen
snapshot. Imports belong to the root's closure and are loaded once per batch.
Missing roots are recorded explicitly. A failed batch is split until failures
are localized; unrelated plans keep their useful results. Cancellation stops
new batches and propagates rather than creating a successful empty result.

The merged attention view retains each source entry's snapshot identity. If
captures disagree on a file's hash, or it changes before final publication,
that file becomes unavailable for this view; affected plans receive uncertainty.
This avoids presenting a mixed-version catalogue as a single verified snapshot.
No persistent store writes occur during attention checks.

Batching is for transient source attention only. Individual plan saves retain
explicit selection/review validation and atomic architecture publication. Limit
failures stay local and explicit, and the byte budget cannot erase already
collected findings for unrelated plans.

## Implemented source and rolling-import corrections

E11-2 returns a plan-specific comparison, or explicitly says there is no baseline.
E11-3 stores durable selected-declaration/dependency witnesses in recovered forms;
unrelated source captures cannot expire the selection. Refresh and review are
separate actions. Their focused service/MCP and two GUI regressions pass.

E11-4 decision: keep-both never retargets existing links. A linked local fork
also depends on the tracked upstream document for relationship review. Attention
reports a new/missing/changed upstream copy since that plan's link-review
revision, with the retained upstream path available to inspect. Reviewing the
relationship acknowledges this divergence only until the next upstream change;
it does not merge text or refresh evidence. Document-level comparison is
deliberately conservative when an exact corresponding section is unavailable.

E11-4 focused service and GUI checks pass. E11-6 revalidates source whenever it
opens; clean buffers reload and dirty conflicts retain both versions. Its GUI
journey passes. These results do not constitute a new independent rating.

## Acceptance status before the next independent review

- E11-5: source-link repair with explicit comparison passes its service/GUI checks.
- E11-7/8/9: compiler-check generation, naming and portable IDs pass real compiler and CLI/MCP/GUI checks.
- E11-10/11: dependency routes, internal search-text removal, wording and newcomer diagnostics have focused checks. Informational repetition remains visible without becoming an optimization warning.

Consolidation passes 410 local tests, 74 real integrations, all 63 registered GUI
journeys, formatting and private installed-package smoke. See
`evidence/product-audit/post-eleventh-validation.json`. These are implementation
acceptance results, not a replacement independent rating. The whole-product
review remains open.

Each change needs focused failing examples and inspected evidence before another
whole-product review. Test counts alone do not establish the required score.

E11-5 decision: replacement suggestions are advisory, never new identities. Match
a missing declaration's retained normalized form with only its top-level name
removed, or offer the same name/kind at another path. Do not ignore referenced
types, parameter names, bodies or effects. Show both sources before an explicit
replacement. Search is limited to the captured catalogue and reports its scope;
large projects can select the new file. Saving validates the replacement's exact
source/dependency witness and preserves every unrelated link's expectation.

E11-7 implementation: generate a separate compiler-check file referencing the user's
implementation type and generated contracts. Configuration names the contracts
module, implementation module/type and target. TypeScript uses the existing exact
input helper; Go emits its interface assertion; Rust imposes the trait bound.
These are compile-time checks with no business logic. The generated file must be
included in the user's ordinary build. Generation is refused for incomplete
contracts and unsupported output plugins; no compiler pass is invented.
