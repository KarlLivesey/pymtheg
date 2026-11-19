# SW-3 coverage scoreboard

Result package ` pymtheg@0.1.0 `. The baseline covers 9 pinned repositories.

## A. All 60 finish

**7 of 9 finished.**

- [ ] microsoft/TypeScript · wall-limit · open
- [ ] swc-project/swc · Rust analysis stalled at the wall limit · open

## B. Coverage of finished graphs

Level 2 counts resolved checkout links and named library symbols over all stored links. The assumed column counts Level 2 links with recorded assumptions. Level 1 also credits named library units. Strict-inside excludes the proven outside partition. Raw credits only the stored resolved outcome.
The closed-set alternative adds the sample estimate for verified complete candidate sets. Candidate evaluations reuse the reference sample.

| Files counted | Module | Graphs | Level 2 | L2 without assumptions | Assumed L2 links | Level 1 | L2 + verified closed sets (95% interval) | L2 median | Strict-inside weighted / median | Raw |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All files | Go | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| All files | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| All files | TypeScript / JS | 7 | 70.73% | 63.51% | 48,090 | 73.52% | 70.73% (70.73%–71.87%) | 71.93% | 66.18% / 69.01% | 50.16% |
| All files | Overall | 7 | 70.73% | 63.51% | 48,090 | 73.52% | 70.73% (70.73%–71.87%) | 71.93% | 66.18% / 69.01% | 50.16% |
| Without bundles | Go | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without bundles | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without bundles | TypeScript / JS | 7 | 70.73% | 63.51% | 48,090 | 73.52% | 70.73% (70.73%–71.87%) | 71.93% | 66.18% / 69.01% | 50.16% |
| Without bundles | Overall | 7 | 70.73% | 63.51% | 48,090 | 73.52% | 70.73% (70.73%–71.87%) | 71.93% | 66.18% / 69.01% | 50.16% |
| Without broken fixtures | Go | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without broken fixtures | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without broken fixtures | TypeScript / JS | 7 | 70.73% | 63.51% | 48,080 | 73.52% | 70.73% (70.73%–71.87%) | 71.93% | 66.18% / 69.01% | 50.16% |
| Without broken fixtures | Overall | 7 | 70.73% | 63.51% | 48,080 | 73.52% | 70.73% (70.73%–71.87%) | 71.93% | 66.18% / 69.01% | 50.16% |
| Without templates | Go | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without templates | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without templates | TypeScript / JS | 7 | 70.73% | 63.51% | 48,090 | 73.52% | 70.73% (70.73%–71.87%) | 71.93% | 66.18% / 69.01% | 50.16% |
| Without templates | Overall | 7 | 70.73% | 63.51% | 48,090 | 73.52% | 70.73% (70.73%–71.87%) | 71.93% | 66.18% / 69.01% | 50.16% |
| Source only | Go | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Source only | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Source only | TypeScript / JS | 7 | 70.73% | 63.51% | 48,080 | 73.52% | 70.73% (70.73%–71.87%) | 71.93% | 66.18% / 69.01% | 50.16% |
| Source only | Overall | 7 | 70.73% | 63.51% | 48,080 | 73.52% | 70.73% (70.73%–71.87%) | 71.93% | 66.18% / 69.01% | 50.16% |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 0 | 0 | 0 | 0 | 0 | 0 (0–0) |
| Rust | 0 | 0 | 0 | 0 | 0 | 0 (0–0) |
| TypeScript / JS | 161,172 | 155,528 | 18,591 | 136,937 | 5,644 | 19,945 (15,316–54,487) |
| Overall | 161,172 | 155,528 | 18,591 | 136,937 | 5,644 | 19,945 (15,316–54,487) |

### Recorded library identities by encoding

| Module | Encoding | Level 1 only | Level 2 | Example |
| --- | --- | ---: | ---: | --- |
| TypeScript / JS | import-binding | 0 | 62,611 | excalidraw/excalidraw ` dev-docs/src/components/Highlight.js:1 ` ` react → default ` |
| TypeScript / JS | reference-directive | 1 | 0 | trpc/trpc ` packages/client/src/links/loggerLink.ts:1 ` ` dom ` |
| TypeScript / JS | import-path | 18,590 | 0 | excalidraw/excalidraw ` dev-docs/docusaurus.config.js:126 ` ` prism-react-renderer ` |
| TypeScript / JS | declared-builtin | 0 | 33,101 | excalidraw/excalidraw ` examples/with-script-in-browser/components/CustomFooter.tsx:35 ` ` dom → alert ` |
| TypeScript / JS | declaring-owner | 0 | 41,225 | excalidraw/excalidraw ` dev-docs/src/components/Homepage/index.js:56 ` ` es → Array.prototype.map ` |

## Source scopes

Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.

| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | source | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | template | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | source | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 0 |
| TypeScript / JS | source | 334,026 | 16,509 | 42,094 | 161,172 | 112,080 | 7 |
| TypeScript / JS | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| TypeScript / JS | broken-fixture | 10 | 0 | 2 | 0 | 0 | 10 |
| TypeScript / JS | template | 0 | 0 | 0 | 0 | 0 | 0 |

## Repository results

Totals include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.

| Repository | Selected language | Outcome | Links | Proven outside | Level 2 | L2 without assumptions | Assumed L2 links | Level 1 | Strict-inside | Raw | Source-only L2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| excalidraw/excalidraw | TypeScript / JS | finished | 104,519 | 15,654 | 71.93% | 71.93% | 0 | 73.24% | 69.01% | 58.68% | 71.93% |
| honojs/hono | TypeScript / JS | finished | 72,340 | 8,611 | 58.24% | 58.24% | 0 | 58.73% | 54.38% | 47.90% | 58.24% |
| reduxjs/redux-toolkit | TypeScript / JS | finished | 57,208 | 14,697 | 63.87% | 63.87% | 0 | 66.53% | 56.44% | 41.94% | 63.87% |
| trpc/trpc | TypeScript / JS | finished | 107,470 | 32,985 | 73.02% | 73.02% | 0 | 78.14% | 71.23% | 49.37% | 73.02% |
| vitejs/vite | TypeScript / JS | finished | 55,575 | 9,366 | 56.64% | 44.24% | 6,896 | 57.76% | 50.34% | 41.86% | 56.65% |
| vitest-dev/vitest | TypeScript / JS | finished | 116,220 | 20,710 | 77.21% | 45.81% | 36,485 | 79.56% | 76.03% | 62.48% | 77.20% |
| withastro/astro | TypeScript / JS | finished | 152,561 | 59,149 | 76.98% | 73.89% | 4,709 | 81.23% | 69.72% | 42.69% | 76.98% |

## Rust failed-file influence

These are exact stored unresolved counts. The eligible column uses the earlier audit disposition. The L2 misses column retains tainted library sites whose symbol is unproved. One site with both failure and receiver reasons belongs to the taint item.

| Repository | Unresolved with failed-file reason | Earlier eligible | L2 misses | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
