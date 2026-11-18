# C-7 factory fallthrough and object destructuring

The candidate uses the production code in `e0a55f8` and TypeScript graph
module version 22. The built artifact digest is
`69533de591cb783da85a4fc0deec225f3f3dd35610836d9ecc8bca0847e28b51`.
Main was `efa0e9e`.

## The 42 review sites

The recheck matches every archived site by repository, captured file and
line, link kind, and written callee name. A restored link must point to
the original file, kind, scoped identity, and ordinal. The new stored
graphs restored 37 links, retained two closed two-target candidate sets,
and withheld three links with unproven receivers.
[Round 1 archive](../review-1/changed-sites.json.gz) · [Round 2 recheck](site-recheck.json.gz)

| Repository and source | Sites | Outcome and source proof |
| --- | ---: | --- |
| Redux Toolkit `ownRequestResult.test.ts` | 23 | Restored. Each destructured `gate` comes from `setup`, whose `gate` is returned by `createDeferredQueue`. |
| Redux Toolkit `invalidation.test.tsx` | 5 | Restored. The selected `providerGate` and `unrelatedGate` come from `createGate` inside `setupDelayedApi`. |
| NestJS `server-grpc.spec.ts` | 9 | Restored. The async `createCall` returns the local `call`, whose `fire` object supplies `drain` and `cancel`. |
| Redux Toolkit `fetchBaseQuery.ts:410` | 1 | Two candidates. `anySignal` supplies both the no-op `clear` and the cleanup `clear`. |
| NestJS `multipart.parser.ts:640` | 1 | Two candidates. `rejectWhenDisconnected` supplies both `stop` properties. |
| Redux Toolkit `immutableStateInvariantMiddleware.ts:264,282` | 2 | Unresolved. The receiver comes from `trackForMutations.bind(...)`, whose results are opaque to the producer check. |
| Redux Toolkit `getRunningQuery.test.ts:114` | 1 | Unresolved. The `ctx` parameter's `ReturnType<typeof setup>` annotation provides shape, and the reader has no proof of the argument's producer. |

