# C-7 coverage evidence

The dev-server sweep used Node 24.21.0, default graph settings and the 20
TypeScript pins in `sweep/repos.json`. Each revision was built locally and the
corpus checkouts were indexed from source. The main revision was `e5f86db`.
The candidate used the production code in `c1e817e` and had digest
`9745b07c6f17bc90186b34f00f9b960686a7d30dd35508b19498032927d82164`.

Each build finished 18 pins, including all 12 requested repositories.
Both builds hit the one-hour cold-index limit on microsoft/TypeScript and
vercel/turborepo. Microsoft TypeScript stopped after Go parsing. Turborepo
stopped after Rust analysis progress reached its file count. These attempts
supply no TypeScript comparison evidence.

## Coverage and stability

TypeScript and JavaScript Level 2 rose from **57.98% to 60.33%** across the
18 matched pins. On the full SW-3 corpus overlay it rose from **56.43% to
58.50%**. The overlay retains previously measured results on pins outside
this sweep and uses the current completion outcomes for the attempted pins.

The matched TypeScript graphs contain **1,390,561** link sites in each build.
The comparison found zero added or removed sites. The all-site and
like-for-like rates therefore agree. All **617,076** existing definite
links kept their targets. All **145,828** existing symbol keys and identities
were preserved. The candidate added **30,532** verified type-parameter
references and **1,581** verified member links at existing sites.
All **440,761** links carrying `external` or `external-package` on main kept
their outcomes and reasons, including reasons qualified by a partial config.
The exporter credited the same 189,111 library-symbol links in each build.

| Repository | Level 2 main → candidate | Like-for-like main → candidate | TS/JS links | Main definite / changed | Main keys / changed |
| --- | ---: | ---: | ---: | ---: | ---: |
| changesets/changesets | 40.49% → 40.87% | 40.49% → 40.87% | 12,646 | 1,762 / 0 | 961 / 0 |
| colinhacks/zod | 72.54% → 76.77% | 72.54% → 76.77% | 81,042 | 46,301 / 0 | 7,004 / 0 |
| dexie/Dexie.js | 38.20% → 41.70% | 38.20% → 41.70% | 36,431 | 12,812 / 0 | 4,390 / 0 |
| excalidraw/excalidraw | 60.32% → 61.56% | 60.32% → 61.56% | 104,519 | 60,040 / 0 | 8,245 / 0 |
| honojs/hono | 39.54% → 49.93% | 39.54% → 49.93% | 72,340 | 27,116 / 0 | 4,638 / 0 |
| mermaid-js/mermaid | 56.75% → 56.99% | 56.75% → 56.99% | 125,657 | 53,912 / 0 | 14,271 / 0 |
| microsoft/TypeScript | wall-limit → wall-limit | — | — | — | — |
| nestjs/nest | 51.89% → 52.91% | 51.89% → 52.91% | 165,330 | 77,435 / 0 | 16,840 / 0 |
| oclif/core | 65.25% → 67.84% | 65.25% → 67.84% | 14,188 | 7,127 / 0 | 1,539 / 0 |
| pingdotgg/t3code | 68.23% → 68.99% | 68.23% → 68.99% | 162,711 | 62,243 / 0 | 19,349 / 0 |
| pmndrs/zustand | 58.09% → 64.15% | 58.09% → 64.15% | 7,099 | 2,295 / 0 | 450 / 0 |
| puppeteer/puppeteer | 52.53% → 53.98% | 52.53% → 53.98% | 58,244 | 22,563 / 0 | 6,234 / 0 |
| react-hook-form/react-hook-form | 48.09% → 50.67% | 48.09% → 50.67% | 49,115 | 14,131 / 0 | 2,601 / 0 |
| reduxjs/redux-toolkit | 42.61% → 48.94% | 42.61% → 48.94% | 57,208 | 20,371 / 0 | 6,106 / 0 |
| trpc/trpc | 56.63% → 62.17% | 56.63% → 62.17% | 107,470 | 47,377 / 0 | 12,173 / 0 |
| vercel/turborepo | wall-limit → wall-limit | — | — | — | — |
| vitejs/vite | 62.17% → 62.79% | 62.17% → 62.79% | 55,575 | 22,782 / 0 | 7,882 / 0 |
| vitest-dev/vitest | 66.34% → 68.08% | 66.34% → 68.08% | 116,220 | 70,811 / 0 | 13,892 / 0 |
| withastro/astro | 65.50% → 66.17% | 65.50% → 66.17% | 152,561 | 64,132 / 0 | 18,237 / 0 |
| yargs/yargs | 34.29% → 35.12% | 34.29% → 35.12% | 12,205 | 3,866 / 0 | 1,016 / 0 |

The requirement-link regression verifies that inserting an unrelated
declaration above a linked member preserves the original link. The CLI
search regression verifies that a bounded search returns a named top-level
declaration ahead of the new member.

[Site and identity comparison](compare.mjs)

## Reference sites, source audit and performance

The candidate settled 22 additional generic reference sites and five
additional sites labelled lexical access. The chain reference sample kept
its seven settled sites. The fixes also resolved chains outside that sample,
including calls through an awaited test harness and optional calls on
objects returned by a factory.

- [SW-3 reference sites](settled.md)
- [Twenty hand-checked targets](source-audit.md)
- [Cold index observations](cost.md)

## Merged graph core

The branch merged main at `62d071d` before the PR. After the merge, the
C-5 identity check re-indexed Zustand and yargs with both candidate builds.
All seven shared graph tables had identical sorted row digests on each pin
across the schema upgrade. The new library-target table was empty. The
checks covered 7,099 Zustand links and 12,205 yargs links.

[Schema identity check](../c-5/identity.mjs)

## Reproduction

Use `scripts/sweep/run.mjs --local-build` with the TypeScript manifest for each
built revision, then export with `scripts/sweep/coverage-export.mjs`. Use
`evidence/sw-3/samples.json.gz` as `--reference-samples` and
`evidence/sw-3/breakdown.json.gz` as `--sampling-base`. Give the outputs the
names read by `compare.mjs` under `PYM_SCRATCH`.

The coverage plan was regenerated with `scripts/sweep/coverage.mjs`,
`--base evidence/sw-3/breakdown.json.gz` and the archived input below.
The input combines the current TypeScript results with the prior Go overlay.

[Coverage plan input](coverage-plan-input.json.gz)
