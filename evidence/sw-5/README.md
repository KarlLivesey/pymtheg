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
