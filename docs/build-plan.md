# Pymtheg build plan

Written 10 November 2026. This says **how** the work in
[`mega-plan.md`](mega-plan.md) gets built. It is the manager's working reference.
Building has not started and does not start until Karl says so.

## 1. Roles

| Role | Who | Does | Does not |
|---|---|---|---|
| Manager and coach | The lead session (Claude Fable 5.2) | Cuts chunks, writes briefs, assigns builders and reviewers, guards file ownership, keeps the ledger in section 9, merges passing pull requests, unblocks and coaches builders, reports to Karl | Write feature code |
| Builder | Claude Opus 5.5 at medium effort, or Sol (GPT-6.1 Sol) at medium effort | Builds one chunk in its own worktree, proves it, opens a pull request | Touch files outside the chunk's owned paths; merge; start other agents |
| Reviewers | Two per pull request: one Sol 6.1 (medium) and one Opus 5.5 at high effort, working independently | Each reviews the pull request against its brief and returns pass or changes needed; it is merged only when both pass | Change the branch; widen the scope; score or polish |
| Owner | Karl | Decides scope, answers escalations, can stop anything | — |

Confirmed available on this machine: `claude-opus-5-5` (effort `medium`) and
`gpt-6.1-sol` (reasoning effort `medium`). The repository has a private GitHub
remote (`KarlLivesey/pymtheg`) and `gh` is signed in, so pull requests work.

## 2. The loop for one chunk

1. **Cut.** The manager writes the chunk brief (section 4) and records it in the ledger with its owned paths.
2. **Assign.** A builder is started in a fresh worktree branched from the current `origin/main`.
3. **Build.** The builder works in small loops under `AGENTS.md`, runs the checks in section 6, and opens a pull request when it is satisfied the "done when" is met.
4. **Review.** The manager assigns two independent reviewers, one Sol 6.1 and one Opus 5.5 at high effort (Karl, 11 November 2026). Each builds and tests a disposable checkout of the branch and returns **pass** or **changes needed** with specific findings. Both must pass.
5. **Fix.** Blocking findings go back to the same builder. Each re-check is a new pair of review assignments, repeated until both pass.
6. **Merge.** When both reviewers pass with checks green, the manager merges the pull request on GitHub with a normal merge, deletes the branch, updates the ledger, and tells builders with open chunks to rebase.

Limits that prevent the old review loop returning:

- A review checks four things only: the "done when" is met, the result is correct, the change stayed inside its owned paths, and the tests are meaningful. No ratings, no cosmetic requests.
- No cap on rounds (Karl, 11 November 2026): a pull request merges only when both reviewers say it is fine. If either one says something needs fixing, it goes back to the builder, the fix is pushed, and both reviewers review again. This repeats until both pass. One reviewer passing does not outweigh the other's finding, and the manager does not dismiss a reviewer's "needs fixing". The manager does use judgement on **where** a real finding is fixed (Karl, 11 November 2026): a problem in what this pull request changed is fixed in this pull request before it merges; a real problem the review uncovered that this pull request did not cause, or that lies in something it affects elsewhere, is recorded in the ledger as its own chunk and fixed in a separate pull request, and does not hold this one up. Either way the finding is tracked to a fix, never dropped. Reviewers still raise only blocking findings (wrong result, unmet "done when", out-of-scope edit, meaningless test); optional suggestions stay in the backlog.
- A reviewer's optional suggestions are recorded as backlog, not as conditions.

## 3. Keeping chunks apart

The aim is that two open chunks never edit the same file, so merges are trivial.

**Rule 1: declared ownership.** Every chunk lists the paths it may edit. A path
belongs to at most one open chunk. The ledger is the lock table. A builder that
finds it needs a file it does not own stops and asks the manager.

**Rule 2: new work goes in new files.** New capabilities live in new files or
directories. Existing large files are touched only by small, dedicated wiring
chunks.

**Rule 3: hot files are single-file queues.** These files are edited by many
features, so only one open chunk may hold each at a time, and wiring chunks for
them run one after another:

| Hot file | Why |
|---|---|
| `src/studio/service.ts` (3,606 lines) | Every Studio feature |
| `src/mcp/server.ts`, `src/mcp/workspace.ts` | Every agent tool |
| `src/cli/main.ts`, `src/cli/help.ts` | Every command |
| `src/backends/adapter.ts`, `src/behaviour/model.ts` | All checking |
| `src/architecture/store.ts` | Planning storage |
| `web/src/main.tsx` | All Studio screens |
| `package.json`, `package-lock.json` | Every dependency change |
| `docs/support.md`, `docs/decisions.md`, `docs/mcp.md` | Every contract change |

**Rule 4: dependencies are added once, up front.** One early chunk adds every
new npm dependency a wave needs. No other chunk edits `package.json` or the lock file.

**Rule 5: documentation by fragment.** A chunk that changes a contract or
support level writes `docs/changes/<chunk-id>.md` instead of editing
`support.md` or `decisions.md`. At the end of each wave one ledger chunk folds
the fragments into those two files. This keeps the `AGENTS.md` duty to update
them without making them a conflict point.

**Rule 6: tests in new files.** A chunk adds its own test file. Editing a shared
test file is allowed only if the chunk owns it.

