# Init trust question evidence

[Change note](../../docs/changes/C-44.md)

- [Identical rows](identical.json): cold indexes of labstack/echo and fjall-rs/fjall
  with main (`60d4f2b`) and this branch, with no trust answer recorded.
  `scripts/reindex/cold-cost.mjs --exact` compared every stored row with the
  first run: no difference on either pin. Timings are observations.

`identical.json` measures the indexer only: `cold-cost.mjs` calls
`indexProject` and never reads settings or the trust answer.
[Command check](command-check.json) (`command-check.mjs`) runs the full
`graph index` command path, through `loadConfig`, the local trust answer and
`graphToolchains`, on fresh copies with no settings and no answer, with main
and with this branch. Both run no toolchain, and the stored rows are the same
(ids are random per copy and are masked).
