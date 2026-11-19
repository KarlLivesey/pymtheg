# TypeScript and JavaScript Level 2 on the 18 released pins

The replay of release 0.1.0 reproduced the committed SW-3 counts on all
18 pins. The main column uses the merged C-7 coverage archive. The
shared-site comparison matches file, source span, link kind and written
name at the same pin. The last two columns count definite stored library
links in C-11.

| Repository | 0.1.0 all sites | Main all sites | C-11 all sites | 0.1.0 → C-11 shared sites | Stored symbol | Stored unit only |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| changesets/changesets | 39.87% | 40.87% | 20.15% | 39.87% → 19.91% | 738 | 154 |
| colinhacks/zod | 71.00% | 76.77% | 83.86% | 71.00% → 83.75% | 18,237 | 602 |
| dexie/Dexie.js | 34.91% | 41.68% | 53.67% | 34.91% → 52.95% | 5,470 | 371 |
| excalidraw/excalidraw | 57.79% | 61.55% | 71.93% | 57.79% → 71.62% | 13,852 | 1,325 |
| honojs/hono | 36.00% | 49.91% | 57.45% | 36.00% → 56.50% | 6,902 | 337 |
| mermaid-js/mermaid | 54.56% | 56.99% | 70.30% | 54.56% → 70.09% | 34,126 | 2,182 |
| nestjs/nest | 47.92% | 52.91% | 59.84% | 47.92% → 58.81% | 19,817 | 1,948 |
| oclif/core | 63.11% | 67.84% | 78.23% | 63.11% → 77.98% | 3,604 | 397 |
| pingdotgg/t3code | 67.21% | 68.99% | 72.34% | 67.21% → 72.14% | 54,224 | 12,005 |
| pmndrs/zustand | 54.38% | 64.15% | 66.78% | 54.38% → 65.43% | 2,016 | 385 |
| puppeteer/puppeteer | 50.75% | 53.97% | 64.56% | 50.75% → 64.38% | 14,200 | 1,029 |
| react-hook-form/react-hook-form | 41.14% | 50.67% | 44.92% | 41.14% → 41.62% | 6,669 | 5,693 |
| reduxjs/redux-toolkit | 39.34% | 48.94% | 54.16% | 39.34% → 53.09% | 6,989 | 1,484 |
| trpc/trpc | 53.31% | 61.94% | 69.49% | 53.31% → 69.02% | 21,618 | 5,365 |
| vitejs/vite | 59.87% | 62.79% | 56.64% | 59.87% → 56.21% | 8,217 | 599 |
| vitest-dev/vitest | 36.13% | 67.89% | 77.19% | 36.13% → 77.01% | 17,095 | 2,335 |
| withastro/astro | 52.89% | 66.15% | 76.97% | 52.89% → 76.79% | 52,306 | 6,203 |
| yargs/yargs | 33.41% | 35.12% | 42.45% | 33.41% → 42.19% | 1,214 | 105 |
| **Total** | **51.92%** | **60.29%** | **67.36%** | **51.92% → 66.91%** | **287,294** | **42,519** |

C-11 credits 936,736 of 1,390,561 links at Level 2. The 287,294 stored
library links with symbols contribute 20.66 percentage points. The 42,519
unit-only links account for 3.06% of all sites and earn Level 1. Release
0.1.0 credited 711,979 of 1,371,373 links. C-11 credits 917,548 on those same sites.
The difference in the all-sites denominators comes from TypeScript changes
merged before C-11.

The module 29 review head at `dfc36b3` credited 938,787 links overall and
919,599 on the release's same sites. Module 30 credits 2,051 fewer links in
both comparisons. Module 31 matches the module 30 counts in both comparisons.

## Checkout identity

The module 29 comparison against main at `595ec7b` matched all 123,219 symbol keys
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

Module 30 repeated the Hono comparison and preserved these counts.
Module 31 repeated the Excalidraw comparison and preserved its 61,330
definite checkout destinations, 13,405 symbol keys and 104,519 link sites.

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

An explicit `types` list narrows automatic ambient discovery. Transitive
package references and Node evidence in sibling files can still open shared
globals. Missing Vite, Vitest, Jest and React types affect their own
documented globals. Documented Node alternatives for URL, encoding,
performance, streams and messaging use `url`, `util`, `perf_hooks`, `stream/web`
and `worker_threads`.
[Outcome comparison](round3-transitions.mjs)

The paired comparison covers sites with missing-global evidence or a bundled
and Node pair in either graph, plus sites whose bundled outcome or identity
changed. It covers all 18 pins, comparing module 28 at `3d8dea94` with the
module 31 revision.

| Overlapping globals | Definite library | Candidate set | Unresolved |
| --- | ---: | ---: | ---: |
| Before | 747 | 2,796 | 23,326 |
| After | 7,217 | 19,260 | 392 |

Of the unresolved sites, 7,208 gained definite targets and 15,734 gained
candidate sets. A further 739 formerly definite sites gained alternatives.
The alias and catalog changes revised 43,003 package target identities or
versions and settled 670 unresolved links. Two package links in Dexie's
`addons/dexie-export-import/src/json-stream.ts:1` stay open because
`addons/dexie-export-import/package.json:41` names a Git repository for `clarinet`.

## Program-wide Node evidence

Module 30 follows checkout class and interface bases to shared runtime
declarations. An unshadowed `require()` in explicit CommonJS supplies local
Node evidence. Node evidence applies to all files in the compiler program.
An imported package or configured type package whose declarations are
absent can introduce Node globals when the program declares `@types/node`.

The counts below compare against the replay with the heritage, CommonJS and
`CryptoKey` fixes in place. The program-wide rule moved 2,053 definite links
to candidate sets. The `ImportMeta` overlap adds two further candidate sets
in Vitest. The CommonJS fix moves four Redux Toolkit links to candidate sets.
Mermaid's `.vite/jsonSchemaPlugin.ts:13` (`URL`) and
`packages/mermaid/src/rendering-util/layout-algorithms/grid/edgeLabels.spec.ts:810`
(`structuredClone`) both gained Node candidates.

| Pin | Program rule: definite → candidate set |
| --- | ---: |
| changesets/changesets | 5 |
| colinhacks/zod | 133 |
| dexie/Dexie.js | 150 |
| excalidraw/excalidraw | 772 |
| honojs/hono | 1 |
| mermaid-js/mermaid | 207 |
| nestjs/nest | 3 |
| oclif/core | 0 |
| pingdotgg/t3code | 380 |
| pmndrs/zustand | 0 |
| puppeteer/puppeteer | 0 |
| react-hook-form/react-hook-form | 22 |
| reduxjs/redux-toolkit | 78 |
| trpc/trpc | 57 |
| vitejs/vite | 57 |
| vitest-dev/vitest | 188 |
| withastro/astro | 0 |
| yargs/yargs | 0 |
| **Total** | **2,053** |

Module 31 also recognizes an unshadowed `require()` in a `.js` file whose
nearest package manifest leaves `type` unset, and accepts `(require)()` in
CommonJS files. The new fixture exercises both forms in separate programs.
The 18-pin source scan selected Dexie, Excalidraw, Mermaid, oclif, Puppeteer,
React Hook Form, Redux Toolkit, Vite and yargs for replay. The paired link
comparison found zero outcome, library target identity or missing-global
reason changes on those pins. The overlapping-global counts and the
coverage-plan input therefore carry over from module 30.

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