**Rule 7: generated files are regenerated, never merged by hand**
(`docs/report.schema.json`, `web/src/generated/`, `dist/`).

**Rule 8: interfaces first.** When several chunks will build against a shared
interface (the language module interface, the storage boundary, the engine
result shape), one chunk lands the interface alone first. Parallel chunks then
depend on it and do not edit it.

**Rule 9: waves.** Chunks are released in waves. Everything in a wave is
disjoint and can run in parallel. A wave's hot-file wiring chunks run in
sequence at its end.

## 4. What a chunk brief contains

Every brief is self-contained, because the builder knows nothing else.

- **Chunk ID and title**, and the mega-plan item it implements.
- **Goal** in one or two sentences, and what is already known or ruled out.
- **Owned paths** (may edit) and **read-only context** (should read).
- **Done when:** one observable criterion, copied or narrowed from the mega plan.
- **Checks to run** (section 6) and the evidence to save under `evidence/<chunk-id>/`.
- **Out of scope:** the nearest things it must not do.
- **Standing rules:** follow `AGENTS.md`; correctness must not depend on machine speed; an incomplete or unsupported analysis is never a pass; no browser use; no further agents; unique scratch directories, never a shared `/tmp` path.
- **Hand-back:** open a pull request against `main` and end with the pull request URL, head commit and check results.

Size guide: one chunk has one "done when", is roughly half a day of work, and
aims for under about 400 changed lines outside tests. Anything larger is cut again.

## 5. Model assignment

- Builders alternate between Opus 5.5 medium and Sol 6.1 medium so both are exercised.
- Every pull request gets two reviews, one Sol 6.1 and one Opus 5.5 high, whichever model built it.
- Chunks that continue the same area go to the same model where practical, since it already knows that code's shape.
- At most **four** builders run at once. That is a ceiling, not a target: a wave uses only as many as it has genuinely disjoint chunks for.

## 6. Checks

There is no CI in the repository, so checks run locally, by the builder before
the pull request and again by the reviewer.

| Check | Command | When |
|---|---|---|
| Unit tests | `npm test` | Always |
| Formatting | `npm run format:check` | Always |
| Integration tests | `npm run test:backend` | When checking, flows or contracts are touched |
| The chunk's own new tests | named in the brief | Always |
| TLC differential | `node evidence/builtin-checker/differential.mjs` | Stage 2 chunks, until TLC is removed |

A resource-budget timeout in a check is reported as unresolved, never as a pass.
Adding CI is optional and would be its own small chunk.

## 7. Before the first wave

Settled with Karl on 10 November 2026:

1. `AGENTS.md` no longer restricts pushes or delegation. Those restrictions were not Karl's and have been replaced by a pointer to this plan.
2. The planning documents (`docs/mega-plan.md`, this file, and the TLC baseline under `evidence/builtin-checker/`) are committed to `main`, so every worktree starts with them.
3. Pull requests are merged on GitHub with a normal merge, not a squash.

4. At most four builders at once, as a ceiling and not a target.
5. Trial models and scope files are copied to the git-ignored `evidence/project-fit/trial-models/` for use as regression inputs. They are local to this machine and are not committed.
6. The manager decides almost everything itself and reports briefly (section 10).

## 8. Waves

Only the first two waves are fixed here. Later waves are cut when the earlier
ones have landed, because several mega-plan items are still unverified and their
results change how the next chunks are best divided.

### Wave 0: foundations

| Chunk | Mega-plan item | Owned paths | Done when |
|---|---|---|---|
| W0-2 Dependencies for the code graph | Stage 4 libraries | `package.json`, `package-lock.json` | `web-tree-sitter` and the Go, Rust and Lua grammar packages install cleanly, and one script proves each grammar loads and parses a sample file |

W0-2 also settles the unverified question of whether the runtime and grammar
versions pair correctly. If they do not, the manager stops and reports before Wave 1's graph chunks start.

### Wave 1: six disjoint chunks in parallel

| Chunk | Mega-plan item | Owned paths | Done when |
|---|---|---|---|
| W1-A Ownership disagreement | 1.1 | `src/analysis/ownership.ts`, `src/behaviour/flow.ts`, new `test/ownership-agreement.test.mjs` | Both analyses give the same verdict on `examples/workbench/fulfilment.pym` and restic's first model |
| W1-B Built-in engine core | 2.1, 2.2, 2.3 | New `src/behaviour/explore.ts`, `explore-worker.ts`, `explore-runner.ts`, new tests | Exhaustive search and seeded sampler pass unit tests, including a cancellation test with a readiness handshake; not yet wired into any command |
| W1-C Graph store and language interface | 4.0, 4.1 | New `src/graph/**` except `src/graph/languages/*/` | Store, queries and the language module interface exist with a conformance kit and one toy language proving the interface |
| W1-D Document import | 6.1, 6.3 | `src/shared/document-selection.ts`, `src/architecture/import-policy.ts`, `src/cli/import-summary.ts`, new tests | `.rst`, `doc/` and single files import, and exclusions are listed |
| W1-E Machines and contracts in one file | 7.2 | `src/contracts/document.ts`, `src/contracts/implementation-check.ts`, `src/contracts/manifest.ts`, new tests | restic's unsplit model produces a Go check file; a truly unresolved contract still refuses |
| W1-F Two investigations (report only) | 1.2, 1.3 | `evidence/w1-f/` | Written findings on the review-acknowledgement behaviour and the one TLC trace that failed replay |

