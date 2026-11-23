# C-42 merged environment globals

[Change note](../../docs/changes/C-42.md)

Measured on the 19 installed TypeScript pins in `pins.json` here (all
TypeScript pins of `sweep/repos.json` except microsoft/TypeScript), main `5c7750e` against
the C-42 build (review N1, N1b, N2). Both used the SW-6 runner and policy, in one session on the
dev server.

## Files

- `globals-split.mjs`, `globals-split.json`: the diagnosis. Every candidate
  set on main whose candidates are all library declarations, classified by
  the same site on the C-42 measurement build: (a) one merged global
  symbol, (b) not marked, by the module's own reason, (c) other. Also split
  by declaring units, by name and by pin.
- `measure-fields.patch`: the measurement build. Applied to this branch, it
  makes the module record why a one-symbol set is not marked
  (`unitConflict`, `oneSymbolNotGlobal`) in the link's data; nothing else
  changes. Its run's marked count and Level 2 equal the candidate's.
- `compare.mjs`, `compare-installed.json`: every link and symbol on main
  against the C-42 build, per pin. Level 2 is given without and with the
  proposed rule, along with row counts.
- `merged-links.jsonl.gz`: every link counted by the rule (D23, narrowed).
- `merged-links-before-narrowing.jsonl.gz`: the same list from the first
  version, before D23 was narrowed, on an older main (kept for the record;
  the split no longer reads it).
- `draw.mjs`, `audit.jsonl`: 20 merged globals drawn at seed
  `pymtheg-c42-2026`, with source lines and declaring units.
- `cold-cost.json`: cold index time and peak memory, main twice and head
  twice, on excalidraw and Hono (`scripts/reindex/cold-cost.mjs`).
- `seeded-edits-zustand-readable.json`: 30 seeded edits on pmndrs/zustand at
  seed 911 with `--readable`. Each incremental store equals a cold one, and
  each step's `held` gives the links, library links and marked links the
  compared store holds.
- `seeded-edits-oclif.json`: the first run, on oclif/core at seed 3307. It
  used the old copy (`cpSync` without `verbatimSymlinks`) and is superseded.

## Reproduce

On the dev server, with main built in `main/` and the C-42 build in the
tree:

```sh
node scripts/sweep/run.mjs --local-build <build> --installed --manifest pins.json \
  --scratch <run> --output <run>/run.json --parallel 3 \
  --serial-pin vercel/turborepo --serial-pin pingdotgg/t3code
node evidence/c-42/compare.mjs <scratch> main.json head.json out
git apply evidence/c-42/measure-fields.patch   # the measurement build
node scripts/sweep/run.mjs --local-build <measurement build> --installed --manifest pins.json \
  --scratch <run> --output <run>/inst.json --parallel 3 \
  --serial-pin vercel/turborepo --serial-pin pingdotgg/t3code
node evidence/c-42/globals-split.mjs <scratch> main.json inst.json <measurement build> > globals-split.json
node evidence/c-42/draw.mjs <scratch> head.json out.merged.jsonl 20 pymtheg-c42-2026 > audit.jsonl
node scripts/reindex/random-edits.mjs dist <scratch> pmndrs/zustand 911 30 out.json --store-dir <dir> --readable
```

The two runs' attempt folders are linked under one scratch root, so that
each `attempt` path resolves.
