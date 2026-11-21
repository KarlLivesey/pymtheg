# SW-5 installed sweep evidence

The replay uses Pymtheg at `0ccd239ad256e93960460b2fb0104e687aad32b1`,
built with Node 24.21.0. The archive keeps the original SW-4 receipts at
`404ee031715022855ef29d1084de3d85f19ac1ca` and records separate commit and
build provenance for each replayed installed receipt. Each bare fallback
still uses the original SW-4 measurement.
[Replay archive](coverage-plan-input.json.gz) · [SW-4 measurements](../sw-4/attempts.md)

Reviewing all 60 bare receipts and their corresponding alternate-mode
receipts found five installed fallbacks, all among the 20 TypeScript pins.
Fourteen Go and Rust pins contributed TypeScript links to the all-pin bare
total. SW-4 did not schedule installed attempts for those pins.
[Fixed replay manifest](pins.json)

The installer runs with lifecycle scripts disabled. Index, repeat index and
queries run in a network namespace without network access. Package caches,
installer binaries, worktrees, stores and raw output stay in disk scratch.
The archive's public flags use `$PYM_SCRATCH` for the variable prefix.

## Installers

| Pin | Observed installer | Arguments |
| --- | --- | --- |
| colinhacks/zod | Nub 0.8.3 | `install --frozen-lockfile --ignore-scripts` |
| microsoft/TypeScript | npm 11.21.1 via Corepack | `ci --ignore-scripts --script-shell=/bin/false --no-audit --no-fund` |
| nestjs/nest | npm 11.19.0 | `ci --legacy-peer-deps --ignore-scripts --script-shell=/bin/false --no-audit --no-fund` |
| pingdotgg/t3code | Bun 1.3.11 | `install --frozen-lockfile --ignore-scripts --cache-dir $PYM_SCRATCH/install-cache/bun` |
| vercel/turborepo | pnpm 12.0.0 | `install --frozen-lockfile --ignore-scripts --ignore-pnpmfile --store-dir $PYM_SCRATCH/install-cache/pnpm` |

The native installer archives are pinned by checksum in the sweep runner.
Corepack verifies Microsoft TypeScript's declared npm integrity. Nub reports
`v0.8.3`, normalized to `0.8.3` in the receipt. The first Nub version probe
stopped before installation. The corrected probe and install both completed.
[Installer pins and policy](../../scripts/sweep/install.mjs)

## Package targets

T3 Code's graph recorded 3,020 read dependency inputs through `node_modules/.bun`,
including 2,385 TypeScript inputs. It has one unresolved `external-package`
link, the `vite/client` type-reference directive in `apps/web/src/vite-env.d.ts:1`.
`apps/web/node_modules/vite/client.d.ts` points to Vite 8.0.0's declaration
inside `.bun`. The directive extractor assigns this diagnostic to a `types`
reference without using the installed declaration as a target. No unresolved
literal module import records `external-package` in this graph.
[Directive extraction](../../src/graph/languages/typescript/extract.ts)

Nest's graph recorded 2,509 dependency inputs through npm's layout. It
still has 58 unresolved links with `external-package`, including three
with an explicit module specifier. These are `fastify/lib/reply.js` and
`fastify/lib/symbols.js` at `packages/platform-fastify/adapters/fastify-adapter.ts:38–39`,
and `ejs` at `packages/platform-node/test/views/view-renderer.spec.ts:1`.
The TypeScript 5.9.3 filesystem resolver with Bundler settings found no
in-checkout TypeScript input for those three specifiers.

Zod's graph recorded 3,301 dependency inputs through Nub's
`node_modules/.store`, including the manifest for `arktype@2.1.19`. It has
13 unresolved links with `external-package`, including five explicit module
specifiers. Examples include `@rollup/plugin-commonjs` and
`rollup-plugin-filesize` at `.configs/rollup.config.js:1,4` and `puppeteer`
at `scripts/chrome-devtools-mcp.mjs:18`. The same filesystem resolver found
no in-checkout TypeScript input for any of the five.

The source check traces 20 matched SW-4 misses to their new targets in the
installed graphs. [Source checks](source-check.md)

## Replay results

