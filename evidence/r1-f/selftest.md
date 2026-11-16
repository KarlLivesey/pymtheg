# Acceptance self-test — latest run

Generated 2026-11-16T02:30:24.447Z from commit 437bb2e5. Result: **every sabotage caught**.

Wording matcher: 39/39 fixed cases correct.

Each row runs the real harness on a tarball broken in one way. A case passes only if the harness exits 1 and every named step is `fail`.

| Case | Break | Scenario | Named step(s) | Harness exit | Verdict | Detail |
|---|---|---|---|---|---|---|
| control | unmodified tarball | a-node-only | – | 0 | clean | exit 0; 0 failed steps; gaps:  |
| check-exits-0 | `check` exits 0 on the broken design | a-node-only | check-broken | 1 | caught | exit 1; check-broken: fail; all failing: check-broken |
| grammar-removed | the vendored Go grammar is missing from the tarball | a-node-only | tarball-contents, graph-index | 1 | caught | exit 1; tarball-contents: fail; graph-index: fail; all failing: tarball-contents, doctor, graph-index, graph-status, graph-ts-callers, graph-ts-callers-2, graph-go-callers, graph-go-same-package, graph-rust-callers, graph-rust-same-file, graph-ts-path, graph-s |
| mcp-check-design-throws | MCP `check_design` throws | a-node-only | mcp-check_design | 1 | caught | exit 1; mcp-check_design: fail; all failing: mcp-check_design, mcp-check_design-broken, mcp-design_interface, mcp-emit_scaffold, mcp-read_scaffold, mcp-emit_implementation_check |
| callers-no-links | `graph callers` returns no links | a-node-only | graph-ts-callers | 1 | caught | exit 1; graph-ts-callers: fail; all failing: graph-ts-callers, graph-ts-callers-2, graph-go-callers, graph-go-same-package, graph-rust-callers, graph-rust-same-file |
| caller-target-renamed | a caller link's target is renamed | a-node-only | graph-ts-callers | 1 | caught | exit 1; graph-ts-callers: fail; all failing: graph-ts-callers, graph-ts-callers-2, graph-go-callers, graph-go-same-package, graph-rust-callers, graph-rust-same-file |
| certainty-downgraded | caller certainty downgraded to name-only | a-node-only | graph-ts-callers | 1 | caught | exit 1; graph-ts-callers: fail; all failing: graph-ts-callers, graph-ts-callers-2, graph-go-callers, graph-go-same-package, graph-rust-callers, graph-rust-same-file |
| prints-java | a command prints "java" | a-node-only | help | 1 | caught | exit 1; help: fail; all failing: install-npx, help |
| index-runs-java | `graph index` silently runs `java -version` | a-node-only | graph-index, no-toolchain-processes | 1 | caught | exit 1; graph-index: fail; no-toolchain-processes: fail; all failing: graph-index, no-toolchain-processes |
| mcp-wrong-verdict | MCP reports a failing verdict for the valid design | a-node-only | mcp-check_design | 1 | caught | exit 1; mcp-check_design: fail; all failing: mcp-check_design, mcp-explore_behaviour-verify, mcp-explore_behaviour-simulate, mcp-design_interface |
| link-crashes | `pymtheg link` crashes (exit 77) | a-node-only | link-requirement | 1 | caught | exit 1; link-requirement: fail; all failing: link-requirement, link-add-go, link-add-rust, link-add-ts, link-list, link-check, link-check-after-edit, link-refresh, link-check-after-refresh, link-refresh-restored, link-check-final, mcp-requirement_links-check,  |
| stack-trace-exit-0 | `--version` prints an internal-error stack trace and exits 0 | a-node-only | version | 1 | caught | exit 1; version: fail; all failing: install-npx-file-spec, version |
| wrong-diagnostic-message | the N002 suggestion text changes | a-node-only | check-broken, mcp-check_design-broken | 1 | caught | exit 1; check-broken: fail; mcp-check_design-broken: fail; all failing: check-broken, verify-broken, mcp-check_design-broken |
| listed-tool-throws | a listed MCP tool (`design_recipe`) throws | a-node-only | mcp-design_recipe | 1 | caught | exit 1; mcp-design_recipe: fail; all failing: mcp-design_recipe |
| deprecation-warning | a coded DeprecationWarning (DEP0005) on Node 24.22 | a-node-only | help | 1 | caught | exit 1; help: fail; all failing: help |
| deprecation-warning-24.0.0 | the same DeprecationWarning on Node 24.0.0 | e-node-24.0.0 | help | 1 | caught | exit 1; help: fail; all failing: help |
| tools-list-error | `tools/list` answers with a JSON-RPC error | a-node-only | mcp-tools-list, mcp-project_info, mcp-tool-coverage, mcp-requirement_links-requirement | 1 | caught | exit 1; mcp-tools-list: fail; mcp-project_info: fail; mcp-tool-coverage: fail; mcp-requirement_links-requirement: fail; all failing: mcp-tools-list, mcp-project_info, mcp-design_recipe, mcp-read_source, mcp-check_design, mcp-check_design-broken, mcp-explore_be |
| simulate-exhaustive-true | MCP simulate reports `exhaustive: true` | a-node-only | mcp-explore_behaviour-simulate | 1 | caught | exit 1; mcp-explore_behaviour-simulate: fail; all failing: mcp-explore_behaviour-simulate |
| init-writes-root-file | `init` writes a file in the project root | a-node-only | init | 1 | caught | exit 1; init: fail; all failing: init |
| engine-hides-violation | the built-in engine turns a violation into no_counterexample | a-node-only | verify-violation | 1 | caught | exit 1; verify-violation: fail; all failing: doctor, verify-violation |
| link-check-passes-changed | `link check` exits 0 with a changed link | a-node-only | link-check-after-edit | 1 | caught | exit 1; link-check-after-edit: fail; all failing: link-check-after-edit |
| mcp-link-check-ok-after-edit | MCP `requirement_links check` reports every link ok after a body edit | a-node-only | mcp-requirement_links-check-after-edit | 1 | caught | exit 1; mcp-requirement_links-check-after-edit: fail; all failing: mcp-requirement_links-check-after-edit |
| link-add-stores-nothing | `add` reports created but stores no link | a-node-only | mcp-requirement_links-add-go, link-add-go | 1 | caught | exit 1; mcp-requirement_links-add-go: fail; link-add-go: fail; all failing: link-add-go, link-add-rust, link-add-ts, link-list, link-check, link-check-after-edit, link-refresh, link-check-after-refresh, link-refresh-restored, link-check-final, mcp-requirement_ |
| go-facts-discarded | Go toolchain facts counted but discarded at final resolution | c-node-go-rust | go-toolchain-callers | 1 | caught | exit 1; go-toolchain-callers: fail; all failing: go-toolchain-callers |
| stack-in-mcp-json | `project_info` carries a TypeError stack in a `debug` field (structuredContent and text) | a-node-only | mcp-project_info | 1 | caught | exit 1; mcp-project_info: fail; all failing: mcp-project_info |
| stack-in-graph-json | `graph status --json` carries a TypeError stack in a `debug` field | a-node-only | graph-status | 1 | caught | exit 1; graph-status: fail; all failing: graph-status |
| writes-into-install | `graph index` writes a cache file inside the installed package (next to import.meta.url) | a-node-only | install-unchanged, writes-outside-project | 1 | caught | exit 1; install-unchanged: fail; writes-outside-project: fail; all failing: writes-outside-project, install-unchanged |
| stack-in-mcp-text-only | `project_info` carries a TypeError stack in its text content only (structuredContent untouched) | a-node-only | mcp-project_info | 1 | caught | exit 1; mcp-project_info: fail; all failing: mcp-project_info |
| unlinked-includes-linked | MCP `unlinked` also lists the already-linked `apply_discount` | a-node-only | mcp-requirement_links-unlinked | 1 | caught | exit 1; mcp-requirement_links-unlinked: fail; all failing: mcp-requirement_links-unlinked |
| unlinked-ignores-rust-links | `unlinked` ignores links to Rust symbols (lists the linked `apply_discount`) | a-node-only | mcp-requirement_links-unlinked | 1 | caught | exit 1; mcp-requirement_links-unlinked: fail; all failing: mcp-requirement_links-unlinked |
| code-graph-candidate | MCP `code_graph` reports a definite caller as a candidate | a-node-only | mcp-code_graph-callers-ts | 1 | caught | exit 1; mcp-code_graph-callers-ts: fail; all failing: mcp-code_graph-callers-ts, mcp-code_graph-callers-go, mcp-code_graph-callers-rust |
