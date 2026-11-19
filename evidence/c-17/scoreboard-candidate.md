# SW-3 coverage scoreboard

Result package ` pymtheg@0.1.0 `. The baseline covers 20 pinned repositories.

## A. All 60 finish

**20 of 20 finished.**


## B. Coverage of finished graphs

Level 2 counts resolved checkout links and named library symbols over all stored links. The assumed column counts Level 2 links with recorded assumptions. Level 1 also credits named library units. Strict-inside excludes the proven outside partition. Raw credits only the stored resolved outcome.
The closed-set alternative adds the sample estimate for verified complete candidate sets. Candidate evaluations reuse the reference sample.

| Files counted | Module | Graphs | Level 2 | L2 without assumptions | Assumed L2 links | Level 1 | L2 + verified closed sets (95% interval) | L2 median | Strict-inside weighted / median | Raw |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All files | Go | 20 | 91.22% | 91.22% | 0 | 93.37% | 91.22% (91.22%–91.36%) | 91.69% | 91.11% / 92.04% | 67.64% |
| All files | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| All files | TypeScript / JS | 7 | 57.48% | 57.48% | 0 | 57.84% | 57.48% (57.48%–58.01%) | 60.61% | 51.68% / 52.13% | 45.02% |
| All files | Overall | 20 | 87.74% | 87.74% | 0 | 89.70% | 87.74% (87.74%–87.92%) | 90.38% | 86.42% / 91.08% | 65.31% |
| Without bundles | Go | 20 | 91.22% | 91.22% | 0 | 93.37% | 91.22% (91.22%–91.36%) | 91.69% | 91.11% / 92.04% | 67.64% |
| Without bundles | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without bundles | TypeScript / JS | 7 | 70.81% | 70.81% | 0 | 72.09% | 70.81% (70.81%–72.48%) | 72.88% | 62.52% / 57.07% | 46.15% |
| Without bundles | Overall | 20 | 90.58% | 90.58% | 0 | 92.71% | 90.58% (90.58%–90.78%) | 91.05% | 90.23% / 91.71% | 66.98% |
| Without broken fixtures | Go | 20 | 91.22% | 91.22% | 0 | 93.37% | 91.22% (91.22%–91.36%) | 91.69% | 91.11% / 92.04% | 67.64% |
| Without broken fixtures | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without broken fixtures | TypeScript / JS | 7 | 57.48% | 57.48% | 0 | 57.84% | 57.48% (57.48%–58.01%) | 60.61% | 51.68% / 52.13% | 45.02% |
| Without broken fixtures | Overall | 20 | 87.74% | 87.74% | 0 | 89.70% | 87.74% (87.74%–87.92%) | 90.38% | 86.42% / 91.08% | 65.31% |
| Without templates | Go | 20 | 91.22% | 91.22% | 0 | 93.37% | 91.22% (91.22%–91.36%) | 91.69% | 91.11% / 92.04% | 67.64% |
| Without templates | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Without templates | TypeScript / JS | 7 | 57.48% | 57.48% | 0 | 57.84% | 57.48% (57.48%–58.01%) | 60.61% | 51.68% / 52.13% | 45.02% |
| Without templates | Overall | 20 | 87.74% | 87.74% | 0 | 89.70% | 87.74% (87.74%–87.92%) | 90.38% | 86.42% / 91.08% | 65.31% |
| Source only | Go | 20 | 91.22% | 91.22% | 0 | 93.37% | 91.22% (91.22%–91.36%) | 91.69% | 91.11% / 92.04% | 67.64% |
| Source only | Rust | 0 | — | — | 0 | — | — (—–—) | — | — / — | — |
| Source only | TypeScript / JS | 7 | 70.81% | 70.81% | 0 | 72.09% | 70.81% (70.81%–72.48%) | 72.88% | 62.52% / 57.07% | 46.15% |
| Source only | Overall | 20 | 90.58% | 90.58% | 0 | 92.71% | 90.58% (90.58%–90.78%) | 91.05% | 90.23% / 91.71% | 66.98% |