The original installed score paired each unavailable attempt with its SW-4
bare graph. The replay still uses that fallback for Microsoft TypeScript.
Its install succeeded, then the runner reached the 60-minute limit at
`graph analyze typescript: 0/27194` and sent a shutdown signal. Turborepo
completed its sweep queries with an incomplete graph. The `Invalid UTF-16
range` analysis error marked all 3,094 TypeScript and JavaScript files
failed. The finished graph supplies Go and Rust links and zero TypeScript
links. Its package layout cannot be assessed through TypeScript links in
this receipt. [Diagnoses and reproductions](../../docs/changes/SW-5.md#typescript-compiler-and-range-failures)

The rates divide each Level 2 count by all stored TypeScript and JavaScript
links for that pin. The proven column excludes links with recorded
assumptions. A dash means the pin contributed zero TypeScript links.

| Pin | Links | Level 2 | Proven | Assumption-marked |
| --- | ---: | ---: | ---: | ---: |
| changesets/changesets | 12,646 → 12,646 | 86.99% → 86.99% | 86.99% → 86.99% | 0.00% → 0.00% |
| colinhacks/zod | 81,042 → 81,042 | 83.86% → 94.65% | 83.86% → 94.65% | 0.00% → 0.00% |
| dexie/Dexie.js | 36,431 → 36,431 | 56.25% → 56.25% | 56.25% → 56.25% | 0.00% → 0.00% |
| excalidraw/excalidraw | 104,519 → 104,519 | 93.36% → 93.36% | 93.36% → 93.36% | 0.00% → 0.00% |
| honojs/hono | 72,340 → 72,340 | 64.15% → 64.15% | 64.15% → 64.15% | 0.00% → 0.00% |
| mermaid-js/mermaid | 125,657 → 125,657 | 89.17% → 89.17% | 89.17% → 89.17% | 0.00% → 0.00% |
| microsoft/TypeScript | 0 → 0 | — → — | — → — | — → — |
| nestjs/nest | 165,330 → 165,330 | 74.78% → 91.55% | 74.78% → 91.55% | 0.00% → 0.00% |
| oclif/core | 14,188 → 14,188 | 95.07% → 95.07% | 95.07% → 95.07% | 0.00% → 0.00% |
| pingdotgg/t3code | 162,711 → 162,711 | 72.34% → 91.48% | 72.34% → 91.48% | 0.00% → 0.00% |
| pmndrs/zustand | 7,099 → 7,099 | 82.65% → 82.65% | 82.65% → 82.65% | 0.00% → 0.00% |
| puppeteer/puppeteer | 58,244 → 58,244 | 78.00% → 78.00% | 77.05% → 77.05% | 0.95% → 0.95% |
| react-hook-form/react-hook-form | 49,115 → 49,115 | 74.90% → 74.90% | 74.90% → 74.90% | 0.00% → 0.00% |
| reduxjs/redux-toolkit | 57,208 → 57,208 | 80.02% → 80.02% | 80.02% → 80.02% | 0.00% → 0.00% |
| trpc/trpc | 107,470 → 107,470 | 88.80% → 88.80% | 88.80% → 88.80% | 0.00% → 0.00% |
| vercel/turborepo | 0 → 0 | — → — | — → — | — → — |
| vitejs/vite | 55,575 → 55,575 | 82.23% → 82.23% | 70.07% → 70.07% | 12.15% → 12.15% |
| vitest-dev/vitest | 116,220 → 116,220 | 82.26% → 82.26% | 50.35% → 50.35% | 31.92% → 31.92% |
| withastro/astro | 152,561 → 152,561 | 85.38% → 85.38% | 82.29% → 82.29% | 3.09% → 3.09% |
| yargs/yargs | 12,205 → 12,205 | 52.65% → 52.65% | 52.65% → 52.65% | 0.00% → 0.00% |
| **All 20 TypeScript pins** | 1,390,561 → 1,390,561 | 80.37% → 85.23% | 76.84% → 81.70% | 3.53% → 3.53% |

The timing figures are observations on the shared dev server. The SW-4
comparison uses the bare cold index because all five prior installed
attempts fell back. Peak is the cold stage's measured resident memory.

| Pin | SW-4 bare cold (s / MiB) | SW-5 installed cold (s / MiB) | SW-5 installed total (s) |
| --- | ---: | ---: | ---: |
| colinhacks/zod | 92.7 / 1,666.0 | 313.7 / 1,708.5 | 356.9 |
| microsoft/TypeScript | 1,848.6 / 4,586.7 | 3,368.3 / 2,860.0 (limit) | 3,610.8 |
| nestjs/nest | 221.1 / 1,882.8 | 937.9 / 2,833.4 | 1,159.9 |
| pingdotgg/t3code | 192.2 / 2,107.7 | 651.2 / 2,942.2 | 785.9 |
| vercel/turborepo | 1,966.7 / 5,601.3 | 1,959.6 / 5,473.3 | 2,548.7 |

## Reproduction

Run on the dev server from the sweep tree. Use a build of the measured
product commit and the SW-5 sweep scripts.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node scripts/sweep/run.mjs --local-build . --installed \
  --manifest evidence/sw-5/pins.json --output "$PYM_SCRATCH/installed-run.json" --parallel 3
node scripts/sweep/refresh-evidence.mjs export
node scripts/sweep/refresh-evidence.mjs overlay-installed \
  --base evidence/sw-4/coverage-plan-input.json.gz \
  --commit 0ccd239ad256e93960460b2fb0104e687aad32b1 \
  --output "$PYM_SCRATCH/coverage-plan-input.json.gz"
```

The exporter checks each finished graph's stored link totals against the
warm CLI receipt. The attempt schedule follows manifest order. With a
fresh scratch directory it uses the standard 60-minute per-pin budget.
[Coverage plan regeneration](../../sweep/README.md#reproduce-the-coverage-plan-for-020)
