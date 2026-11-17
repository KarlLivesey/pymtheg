# SW-1: graph 60 public repositories

The corpus sweep pins 20 TypeScript, 20 Go and 20 Rust repositories. It uses
`pymtheg@0.1.0` from npm with the default source-only settings. Every attempt
starts from a shallow checkout. The runner indexes cold, repeats the index
with its cache and queries the resulting graph.

On the dev server, 53 repositories finished both indexing passes. Two hit
Node’s heap limit in mixed-language checkouts, and five reached the 60-minute
limit in Rust analysis or resolution. The runner records errors, time,
memory, failed files, link outcomes and query sizes. It keeps completed attempts in scratch so an interrupted sweep can
resume. The manifest and instructions are in [`sweep/`](../../sweep/), and
[the ranked findings](../../evidence/sw-1/summary.md) are based on the dev
server run. This chunk adds the sweep and evidence without changing Pymtheg.