W1-D needs one function in the hot file `src/architecture/store.ts` (the folder
reader). It holds that file for the wave; no other Wave 1 chunk touches it.

### Wave 2: after Wave 1 merges

| Chunk | Mega-plan item | Owned paths | Depends on |
|---|---|---|---|
| W2-A Switch `verify` and `simulate` to the built-in engines; run the TLC differential | 2.1 proof, 2.8 | `src/backends/adapter.ts`, `src/behaviour/model.ts` | W1-B |
| W2-B Go language module | 4.3 | New `src/graph/languages/go/**` | W1-C |
| W2-C Rust language module | 4.4 | New `src/graph/languages/rust/**` | W1-C |
| W2-D TypeScript and JavaScript language module | 4.2 | New `src/graph/languages/typescript/**` (reads, does not edit, `src/implementation/`) | W1-C |
| W2-E Storage boundary and `.pymtheg/` layout | 3.1–3.4 | New `src/storage/**`, `src/project/workspace.ts`, `src/studio/recovery.ts`, `src/shared/identity-values.ts` | — |
| W2-F Hints | 7.7, 7.8 | `src/semantic/core.ts`, `src/reporting/explain.ts` | — |
| W2-Z Fold documentation fragments | Rule 5 | `docs/support.md`, `docs/decisions.md`, `docs/changes/` | All Wave 1 merged |

### Later waves (outline; cut in detail when reached)

- **Wave 3:** remove TLC and Quint everywhere (a hot-file chunk that runs alone); per-invariant verdicts, reachability, event-path replay and multi-outcome replay on the engine; automatic sync for the graph.
- **Wave 4:** the join; the explore query; requirement and link writing from CLI and MCP; the agent interface redesign. These are hot-file heavy and mostly sequential.
- **Wave 5:** generated behaviour tests per language; cancel cleanup that depends on state; ownership as a value; async and internal contracts; table-row links; imported sections as records; the save/restart pattern.
- **Wave 6:** Lua as the proof of a clean language add; Node pin; clean-machine install; the six-trial rerun from wiped projects.

## 9. Ledger

The manager keeps this table current. It is the single record of who holds which paths.

