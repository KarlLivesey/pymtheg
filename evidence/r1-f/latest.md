# Clean-machine acceptance — latest run

Generated 2026-11-15T20:16:54.345Z from commit 43bee54d by `scripts/acceptance/run.mjs`. Verdict: **known-gaps**.

Counts: pass 215, observed 12, expected-fail 12, known-gap 35. Tarball pymtheg-1.0.0.tgz: 2.16 MiB packed, 9.76 MiB unpacked, 884 files.

Durations, sizes and memory are observations on the dev server, not limits.

## Known gaps

| Scenario | Step | Chunk | Reason |
|---|---|---|---|
| a-node-only | link-requirement | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| a-node-only | link-add | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| a-node-only | link-check | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| a-node-only | mcp-code-graph | R1-C | tool `code_graph` not in the tool list (tool code_graph is not in tools/list) |
| a-node-only | mcp-requirement-links | R1-D | no tool named *code_link* or *requirement* in the tool list (no tool named *code_link* or *requirement* in the tool list) |
| b-node-git | link-requirement | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| b-node-git | link-add | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| b-node-git | link-check | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| b-node-git | mcp-code-graph | R1-C | tool `code_graph` not in the tool list (tool code_graph is not in tools/list) |
| b-node-git | mcp-requirement-links | R1-D | no tool named *code_link* or *requirement* in the tool list (no tool named *code_link* or *requirement* in the tool list) |
| c-node-go-rust | link-requirement | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| c-node-go-rust | link-add | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| c-node-go-rust | link-check | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| c-node-go-rust | mcp-code-graph | R1-C | tool `code_graph` not in the tool list (tool code_graph is not in tools/list) |
| c-node-go-rust | mcp-requirement-links | R1-D | no tool named *code_link* or *requirement* in the tool list (no tool named *code_link* or *requirement* in the tool list) |
| c-node-go-rust | go-toolchain-index | W3-L2 | W3-L2 wiring not merged: the setting is ignored (no toolchain field, no go process) (toolchain "absent", expected state "used") |
| d-global | link-requirement | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| d-global | link-add | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| d-global | link-check | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| d-global | mcp-code-graph | R1-C | tool `code_graph` not in the tool list (tool code_graph is not in tools/list) |
| d-global | mcp-requirement-links | R1-D | no tool named *code_link* or *requirement* in the tool list (no tool named *code_link* or *requirement* in the tool list) |
| d-local | link-requirement | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| d-local | link-add | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| d-local | link-check | R1-D | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| d-local | mcp-code-graph | R1-C | tool `code_graph` not in the tool list (tool code_graph is not in tools/list) |
| d-local | mcp-requirement-links | R1-D | no tool named *code_link* or *requirement* in the tool list (no tool named *code_link* or *requirement* in the tool list) |
| e-node-24.0.0 | help | R1-H | Node warning: (node:207) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| e-node-24.0.0 | init | R1-H | Node warning: (node:230) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| e-node-24.0.0 | doctor | R1-H | Node warning: (node:254) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| e-node-24.0.0 | check-valid | R1-H | Node warning: (node:281) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| e-node-24.0.0 | verify-valid | R1-H | Node warning: (node:305) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| e-node-24.0.0 | simulate-valid | R1-H | Node warning: (node:331) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| e-node-24.0.0 | check-broken | R1-H | Node warning: (node:357) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| e-node-24.0.0 | graph-index | R1-H | Node warning: (node:381) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| e-node-24.0.0 | graph-ts-callers | R1-H | Node warning: (node:404) ExperimentalWarning: SQLite is an experimental feature and might change at any time |

## 0-build

Release build: npm ci, npm run build, npm pack in a node:24.21.0 container.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| npm-ci | pass | 0 | yes | 4.4 s (observation); 7 npm warning lines |
| npm-run-build | pass | 0 | yes | 27.6 s (observation); 0 npm warning lines |
| npm-pack | pass | 0 | yes | 2.7 s (observation); 0 npm warning lines |
| tarball-contents | pass | – | yes | 884 files, 2.16 MiB packed, 9.76 MiB unpacked |
| package-private | observed | – | no | "private": true — npm refuses to publish it, so `npx pymtheg` from the registry cannot work until the owner decides to publish; `npx ./pymtheg-*.tgz` works without publishing |
| package-engines | observed | – | no | engines.node ">=24"; optionalDependencies {} |

