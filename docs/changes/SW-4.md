# SW-4 coverage plan from a fresh sweep

The coverage plan for 0.2.0 now uses one build and one observed corpus across
the three languages. The headline counts all stored links by source language.
A second table restricts each language to its own pins. The comparison stays
at the 0.1.0 release, with its original finished graphs.

The sweep starts each pin from the fixed public checkout. TypeScript also runs
with lockfile dependencies installed and lifecycle scripts disabled. The Go
comparison opts in to the offline toolchain and records where existing cached
packages supply usable facts. Rust uses the source graph and shows its
assumption-marked links separately.

Every current missing link contributes its stored kind and reason list to an
exact inventory. The first reason owns its support item count. A new
proportional draw of 150 bare links per language checks those diagnostics
against the pinned source. The plan shows potential gains and source-only
ceilings as ranges, with the sample and its uncertainty preserved in evidence.

The fresh bare score across all pins is 91.94% for Go, 44.60% for Rust and
68.82% for TypeScript and JavaScript. The previous plan's partial overlays
showed 89.79%, 44.27% and 67.69%, respectively. Across the 20 Go pins alone,
the fresh score is 91.22%, the same as the earlier Go measurement. Microsoft
TypeScript's Go code alone adds 485,580 Go links to the all-pin denominator.
The previous plan at `404ee031715022855ef29d1084de3d85f19ac1ca`
estimated an 87.77% source-only ceiling, below both fresh Go scores.
[Fresh archive](../../evidence/sw-4/coverage-plan-input.json.gz) · [Earlier Go measurement](C-17.md)

The previous Rust failed-file item assigned 13.04 points to a reason that
often applied to unrelated links. The fresh finished graphs have zero below-
Level-2 Rust links with the corrected reason. The earlier fixes to the
diagnostic and grammar account for the retirement of that estimate.
[Failed-file diagnosis](C-15.md) · [Rust grammar recovery](C-21.md)

SWC reached the limit in cold Rust analysis after 3,601.4 seconds at a
recorded 4,283,260 KiB peak. Microsoft TypeScript finished in 2,608.3 seconds
at 5,108,004 KiB. Its TypeScript compiler assertion marked all 27,194
TypeScript and JavaScript files failed, so the links it contributes to the
bare score come from its Go code. The later large-checkout fix recorded a
different TypeScript stall and did not form part of the measured build.
[Per-pin measurements](../../evidence/sw-4/attempts.md) · [Earlier TypeScript run](C-2.md) · [Later compiler containment work](C-13.md)

Embassy completed its cold index and reached the limit in warm Rust analysis
after 3,601.0 seconds at a recorded 4,659,916 KiB peak. The coverage tables
use attempts that completed the cold index, warm index and queries.
[Per-pin measurements](../../evidence/sw-4/attempts.md)

Turborepo also finished incomplete. The stored graph contains Go and Rust
links. The TypeScript analysis reported an invalid UTF-16 range and marked
all 3,094 TypeScript and JavaScript files failed.
[Per-pin measurements](../../evidence/sw-4/attempts.md)

The installed Nest attempt used the installation policy at the measured
commit. npm returned `ERESOLVE`. A later change added the contributor
guide's peer-resolution flag for this pin. The sweep keeps the observed
bare fallback. [Later installation change](C-23.md)

Fifteen installed attempts finished. Microsoft TypeScript installed its
dependencies and reached the deadline in cold analysis after 3,610.9
seconds at a recorded 3,760,956 KiB peak. The scores keep its bare graph.
Zod and T3 Code declared unsupported package managers, and Turborepo's
pnpm rejected the sweep's virtual store option. They also use bare graphs.
[Installed attempt receipts](../../evidence/sw-4/attempts.md)

On the TypeScript pins alone, the fresh installed score is 80.37%, up
from 70.42% bare. The earlier installed sweep reached 80.28% over the
same 1,390,561 links. Across every source language's pins, the fresh
installed TypeScript score is 77.54%.
[Fresh archive](../../evidence/sw-4/coverage-plan-input.json.gz) · [Earlier installed sweep](C-20.md)

The offline Go toolchain completed all 20 Go pins. It reported 872 of
2,191 packages as clean using local sources and the existing module cache.
The opt-in score is 92.06% on these pins and 92.58% with the bare Go links
in the other pins included. The opt-in graphs have 17 fewer stored Go
links overall across changes in four pins.
[Per-pin toolchain reports](../../evidence/sw-4/attempts.md) · [Fresh archive](../../evidence/sw-4/coverage-plan-input.json.gz)

[Current plan](../coverage-plan.md) · [Per-pin attempts](../../evidence/sw-4/attempts.md) · [Added and retired items](../../evidence/sw-4/items.md) · [Archive and source review](../../evidence/sw-4/README.md)
