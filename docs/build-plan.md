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
| W2-B Go language module | changes needed (after round 1; both reviewers: wrong definite links and candidate sets missing the true target); merge also waits for the A10 test fix | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-b-go-module` | [#12](https://github.com/KarlLivesey/pymtheg/pull/12) | `src/graph/languages/go/**`, `test/graph-go*.test.mjs`, `test/fixtures/graph-go/**` |
| W2-C Rust language module | changes needed (after round 1; both reviewers: wrong definite links, a candidate set missing its target, silent rule failures, quadratic resolver); merge also waits for the A10 test fix and a whole-Vector run after W2-I merges | Sol 6.1 | Sol 6.1 + Opus 5.5 high | `w2-c-rust-module` | [#13](https://github.com/KarlLivesey/pymtheg/pull/13) | `src/graph/languages/rust/**`, `test/graph-rust*.test.mjs`, `test/fixtures/graph-rust/**` |
| W2-D TypeScript/JavaScript language module | pull request open; reviews queued to limit machine load; merge waits for the A10 test fix | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-d-typescript-module` | [#14](https://github.com/KarlLivesey/pymtheg/pull/14) | `src/graph/languages/typescript/**`, `test/graph-typescript*.test.mjs`, `test/fixtures/graph-typescript/**` |
| W2-I Graph core speed and kit hardening | changes needed (after round 1; both reviewers: kit edit breaks shebang files, scaling test gaps; core logic confirmed correct) | Sol 6.1 | Sol 6.1 + Opus 5.5 high | `w2-i-graph-core-speed` | [#11](https://github.com/KarlLivesey/pymtheg/pull/11) | `src/graph/*.ts` (core only, interface frozen), `test/graph-core*.test.mjs` |
| W2-J Production-discovery test allows real languages (A10) | merged (round 1: both reviewers passed) | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-j-discovery-test` | [#15](https://github.com/KarlLivesey/pymtheg/pull/15) | `test/graph-review.test.mjs` (the A10 test only) |
| W2-G Flow lowering must not change its input (B106) | merged (round 1: both reviewers passed) | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-g-flow-lowering-pure` | [#9](https://github.com/KarlLivesey/pymtheg/pull/9) | `src/behaviour/flow.ts` only (`model.ts` stays with W2-A) |
| W2-H Link baseline versus real review (1.2) | changes needed (after round 1; both reviewers; `web/src/PlanEditor.tsx` added to its paths) | Opus 5.5 | Sol 6.1 + Opus 5.5 high | `w2-h-link-baseline` | [#10](https://github.com/KarlLivesey/pymtheg/pull/10) | `src/studio/service.ts`, plus `src/architecture/schema.ts`, `src/architecture/work.ts`, `src/implementation/plan-hash.ts` (taken by the builder without asking; accepted by the manager, no other chunk held them) |
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

From W2-D, for the interface additions chunk: a per-project analysis error (one bad `tsconfig` currently fails every TS/JS file in the repository).

Backlog from W2-B review: `implements` does not expand type aliases when comparing method signatures (a conservative miss, not a wrong link).

Backlog from W2-C review: a Rust glob import's own link is always unresolved; it could link to its module.