## a-node-only

Node only: install from the tarball with npx, then init, doctor, check/verify/simulate, a broken design, graph (TypeScript, Go and Rust source-only), requirement links, MCP over stdio and Studio over HTTP; no backend or toolchain process and no Java/Quint/TLC wording.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | pass | 0 | yes | 8.0 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| install-size | observed | 0 | no | ~/.npm/_npx 84.9 MiB; ~/.npm/_cacache 69.5 MiB (apparent file sizes) |
| npx-absolute-path | observed | 126 | no | exit 126: sh: 1: /acc/pkg/pymtheg-1.0.0.tgz: Permission denied |
| help | pass | 0 | yes | ok |
| version | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | Node, Verifier, Simulator, Storage, Go code graph, Rust code graph, TypeScript code graph, Studio: ready |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed exactly as specified |
| verify-broken | expected-fail | 1 | yes | failed exactly as specified |
| graph-index | pass | 0 | yes | 9 files, 28 symbols, 66 links |
| graph-status | pass | 0 | yes | ok |
| graph-ts-callers | pass | 0 | yes | renderBasket@web/src/main.ts:definite |
| graph-ts-callers-2 | pass | 0 | yes | formatTotal@web/src/format.ts:definite |
| graph-go-callers | pass | 0 | yes | main@service/main.go:definite |
| graph-go-same-package | pass | 0 | yes | ComputeTotal@service/pricing/total.go:definite |
| graph-rust-callers | pass | 0 | yes | main@engine/src/main.rs:definite |
| graph-rust-same-file | pass | 0 | yes | apply_discount@engine/src/discount.rs:definite |
| graph-ts-path | pass | 0 | yes | ok |
| graph-search | pass | 0 | yes | ok |
| link-requirement | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| link-add | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| link-check | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | pass | – | yes | 17 tools |
| mcp-check-design | pass | – | yes | ok |
| mcp-check-broken | pass | – | yes | ok |
| mcp-explore-verify | pass | – | yes | ok |
| mcp-explore-simulate | pass | – | yes | ok |
| mcp-code-graph | known-gap (R1-C) | – | yes | tool `code_graph` not in the tool list (tool code_graph is not in tools/list) |
| mcp-requirement-links | known-gap (R1-D) | – | yes | no tool named *code_link* or *requirement* in the tool list (no tool named *code_link* or *requirement* in the tool list) |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | pass | – | yes | ok |
| studio-assets | pass | – | yes | 4 assets HTTP 200 |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | pass | 0 | yes | ok |
| writes-outside-project | observed | 0 | no | 4075 /home/node/.npm/_npx; 135 /home/node/.npm/_cacache; 11 /home/node/.npm/_logs |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## b-node-git

Same as (a) in a git repository (git installed with apt before the install step), plus exactly what init does to git state.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| setup-git | pass | – | yes | git version 2.39.5 |
| install-npx | pass | 0 | yes | 8.1 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| git-setup | pass | 0 | yes | ok |
| help | pass | 0 | yes | ok |
| version | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| git-status-after-init | pass | 0 | yes | ok |
| git-tracked-unchanged | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | Node, Verifier, Simulator, Storage, Go code graph, Rust code graph, TypeScript code graph, Studio: ready |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed exactly as specified |
| verify-broken | expected-fail | 1 | yes | failed exactly as specified |
| graph-index | pass | 0 | yes | 9 files, 28 symbols, 66 links |
| graph-status | pass | 0 | yes | ok |
| graph-ts-callers | pass | 0 | yes | renderBasket@web/src/main.ts:definite |
| graph-ts-callers-2 | pass | 0 | yes | formatTotal@web/src/format.ts:definite |
| graph-go-callers | pass | 0 | yes | main@service/main.go:definite |
| graph-go-same-package | pass | 0 | yes | ComputeTotal@service/pricing/total.go:definite |
| graph-rust-callers | pass | 0 | yes | main@engine/src/main.rs:definite |
| graph-rust-same-file | pass | 0 | yes | apply_discount@engine/src/discount.rs:definite |
| graph-ts-path | pass | 0 | yes | ok |
| graph-search | pass | 0 | yes | ok |
| link-requirement | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| link-add | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| link-check | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | pass | – | yes | 17 tools |
| mcp-check-design | pass | – | yes | ok |
| mcp-check-broken | pass | – | yes | ok |
| mcp-explore-verify | pass | – | yes | ok |
| mcp-explore-simulate | pass | – | yes | ok |
| mcp-code-graph | known-gap (R1-C) | – | yes | tool `code_graph` not in the tool list (tool code_graph is not in tools/list) |
| mcp-requirement-links | known-gap (R1-D) | – | yes | no tool named *code_link* or *requirement* in the tool list (no tool named *code_link* or *requirement* in the tool list) |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | pass | – | yes | ok |
| studio-assets | pass | – | yes | 4 assets HTTP 200 |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | pass | 0 | yes | ok |
| git-status-end | pass | 0 | yes | ok |
| writes-outside-project | observed | 0 | no | 4075 /home/node/.npm/_npx; 135 /home/node/.npm/_cacache; 11 /home/node/.npm/_logs |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## c-node-go-rust

