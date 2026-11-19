# TypeScript and JavaScript Level 2 on the 18 released pins

The replay of release 0.1.0 reproduced the committed SW-3 counts on all
18 pins. The main column uses the merged C-7 coverage archive. The
shared-site comparison matches file, source span, link kind and written
name at the same pin. The last two columns count definite stored library
links in C-11.

| Repository | 0.1.0 all sites | Main all sites | C-11 all sites | 0.1.0 → C-11 shared sites | Stored symbol | Stored unit only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| changesets/changesets | 39.87% | 40.87% | 20.19% | 39.87% → 19.95% | 743 | 154 |
| colinhacks/zod | 71.00% | 76.77% | 84.03% | 71.00% → 83.91% | 18,373 | 602 |
| dexie/Dexie.js | 34.91% | 41.68% | 54.07% | 34.91% → 53.36% | 5,618 | 371 |
| excalidraw/excalidraw | 57.79% | 61.55% | 72.67% | 57.79% → 72.37% | 14,626 | 1,325 |
| honojs/hono | 36.00% | 49.91% | 57.43% | 36.00% → 56.48% | 6,893 | 337 |
| mermaid-js/mermaid | 54.56% | 56.99% | 70.47% | 54.56% → 70.25% | 34,335 | 2,182 |
| nestjs/nest | 47.92% | 52.91% | 59.84% | 47.92% → 58.81% | 19,821 | 1,948 |
| oclif/core | 63.11% | 67.84% | 78.23% | 63.11% → 77.98% | 3,604 | 397 |
| pingdotgg/t3code | 67.21% | 68.99% | 72.57% | 67.21% → 72.37% | 54,604 | 12,005 |
| pmndrs/zustand | 54.38% | 64.15% | 66.78% | 54.38% → 65.43% | 2,016 | 385 |
| puppeteer/puppeteer | 50.75% | 53.97% | 64.56% | 50.75% → 64.39% | 14,201 | 1,029 |
| react-hook-form/react-hook-form | 41.14% | 50.67% | 44.97% | 41.14% → 41.66% | 6,691 | 5,693 |
| reduxjs/redux-toolkit | 39.34% | 48.94% | 54.30% | 39.34% → 53.24% | 7,072 | 1,484 |
| trpc/trpc | 53.31% | 61.94% | 69.54% | 53.31% → 69.07% | 21,675 | 5,365 |
| vitejs/vite | 59.87% | 62.79% | 56.75% | 59.87% → 56.32% | 8,277 | 599 |
| vitest-dev/vitest | 36.13% | 67.89% | 77.35% | 36.13% → 77.18% | 17,285 | 2,335 |
| withastro/astro | 52.89% | 66.15% | 76.97% | 52.89% → 76.79% | 52,297 | 6,203 |
| yargs/yargs | 33.41% | 35.12% | 42.45% | 33.41% → 42.19% | 1,214 | 105 |
| **Total** | **51.92%** | **60.29%** | **67.51%** | **51.92% → 67.06%** | **289,345** | **42,519** |

C-11 credits 938,787 of 1,390,561 links at Level 2. The 289,345 stored
library links with symbols contribute 20.81 percentage points. The 42,519
unit-only links account for 3.06% of all sites and earn Level 1. Release
0.1.0 credited 711,979 of 1,371,373 links. C-11 credits 919,599 on those same sites.
The difference in the all-sites denominators comes from TypeScript changes
merged before C-11.

## Checkout identity

The comparison against main at `595ec7b` matched all 123,219 symbol keys
and 820,506 link sites across seven repositories. It preserved 379,852
definite checkout destinations, identified by file and symbol key. The
18 corrected destinations are in tRPC's Deno example. Level 2 rose from
61.25% to 68.03% on the same 820,506 sites.

| Repository | Symbol keys | Link sites | Definite checkout destinations preserved |
| --- | ---: | ---: | ---: |
| Hono | 5,773 | 72,340 | 34,618 |
| T3 Code | 30,346 | 162,711 | 63,481 |
| Astro | 26,243 | 152,561 | 65,124 |
| Excalidraw | 13,405 | 104,519 | 61,330 |
| NestJS | 19,464 | 165,330 | 79,114 |
| Vite | 10,184 | 55,575 | 23,126 |
| tRPC | 17,804 | 107,470 | 53,059 |

