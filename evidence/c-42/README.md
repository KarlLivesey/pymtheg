# C-42 merged environment globals

[Change note](../../docs/changes/C-42.md)

Measured on the 19 installed TypeScript pins of `evidence/c-39/pins.json`
(all TypeScript pins except microsoft/TypeScript), main `e00be69` against
the C-42 build. Both used the SW-6 runner and policy, in one session on the
dev server.

## Files

- `globals-split.mjs`, `globals-split.json`: the diagnosis. Every candidate
  set on main whose candidates are all library declarations, classified by
  the same site on the C-42 build: (a) one merged global symbol, (b)
  different symbols, (c) other. Also split by declaring units, by name and
  by pin.
- `compare.mjs`, `compare-installed.json`: every link and symbol on main
  against the C-42 build, per pin. Level 2 is given without and with the
  proposed rule, along with row counts.
- `merged-links.jsonl.gz`: every link counted by the proposed rule.
- `draw.mjs`, `audit.jsonl`: 20 merged globals drawn at seed
  `pymtheg-c42-2026`, with source lines and declaring units.
- `cold-cost.json`: cold index time and peak memory, main twice and head
  twice, on excalidraw and Hono (`scripts/reindex/cold-cost.mjs`).
- `seeded-edits-oclif.json`: 30 seeded edits on oclif/core at seed 3307,
  each incremental store equal to a cold one
  (`scripts/reindex/random-edits.mjs`).

## Reproduce

On the dev server, with main built in `main/` and the C-42 build in the
tree:

```sh
node scripts/sweep/run.mjs --local-build <build> --installed --manifest pins.json \
  --scratch <run> --output <run>/run.json --parallel 3 \
  --serial-pin vercel/turborepo --serial-pin pingdotgg/t3code
node evidence/c-42/compare.mjs <scratch> main.json head.json out
node evidence/c-42/globals-split.mjs <scratch> main.json head.json > globals-split.json
node evidence/c-42/draw.mjs <scratch> head.json out.merged.jsonl 20 pymtheg-c42-2026 > audit.jsonl
```

The two runs' attempt folders are linked under one scratch root, so that
each `attempt` path resolves.
