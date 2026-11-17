# Source sample review

The fixed seed selected **704** eligible unresolved and ambiguous sites across 14 strata. The source review assigned **133** to sampled support items. Sites with a static shape and evidence of a checked-in target were preferred. A site that looked external or lacked a clear target stayed unassigned.

The table shows observed populations and actual sample sizes. The plan computes shares within each stratum and file scope. Links with Rust failed-file taint use the exact eligible population in the plan. Their sample remains available for inspecting examples and contributes no sampled estimate.

| Module and reason stratum | Eligible unresolved or ambiguous links | Sampled | Assigned a sampled support item |
| --- | ---: | ---: | ---: |
| `go:ambiguous` | 38,479 | 32 | 6 |
| `go:empty` | 232,330 | 96 | 4 |
| `go:other` | 149 | 32 | 0 |
| `rust:ambiguous` | 781 | 32 | 15 |
| `rust:empty` | 160,197 | 96 | 19 |
| `rust:failed-file-taint` | 10,071 | 32 | 0 |
| `rust:other` | 106,166 | 32 | 2 |
| `rust:receiver` | 153,704 | 96 | 17 |
| `typescript:ambiguous` | 4,275 | 32 | 20 |
| `typescript:external-package` | 87,772 | 32 | 14 |
| `typescript:incomplete-config` | 9,251 | 32 | 14 |
| `typescript:local` | 156,485 | 32 | 19 |
| `typescript:no-symbol` | 293,577 | 96 | 2 |
| `typescript:other` | 123,425 | 32 | 1 |

The largest remaining strata, including the unspecified Go and Rust reasons and TypeScript `no-symbol`, contain a mixture of shapes. The unresolved sites in those strata remain eligible when their target is unclassified. Some support rows have a supplemental source example from the same pinned graph. Only the fixed-seed sample contributes to the estimates.