Hono gains 36 checkout links. The `hono` route in
`adapters/deno/test/deno.json:11` points to `src/index.ts`. The checker
can follow its exports to `src/hono.ts`, `src/hono-base.ts` and
`src/context.ts`.

Vite resolves 136 additional existing sites to checkout declarations.
Its configs explicitly load `vite/client`. Honoring that option makes
the existing asset module declarations in `packages/vite/client.d.ts`
visible at 68 of those sites, and the hot-reload declarations in
`packages/vite/types/hot.d.ts` visible at the other 68. The module uses
its existing rule for checkout declarations at those sites.

tRPC preserves all 17,804 symbol keys, all 107,470 sites and 53,059 definite
checkout links. The 18 changed checkout links come from
`examples/deno-deploy/src/{client,index,router}.ts`. Main selected checkout v11.
`examples/deno-deploy/deno.json:5–7` selects remote 10.32.0 routes, so those
calls and import bindings stay `deno-import-unverified`.

The T3 Code sweep pin is separate from the `b387e3a1` default-heap check.

## Second-review outcome changes

The comparison uses the same sites in module 27 and the final module 28.
All rows start from a definite library outcome. The last column counts
the subset that previously had a symbol and earned Level 2.

| Review point | Final outcome | Sites | Previously Level 2 |
| --- | --- | ---: | ---: |
| 5 · Missing evidence for a package route | Unresolved | 3,718 | 3,406 |
| 6 · Missing global type declarations | Candidate set | 2,781 | 2,781 |
| 6 · Missing global type declarations | Unresolved | 19,431 | 19,431 |
| 6 · Tied compiler configurations disagree on global type availability | Unresolved | 3,158 | 3,158 |
| 7 · Node builtin and declared npm polyfill | Candidate set | 9 | 3 |
| **Total** | **2,790 candidate sets and 26,307 unresolved links** | **29,097** | **28,779** |

Excalidraw's `@site/src/initialData` and `@theme-original/MDXComponents`,
tRPC's `std/async/delay.ts` remote Deno route and Vitest's `uno.css` virtual
module stay unresolved. Vitest's `test/browser/test/polyfill-lib.test.ts:2`
stores both the Node and npm `url` candidates.
[Paired outcome counter](review-transitions.mjs)

## Node overlap and package alias revision

