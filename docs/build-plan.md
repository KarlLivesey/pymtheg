# Pymtheg build plan

Written 10 November 2026. This says **how** the work in
[`mega-plan.md`](mega-plan.md) gets built. It is the manager's working reference.
Building has not started and does not start until Karl says so.

## 1. Roles

| Role | Who | Does | Does not |
|---|---|---|---|
| Manager and coach | The lead session (Claude Fable 5.2) | Cuts chunks, writes briefs, assigns builders and reviewers, guards file ownership, keeps the ledger in section 9, merges passing pull requests, unblocks and coaches builders, reports to Karl | Write feature code |
| Builder | Claude Opus 5.5 at medium effort, or Sol (GPT-6.1 Sol) at medium effort | Builds one chunk in its own worktree, proves it, opens a pull request | Touch files outside the chunk's owned paths; merge; start other agents |
| Reviewer | Opus 5.5 medium or Sol 6.1 medium, always the other model from the builder | Reviews one pull request against its brief and returns pass or changes needed | Change the branch; widen the scope; score or polish |
| Owner | Karl | Decides scope, answers escalations, can stop anything | — |

Confirmed available on this machine: `claude-opus-5-5` (effort `medium`) and
`gpt-6.1-sol` (reasoning effort `medium`). The repository has a private GitHub
remote (`KarlLivesey/pymtheg`) and `gh` is signed in, so pull requests work.

## 2. The loop for one chunk

1. **Cut.** The manager writes the chunk brief (section 4) and records it in the ledger with its owned paths.
2. **Assign.** A builder is started in a fresh worktree branched from the current `origin/main`.
3. **Build.** The builder works in small loops under `AGENTS.md`, runs the checks in section 6, and opens a pull request when it is satisfied the "done when" is met.
4. **Review.** The manager assigns a reviewer of the other model. The reviewer builds and tests a disposable checkout of the branch and returns **pass** or **changes needed** with specific findings.
5. **Fix.** Findings go back to the same builder. A re-check is a new review assignment.
6. **Merge.** On a pass with checks green, the manager merges the pull request on GitHub with a normal merge, deletes the branch, updates the ledger, and tells builders with open chunks to rebase.

Limits that prevent the old review loop returning:

- A review checks four things only: the "done when" is met, the result is correct, the change stayed inside its owned paths, and the tests are meaningful. No ratings, no cosmetic requests.
- At most **two** review rounds per pull request. If it still has not passed, the manager decides: narrow the chunk, reassign it, or escalate to Karl.
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
- The reviewer is always the other model from the builder.
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
| W0-2 Dependencies | building | Sol 6.1 | — | `w0-2-graph-dependencies` | — | `package.json`, `package-lock.json`, `scripts/grammar-check.mjs` |
| W1-A Ownership disagreement | building | Opus 5.5 | — | `w1-a-ownership-agreement` | — | `src/analysis/ownership.ts`, `src/behaviour/flow.ts`, `test/ownership-agreement.test.mjs` |
| W1-B Engine core | building | Sol 6.1 | — | `w1-b-engine-core` | — | `src/behaviour/explore*.ts`, `test/explore*.test.mjs` |
| W1-E Machines and contracts | building | Opus 5.5 | — | `w1-e-mixed-file-contracts` | — | `src/contracts/document.ts`, `implementation-check.ts`, `manifest.ts`, `test/contracts-mixed-file.test.mjs` |
| W1-C Graph store and interface | cut, waits for W0-2 | — | — | — | — | `src/graph/**` except `languages/*/` |
| W1-D Document import | cut, next free slot | — | — | — | — | `src/shared/document-selection.ts`, `src/architecture/import-policy.ts`, `src/cli/import-summary.ts`, `src/architecture/store.ts` |
| W1-F Two investigations | cut, next free slot | — | — | — | — | `evidence/w1-f/` |

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
