# Acceptance self-test — latest run

Generated 2026-11-15T20:22:57.301Z from commit 43bee54d. Result: **every sabotage caught**.

Wording matcher: 22/22 fixed cases correct.

Each row runs the real harness (scenario a-node-only) on a tarball broken in one way.

| Case | Break | Harness exit | Verdict | Detail |
|---|---|---|---|---|
| control | unmodified tarball | 2 | clean | exit 2; 0 failed steps; link-requirement (R1-D), link-add (R1-D), link-check (R1-D), mcp-code-graph (R1-C), mcp-requirement-links (R1-D) |
| check-exits-0 | `check` exits 0 on the broken design | 1 | caught | exit 1; check-broken: fail; failing steps: check-broken |
| grammar-removed | the vendored Go grammar is missing from the tarball | 1 | caught | exit 1; tarball-contents: fail; graph-index: fail; failing steps: tarball-contents, doctor, graph-index, graph-status, graph-ts-callers, graph-ts-callers-2, graph-go-callers, graph-go-same-package, graph-rust-callers, graph-rust-same-file, graph-ts-path, graph |
| mcp-check-design-throws | MCP `check_design` throws | 1 | caught | exit 1; mcp-check-design: fail; failing steps: mcp-check-design, mcp-check-broken |
| callers-no-links | `graph callers` returns no links | 1 | caught | exit 1; graph-ts-callers: fail; failing steps: graph-ts-callers, graph-ts-callers-2, graph-go-callers, graph-go-same-package, graph-rust-callers, graph-rust-same-file |
| caller-target-renamed | a caller link's target is renamed | 1 | caught | exit 1; graph-ts-callers: fail; failing steps: graph-ts-callers, graph-ts-callers-2, graph-go-callers, graph-go-same-package, graph-rust-callers, graph-rust-same-file |
| certainty-downgraded | caller certainty downgraded to name-only | 1 | caught | exit 1; graph-ts-callers: fail; failing steps: graph-ts-callers, graph-ts-callers-2, graph-go-callers, graph-go-same-package, graph-rust-callers, graph-rust-same-file |
| prints-java | a command prints "java" | 1 | caught | exit 1; help: fail; failing steps: install-npx, help |
| index-runs-java | `graph index` silently runs `java -version` | 1 | caught | exit 1; graph-index: fail; no-toolchain-processes: fail; failing steps: graph-index, no-toolchain-processes |
| mcp-wrong-verdict | MCP reports a failing verdict for the valid design | 1 | caught | exit 1; mcp-check-design: fail; failing steps: mcp-check-design, mcp-explore-verify, mcp-explore-simulate |
| link-crashes | `pymtheg link` crashes (exit 77) instead of today's unknown-command answer | 1 | caught | exit 1; link-requirement: fail; failing steps: link-requirement, link-add, link-check |
