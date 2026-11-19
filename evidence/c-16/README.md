# C-16 TypeScript and JavaScript evidence

[Change note](../../docs/changes/C-16.md) · [Plan input](coverage-plan-input.json.gz)

The two builds replay the 18 TypeScript pins that finished in SW-1. Each
checkout is pinned by SHA and receives no package installation. The sweep
runs cold and warm indexing and queries the resulting store. Node 24.21.0
and TypeScript 5.9.3 provide the same bundled compiler libraries for both
builds.

`pins.mjs` selects the manifest. Run `scripts/sweep/run.mjs --local-build`
once per build and name the aggregate records `main-run.json` and
`candidate-run.json` in the same scratch directory. Use
`node evidence/c-16/compare.mjs SCRATCH --candidate` to compare all stored
site and symbol keys and the destinations of all definite links. TypeScript
Level 2 includes every TypeScript-module link kind in those repositories.
The paired score counts identical site identities, including their occurrence
counts.

`audit.mjs SCRATCH COMPARISON` draws new stored destinations at a fixed
rank, taking one site per eligible pin before taking a second. It prints the
pinned source and compiler configuration for review. Pass `--misses` to
read the corresponding context for the baseline draw.

For the ambient declarations, the hand review uses the Vitest pin's
`globals.d.ts`, Jest's and Mocha's public type declarations, and the Node
24 API. The TypeScript compiler's `lib.*.d.ts` files serve as the standard
library reference. [Vitest](https://github.com/vitest-dev/vitest/blob/161e25f663a838f6a30890f8a6827ff83ff1b3c7/packages/vitest/globals.d.ts) · [Jest](https://unpkg.com/@types/jest@29.5.14/index.d.ts) · [Mocha](https://unpkg.com/@types/mocha@10.0.10/index.d.ts) · [Node](https://nodejs.org/docs/latest-v24.x/api/globals.html)

The plan rows are weighted estimates from the historical source audit. They
have no stored row label for every link. The baseline draw uses historical
labels where present and source shapes elsewhere. The first stratum covers
unqualified test or Node names and roots named by non-relative imports. The
second covers standard and DOM spellings and common member names. The third
covers the remaining member and return chains. A matching spelling only
selects a site for review. It supplies no target evidence. The fixed
`pymtheg-c16-2026` hash orders 100 sites for each stratum. The paired
row counters also use checker-proven library identities when available.

Run `scripts/sweep/coverage-export.mjs` on the candidate with the SW-3
reference samples, then `scripts/sweep/coverage.mjs --base
evidence/sw-3/breakdown.json.gz`. `plan.mjs` overlays the candidate
coverage export on the preceding committed plan archives. Use
`evidence/c-11/plan.mjs` to copy the generated TypeScript / JS section to
the plan on main.

The replay audit begins with a candidate run covering all 18
pins. `replay.mjs select` selects pins with a newly credited synthetic Node
global or Vitest `bench` from the first comparison. Those are the possible
outcome changes from withholding Node globals in mixed runtimes and
removing `bench` from Vitest's ambient inventory. `replay.mjs select-deno`
selects every pin whose snapshot contains Deno settings for the scope fix.
`replay.mjs select-members` selects pins with newly stored library targets
on previously local or computed calls for the named-object guard.
`replay.mjs overlay` retains each pin's build provenance and requires a
finished replay at the same commit.

| Artifact | Pins in the final comparison | Build digest |
| --- | --- | --- |
| Main at `ef149b7` | All 18 baseline graphs | `2841597e7f0f35b9a6ad2420760c666b836d9454ca1353d84c1105d4c237fc79` |
| Initial candidate | Changesets, Dexie, oclif, Zustand, React Hook Form, yargs | `02858145d0cb7a8aaa432913d8f5d48c970123b0a3ffdfcb9f441cefd9cd7fed` |
| Mixed-runtime replay | NestJS, T3 Code | `8129c57d69e3353b7df9e89581fac9b7f6ab090d8f4f6e714d6577dd817fd7f8` |
| Scoped Deno check | Hono | `520e8076be08e0a796ecbc6a3983dcb030a41462b14bd94ceec49d833ddd1665` |
| Final named-object guard | Astro, Excalidraw, Vitest, Mermaid, Puppeteer, Zod, Vite | `e8e5dc9db553bc9d31b4aa15e12cc998c73f35674880d6f4bd88fe47ea6d8db9` |
| Post-merge recheck | tRPC, Redux Toolkit | `58f182de2e9fa180d4309e431d478db997ce0feaa618ae9b1874f5b95e840394` |

C-14 merged into main at `981b20d` during validation. Its analyzer and
scoring changes apply to Go. The 18 TypeScript pins have zero indexed Go
files. The merged build replays tRPC and Redux Toolkit and compares the
resulting 18-pin table and 60 audit records with the preceding run. The
cumulative plan incorporates the committed C-14 Go export.

## Cold indexing

Each triplet uses one copy of the pinned source on the same memory-backed
storage. The cold runner starts with a fresh store for each command and
brackets the delivery build with two main runs in one session. Time is
wall clock and memory is peak RSS.

| Pin | Main first | C-16 | Main repeat |
| --- | ---: | ---: | ---: |
| oclif | 17.86 s / 635,192 KiB | 15.92 s / 645,292 KiB | 16.19 s / 650,968 KiB |
| Redux Toolkit | 45.10 s / 1,256,768 KiB | 59.63 s / 1,241,460 KiB | 63.78 s / 1,293,976 KiB |

Redux Toolkit's main runs varied by 41% on the shared server. The candidate
time falls within that bracket. oclif's candidate finished 0.27 seconds below
the faster main run. Candidate peak RSS fell below the higher main reading
on both pins.

## Validation

The merged branch passed the production build, the TypeScript no-emit
check and the format check. All 3,085 tests in `npm test` and all 19
sweep-tool tests passed. The merged tRPC and Redux Toolkit graphs
reproduced the paired comparison and the audit records byte for byte.
