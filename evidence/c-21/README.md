# C-21 evidence

All heavy work ran on the dev server. Pins are the sweep's (`rust-pins.json`,
`affected.json`, both from C-15), cloned at their commits by
[`clone-pins.mjs`](clone-pins.mjs); the pinned Vector corpus was read in
place, never edited. Change note: [`docs/changes/C-21.md`](../../docs/changes/C-21.md).

## Grammar

- [`build-verify.txt`](build-verify.txt): `node grammars/build.mjs rust` on
  the final inputs. Upstream's `tree-sitter test` passes with the new
  corpus cases; the build reproduces sha256 `421c975a…` (the `--write` build
  gave the same bytes).
- [`grammar-dev.mjs`](grammar-dev.mjs): the same build steps into a scratch
  `.wasm`; with `ONLY=00NN` it applies 0001–0008 plus that one C-21 patch
  (the six attribution builds; each passes its corpus).

## Tree gate

- [`tree-gate.md`](tree-gate.md): results, newly read files with their
  patch, files still failing with cause. Made by
  [`tree-compare.mjs`](tree-compare.mjs) (main's grammar against this one, and
  against each single-patch build) and [`tree-summary.mjs`](tree-summary.mjs).
- [`tree-digests.mjs`](tree-digests.mjs): writes
  `test/fixtures/rust-grammar/ordinary-trees.json` with the previous grammar
  (the golden file of the tree-identity test).

## Graph effect

Runs: `scripts/sweep/run.mjs --local-build` with main `920dc47` and the merged
branch, built by [`builds.sh`](builds.sh), on [`changed-pins.json`](changed-pins.json)
(the 7 pins with newly read files; swc does not finish on main).

- [`compare.mjs`](compare.mjs): every stored link, symbol key and library row
  (based on C-15's). Outputs:
  - [`compare-summary.json`](compare-summary.json): per repository: failed
    Rust files before and after, newly read files, symbol keys removed and
    added, Rust Level 2 on all sites and on main's sites, failed-file reason
    counts, definite links kept, transitions;
  - [`changed-definite.jsonl`](changed-definite.jsonl): every link definite
    on main whose answer changed (one);
  - [`newly-resolved.jsonl.gz`](newly-resolved.jsonl.gz): every Rust link
    resolved on the branch and not on main, ordered by the `c21` seed;
  - [`other-changes.jsonl.gz`](other-changes.jsonl.gz): every other changed
    site (library rows).
- [`audit.md`](audit.md): the hand audit of 40 newly resolved links (40
  right) and the changed definite link, with
  [`audit-context.mjs`](audit-context.mjs).
- Determinism: dioxus was indexed twice with each build, before and after
  the merge of C-18 ([`dioxus-pin.json`](dioxus-pin.json)); main against main
  and branch against branch show no change of any definite link. One
  `implements` library row in dioxus `payloads/sse.rs` flips between two
  branch runs (Deref / DerefMut), as noted in the change note.
- The plan: `coverage-export.mjs` on both runs, then C-15's
  [`plan.mjs`](../c-15/plan.mjs) into `sweep/plan-input.json.gz` and
  `coverage.mjs --rust-section` (the committed plan reproduces from the
  committed archive byte for byte).
- Before the merge of C-18 the same comparison was made against main
  `6cc2753` (turborepo on disk because the shared memory-backed storage hit
  its quota). It agreed except that turborepo `auth/login.rs:38`
  (`match error`) went from resolved to unresolved; on the merged builds it
  does not change.

## Fixtures and cost

- [`fixture-links.mjs`](fixture-links.mjs): prints what each grammar fixture
  indexes to (used to write the behaviour tests).
- [`cost.txt`](cost.txt), [`parse-cost.mjs`](parse-cost.mjs),
  [`parse-cost-turborepo.txt`](parse-cost-turborepo.txt): cold index time and
  peak memory (C-15's `cost.sh`), grammar size and parse time.

Fetched over the network: `github.com/tree-sitter/tree-sitter-rust` (the
pinned commit, by the build scripts), the upstream issue and pull-request
lists (to find references for the patch headers), the sweep pins at their
commits, and `tree-sitter-cli` 0.27.2 from crates.io.
