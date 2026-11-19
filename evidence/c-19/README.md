# C-19 evidence: what a Rust toolchain route would give

[Change note](../../docs/changes/C-19.md) · [Per-pin table](table.md) ·
[Results](results.json) · [Hand-check](handcheck.md)

A measurement, no product change. Every Rust pin that finished in the sweep
(18 of the 20 in `sweep/repos.json`; swc and embassy are still open at the
wall limit) is indexed twice from the same clean pinned checkout:

1. by Pymtheg `main` (a merge of `e003342`), source-only, default settings
   (`pym-index.sh`); and
2. by `rust-analyzer scip` from the pinned stable toolchain (Rust 1.98.1,
   the rustup component `rust-analyzer 1.98.1 (48a229c 2026-09-01)`, with
   `rust-src`), in its own copy with a fresh crate cache (`CARGO_HOME`) so
   that downloads can be measured (`ra-scip.sh`). One run at a time, 8
   threads and 8 cargo jobs, on a shared and loaded dev server: times are
   observations. Build output goes to disk scratch.

`join.mjs` joins the SCIP index to every stored Rust link of the same pin,
by file and range, two ways: the first run's loose method (kept for the
comparison) and the strict method that the figures use. Its header says
exactly what each requires.

## The join, in short

- Ranges: Pymtheg stores JavaScript string offsets (UTF-16 code units),
  SCIP UTF-8 byte columns; the join converts.
- Strict answer: an occurrence at exactly the written name's last segment
  at the end of the link's range, one symbol there, a symbol kind the link
  kind can name, and none of the excluded classes (a `use` answered with a
  module, `extern crate` and crate roots, symbols defined more than once,
  non-macro items of proc-macro crates referenced from another package).
- The toolchain's answer: a checkout declaration (mapped to the Pymtheg
  symbol declaring that name at that place; a local to its enclosing item),
  a macro-generated checkout item with no definition site, or a library
  item (crate, version, descriptor path).
- Gated: also no answers on links Pymtheg records under a cfg condition
  other than `test`, and no trait-method declarations (dispatch).
- Agreement on library targets resolves both sides with `rustpath.mjs`, a
  text-level resolver over the downloaded crate sources and `rust-src`
  (`mod` declarations, `use` re-exports, renamed dependencies, required
  versions, proc-macro functions, `#[macro_export]`). It does not evaluate
  cfg or expand macros; what it cannot follow is reported as unverified or
  "same crate family and final name" only. `rustpath-check.mjs` holds its
  checks (`rustpath-check.txt`).

## Hand-checks

- `handcheck.mjs` lists 30 comparisons per deep-dive pin (ripgrep, axum,
  helix, tauri) on links Pymtheg calls definite that are not verified as
  the same declaration. Hard differences come first, then unverified, then
  family-and-name only. The order is fixed by seed `c-19` over site and
  written name, so a fresh run draws the same rows. Every row carries a
  verdict from `handcheck-verdicts.json`, by site or by shape (a Pymtheg
  target and a toolchain target checked once in the crate source), and
  the script fails if one is missing.
- `unconditional.mjs` lists every difference across the 18 pins that has
  no recorded cfg condition (`unconditional.txt`).
- `join.mjs` draws a fixed-seed sample of gated gains (`gainSample`); the
  first 10 per deep-dive pin are in `handcheck.md` and were read against
  their source lines.

## Results in this folder

- `table.md`, `results.json`: per-pin coverage (loose and strict),
  agreement and cost (`report.mjs`).
- `aggregate.json`: 18-pin sums (`aggregate.mjs`).
- `joins/*.join.json.gz`: every pin's full join result, and the axum
  variants (build scripts and proc macros configured off, cfg(test) off,
  all features, all features plus the examples workspace) and the ripgrep
  offline run.
- `axum-scip-compare.json`: the variant indexes compared by payload, the
  metadata left out (`scip-compare.mjs`).
- `axum-join-compare.json`: their join results compared.
- `handcheck.md`, `unconditional.txt`, `rustpath-check.txt`.

## Reproduce (dev server)

```sh
pymtheg-dev --name c19 -- bash -c 'npm ci --ignore-scripts && npm run build'
pymtheg-dev --name c19 -- bash evidence/c-19/queue-pym.sh "$PWD" /dev/shm/c19
pymtheg-dev --name c19 -- bash evidence/c-19/queue-ra.sh /dev/shm/c19
pymtheg-dev --name c19 -- bash evidence/c-19/analyse.sh /dev/shm/c19 OUT
```

`queue-ra.sh` runs every pin's default index, then the axum variants, the
one-file-edit re-runs (`ra-rerun.sh`) and the ripgrep extras (`ra-extra.sh`:
lsif, offline with an empty crate cache). `analyse.sh` runs the resolver
checks, all joins (`join-all.sh`), the variant joins and comparisons
(`variants.sh`), the report, the aggregates, the unconditional list and
the hand-check. The queues skip finished work and retry failed attempts
into new folders (nothing is deleted).

Other scripts: `fetch.sh` (pinned shallow fetch, as the sweep runner),
`pins.mjs` (the 18 pins), `scip.mjs` (a minimal SCIP reader), `inspect.mjs`
and `occurrences.mjs` (index summaries for hand checks), `show.mjs` (print
a result section). Nothing here installs anything into the checkout.