Same as (a) with Go and Rust toolchains (copied from the official golang and rust images) on PATH: the source-only graph is identical and nothing runs them by default; with graph.toolchain.go on, `go` runs and links are upgraded.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| setup-toolchains | pass | – | yes | golang:1-bookworm, rust:1-slim-bookworm: go version go1.27.4 linux/amd64; cargo 1.100.0 (3acc79c0c 2026-11-05) |
| install-npx | pass | 0 | yes | 7.4 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| toolchains-present | observed | 0 | no | go version go1.27.4 linux/amd64; cargo 1.100.0 (3acc79c0c 2026-11-05); rustc 1.100.0 (0ef1bc386 2026-11-09) |
| help | pass | 0 | yes | ok |
| version | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | Node, Verifier, Simulator, Storage, Go code graph, Rust code graph, TypeScript code graph, Studio: ready |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed exactly as specified |
| verify-broken | expected-fail | 1 | yes | failed exactly as specified |
| graph-index | pass | 0 | yes | 9 files, 28 symbols, 66 links |
| graph-status | pass | 0 | yes | ok |
| graph-ts-callers | pass | 0 | yes | renderBasket@web/src/main.ts:definite |
| graph-ts-callers-2 | pass | 0 | yes | formatTotal@web/src/format.ts:definite |
| graph-go-callers | pass | 0 | yes | main@service/main.go:definite |
| graph-go-same-package | pass | 0 | yes | ComputeTotal@service/pricing/total.go:definite |
| graph-rust-callers | pass | 0 | yes | main@engine/src/main.rs:definite |
| graph-rust-same-file | pass | 0 | yes | apply_discount@engine/src/discount.rs:definite |
| graph-ts-path | pass | 0 | yes | ok |
| graph-search | pass | 0 | yes | ok |
| link-requirement | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| link-add | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| link-check | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | pass | – | yes | 17 tools |
| mcp-check-design | pass | – | yes | ok |
| mcp-check-broken | pass | – | yes | ok |
| mcp-explore-verify | pass | – | yes | ok |
| mcp-explore-simulate | pass | – | yes | ok |
| mcp-code-graph | known-gap (R1-C) | – | yes | tool `code_graph` not in the tool list (tool code_graph is not in tools/list) |
| mcp-requirement-links | known-gap (R1-D) | – | yes | no tool named *code_link* or *requirement* in the tool list (no tool named *code_link* or *requirement* in the tool list) |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | pass | – | yes | ok |
| studio-assets | pass | – | yes | 4 assets HTTP 200 |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | pass | 0 | yes | ok |
| go-project-init | pass | 0 | yes | ok |
| go-toolchain-index | known-gap (W3-L2) | 0 | yes | W3-L2 wiring not merged: the setting is ignored (no toolchain field, no go process) (toolchain "absent", expected state "used") |
| go-toolchain-off-again | pass | 0 | yes | ok |
| no-toolchain-processes | pass | – | yes | log empty in every step |
| graph-identical-to-node-only | pass | – | yes | 9 graph results identical |