## What the released store says about outside links

Unit and symbol counts are exact on stored links with proof of outside origin. The final column estimates additional outside sites whose current facts name neither.
The audit recovers these identities from paths, import bindings, named declaring traits or directives. The target-ID slot points to a symbol in a captured file. The released graph has no first-class external target nodes.

| Module | Proven outside | Named unit, including L2 | Unit only | Unit and symbol | Neither, proven outside | Additional outside with neither (95% interval) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | 389,768 | 389,227 | 32,531 | 356,696 | 541 | 4,632 (3,042–28,653) |
| Rust | 0 | 0 | 0 | 0 | 0 | 0 (0–0) |
| TypeScript / JS | 22,424 | 22,299 | 620 | 21,679 | 125 | 3,527 (968–35,478) |
| Overall | 412,192 | 411,526 | 33,151 | 378,375 | 666 | 8,159 (5,146–62,995) |

### Recorded library identities by encoding

| Module | Encoding | Level 1 only | Level 2 | Example |
| --- | --- | ---: | ---: | --- |
| Go | import-binding | 0 | 211,901 | charmbracelet/bubbletea ` color.go:39 ` ` image/color → Color ` |
| Go | import-path | 32,531 | 0 | charmbracelet/bubbletea ` color.go:4 ` ` image/color ` |
| Go | declared-builtin | 0 | 48,840 | charmbracelet/bubbletea ` commands.go:42 ` ` builtin → append ` |
| Go | declaring-owner | 0 | 95,955 | charmbracelet/bubbletea ` commands.go:104 ` ` time → Time.Sub ` |
| TypeScript / JS | import-binding | 0 | 4,338 | cli/cli ` .github/extensions/terminal-mockup/extension.mjs:7 ` ` http → createServer ` |
| TypeScript / JS | import-path | 620 | 0 | cli/cli ` .github/extensions/terminal-mockup/extension.mjs:7 ` ` http ` |
| TypeScript / JS | declared-builtin | 0 | 4,810 | cli/cli ` .github/extensions/terminal-mockup/assets/ansi.js:21 ` ` es → Set ` |
| TypeScript / JS | declaring-owner | 0 | 12,531 | cli/cli ` .github/extensions/terminal-mockup/assets/ansi.js:34 ` ` es → Array.prototype.push ` |

## Source scopes

Counts include every observed link. Broken and template files that produced no links appear in the failed-source column.

| Module | Scope | Resolved | Ambiguous | Inside | Outside | Unclassified | Failed source files |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Go | source | 1,023,393 | 36,693 | 181 | 389,768 | 62,963 | 3 |
| Go | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Go | broken-fixture | 0 | 0 | 0 | 0 | 0 | 14 |
| Go | template | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | source | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | bundle | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| Rust | template | 0 | 0 | 0 | 0 | 0 | 0 |
| TypeScript / JS | source | 22,293 | 1,759 | 888 | 12,652 | 10,717 | 0 |
| TypeScript / JS | bundle | 56,064 | 121 | 20,116 | 9,772 | 39,656 | 0 |
| TypeScript / JS | broken-fixture | 0 | 0 | 0 | 0 | 0 | 0 |
| TypeScript / JS | template | 0 | 0 | 0 | 0 | 0 | 0 |

## Repository results

Totals include every module in a finished checkout. For each attempt, the archive holds the full link breakdown and the explicit inside, outside and unclassified counts for every file scope.

