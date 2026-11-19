# C-11 first review evidence

At Hono's pin `676c8f80`, the graph records 65 `jsr @std/assert`
targets and zero `npm @std/assert` targets. The standard config gives
38 targets across the three `runtime-tests/deno` files. Both explicitly
selected JSX configs give the same JSR route for the other 27 in
`runtime-tests/deno-jsx/jsx.test.tsx`. The replay analyzed all 460
TypeScript and JavaScript files and recorded 5,773 symbols.

## Repository self-index on tmpfs

The unchanged repository initialization test ran alone in each invocation.
Test scratch was on tmpfs, including the graph store. Main was `6b3cdf2`.
The review head in this bracket was `b61f9f3`. Each row is wall seconds,
combined user and system CPU seconds, and peak RSS in KiB. The disk-backed
corpus replays were active during this bracket.

| Trial | Main wall / CPU / RSS | C-11 wall / CPU / RSS |
| --- | ---: | ---: |
| 1 | 57.25 / 86.18 / 1,015,824 | 68.30 / 99.53 / 1,078,036 |
| 2 | 58.13 / 86.02 / 1,068,828 | 75.46 / 104.87 / 1,093,308 |
| 3 | 69.65 / 98.06 / 1,125,068 | 70.09 / 99.12 / 1,096,960 |

All six passed the existing hang guard and assertions. C-11 used 12.3%
more combined CPU across the bracket. Mean wall time was 15.6% higher.
Wall time varied by 12.40 seconds across the main runs.

The first review build (`f1131ae`) averaged 18.0% more wall time and 15.0%
more CPU in its three-pair bracket. Sampling the longest CLI index process
recorded 15.02 → 16.51 seconds in TypeScript extraction, 10.73 → 10.90 in
the rest of TypeScript analysis, and 18.11 → 24.60 inside graph storage.
The extracted TypeScript stacks included 1.10 seconds in the lexical
binding reader and 0.31 in the direct-write scan.

The next build cached repeated module and importer decisions and narrowed
the write scan to the relevant syntax nodes. When an unresolved link gains
its first definite library target, the final build now inserts that row
directly. The existing insert trigger updates the class. This transition
avoids a target-update statement and two deletes of absent relationships.
[Timing and profiling runner](self-index-review.mjs)