## d-global

npm install --global of the tarball: the binary resolves grammars, web assets and helpers from the installed location.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-global | pass | 0 | yes | 7.1 s (observation); 6 npm warning lines |
| network-off | pass | – | yes | ok |
| install-size | observed | 0 | no | ~/.npm/_cacache 69.5 MiB; ~/.npm-global 84.8 MiB (apparent file sizes) |
| bin-location | pass | 0 | yes | ok |
| help | pass | 0 | yes | ok |
| version | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | Node, Verifier, Simulator, Storage, Go code graph, Rust code graph, TypeScript code graph, Studio: ready |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed exactly as specified |
| verify-broken | expected-fail | 1 | yes | failed exactly as specified |
| graph-index | pass | 0 | yes | 9 files, 28 symbols, 66 links |
| graph-status | pass | 0 | yes | ok |
| graph-ts-callers | pass | 0 | yes | renderBasket@web/src/main.ts:definite |
| graph-ts-callers-2 | pass | 0 | yes | formatTotal@web/src/format.ts:definite |
| graph-go-callers | pass | 0 | yes | main@service/main.go:definite |
| graph-go-same-package | pass | 0 | yes | ComputeTotal@service/pricing/total.go:definite |
| graph-rust-callers | pass | 0 | yes | main@engine/src/main.rs:definite |
| graph-rust-same-file | pass | 0 | yes | apply_discount@engine/src/discount.rs:definite |
| graph-ts-path | pass | 0 | yes | ok |
| graph-search | pass | 0 | yes | ok |
| link-requirement | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| link-add | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| link-check | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | pass | – | yes | 17 tools |
| mcp-check-design | pass | – | yes | ok |
| mcp-check-broken | pass | – | yes | ok |
| mcp-explore-verify | pass | – | yes | ok |
| mcp-explore-simulate | pass | – | yes | ok |
| mcp-code-graph | known-gap (R1-C) | – | yes | tool `code_graph` not in the tool list (tool code_graph is not in tools/list) |
| mcp-requirement-links | known-gap (R1-D) | – | yes | no tool named *code_link* or *requirement* in the tool list (no tool named *code_link* or *requirement* in the tool list) |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | pass | – | yes | ok |
| studio-assets | pass | – | yes | 4 assets HTTP 200 |
| studio-stop | pass | 0 | yes | ok |
| init-with-legacy-folder | pass | 0 | yes | ok |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## d-local

npm install of the tarball as a dependency of another package, then npx pymtheg.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-local | pass | 0 | yes | 7.0 s (observation); 6 npm warning lines |
| network-off | pass | – | yes | ok |
| install-size | observed | 0 | no | ~/.npm/_cacache 69.5 MiB; ~/app/node_modules 84.8 MiB (apparent file sizes) |
| help | pass | 0 | yes | ok |
| version | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | Node, Verifier, Simulator, Storage, Go code graph, Rust code graph, TypeScript code graph, Studio: ready |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed exactly as specified |
| verify-broken | expected-fail | 1 | yes | failed exactly as specified |
| graph-index | pass | 0 | yes | 9 files, 28 symbols, 66 links |
| graph-status | pass | 0 | yes | ok |
| graph-ts-callers | pass | 0 | yes | renderBasket@web/src/main.ts:definite |
| graph-ts-callers-2 | pass | 0 | yes | formatTotal@web/src/format.ts:definite |
| graph-go-callers | pass | 0 | yes | main@service/main.go:definite |
| graph-go-same-package | pass | 0 | yes | ComputeTotal@service/pricing/total.go:definite |
| graph-rust-callers | pass | 0 | yes | main@engine/src/main.rs:definite |
| graph-rust-same-file | pass | 0 | yes | apply_discount@engine/src/discount.rs:definite |
| graph-ts-path | pass | 0 | yes | ok |
| graph-search | pass | 0 | yes | ok |
| link-requirement | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| link-add | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| link-check | known-gap (R1-D) | 3 | yes | `pymtheg link` is an unknown command (exit 3, the unknown-command message) (exit 3, expected 0) |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | pass | – | yes | 17 tools |
| mcp-check-design | pass | – | yes | ok |
| mcp-check-broken | pass | – | yes | ok |
| mcp-explore-verify | pass | – | yes | ok |
| mcp-explore-simulate | pass | – | yes | ok |
| mcp-code-graph | known-gap (R1-C) | – | yes | tool `code_graph` not in the tool list (tool code_graph is not in tools/list) |
| mcp-requirement-links | known-gap (R1-D) | – | yes | no tool named *code_link* or *requirement* in the tool list (no tool named *code_link* or *requirement* in the tool list) |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | pass | – | yes | ok |
| studio-assets | pass | – | yes | 4 assets HTTP 200 |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | pass | 0 | yes | ok |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## e-node-24.0.0