| Chunk | Status | Builder | Reviewer | Branch | Pull request | Owned paths held |
|---|---|---|---|---|---|---|
| W0-2 Dependencies | merged | Sol 6.1 | Opus 5.5 | `w0-2-graph-dependencies` | [#1](https://github.com/KarlLivesey/pymtheg/pull/1) | `package.json`, `package-lock.json`, `scripts/grammar-check.mjs` |
| W1-A Ownership disagreement | merged | Opus 5.5 | Sol 6.1 | `w1-a-ownership-agreement` | [#5](https://github.com/KarlLivesey/pymtheg/pull/5) | `src/analysis/ownership.ts`, `src/behaviour/flow.ts`, `test/ownership-agreement.test.mjs` |
| W1-B Engine core | merged | Sol 6.1 | Opus 5.5 | `w1-b-engine-core` | [#2](https://github.com/KarlLivesey/pymtheg/pull/2) | `src/behaviour/explore*.ts`, `test/explore*.test.mjs` |
| W1-E Machines and contracts | merged | Opus 5.5 | Sol 6.1 | `w1-e-mixed-file-contracts` | [#3](https://github.com/KarlLivesey/pymtheg/pull/3) | `src/contracts/document.ts`, `implementation-check.ts`, `manifest.ts`, `test/contracts-mixed-file.test.mjs` |
| W2-A Built-in backend wiring | merged (round 1: both reviewers passed) | Sol 6.1 | Sol 6.1 + Opus 5.5 high | `w2-a-builtin-backend` | [#8](https://github.com/KarlLivesey/pymtheg/pull/8) | `src/backends/adapter.ts`, `src/behaviour/model.ts`, `src/behaviour/explore*.ts`, minimal lines in `src/cli/main.ts` and `src/cli/help.ts`, `evidence/builtin-checker/differential.mjs` |
| W2-B Go language module | merged (17 rounds) | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-b-go-module` | [#12](https://github.com/KarlLivesey/pymtheg/pull/12) | `src/graph/languages/go/**`, `test/graph-go*.test.mjs`, `test/fixtures/graph-go/**` |
| W2-C Rust language module | in review (round 7) | Sol 6.1 | Sol 6.1 + Opus 5.5 high | `w2-c-rust-module` | [#13](https://github.com/KarlLivesey/pymtheg/pull/13) | `src/graph/languages/rust/**`, `test/graph-rust*.test.mjs`, `test/fixtures/graph-rust/**` |
| W2-D TypeScript/JavaScript language module | builder narrowing over-failing before round 12 (manager's ruling: wrong cause worse than missing) | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-d-typescript-module` | [#14](https://github.com/KarlLivesey/pymtheg/pull/14) | `src/graph/languages/typescript/**`, `test/graph-typescript*.test.mjs`, `test/fixtures/graph-typescript/**` |
| W2-K Rust toolchain investigation (evidence only) | merged (7 rounds) | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-k-rust-toolchain-investigation` | [#16](https://github.com/KarlLivesey/pymtheg/pull/16) | `evidence/w2-k/**`, `docs/changes/W2-K.md` |
| W2-L Go toolchain investigation (evidence only) | changes needed (after round 1: `go list` runs git; a wrong link on broken code) | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-l-go-toolchain-investigation` | [#17](https://github.com/KarlLivesey/pymtheg/pull/17) | `evidence/w2-l/**`, `docs/changes/W2-L.md` |
| W2-I Graph core speed and kit hardening | merged (round 3: both reviewers passed) | Sol 6.1 | Sol 6.1 + Opus 5.5 high | `w2-i-graph-core-speed` | [#11](https://github.com/KarlLivesey/pymtheg/pull/11) | `src/graph/*.ts` (core only, interface frozen), `test/graph-core*.test.mjs` |
| W2-J Production-discovery test allows real languages (A10) | merged (round 1: both reviewers passed) | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-j-discovery-test` | [#15](https://github.com/KarlLivesey/pymtheg/pull/15) | `test/graph-review.test.mjs` (the A10 test only) |
| W2-G Flow lowering must not change its input (B106) | merged (round 1: both reviewers passed) | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-g-flow-lowering-pure` | [#9](https://github.com/KarlLivesey/pymtheg/pull/9) | `src/behaviour/flow.ts` only (`model.ts` stays with W2-A) |
| W2-H Link baseline versus real review (1.2) | merged (round 2: both reviewers passed; `web/src/PlanEditor.tsx` and `web/src/LinkedTargetComparison.tsx` added to its paths) | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-h-link-baseline` | [#10](https://github.com/KarlLivesey/pymtheg/pull/10) | `src/studio/service.ts`, plus `src/architecture/schema.ts`, `src/architecture/work.ts`, `src/implementation/plan-hash.ts` (taken by the builder without asking; accepted by the manager, no other chunk held them) |
| W1-C Graph store and interface | merged (round 2: both reviewers passed) | Sol 6.1 | Sol 6.1 + Opus 5.5 high | `w1-c-graph-store-interface` | [#7](https://github.com/KarlLivesey/pymtheg/pull/7) | `src/graph/**` except `languages/*/` |
| W1-D Document import | merged (round 3: both reviewers passed) | Sol 6.1 | Sol 6.1 + Opus 5.5 high | `w1-d-document-import` | [#4](https://github.com/KarlLivesey/pymtheg/pull/4) | `src/shared/document-selection.ts`, `src/architecture/import-policy.ts`, `src/cli/import-summary.ts`, `src/architecture/store.ts`; extended on request to `src/architecture/model.ts`, `heading-identities.ts`, `headings.ts` (minimal RST section wiring; no other chunk holds them) |
| W1-F Two investigations | merged (evidence only, merged by the manager without a separate review; the fix chunks get reviewed) | Opus 5.5 | — | `w1-f-investigations` | [#6](https://github.com/KarlLivesey/pymtheg/pull/6) | `evidence/w1-f/` |

Each chunk also owns its own `evidence/<chunk-id>/` folder and `docs/changes/<chunk-id>.md`.

Status values: cut, building, in review (round 1 or 2), changes needed, merged, escalated, dropped.

## 10. Deciding and reporting

The manager is expected to decide nearly everything itself: how to cut chunks,
who builds and reviews, how to resolve a clash, when to narrow or reassign a
chunk, and how to handle a failed assumption. Decisions are recorded in the
ledger or a chunk's change note, not sent to Karl for approval.

Karl is asked only for a major decision the manager cannot work out: one that
changes what the product is or does (a mega-plan decision), loses work, or needs
a removal he has not asked for. Other chunks keep running while it is open.

Reports to Karl are short:

- a few lines of progress when something lands or changes state;
- a brief summary at the end of each wave: what merged, what is next, anything decided on his behalf that he might want to know.

Backlog from reviews (not conditions): W0-2 — the grammar packages declare a `node-gyp-build` install hook; install stays compiler-free only while hooks are not run (`--ignore-scripts`, or npm 12 leaving them unapproved). Never add them to `allowScripts`. Stage 8 clean-machine install must cover this, including older npm that runs hooks by default.

Backlog from W1-E (wiring, hot files, for a later CLI/MCP chunk): `src/cli/main.ts:653-657` plain `scaffold --mode contracts` on a mixed file still prints the machine as omitted and exits 2; saving a contract baseline (`src/cli/main.ts:589`, `src/mcp/server.ts:793`) still counts machines as missing coverage. Both can use the new `isNotContractMaterial` helper.

Environment note: Go is not installed on the build machine (Rust and Java are), so tests that compile emitted Go checks are skipped or fail the same way on `main`. Those results are unresolved, not passed.

Backlog from W1-B review: a worker that never posts `ready` makes the cancellation test hang rather than fail (add a test-level timeout); `explore()` could cross-check indexed misses against an unindexed step as a second guard. For W2-A.

Backlog from W1-A: a cancel handler that *calls* an operation with an already handed-off resource (while another is still owned) is flagged by the static check but not the behavioural check. Strict-side mismatch, predates W1-A; follow-up with the state-dependent cancel cleanup chunk (7.3).

Backlog from W1-A review: runtime ownership validation at invocation boundaries (the declared residual mismatch); keep ownership/lifecycle correlation across static branch joins (conservative `O004` on an idempotent branch model); behavioural preflight should preserve unresolved cancellation settlement summaries. All for the 7.3 chunk.

Wiring backlog from W2-A (hot files): MCP and Studio still select the external engines explicitly at `src/mcp/workspace.ts:185` and `src/studio/service.ts:3392` (legacy tool availability at `service.ts:3207-3208`); switch to the built-in backend in the Wave 3 removal chunk.

Review rule change (Karl, 11 November 2026): every pull request needs one Sol 6.1 review and one Opus 5.5 high review, both passing. PRs 1, 2, 3, 5 and 6 were merged earlier on a single medium review; each gets the missing reviews after the fact, and any finding becomes a fix chunk. Review briefs are kept locally in the git-ignored `evidence/project-fit/review-briefs/`.

Backlog from W2-G: B106 covers two different failures (the pre-run identity check and a real failed replay); give the check its own code in `adapter.ts` in the Wave 3 removal chunk. Observation: two Quint tests stopped on "Explicit checker budget exhausted" on `main` while the machine was busy with other builds, so some existing backend tests depend on machine load; they go when Quint is removed.

Backlog from W1-C review: a grammar `.wasm` kept inside a language folder is not copied to `dist/` by the build, so a language bringing its own grammar file needs a build change; for now grammars come from npm packages (dependency chunk).

Backlog from W1-D review: include patterns such as `.`, `docs/./sub`, `docs//sub` silently match nothing (normalise or reject); error wording at exactly 4096 documents changed. For the import wiring chunk.

Backlog from W1-D round 3 (for the import wiring chunk, W3 import follow-up): RST field lists, line blocks and doctests followed directly by an adornment line become false headings; single-character RST titles are missed; `Generics declared:` parsing now also runs on `.rst`; a symlinked single file is imported under the target's name; `docs/*` also selects nested files (document it); error wording at exactly 4096 documents.

Backlog from W2-A review, for the Wave 3 removal chunk: a worker or engine error in the built-in backend is reported as `incomplete` (exit 2) where an external backend crash is `failed` (exit 3), so a broken run looks like a budget-limited one — give it its own failed state; `--backend`/command combinations (`verify --backend quint`, `simulate --backend tlc`, `--state-budget` silently ignored) disappear with the old backends; plain-text `simulate` output should read as a sampled result, not `complete`; stale text in `evidence/w2-a/compare.mjs`. Explained: TLC state counts exceed built-in counts because the generated TLA+ carries an `eventId` variable no guard or invariant reads; reachable source states are identical.

Backlog from W2-H: `web/src/PlanEditor.tsx:381` shows no "before" version for a link that has only a baseline (UI chunk); `docs/decisions.md:542` and `docs/runtime-map.md:459` describe the old review behaviour (fold in with W2-Z).

From W1-C round 2: core resolution is quadratic (800 files / 8k symbols: about 21 s to index and to re-index unchanged); fixed in W2-I without changing the interface. Note for W2-D: a `tsconfig` that `extends` a file under `node_modules` cannot be captured (never walked).

Backlog from W2-H review: a proposal's link is baselined at the save's base revision, not its `originRevision`; if the two differ a change in between is hidden. For a later planning chunk.

Backlog from W2-G review: in `test/flow-lowering-pure.test.mjs` the "keep the execution assumption" test checks `p.name` where properties have `source`, so half of it is always false (fix in the Wave 3 removal chunk, which holds the behaviour files). Separate small chunk needed: `test/process.test.mjs` "timeout and cancellation terminate group" hung for 32 minutes at 0% CPU under heavy machine load with its middle process left alive; passes alone. A test that can hang is a defect whatever the load.

From W2-B: core test `A10` in `test/graph.test.mjs` asserts production discovery returns no language, so it fails as soon as any real language module exists (affects Go, Rust and TypeScript). Fix: assert `toy` is not offered. The test is in `test/graph-review.test.mjs`, which no chunk held, so it is its own small chunk, W2-J.

Interface additions wanted after the three modules land (one additive chunk, existing modules unaffected): a symbol that spans several files (a Go package; its ID currently depends on one chosen file); a candidate list of one, and "or something outside the project"; a recorded reason for an unresolved link.

From W2-D: "one bad `tsconfig` fails every TS/JS file" turned out NOT to need an interface change (per-file failed results already exist); fixed in W2-D itself.

Backlog from W2-B review: `implements` does not expand type aliases when comparing method signatures (a conservative miss, not a wrong link).

Backlog from W2-C review: a Rust glob import's own link is always unresolved; it could link to its module.

Backlog from W2-D review: TypeScript module augmentation (`declare module "./orig"`) turns imports of that module into candidate sets of the augmentation plus the real module.

Follow-up chunk from W2-H round 2 (cut after the language modules, with the link-writing work of Stage 5): (1) an API edit that drops a stored review baselines those links at the edit's starting revision, which hides a change already reported against the review — use the dropped review or origin revision instead (API-only; the UI cannot drop a review); (2) retargeting a link in the editor draft loses its comparison base (`web/src/PlanEditor.tsx:382`); (3) raw document saves and imports can still add links with no baseline or carry any `linkReviewRevision`; (4) any API client can claim a review by naming a real revision — no server-issued token as source links have; (5) an empty-string `linkReviewRevision` is accepted as no review.

From W2-D round 3, for the interface additions chunk: a module cannot request specific context files discovered during analysis (a `tsconfig` that `extends` `./base.json` — a name outside the context patterns — leaves its files partial).

Backlog from W2-I review: within one indexing run every module's `resolve` is given the same `files`/`symbols`/`links` arrays (nested `data` shared), so a module that mutates them could affect later modules in that run; same on `main` before. Decide whether to copy or freeze, with the interface additions chunk. Known limit, documented: the operation counters do not see a quadratic step written as an index-based loop, `includes` or `indexOf`.

Rule adopted for all language modules (from the W2-B and W2-D reviews, 11 November 2026): a candidate set must be honest about completeness. A closed set contains every possible target. A set that cannot be complete (a type outside the project could be the target, or the receiver's type is unknown) is either unresolved with the known targets kept, or marked open with the reason on the link; it still lists every project target. Carry this into the interface additions chunk as a first-class field. Sharpened after W2-B round 4: "open" excuses only targets outside the project; a set is closed only when provably complete and every member provably possible; a member that is possible but unproven may appear only in an open set; a visibility rule alone (an unexported interface method) does not prove closure when an outside package can import the package and embed an implementer.

Backlog from W2-C round 2: a later inner Rust macro definition blocks lookup of an earlier outer macro before the inner one is active; impl identities omit the where-clause (ordinals distinguish them); `<T as Trait>::f` is looked up through an empty path.

Follow-up chunk from W2-D round 4 (after the interface additions chunk): narrow the TypeScript `incomplete-config` rule. Today a config whose `extends` base cannot be captured (a package preset such as `@tsconfig/node20`, very common) leaves almost every cross-file link unresolved: on BullMQ with such a preset, 32,267 links become `incomplete-config` and non-`contains` resolved links fall 86%. Honest, never wrong, but sparse. Two parts: (1) interface addition so a module can request a base file it discovers; (2) a narrower sound rule — relative specifiers that resolve identically under every resolution mode, with no suffix variant captured, stay definite, as do calls and members through such settled bindings. Also: reason propagation for computed outer calls (`it.each(...)()`).

Backlog from W2-D round 5: AMD modules (`define(function (require, exports, module) {…})`) are not modelled; their `require('./b')` is reported as a call to the local parameter and the import is unresolved (on `requirejs`, 133 of 406 files). Add AMD linking only if a target project needs it.

Backlog from W2-B round 6 (lost resolutions, not wrong ones): `true().M()` with a user-declared `func true() T`; `v := l{}; v.M()` on a function-local struct type; fields of anonymous struct types reached through a range variable.

Backlog from W2-B round 7: values of local types are opaque (`var v lt; v.M()` unresolved; no `references` link from `var y lt`); an exported `type P *a` opens sealed sets though a defined pointer type cannot be embedded; a struct embedding a local defined type over an interface opens an otherwise closed set.

Rule adopted for all language modules (from W2-B round 8): nothing recovered from inside a syntax-error region, or from a declaration whose own header contains one, may support a definite link or a closed candidate set anywhere in the project; such structure is unknown. Agents index working trees mid-edit, so partial files are routine. Check the Rust and TypeScript modules against this. Made exact (manager, W2-D round 7): a declaration's existence and name may be linked when its name token is intact; its recovered structure (members, parameters, return type, heritage, type parameters) may support a definite link only from parts wholly before the first syntax error inside that declaration; anything at or after it is unknown and yields an unresolved link with the would-be target kept. One broken declaration must not degrade unrelated intact ones.

Backlog from W2-C round 3: cross-file use of project `macro_rules!` macros is unresolved (1,056 invocations in Vector); an external glob beside a project glob makes a name uncertain; an inherent `fn f(self)` on a `Copy` type called through `&mut` is filtered out; generic substitution, trait-in-scope precision and custom receiver types are conservative.

Backlog from W2-B round 9: one broken spec in a Go `type ( … )` group makes the intact specs of that group unknown (safe, limited to the group); `func (b) () {}` is accepted as clean by the grammar.

Decision (manager, 11 November 2026, W2-B round 10), for all language modules: when a file is so broken that the parser may have lost declarations, correctness must not depend on recovering them from text. Layer 1, sound and with no scanning: that file's package (or the language's equivalent unit of name scope) is treated as possibly containing unseen declarations — members declared intact stay definite; promoted or otherwise shadowable lookups, names that resolve outside the unit, and completeness of any set those types could join become uncertain. Layer 2, precision only: recovered names may add candidates, keep IDs stable and produce diagnostics, but never make a link definite or a set closed, and never take an intact symbol's ID.

Follow-up chunk (after the language modules merge): sharpen the lossy-file base rule for Go. Measured on restic, one mid-edit file costs its package 100-966 resolved links (e.g. a struct truncated at the end of a file in `internal/restic` loses 100 `implements` links because an unseen declaration could shadow a predeclared type named in a signature). Sound but blunt.

For the Go lossy-rule follow-up chunk, the three sharpenings a reviewer named (all decidable from the tree): treat a name as possibly unseen only if it appears as an identifier inside a lossy region; apply the same bound to promoted-member shadowing; allow a one-candidate open set so a reference to a swallowed type is "possibly this".

From W2-B round 12, for the lossy-rule sharpening chunk: Go name-only `receiver-type-unknown` candidate sets with a member in a lossy package do not list `declarations-may-be-unseen` as a second reason (26 sets on the broken restic variant). Reason only; targets and openness are right. Also noted: an `import` after another declaration is accepted without making the file lossy (meaning intact).

Backlog from W2-B round 12: a Go file under a build constraint whose package name conflicts with the directory's unconstrained files is not detected as a conflict (needs constraint evaluation to tell `ignore` from a real tag).

Backlog from W2-B round 13: Go build constraints that are equivalent but spelled differently (`a && b` vs `b && a`, `// +build`) are not compared; `exclude` of the main module's required version is ignored; in a lossy package the same `q.S` written twice becomes unknown when `S` is unseen (precision only); a two-name directory's import is unresolved where an open set of the two packages would say more.

Follow-up for the lossy-rule sharpening chunk, from W2-D round 10: the TypeScript open-scope rule is sound but costly when one file is broken. On BullMQ one syntax error in `class Job` withholds 2,030 links, 1,618 of them names imported through barrels that `export *` from the broken file (only names another `export *` could also supply can really be shadowed). On requirejs one broken script withholds 407 calls to script-declared globals. Errors that lose no text (a legacy octal literal `0777`) open a file needlessly. Sharpen all three.

Decision D16 (Karl, 11 November 2026), amending D8: a language's own default build chain may be required to index it. Consequences for the build:

- The hand-written Go and Rust modules (W2-B, W2-C) become the no-toolchain fallback. They stay sound and stop chasing precision: mega-plan Stage 4 only ever asked for structure-level accuracy there (direct calls and imports definite; calls through interfaces, traits, generics and macros may be candidates or unresolved). Where review keeps finding wrong definite links in a hard area, the area is downgraded to candidates with the would-be target kept, not re-proved. First application: Go `implements` links and closed dispatch sets (type identity).
- Precision for Go and Rust comes from new chunks that ask the language's own toolchain: W2-K investigation (Rust: what `cargo`/`rustc` alone can supply, and what `rust-analyzer` adds if present), then a Go chunk using the `go` toolchain's standard-library type checker (blocked until Go is installed on the build machine), then the Rust equivalent. Tools outside the default build chain (`rust-analyzer`, `gopls`) are optional extras unless Karl says otherwise.
- Mega-plan line "Considered and not used: … rust-analyzer (need language toolchains)" is superseded by D16; fold into the docs chunk (W2-Z).

Broken-file policy for TypeScript (manager, W2-D round 10): an unseen declaration in any broken file can merge into or augment almost anything in a TypeScript program, so per-link proof either withholds most of the graph or needs hand-written propagation. Policy: links directly touching unreadable text are withheld (`partial-declaration`, target kept); every other link in a program that contains a partial file is reported as the compiler resolved it and carries the assumption `no-unseen-declarations`. Idea for the sharpening chunk: an unseen declaration can only introduce names that occur as identifier tokens in the unreadable text, so a link whose names do not occur there can be proven unaffected and lose the flag.

Rule from Karl (11 November 2026), for all language modules — supersedes the "would-be target kept" outcome for syntax errors and the W2-D round 7 "name linkable when the name token is intact" form: unreadable code is invalid code, and invalid code has failed. A declaration that contains a syntax error is not a link target. A link whose site lies in unreadable text, or whose target would be an invalid declaration or something reached through one, is FAILED: recorded `unresolved` with reason `invalid-code`, the name kept, and no target, candidate or would-be target. "Probably this, unverified" with the target named is reserved for valid code whose resolution needs information the module lacks. Granularity, settled by Karl the same day ("the target is the file and the file is invalid so what target?"): the unit is the FILE. A file with any syntax error is reported failed and contributes no symbols and no links; a link from a valid file into it is failed. All machinery for salvaging broken files (lexical recovery, untrusted spans, open member lists, per-declaration trust) is deleted from the three modules. What remains is the sound base: a failed file's package, crate or program may contain unseen declarations. For the interface additions chunk: make "failed" a first-class link outcome.

Also from Karl (11 November 2026): a failed link says why — "these imports are broken because the file they import is broken". Each `invalid-code` link records the failed file(s) that caused it (`data.cause`), as a cause, never as a target. Wiring backlog for the CLI, MCP and Studio: say that a file is broken, and on a failed link that it failed because that file is broken. Karl: that is the most these surfaces need to do; no further breakdown or impact view.

From W2-B round 14, for the sharpening chunk: (1) in a Go package with a failed file, builtin calls such as `len` are reported `invalid-code` because the failed file might declare the name; an assumption flag (as TypeScript's `no-unseen-declarations`) would say more. (2) The tree-sitter Go grammar rejects some valid Go (restic `status_test.go`: a user-declared `new(…)`), which now fails the whole file; keep a list of such constructs per language and decide whether to patch, work round or accept.

From W2-B round 14. For the interface additions chunk: the core re-parses a failed file on every index (`src/graph/indexer.ts:184-190`), so a project with a broken file is never an all-unchanged re-index; store failed results like any other. For the Go toolchain chunk: the tree-sitter Go grammar accepts some text the compiler rejects (`func F(a int, string) {}`, `go func(){}` with no call, `defer 1`, `"abc\q"`, `package _`); the toolchain's own parser becomes the authority on what is a syntax error. Rule adopted for all modules: a failed-file cause propagates — a link that depends on a lookup ending in `invalid-code` is itself `invalid-code` with the same cause, never a fallback candidate set.

Backlog from W2-D round 11: JavaScript early errors that the TypeScript compiler suppresses for JS files without `checkJs` (`let let = 1`, top-level `return`) leave the file clean although Node rejects it.

Ruling for the no-toolchain modules (manager, W2-B round 15): links are required to be right for code that compiles. A definite link on an expression the language's type checker rejects is outside the contract; the modules are not type checkers. A wrong definite link in a program the compiler accepts is always blocking.

Backlog from W2-B round 15 (for the sharpening chunk or the Go toolchain chunk): methods declared in valid files on a type from a failed file are over-failed (18 links on the broken restic variant; in any compiling program they can only be those methods); cross-package pointer-alias embedding and methods declared on a pointer-alias receiver stay unresolved though Go accepts them; three internal lookups still bypass the single scope lookup (no wrong output found); the grammar accepts `for i := 0; i < 3; i++` followed by a newline before `{`.

For the interface additions chunk (from W2-C round 6): the core serializes a whole module's analysis as one string in `SqliteGraphStore.replaceAnalysis` (`src/graph/store.ts`), which hits V8's string-size limit on a large enough project; write it in pieces. Rule for all modules: would-be target lists are capped (a count and a reason when over the cap, never a truncated list).

Ruling for all modules (manager, W2-B round 16): for links that are not resolved, a wrong cause is worse than a missing one. `invalid-code` is asserted only when dependence on a failed file is certain; otherwise the link stays plain unresolved. Backlog: Go's `declarations-may-be-unseen` reason is applied to every set an exported-method interface could gain a member for, though the failed file's package cannot reach most of them (all 1,117 newly marked restic sets).

W2-K result (merged 12 November 2026, `docs/changes/W2-K.md`, `evidence/w2-k/`). Measured on three crates of Vector: stable `cargo` + `rustc` alone give an exact callee location for 73.2% / 92.3% / 99.3% of method calls (dev + test builds with dependency IR); of the calls that target the project's own code they reach 90/125, 60/60 and 14/14, the misses being code behind an unbuilt feature and generic code never instantiated; a crate that does not compile gets nothing; calls only (no imports, type references or `implements`). rust-analyzer reaches the rest but is not in the default build chain, matches no real build configuration (`test` + `miri` + `debug_assertions`), and gives wrong links with exit 0 when project code is not run or dependencies are missing. Both routes run build scripts and proc macros. Every link from either route is true only for a named build configuration. Recommended: layered — hand-written module underneath, stable IR tier for crates that compile, rust-analyzer on top where installed. OPEN OWNER DECISION: may indexing run a project's build scripts and proc macros (W1-C forbids executing project code today)? Backlog from the last review: have `probe-cfg.sh` write the schema line itself; note that `cargo miri test` has the same cfg set.

From W2-C round 6: all 11 Vector files that the tree-sitter Rust grammar rejects are VALID Rust (accepted by rustc's parser). Under the whole-file rule they fail outright: 485 symbols and 6,726 source links gone, on a healthy project. With restic's one such Go file this makes grammar gaps a real cost of the rule. Follow-up chunk (after the modules merge): list the rejected constructs per language, check whether a newer grammar release parses them, and decide between upgrading, patching queries, or (where the language's toolchain is present) letting its own parser decide whether a file is valid. Wording for the surfaces: a file our parser cannot read must be reported as "could not be parsed by Pymtheg", not as "broken", unless the language's own parser agrees. The narrowing's cost on Vector: definite links 116,400 → 72,565; 40,885 of the withdrawn calls keep a single would-be target.

W2-B merged 12 November 2026 (module version 20). Backlog from the final reviews, for the sharpening chunk: add a regression test that an anonymous struct type term follows only its embedded fields (`type W = struct{ F p.T; bytes.Buffer }`, `w.Write(nil)` must stay plain unresolved; breaking the guard survives the suite); add the alias-map control (`type MT = map[p.T]time.Time`, range value) to the suite; name-only sets drop failed-file members without carrying `declarations-may-be-unseen`; a first error the grammar accepts (missing `,` before a newline) puts the diagnostic range on a later error.

Grammar gaps found so far (for the follow-up chunk). Rust (tree-sitter-rust 0.24.0), valid code rejected: `&raw` where `raw` is an ordinary variable (6 of Vector's 11 failed files); an attribute on a function parameter; `#[cfg]` on a struct-pattern field (2 files); turbofish on a function named like a primitive (`char::<_, E>(…)`); `impl A + for<'a> B<'a>`; `unsafe extern "C" { … }` (required by edition 2024). Go (tree-sitter-go 0.25.0): a user-declared `new(…)`. Other Rust backlog from W2-C round 6: cross-crate glob re-exports unresolved; children of a failed module file become loose files with no cause; name-only hints on std paths; std macros treated as possible item generators (33,085 withdrawals on Vector).
