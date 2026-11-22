# Init trust question evidence

[Change note](../../docs/changes/C-44.md)

- [Identical rows](identical.json): cold indexes of labstack/echo and fjall-rs/fjall
  with main (`60d4f2b`) and this branch, with no trust answer recorded.
  `scripts/reindex/cold-cost.mjs --exact` compared every stored row with the
  first run: no difference on either pin. Timings are observations.
