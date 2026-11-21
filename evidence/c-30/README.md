# C-30 evidence: shared base configs

[Change note](../../docs/changes/C-30.md) · [Hand-check](hand-check.md)

Measured on the dev server on 21 November 2026: main `c6b77dc` (after the review fixes; first round `0ccd239`) and this
branch's build, nine TypeScript pins (`pins.json`), bare and installed.

## Files

- `coverage-plan-input.json.gz`: per build (`main`, `candidate`), mode and
  pin, the TypeScript link and Level 2 counts and every below-Level-2
  `[module, kind, outcome, reasons, links]` combination (`tools/inventory.mjs`).
- `compare-installed.json`, `compare-bare.json`: per pin, link counts, Level 2
  before/after, sites only in one build (zero everywhere), changed and newly
  definite counts, symbols only in one build (zero everywhere), owner changes,
  and the outcome of every in-scope link (`tools/compare.mjs`).
- `changed-definite-installed.jsonl`, `changed-definite-bare.jsonl`: every
  link that was Level 2 on main and is not, or has another target.
- `hand-check.md`, `hand-check.jsonl`: the 20 reviewed newly definite links.
- `candidate-to-definite-installed.jsonl`: every installed link that was a
  candidate set on main and is definite now (43), all reviewed: 29
  merged-member calls and 14 Vite type references and imports.
- `work.tsv`: per run and pin, compiler programs, file analyses, cold CPU
  seconds and peak MiB (`tools/programs.mjs`).
- `cost-1-main.json`, `cost-2-candidate.json`, `cost-3-main.json`: Hono and
  Nest cold bare runs in one session, in the order main, candidate, main.
- `tools/amb.mjs` and `tools/inc.mjs`: the diagnosis groupings of
  `ambiguous-project` links by tied configs, and of `incomplete-config`
  links by recorded cause. `tools/libnames.mjs` lists stored library names.
  `tools/tally.mjs` and `tools/drawnew.mjs` summarise and draw new links.

## Reproduce

`$S` is a dev-server scratch directory. `$S/main` and `$S/cand` are built
copies of main and of this branch.

```sh
for b in main cand; do
  node scripts/sweep/run.mjs --manifest evidence/c-30/pins.json --scratch $S/sw \
    --local-build $S/$b --installed --output $S/$b-inst.json --parallel 4
  node scripts/sweep/run.mjs --manifest evidence/c-30/pins.json --scratch $S/sw \
    --local-build $S/$b --output $S/$b-bare.json --parallel 4
done
node evidence/c-30/tools/compare.mjs $S/sw $S/main-inst.json $S/cand-inst.json $S/cmp-inst
node evidence/c-30/tools/compare.mjs $S/sw $S/main-bare.json $S/cand-bare.json $S/cmp-bare
node evidence/c-30/tools/drawnew.mjs $S/cmp-inst.new.jsonl $S/cand-inst.json $S/sw 20 pymtheg-c30-2026
node evidence/c-30/tools/amb.mjs $S/main-inst.json $S/sw honojs/hono ambiguous-project
node evidence/c-30/tools/inc.mjs $S/main-inst.json $S/sw withastro/astro incomplete-config
node evidence/c-30/tools/programs.mjs $S/sw $S/main-bare.json $S/cand-bare.json
node evidence/c-30/tools/inventory.mjs $S/sw out.json main-bare=$S/main-bare.json \
  main-installed=$S/main-inst.json candidate-bare=$S/cand-bare.json \
  candidate-installed=$S/cand-inst.json
```