Lowest Node release engines ">=24" allows: install, doctor and the core commands.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | pass | 0 | yes | 8.1 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| node-version | observed | 0 | no | v24.0.0 |
| help | known-gap (R1-H) | 0 | yes | Node warning: (node:207) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| init | known-gap (R1-H) | 0 | yes | Node warning: (node:230) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| doctor | known-gap (R1-H) | 0 | yes | Node warning: (node:254) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| check-valid | known-gap (R1-H) | 0 | yes | Node warning: (node:281) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| verify-valid | known-gap (R1-H) | 0 | yes | Node warning: (node:305) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| simulate-valid | known-gap (R1-H) | 0 | yes | Node warning: (node:331) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| check-broken | known-gap (R1-H) | 1 | yes | Node warning: (node:357) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| graph-index | known-gap (R1-H) | 0 | yes | Node warning: (node:381) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| graph-ts-callers | known-gap (R1-H) | 0 | yes | Node warning: (node:404) ExperimentalWarning: SQLite is an experimental feature and might change at any time |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## e-node-25

Node 25 (supported by engines ">=24"): install, doctor and the core commands.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | pass | 0 | yes | 9.1 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| node-version | observed | 0 | no | v25.9.0 |
| help | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | ok |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed exactly as specified |
| graph-index | pass | 0 | yes | ok |
| graph-ts-callers | pass | 0 | yes | ok |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## e-node-26

Node 26 (supported by engines ">=24"): install, doctor and the core commands.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | pass | 0 | yes | 9.0 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| node-version | observed | 0 | no | v26.13.1 |
| help | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | ok |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed exactly as specified |
| graph-index | pass | 0 | yes | ok |
| graph-ts-callers | pass | 0 | yes | ok |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## f-restic

restic (a larger real Go project): init, graph index and five queries; time and peak memory are observations.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | pass | 0 | yes | 12.0 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| restic-init | pass | 0 | yes | 6.4 s (observation) |
| restic-graph-index | pass | 0 | yes | 559 files, 7356 symbols, 63088 links, 0 failed; 108.3 s, peak RSS ≥ 2093 MiB (observations) |
| restic-status | pass | 0 | yes | ok; {"matches":0,"symbols":0,"links":0,"callers":0,"observedLinks":0}; 3.2 s, peak RSS ≥ 161 MiB (observations) |
| restic-search | pass | 0 | yes | ok; {"matches":20,"symbols":0,"links":0,"callers":0,"observedLinks":0}; 3.3 s, peak RSS ≥ 160 MiB (observations) |
| restic-callers | pass | 0 | yes | ambiguous; {"matches":6,"symbols":0,"links":0,"callers":0,"observedLinks":0}; 3.4 s, peak RSS ≥ 162 MiB (observations) |
| restic-callees | pass | 0 | yes | ok; {"matches":0,"symbols":1,"links":57,"callers":0,"observedLinks":0}; 3.3 s, peak RSS ≥ 160 MiB (observations) |
| restic-impact | pass | 0 | yes | ambiguous; {"matches":3,"symbols":0,"links":0,"callers":0,"observedLinks":0}; 3.4 s, peak RSS ≥ 162 MiB (observations) |
| restic-path | pass | 0 | yes | ambiguous; {"matches":7,"symbols":0,"links":0,"callers":0,"observedLinks":0}; 3.3 s, peak RSS ≥ 158 MiB (observations) |
| no-toolchain-processes | pass | – | yes | log empty in every step |