The gRPC fixture passes `call` into `serviceMethod` before returning it.
Passing a produced object as an argument preserves its static link. A direct
reassignment of its binding contributes an alternative. A direct property
write withholds the proof when it may reach the same literal. The injector's
`Object.defineProperty` writes `CONTROLLER_ID` on a controller through an
imported constant. The RabbitMQ test writes `cancel` on a different known
object. The gRPC `cancel` link stays definite.
[gRPC factory](https://github.com/nestjs/nest/blob/085f83a168e9edbedfe9560428dcfd270073ae00/packages/microservices/test/server/server-grpc.spec.ts#L738-L805) · [Controller write](https://github.com/nestjs/nest/blob/085f83a168e9edbedfe9560428dcfd270073ae00/packages/core/injector/module.ts#L531-L538)

## Source sample

The source check used the 20 smallest SHA-256 hashes of the null-separated
seed `c-7-round-2`, repository ID, path, line, and callee among the 37
restored links. All 20 calls reached their reported targets. Lines refer
to the captured source snapshots.

| Source file | Checked call lines | Declaration in the same file |
| --- | --- | --- |
| Redux Toolkit `ownRequestResult.test.ts` | 110, 126, 214, 282, 357, 358, 392, 440, 453 | `createDeferredQueue` returns `resolveOldest` at line 10. |
| Redux Toolkit `invalidation.test.tsx` | 383, 392, 397, 412, 439 | `createGate` returns `releaseOldest` at line 194. |
| NestJS `server-grpc.spec.ts` | 837, 859, 880, 882, 909, 911 | `createCall` returns `call.fire.drain`, the shorthand property at line 781. |

## Coverage and identity

The TypeScript and JavaScript Level 2 overlay is **56.3758% on main,
58.4005% with the round 1 results on the same baseline, and
58.4056% after the fix**. The denominator is
1,586,967 links in all three calculations. The round 2
graphs add 82 covered links to
the same overlay.

On the 18 matched pins, Level 2 is **57.9757% → 60.2862%
→ 60.2921%**, over 1,390,561 links.

| Repository | Main | Round 1 | Round 2 | TS/JS link sites |
| --- | ---: | ---: | ---: | ---: |
| changesets/changesets | 40.4871% | 40.8667% | 40.8667% | 12,646 |
| colinhacks/zod | 72.5426% | 76.7688% | 76.7688% | 81,042 |
| dexie/Dexie.js | 38.1982% | 41.6815% | 41.6815% | 36,431 |
| excalidraw/excalidraw | 60.3153% | 61.5400% | 61.5496% | 104,519 |
| honojs/hono | 39.5424% | 49.9129% | 49.9129% | 72,340 |
| mermaid-js/mermaid | 56.7545% | 56.9917% | 56.9917% | 125,657 |
| nestjs/nest | 51.8932% | 52.9033% | 52.9087% | 165,330 |
| oclif/core | 65.2453% | 67.8390% | 67.8390% | 14,188 |
| pingdotgg/t3code | 68.2259% | 68.9867% | 68.9867% | 162,711 |
| pmndrs/zustand | 58.0927% | 64.1499% | 64.1499% | 7,099 |
| puppeteer/puppeteer | 52.5256% | 53.9661% | 53.9661% | 58,244 |
| react-hook-form/react-hook-form | 48.0933% | 50.6668% | 50.6668% | 49,115 |
| reduxjs/redux-toolkit | 42.6059% | 48.8883% | 48.9372% | 57,208 |
| trpc/trpc | 56.6335% | 61.9150% | 61.9373% | 107,470 |
| vitejs/vite | 62.1718% | 62.7908% | 62.7908% | 55,575 |
| vitest-dev/vitest | 66.3423% | 67.8928% | 67.8936% | 116,220 |
| withastro/astro | 65.4951% | 66.1388% | 66.1453% | 152,561 |
| yargs/yargs | 34.2892% | 35.1168% | 35.1168% | 12,205 |

The exact graph comparison against merged main covered Redux Toolkit,
NestJS, Zustand, and yargs. All 103,967 main definite links kept their
targets, all 24,412 existing symbol keys were preserved, and all 44,322
checked outside outcomes kept their reasons. The four graphs had zero
added or removed sites, so their all-site and like-for-like scores agree.
[Main graph comparison](main-comparison.json.gz)

The coverage script used the same C-4 overlay on SW-3 as the merged C-1
plan. The archived result input contains the five C-1 records plus the 18
fresh TypeScript pins. This keeps main's existing measurements for
Microsoft TypeScript and Turborepo, which had hit the wall limit in
earlier C-7 attempts. The plan has 58 of 60 finished graphs and shows all
23 generic reference samples, seven of 32 chain samples, and 15 of 37
lexical samples settled.
[C-1 plan baseline](../../c-1/merged-validation.md#coverage-plan) · [Round 2 plan input](coverage-plan-input.json.gz)

## Cold indexing

Each trial indexed a fresh store on the same dev-server source copy. Main
ran on either side of the candidate. Each cell reports wall seconds and
peak RSS in KiB. [Benchmark script](../cold.mjs)

| Repository | Main 1 s / KiB | Candidate s / KiB | Main 2 s / KiB |
| --- | ---: | ---: | ---: |
| pmndrs/zustand | 35.99 / 388,240 | 43.89 / 393,620 | 43.35 / 385,020 |
| yargs/yargs | 68.37 / 412,896 | 81.55 / 397,580 | 59.66 / 400,208 |
| yargs/yargs repeat | 75.68 / 399,008 | 37.99 / 400,548 | 39.68 / 405,424 |

The first yargs candidate took 19.3% longer than the slower main trial in
its set. Wall times varied sharply between runs on the shared server. The
repeat recorded user CPU of 12.07, 12.58, and 12.18 seconds in order. Its
candidate used 3.8% more user CPU than the average main trial. The yargs
candidate covered 101 additional Level 2 links across the same 12,205
sites relative to main.

## Validation

The production build, no-emit TypeScript check, and format check passed.
All 3,006 repository tests and 16 sweep-tool tests passed. The regressions
cover fallthrough, bare returns, optional chaining, fallback placement
relative to `await`, renamed and nested object patterns, reachable
defaults, and direct writes to the selected property.