The Node overlap inventory uses the Node 24 globals documentation and the
project's pinned `@types/node` 24.13.3. Compare the TypeScript 5.9.3 symbols
from an ES+DOM program with their counterparts in an ES+Node program. Read
`@types/node/web-globals/fetch.d.ts` and `undici-types/fetch.d.ts` for the
global fetch types and inherited body members. This supplies the Node names
for candidate pairs. The receiver's checker identity ties inherited `Body`
members to `Request` or `Response` when the type is available.
[Node 24 globals](https://nodejs.org/docs/latest-v24.x/api/globals.html)

Hono's `src/adapter/aws-lambda/handler.ts:357` now shows `dom RequestInit` and
`node globals RequestInit` as candidates. Its
`src/adapter/cloudflare-pages/handler.test.ts:160` shows DOM
`Body.prototype.json` and Node `Response.prototype.json` for `res.json()`.
Vitest's `packages/pretty-format/src/plugins/ReactElement.ts:11` names
`npm react-is` at `18.3.1`, pinned in `packages/pretty-format/package.json`,
from its written `react-is-18` alias.
T3 Code's Bun workspace catalog in `package.json` supplies `effect` at
`4.0.0-beta.59` for 15,226 definite library links in `apps/server`.
Zod's `packages/bench/package.json:15` supplies `zod` at `4.0.8` for the
written `zod4` binding. The checkout also declares a workspace package
named `zod`.
Excalidraw's `scripts/release.js:38` pairs DOM and Node console targets for
`console.info`. Its `child_process` route independently proves the Node
`execSync` target at line 159.

An explicit `types: []` or a list without Node recovers browser declarations
from the compiler's configured libs. An explicit Node reference still opens
the shared declarations. Missing Vite, Vitest, Jest and React types affect
their own documented globals. Documented Node alternatives for URL, encoding,
performance, streams and messaging use `url`, `util`, `perf_hooks`, `stream/web`
and `worker_threads`.
[Outcome comparison](round3-transitions.mjs)

The paired comparison covers sites with missing-global evidence or a bundled
and Node pair in either graph, plus sites whose bundled outcome or identity
changed. It covers all 18 pins. The previous graph is module 28 at `3d8dea94`.

| Overlapping globals | Definite library | Candidate set | Unresolved |
| --- | ---: | ---: | ---: |
| Before | 531 | 2,786 | 23,326 |
| After | 9,052 | 17,213 | 378 |

Of the unresolved sites, 8,971 gained definite targets and 13,977 gained
candidate sets. A further 531 formerly definite sites gained alternatives.
The alias and catalog changes revised 43,003 package target identities or
versions and settled 670 unresolved links. Two package links in Dexie's
`addons/dexie-export-import/src/json-stream.ts:1` stay open because
`addons/dexie-export-import/package.json:41` names a Git repository for `clarinet`.

## Previously credited library symbols

The paired export found 35,602 released Level 2 library credits that C-11
withholds, down from 39,645 in the first review build. Explicit Node routes
survive incomplete compiler configuration when the route is independently
known. Unrelated unreadable source no longer suppresses a written outside
binding when the module route is proven. Qualified import aliases and
type-only ambient heritage recover 19 previous credits in the last replay.

| Reason for withholding Level 2 | Links | Source evidence |
| --- | ---: | --- |
| Unsupported legacy member attribution | 24,788 | The old reconstruction took an imported value's property spelling as an export path. Of these sites, 19,685 now earn unit-only credit. |
| Legacy credit for a bundler transform | 5 | T3 Code constructs a `?worker` wrapper at `apps/web/src/components/DiffWorkerPoolProvider.tsx:43`. The default export depends on the transform. |
| Legacy credit for a name omitted by a captured module | 1 | Dexie imports `config` from `qunit` at `addons/y-dexie/test/unit/dexie-unittest-utils.js:2`. The captured declaration at `addons/y-dexie/test/qunit.d.ts:1` omits that export. |
| Written name without evidence of an external package route | 168 | A bare name can select a framework alias, virtual module, tarball dependency or missing workspace entry. |
| Written name with competing Node and npm routes | 3 | Vite imports `URL` from a declared bare `url` polyfill at `playground/cli-module/vite.config.js:2`. |
| Written name with incomplete compiler configuration | 2,655 | Changesets names `vitest`'s `expect` and `it` in `packages/apply-release-plan/src/edit-json.test.ts:1`. Its missing base config leaves module resolution open. |
| Written name with an unreadable workspace manifest | 7,974 | The manifest in Vite's `playground/resolve/utf8-bom-package` fixture leaves the workspace package inventory incomplete. This includes cases also carrying the `no-unseen-declarations` assumption. |
| Written name with an unverified Deno route | 5 | Hono names `vite-plus` in `adapters/deno/vite.config.ts:1`. The nearest captured Deno map does not establish the route. |
| Written name with unseen declaration context | 3 | Astro's Preact compatibility fixture imports a written `react` binding from `packages/astro/e2e/fixtures/preact-compat-component/src/components/Counter.jsx:1`. |

The legacy measurements accepted these outside names using source
reconstruction. The current measure credits only stored definite targets.

The 7,974 workspace cases are recoverable from the pinned source once the
manifest reader handles its leading UTF-8 BOM. In a separate copy of the
Vite pin, removing only that marker exposed the workspace package name
`@vitejs/test-utf8-bom-package`. After cold and warm indexing and pairing
with the release from the same pin, withheld written-name credits fell
from 7,979 to 5. The pinned comparison and coverage plan still use the
original manifest bytes.

## Coverage-plan examples

| Support item | Newly settled reference sites | Recorded example |
| --- | ---: | --- |
| `ts-runtime` | 48 | Astro's `packages/astro/src/assets/utils/vendor/image-size/detector.ts:22` names `es Map.prototype.get`. |
| `ts-package` | 2 | Astro's `packages/integrations/markdoc/src/runtime-assets-config.ts:6` names `@markdoc/markdoc Config`. |
| `ts-package-chain` | 0 | A missing dependency declaration or package route still leaves the sampled chains open. |

[Coverage-plan input](coverage-plan-input.json.gz) · [Pinned source audit](audit.md)
