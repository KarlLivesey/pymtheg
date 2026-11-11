These are frozen test-only implementations of `analysis.ts`, `indexer.ts` and
`store.ts` from commit `397c5e7fed4295e8906aa9ecfcb7bc9ea4c041d7`, compiled with
the repository's TypeScript compiler before W2-I edits. Only import paths and
formatting differ from that output. Their old quadratic algorithms deliberately
remain intact. The unchanged identity and registry helpers are shared with the
production build. No reference implementation is shipped in `dist/`.

The equivalence suite compares complete canonical files/contexts, symbols,
links (including IDs, ranges, provenance and candidate statuses), reports and
queries after fixed-seed generated edit sequences. The benchmark runs this same
reference with a map-based synthetic module, excluding module lookup costs.
