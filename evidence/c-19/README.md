# C-19 evidence: what a Rust toolchain route would give

[Change note](../../docs/changes/C-19.md) · [Per-pin table](table.md) ·
[Results](results.json) · [Hand-check](handcheck.md)

A measurement, no product change. Every Rust pin that finished in the sweep
(18 of the 20 in `sweep/repos.json`; swc and embassy are still open at the
wall limit) is indexed twice from the same clean pinned checkout:

1. by Pymtheg `main` (build of `02d0e3d`), source-only, default settings
   (`pym-index.sh`); and
2. by `rust-analyzer scip` from the pinned stable toolchain (Rust 1.98.1,
   the rustup component `rust-analyzer 1.98.1 (48a229c 2026-09-01)`, with
   `rust-src`), in its own copy with a fresh `CARGO_HOME` so that downloads
   can be measured (`ra-scip.sh`). One run at a time, 8 threads and 8 cargo
   jobs, on a shared and loaded dev server: times are observations.

`join.mjs` then joins the SCIP index to every stored Rust link of the same
pin, by file and range, and reports Pymtheg's outcome against the
toolchain's answer.

## The join

- Pymtheg stores ranges as JavaScript string offsets (UTF-16 code units);
  SCIP stores UTF-8 byte columns. The join converts. (`rangeCheck` in each
  result counts stored ranges whose text ends with the written name; the
  rest are `use … as …` renames, generic arguments, `self` imports and links
  found inside macro expansions, whose range is the macro's name.)
- A link matches the SCIP occurrence inside its range whose text is the
  last segment of the written name (`a::b::c` → `c`, `x.m` → `m`), a
  reference preferred over a definition.
- The toolchain's answer is the matched symbol's definition: in a checkout
  file (mapped to the smallest Pymtheg symbol declaring that name there; a
  local binding maps to its enclosing item, as Pymtheg links locals), in a
  checkout crate with no definition site (macro-generated), or in another
  crate (crate, version, descriptor path).
- A SCIP symbol defined more than once is a **collision** and gives no
  answer: SCIP symbol strings carry no function-body scope, so two items
  declared inside two function bodies of one module share one symbol.
- `contains` and `modules` links are structural and left out of agreement.

"Level 2 now" is Pymtheg's stored outcome: resolved checkout links plus
library links with a symbol, over all stored Rust links of the pin.
"+ toolchain answers" adds every unresolved, candidate or unit-only link
the toolchain answers with a checkout declaration or a library symbol.
"Conservative" drops two kinds from that gain: answers that name a trait's
method declaration (`Trait#m().`, dispatch or a default body) and answers
on links Pymtheg records under a cfg condition other than `test` (the
toolchain sees one configuration).

## Hand-checks

- `handcheck.mjs` lists 30 disagreements per deep-dive pin (ripgrep, axum,
  helix, tauri) on links Pymtheg calls definite: every hard disagreement
  first, then same-name re-export cases, in fixed-seed order (`c-19`).
  Hard ones carry a verdict checked by hand against the pinned source
  (`handcheck-verdicts.json`); re-export cases are checked in the unit's
  downloaded source (`reexport.mjs`, a text check).
- `join.mjs` also draws a fixed-seed sample of conservative gains
  (`gainSample` in each result); 40 were read against their source line.

## Results in this folder

- `table.md`, `results.json`: per-pin coverage, agreement and cost
  (`report.mjs`); `aggregate.json`: 18-pin sums (`aggregate.mjs`).
- `joins/*.join.json.gz`: every pin's full join result, and the axum
  all-features, all-features-plus-examples and ripgrep offline variants.
- `handcheck.md`: the hand-check table; `unconditional.txt`: every hard
  disagreement without a recorded cfg condition (`unconditional.mjs`);
  `reexport-check.jsonl`: the re-export check per pin.

## Reproduce (dev server)

```sh
pymtheg-dev --name c19 -- bash -c 'npm ci --ignore-scripts && npm run build'
pymtheg-dev --name c19 -- bash evidence/c-19/queue-pym.sh "$PWD" /dev/shm/c19
pymtheg-dev --name c19 -- bash evidence/c-19/queue-ra.sh /dev/shm/c19
pymtheg-dev --name c19 -- bash evidence/c-19/join-all.sh /dev/shm/c19
pymtheg-dev --name c19 -- node evidence/c-19/report.mjs /dev/shm/c19 OUT
pymtheg-dev --name c19 -- node evidence/c-19/handcheck.mjs /dev/shm/c19 ripgrep axum helix tauri
pymtheg-dev --name c19 -- bash evidence/c-19/ra-extra.sh /dev/shm/c19
```

`queue-ra.sh` also runs the axum variants (build scripts and proc macros
"off", all features, the separate `examples/` workspace) and the one-file
edit re-runs (`ra-rerun.sh`). The axum variant joins:

```sh
node evidence/c-19/join.mjs --graph …/axum/…/graph.sqlite \
  --scip OUT/axum.allfeatures.scip,OUT/axum.examples.scip=examples …
```

Scripts: `fetch.sh` (pinned shallow fetch, as the sweep runner),
`scip.mjs` (a minimal SCIP reader), `inspect.mjs` and `occurrences.mjs`
(index summaries for hand checks), `show.mjs` (print a result section).
Nothing here installs anything into the checkout; the scratch folder holds
the clones, indexes, crate caches and build output.