| Repository | Selected language | Outcome | Links | Proven outside | Level 2 | L2 without assumptions | Assumed L2 links | Level 1 | Strict-inside | Raw | Source-only L2 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| charmbracelet/bubbletea | Go | finished | 12,533 | 3,630 | 86.71% | 86.71% | 0 | 90.64% | 87.02% | 61.81% | 86.71% |
| cilium/ebpf | Go | finished | 50,239 | 14,419 | 92.36% | 92.36% | 0 | 95.29% | 93.40% | 66.59% | 92.36% |
| cli/cli | Go | finished | 218,286 | 65,670 | 90.08% | 90.08% | 0 | 93.23% | 90.37% | 63.18% | 90.56% |
| cockroachdb/pebble | Go | finished | 214,346 | 46,027 | 89.82% | 89.82% | 0 | 91.72% | 89.47% | 70.25% | 91.41% |
| etcd-io/bbolt | Go | finished | 16,898 | 5,488 | 93.09% | 93.09% | 0 | 96.09% | 94.22% | 63.62% | 93.09% |
| evanw/esbuild | Go | finished | 118,250 | 15,603 | 95.84% | 95.84% | 0 | 96.41% | 95.87% | 83.22% | 95.84% |
| gin-gonic/gin | Go | finished | 21,081 | 9,254 | 93.49% | 93.49% | 0 | 95.82% | 92.57% | 51.93% | 93.49% |
| go-task/task | Go | finished | 18,984 | 6,301 | 91.57% | 91.57% | 0 | 95.04% | 92.62% | 61.88% | 91.57% |
| gofiber/fiber | Go | finished | 143,673 | 47,361 | 87.30% | 87.30% | 0 | 88.93% | 83.54% | 56.00% | 87.30% |
| golang/tools | Go | finished | 253,517 | 86,089 | 92.23% | 92.23% | 0 | 95.03% | 92.59% | 61.15% | 92.88% |
| junegunn/fzf | Go | finished | 25,947 | 4,880 | 89.54% | 89.54% | 0 | 90.85% | 88.74% | 72.05% | 89.54% |
| labstack/echo | Go | finished | 31,880 | 13,812 | 95.17% | 95.17% | 0 | 97.45% | 95.62% | 54.19% | 95.17% |
| mattn/go-sqlite3 | Go | finished | 9,650 | 4,780 | 84.09% | 84.09% | 0 | 86.96% | 74.80% | 37.75% | 84.09% |
| pocketbase/pocketbase | Go | finished | 197,148 | 30,189 | 66.43% | 66.43% | 0 | 67.55% | 61.71% | 52.26% | 84.37% |
| protocolbuffers/protobuf-go | Go | finished | 217,087 | 14,299 | 88.56% | 88.56% | 0 | 89.13% | 88.36% | 82.54% | 88.56% |
| restic/restic | Go | finished | 64,165 | 18,103 | 90.68% | 90.68% | 0 | 94.13% | 92.00% | 66.05% | 90.68% |
| samber/lo | Go | finished | 29,697 | 12,816 | 85.91% | 85.91% | 0 | 86.90% | 77.55% | 44.09% | 85.91% |
| spf13/cobra | Go | finished | 8,886 | 2,612 | 92.20% | 92.20% | 0 | 94.20% | 91.79% | 64.81% | 92.20% |
| stretchr/testify | Go | finished | 19,868 | 5,740 | 93.30% | 93.30% | 0 | 94.41% | 92.14% | 65.52% | 93.30% |
| wagoodman/dive | Go | finished | 14,901 | 5,119 | 86.98% | 86.98% | 0 | 92.22% | 88.23% | 57.92% | 86.98% |

## Rust failed-file influence

These are exact stored unresolved counts. The eligible column uses the earlier audit disposition. The L2 misses column retains tainted library sites whose symbol is unproved. One site with both failure and receiver reasons belongs to the taint item.

| Repository | Unresolved with failed-file reason | Earlier eligible | L2 misses | Tainted and blocked | Also receiver-unverified | All unresolved marked blocked |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |

## Outside-link review checks

These counts use source evidence from the full primary-module breakdown for the SW-1 review cases. For example, yargs imports its own build output, so `missing-module` on those relative paths remains inside. Unproven package links and return types stay unclassified.

| Repository | Outside / unresolved | Outside / unresolved imports |
| --- | ---: | ---: |
| gin-gonic/gin | 9,254 / 9,582 (96.58%) | 490 / 490 |
