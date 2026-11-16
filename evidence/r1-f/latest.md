# Clean-machine acceptance — latest run

Generated 2026-11-16T02:00:24.031Z from commit 0857f2f2 by `scripts/acceptance/run.mjs`. Verdict: **pass**.

Counts: pass 466, observed 10, expected-fail 23. Tarball pymtheg-1.0.0.tgz: 1.75 MiB packed, 8.60 MiB unpacked, 831 files.

Durations, sizes and memory are observations on the dev server, not limits.

## Known gaps

None.

## 0-build

Release build: npm ci, npm run build, npm pack in a node:24.21.0 container.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| npm-ci | pass | 0 | yes | 4.5 s (observation); 7 npm warning lines |
| npm-run-build | pass | 0 | yes | 25.5 s (observation); 0 npm warning lines |
| npm-pack | pass | 0 | yes | 2.5 s (observation); 0 npm warning lines |
| tarball-contents | pass | – | yes | 831 files, 1.75 MiB packed, 8.60 MiB unpacked |
| package-private | observed | – | no | "private": true — npm refuses to publish it, so `npx pymtheg` from the registry cannot work until the owner decides to publish; `npx ./pymtheg-*.tgz` works without publishing |
| package-engines | observed | – | no | engines.node ">=24"; optionalDependencies {} |

## a-node-only

Node only: install from the tarball with npx, then init, doctor, check/verify/simulate, a broken design, graph (TypeScript, Go and Rust source-only), requirement links, MCP over stdio and Studio over HTTP; no backend or toolchain process and no Java/Quint/TLC wording.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | pass | 0 | yes | 3.9 s (observation); 0 npm warning lines |
| install-npx-file-spec | pass | 0 | yes | 3.1 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| install-size | observed | 0 | no | ~/.npm/_npx 97.7 MiB; ~/.npm/_cacache 30.5 MiB (apparent file sizes) |
| npx-absolute-path | observed | 126 | no | exit 126: sh: 1: /acc/pkg/pymtheg-1.0.0.tgz: Permission denied |
| help | pass | 0 | yes | ok |
| version | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | Node, Verifier, Simulator, Storage, Go code graph, Rust code graph, TypeScript code graph, Studio: ready |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| verify-violation | expected-fail | 1 | yes | failed exactly as specified |
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
| link-requirement | pass | 0 | yes | ok |
| link-add-go | pass | 0 | yes | ok |
| link-add-rust | pass | 0 | yes | ok |
| link-add-ts | pass | 0 | yes | ok |
| link-list | pass | 0 | yes | ok |
| link-check | pass | 0 | yes | ok |
| link-check-after-edit | expected-fail | 1 | yes | failed exactly as specified |
| link-refresh | pass | 0 | yes | ok |
| link-check-after-refresh | pass | 0 | yes | ok |
| link-refresh-restored | pass | 0 | yes | ok |
| link-check-final | pass | 0 | yes | ok |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | pass | – | yes | 21 tools: read_architecture, compare_implementation, read_implementation, observe_implementation, link_implementation, unlink_implementation, code_graph, graph_result, design_recipe, try_inputs, project_info, read_source |
| mcp-project_info | pass | – | yes | ok |
| mcp-design_recipe | pass | – | yes | ok |
| mcp-read_source | pass | – | yes | ok |
| mcp-check_design | pass | – | yes | ok |
| mcp-check_design-broken | pass | – | yes | ok |
| mcp-explore_behaviour-verify | pass | – | yes | ok |
| mcp-explore_behaviour-simulate | pass | – | yes | ok |
| mcp-try_inputs | pass | – | yes | ok |
| mcp-design_interface | pass | – | yes | ok |
| mcp-emit_scaffold | pass | – | yes | ok |
| mcp-read_scaffold | pass | – | yes | ok |
| mcp-emit_implementation_check | pass | – | yes | ok |
| mcp-code_graph-index | pass | – | yes | ok |
| mcp-code_graph-search | pass | – | yes | ok |
| mcp-code_graph-callers-ts | pass | – | yes | ok |
| mcp-code_graph-callers-go | pass | – | yes | ok |
| mcp-code_graph-callers-rust | pass | – | yes | ok |
| mcp-requirement_links-requirement | pass | – | yes | ok |
| mcp-requirement_links-add-go | pass | – | yes | ok |
| mcp-requirement_links-add-rust | pass | – | yes | ok |
| mcp-requirement_links-add-ts | pass | – | yes | ok |
| mcp-requirement_links-list | pass | – | yes | ok |
| mcp-requirement_links-check | pass | – | yes | ok |
| mcp-requirement_links-check-after-edit | pass | – | yes | ok |
| mcp-requirement_links-refresh | pass | – | yes | ok |
| mcp-requirement_links-check-after-refresh | pass | – | yes | ok |
| mcp-requirement_links-refresh-restored | pass | – | yes | ok |
| mcp-requirement_links-check-final | pass | – | yes | ok |
| mcp-requirement_links-requirements_for | pass | – | yes | ok |
| mcp-requirement_links-unlinked | pass | – | yes | ok |
| mcp-link_result-handle | pass | – | yes | ok |
| mcp-read_architecture | pass | – | yes | ok |
| mcp-observe_implementation | pass | – | yes | ok |
| mcp-link_implementation | pass | – | yes | ok |
| mcp-compare_implementation | pass | – | yes | ok |
| mcp-unlink_implementation | pass | – | yes | ok |
| mcp-tool-coverage | pass | – | yes | 21 tools listed, all called |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | pass | – | yes | ok |
| studio-assets | pass | – | yes | 4 assets HTTP 200 |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | pass | 0 | yes | ok |
| writes-outside-project | pass | 1 | yes | all inside allowed places: ~/project/ 13; ~/.npm/_logs/ 11; ~/.npm/_cacache/ 2; ~/.npm/_npx/ 2; ~/legacy/ 22; /acc/ 3 |
| install-unchanged | pass | – | yes | 4726 files under ~/.npm/_npx unchanged |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## b-node-git

Same as (a) in a git repository (git installed with apt before the install step), plus exactly what init does to git state.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| setup-git | pass | – | yes | git version 2.39.5 |
| install-npx | pass | 0 | yes | 3.9 s (observation); 0 npm warning lines |
| install-npx-file-spec | pass | 0 | yes | 3.3 s (observation); 0 npm warning lines |
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
| verify-violation | expected-fail | 1 | yes | failed exactly as specified |
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
| link-requirement | pass | 0 | yes | ok |
| link-add-go | pass | 0 | yes | ok |
| link-add-rust | pass | 0 | yes | ok |
| link-add-ts | pass | 0 | yes | ok |
| link-list | pass | 0 | yes | ok |
| link-check | pass | 0 | yes | ok |
| link-check-after-edit | expected-fail | 1 | yes | failed exactly as specified |
| link-refresh | pass | 0 | yes | ok |
| link-check-after-refresh | pass | 0 | yes | ok |
| link-refresh-restored | pass | 0 | yes | ok |
| link-check-final | pass | 0 | yes | ok |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | pass | – | yes | 21 tools: read_architecture, compare_implementation, read_implementation, observe_implementation, link_implementation, unlink_implementation, code_graph, graph_result, design_recipe, try_inputs, project_info, read_source |
| mcp-project_info | pass | – | yes | ok |
| mcp-design_recipe | pass | – | yes | ok |
| mcp-read_source | pass | – | yes | ok |
| mcp-check_design | pass | – | yes | ok |
| mcp-check_design-broken | pass | – | yes | ok |
| mcp-explore_behaviour-verify | pass | – | yes | ok |
| mcp-explore_behaviour-simulate | pass | – | yes | ok |
| mcp-try_inputs | pass | – | yes | ok |
| mcp-design_interface | pass | – | yes | ok |
| mcp-emit_scaffold | pass | – | yes | ok |
| mcp-read_scaffold | pass | – | yes | ok |
| mcp-emit_implementation_check | pass | – | yes | ok |
| mcp-code_graph-index | pass | – | yes | ok |
| mcp-code_graph-search | pass | – | yes | ok |
| mcp-code_graph-callers-ts | pass | – | yes | ok |
| mcp-code_graph-callers-go | pass | – | yes | ok |
| mcp-code_graph-callers-rust | pass | – | yes | ok |
| mcp-requirement_links-requirement | pass | – | yes | ok |
| mcp-requirement_links-add-go | pass | – | yes | ok |
| mcp-requirement_links-add-rust | pass | – | yes | ok |
| mcp-requirement_links-add-ts | pass | – | yes | ok |
| mcp-requirement_links-list | pass | – | yes | ok |
| mcp-requirement_links-check | pass | – | yes | ok |
| mcp-requirement_links-check-after-edit | pass | – | yes | ok |
| mcp-requirement_links-refresh | pass | – | yes | ok |
| mcp-requirement_links-check-after-refresh | pass | – | yes | ok |
| mcp-requirement_links-refresh-restored | pass | – | yes | ok |
| mcp-requirement_links-check-final | pass | – | yes | ok |
| mcp-requirement_links-requirements_for | pass | – | yes | ok |
| mcp-requirement_links-unlinked | pass | – | yes | ok |
| mcp-link_result-handle | pass | – | yes | ok |
| mcp-read_architecture | pass | – | yes | ok |
| mcp-observe_implementation | pass | – | yes | ok |
| mcp-link_implementation | pass | – | yes | ok |
| mcp-compare_implementation | pass | – | yes | ok |
| mcp-unlink_implementation | pass | – | yes | ok |
| mcp-tool-coverage | pass | – | yes | 21 tools listed, all called |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | pass | – | yes | ok |
| studio-assets | pass | – | yes | 4 assets HTTP 200 |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | pass | 0 | yes | ok |
| git-status-end | pass | 0 | yes | ok |
| writes-outside-project | pass | 1 | yes | all inside allowed places: ~/project/ 63; ~/.npm/_logs/ 11; ~/.npm/_cacache/ 2; ~/.npm/_npx/ 2; ~/legacy/ 22; /acc/ 3 |
| install-unchanged | pass | – | yes | 4726 files under ~/.npm/_npx unchanged |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## c-node-go-rust

Same as (a) with Go and Rust toolchains (copied from the official golang and rust images) on PATH: the source-only graph is identical and nothing runs them by default; with graph.toolchain.go on, `go` runs and links are upgraded.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| setup-toolchains | pass | – | yes | golang:1-bookworm, rust:1-slim-bookworm: go version go1.27.4 linux/amd64; cargo 1.100.0 (3acc79c0c 2026-11-05) |
| install-npx | pass | 0 | yes | 4.1 s (observation); 0 npm warning lines |
| install-npx-file-spec | pass | 0 | yes | 3.3 s (observation); 0 npm warning lines |
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
| verify-violation | expected-fail | 1 | yes | failed exactly as specified |
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
| link-requirement | pass | 0 | yes | ok |
| link-add-go | pass | 0 | yes | ok |
| link-add-rust | pass | 0 | yes | ok |
| link-add-ts | pass | 0 | yes | ok |
| link-list | pass | 0 | yes | ok |
| link-check | pass | 0 | yes | ok |
| link-check-after-edit | expected-fail | 1 | yes | failed exactly as specified |
| link-refresh | pass | 0 | yes | ok |
| link-check-after-refresh | pass | 0 | yes | ok |
| link-refresh-restored | pass | 0 | yes | ok |
| link-check-final | pass | 0 | yes | ok |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | pass | – | yes | 21 tools: read_architecture, compare_implementation, read_implementation, observe_implementation, link_implementation, unlink_implementation, code_graph, graph_result, design_recipe, try_inputs, project_info, read_source |
| mcp-project_info | pass | – | yes | ok |
| mcp-design_recipe | pass | – | yes | ok |
| mcp-read_source | pass | – | yes | ok |
| mcp-check_design | pass | – | yes | ok |
| mcp-check_design-broken | pass | – | yes | ok |
| mcp-explore_behaviour-verify | pass | – | yes | ok |
| mcp-explore_behaviour-simulate | pass | – | yes | ok |
| mcp-try_inputs | pass | – | yes | ok |
| mcp-design_interface | pass | – | yes | ok |
| mcp-emit_scaffold | pass | – | yes | ok |
| mcp-read_scaffold | pass | – | yes | ok |
| mcp-emit_implementation_check | pass | – | yes | ok |
| mcp-code_graph-index | pass | – | yes | ok |
| mcp-code_graph-search | pass | – | yes | ok |
| mcp-code_graph-callers-ts | pass | – | yes | ok |
| mcp-code_graph-callers-go | pass | – | yes | ok |
| mcp-code_graph-callers-rust | pass | – | yes | ok |
| mcp-requirement_links-requirement | pass | – | yes | ok |
| mcp-requirement_links-add-go | pass | – | yes | ok |
| mcp-requirement_links-add-rust | pass | – | yes | ok |
| mcp-requirement_links-add-ts | pass | – | yes | ok |
| mcp-requirement_links-list | pass | – | yes | ok |
| mcp-requirement_links-check | pass | – | yes | ok |
| mcp-requirement_links-check-after-edit | pass | – | yes | ok |
| mcp-requirement_links-refresh | pass | – | yes | ok |
| mcp-requirement_links-check-after-refresh | pass | – | yes | ok |
| mcp-requirement_links-refresh-restored | pass | – | yes | ok |
| mcp-requirement_links-check-final | pass | – | yes | ok |
| mcp-requirement_links-requirements_for | pass | – | yes | ok |
| mcp-requirement_links-unlinked | pass | – | yes | ok |
| mcp-link_result-handle | pass | – | yes | ok |
| mcp-read_architecture | pass | – | yes | ok |
| mcp-observe_implementation | pass | – | yes | ok |
| mcp-link_implementation | pass | – | yes | ok |
| mcp-compare_implementation | pass | – | yes | ok |
| mcp-unlink_implementation | pass | – | yes | ok |
| mcp-tool-coverage | pass | – | yes | 21 tools listed, all called |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | pass | – | yes | ok |
| studio-assets | pass | – | yes | 4 assets HTTP 200 |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | pass | 0 | yes | ok |
| go-project-init | pass | 0 | yes | ok |
| go-toolchain-index | pass | 0 | yes | 1 links upgraded; processes: sh -c, go env, go build, golinks-b78189ed4ced0505 -go, golinks-b78189ed4ced0505 -go |
| go-toolchain-callers | pass | 0 | yes | main@main.go:10->Add:definite:toolchain, main@main.go:10->Add:definite:toolchain, main@main.go:13->Add:definite:toolchain, main@main.go:15->Add:definite:toolchain, main@main.go:17->Add:definite:toolchain |
| go-toolchain-off-again | pass | 0 | yes | ok |
| go-source-only-callers | pass | 0 | yes | main@main.go:10->Add:definite:source, main@main.go:10->Add:definite:source, main@main.go:15->Add:definite:source, main@main.go:17->Add:definite:source |
| writes-outside-project | pass | 1 | yes | all inside allowed places: ~/project/ 13; ~/.config/go/ 1; ~/.npm/_logs/ 11; ~/.npm/_cacache/ 2; ~/.npm/_npx/ 2; ~/legacy/ 22; ~/goproject/ 12; /acc/ 3 |
| install-unchanged | pass | – | yes | 4726 files under ~/.npm/_npx unchanged |
| no-toolchain-processes | pass | – | yes | log empty in every step |
| graph-identical-to-node-only | pass | – | yes | 9 graph results identical |

## d-global

npm install --global of the tarball: the binary resolves grammars, web assets and helpers from the installed location.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-global | pass | 0 | yes | 3.6 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| install-size | observed | 0 | no | ~/.npm/_cacache 30.5 MiB; ~/.npm-global 48.9 MiB (apparent file sizes) |
| bin-location | pass | 0 | yes | ok |
| help | pass | 0 | yes | ok |
| version | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | Node, Verifier, Simulator, Storage, Go code graph, Rust code graph, TypeScript code graph, Studio: ready |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| verify-violation | expected-fail | 1 | yes | failed exactly as specified |
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
| link-requirement | pass | 0 | yes | ok |
| link-add-go | pass | 0 | yes | ok |
| link-add-rust | pass | 0 | yes | ok |
| link-add-ts | pass | 0 | yes | ok |
| link-list | pass | 0 | yes | ok |
| link-check | pass | 0 | yes | ok |
| link-check-after-edit | expected-fail | 1 | yes | failed exactly as specified |
| link-refresh | pass | 0 | yes | ok |
| link-check-after-refresh | pass | 0 | yes | ok |
| link-refresh-restored | pass | 0 | yes | ok |
| link-check-final | pass | 0 | yes | ok |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | pass | – | yes | 21 tools: read_architecture, compare_implementation, read_implementation, observe_implementation, link_implementation, unlink_implementation, code_graph, graph_result, design_recipe, try_inputs, project_info, read_source |
| mcp-project_info | pass | – | yes | ok |
| mcp-design_recipe | pass | – | yes | ok |
| mcp-read_source | pass | – | yes | ok |
| mcp-check_design | pass | – | yes | ok |
| mcp-check_design-broken | pass | – | yes | ok |
| mcp-explore_behaviour-verify | pass | – | yes | ok |
| mcp-explore_behaviour-simulate | pass | – | yes | ok |
| mcp-try_inputs | pass | – | yes | ok |
| mcp-design_interface | pass | – | yes | ok |
| mcp-emit_scaffold | pass | – | yes | ok |
| mcp-read_scaffold | pass | – | yes | ok |
| mcp-emit_implementation_check | pass | – | yes | ok |
| mcp-code_graph-index | pass | – | yes | ok |
| mcp-code_graph-search | pass | – | yes | ok |
| mcp-code_graph-callers-ts | pass | – | yes | ok |
| mcp-code_graph-callers-go | pass | – | yes | ok |
| mcp-code_graph-callers-rust | pass | – | yes | ok |
| mcp-requirement_links-requirement | pass | – | yes | ok |
| mcp-requirement_links-add-go | pass | – | yes | ok |
| mcp-requirement_links-add-rust | pass | – | yes | ok |
| mcp-requirement_links-add-ts | pass | – | yes | ok |
| mcp-requirement_links-list | pass | – | yes | ok |
| mcp-requirement_links-check | pass | – | yes | ok |
| mcp-requirement_links-check-after-edit | pass | – | yes | ok |
| mcp-requirement_links-refresh | pass | – | yes | ok |
| mcp-requirement_links-check-after-refresh | pass | – | yes | ok |
| mcp-requirement_links-refresh-restored | pass | – | yes | ok |
| mcp-requirement_links-check-final | pass | – | yes | ok |
| mcp-requirement_links-requirements_for | pass | – | yes | ok |
| mcp-requirement_links-unlinked | pass | – | yes | ok |
| mcp-link_result-handle | pass | – | yes | ok |
| mcp-read_architecture | pass | – | yes | ok |
| mcp-observe_implementation | pass | – | yes | ok |
| mcp-link_implementation | pass | – | yes | ok |
| mcp-compare_implementation | pass | – | yes | ok |
| mcp-unlink_implementation | pass | – | yes | ok |
| mcp-tool-coverage | pass | – | yes | 21 tools listed, all called |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | pass | – | yes | ok |
| studio-assets | pass | – | yes | 4 assets HTTP 200 |
| studio-stop | pass | 0 | yes | ok |
| init-with-legacy-folder | pass | 0 | yes | ok |
| writes-outside-project | pass | 1 | yes | all inside allowed places: ~/project/ 13; ~/legacy/ 22; /acc/ 3 |
| install-unchanged | pass | – | yes | 2359 files under ~/.npm-global/lib/node_modules/pymtheg unchanged |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## d-local

npm install of the tarball as a dependency of another package, then npx pymtheg.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-local | pass | 0 | yes | 3.4 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| install-size | observed | 0 | no | ~/.npm/_cacache 30.5 MiB; ~/app/node_modules 48.9 MiB (apparent file sizes) |
| help | pass | 0 | yes | ok |
| version | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | Node, Verifier, Simulator, Storage, Go code graph, Rust code graph, TypeScript code graph, Studio: ready |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| verify-violation | expected-fail | 1 | yes | failed exactly as specified |
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
| link-requirement | pass | 0 | yes | ok |
| link-add-go | pass | 0 | yes | ok |
| link-add-rust | pass | 0 | yes | ok |
| link-add-ts | pass | 0 | yes | ok |
| link-list | pass | 0 | yes | ok |
| link-check | pass | 0 | yes | ok |
| link-check-after-edit | expected-fail | 1 | yes | failed exactly as specified |
| link-refresh | pass | 0 | yes | ok |
| link-check-after-refresh | pass | 0 | yes | ok |
| link-refresh-restored | pass | 0 | yes | ok |
| link-check-final | pass | 0 | yes | ok |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | pass | – | yes | 21 tools: read_architecture, compare_implementation, read_implementation, observe_implementation, link_implementation, unlink_implementation, code_graph, graph_result, design_recipe, try_inputs, project_info, read_source |
| mcp-project_info | pass | – | yes | ok |
| mcp-design_recipe | pass | – | yes | ok |
| mcp-read_source | pass | – | yes | ok |
| mcp-check_design | pass | – | yes | ok |
| mcp-check_design-broken | pass | – | yes | ok |
| mcp-explore_behaviour-verify | pass | – | yes | ok |
| mcp-explore_behaviour-simulate | pass | – | yes | ok |
| mcp-try_inputs | pass | – | yes | ok |
| mcp-design_interface | pass | – | yes | ok |
| mcp-emit_scaffold | pass | – | yes | ok |
| mcp-read_scaffold | pass | – | yes | ok |
| mcp-emit_implementation_check | pass | – | yes | ok |
| mcp-code_graph-index | pass | – | yes | ok |
| mcp-code_graph-search | pass | – | yes | ok |
| mcp-code_graph-callers-ts | pass | – | yes | ok |
| mcp-code_graph-callers-go | pass | – | yes | ok |
| mcp-code_graph-callers-rust | pass | – | yes | ok |
| mcp-requirement_links-requirement | pass | – | yes | ok |
| mcp-requirement_links-add-go | pass | – | yes | ok |
| mcp-requirement_links-add-rust | pass | – | yes | ok |
| mcp-requirement_links-add-ts | pass | – | yes | ok |
| mcp-requirement_links-list | pass | – | yes | ok |
| mcp-requirement_links-check | pass | – | yes | ok |
| mcp-requirement_links-check-after-edit | pass | – | yes | ok |
| mcp-requirement_links-refresh | pass | – | yes | ok |
| mcp-requirement_links-check-after-refresh | pass | – | yes | ok |
| mcp-requirement_links-refresh-restored | pass | – | yes | ok |
| mcp-requirement_links-check-final | pass | – | yes | ok |
| mcp-requirement_links-requirements_for | pass | – | yes | ok |
| mcp-requirement_links-unlinked | pass | – | yes | ok |
| mcp-link_result-handle | pass | – | yes | ok |
| mcp-read_architecture | pass | – | yes | ok |
| mcp-observe_implementation | pass | – | yes | ok |
| mcp-link_implementation | pass | – | yes | ok |
| mcp-compare_implementation | pass | – | yes | ok |
| mcp-unlink_implementation | pass | – | yes | ok |
| mcp-tool-coverage | pass | – | yes | 21 tools listed, all called |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | pass | – | yes | ok |
| studio-assets | pass | – | yes | 4 assets HTTP 200 |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | pass | 0 | yes | ok |
| writes-outside-project | pass | 1 | yes | all inside allowed places: ~/project/ 13; ~/.npm/_logs/ 11; ~/legacy/ 22; /tmp/node-compile-cache/ 11; /acc/ 3 |
| install-unchanged | pass | – | yes | 2361 files under ~/app/node_modules unchanged |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## e-node-24.0.0

Lowest Node release engines ">=24" allows: install, doctor and the core commands.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | pass | 0 | yes | 3.7 s (observation); 0 npm warning lines |
| install-npx-file-spec | pass | 0 | yes | 2.9 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| node-version | observed | 0 | no | v24.0.0 |
| help | pass | 0 | yes | ok |
| init | pass | 0 | yes | ok |
| doctor | pass | 0 | yes | ok |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed exactly as specified |
| graph-index | pass | 0 | yes | ok |
| graph-ts-callers | pass | 0 | yes | ok |
| writes-outside-project | pass | 1 | yes | all inside allowed places: ~/project/ 5; ~/.npm/_logs/ 9; ~/.npm/_cacache/ 2; ~/.npm/_npx/ 2; /acc/ 3 |
| install-unchanged | pass | – | yes | 4726 files under ~/.npm/_npx unchanged |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## e-node-25

Node 25 (supported by engines ">=24"): install, doctor and the core commands.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | pass | 0 | yes | 4.1 s (observation); 0 npm warning lines |
| install-npx-file-spec | pass | 0 | yes | 3.2 s (observation); 0 npm warning lines |
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
| writes-outside-project | pass | 1 | yes | all inside allowed places: ~/project/ 5; ~/.npm/_logs/ 9; ~/.npm/_cacache/ 2; ~/.npm/_npx/ 2; /acc/ 3 |
| install-unchanged | pass | – | yes | 4726 files under ~/.npm/_npx unchanged |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## e-node-26

Node 26 (supported by engines ">=24"): install, doctor and the core commands.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | pass | 0 | yes | 3.8 s (observation); 0 npm warning lines |
| install-npx-file-spec | pass | 0 | yes | 3.3 s (observation); 0 npm warning lines |
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
| writes-outside-project | pass | 1 | yes | all inside allowed places: ~/project/ 5; ~/.npm/_logs/ 9; ~/.npm/_cacache/ 2; ~/.npm/_npx/ 2; /acc/ 3 |
| install-unchanged | pass | – | yes | 4726 files under ~/.npm/_npx unchanged |
| no-toolchain-processes | pass | – | yes | log empty in every step |

## f-restic

restic (a larger real Go project): init, graph index and five queries; time and peak memory are observations.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | pass | 0 | yes | 3.8 s (observation); 0 npm warning lines |
| install-npx-file-spec | pass | 0 | yes | 3.5 s (observation); 0 npm warning lines |
| network-off | pass | – | yes | ok |
| restic-init | pass | 0 | yes | 2.8 s (observation) |
| restic-graph-index | pass | 0 | yes | 559 files, 7356 symbols, 63088 links, 0 failed; 86.6 s, peak RSS ≥ 2074 MiB (observations) |
| restic-status | pass | 0 | yes | ok; {"matches":0,"symbols":0,"links":0,"callers":0,"observedLinks":0}; 2.7 s, peak RSS ≥ 167 MiB (observations) |
| restic-search | pass | 0 | yes | ok; {"matches":20,"symbols":0,"links":0,"callers":0,"observedLinks":0}; 2.9 s, peak RSS ≥ 159 MiB (observations) |
| restic-callers | pass | 0 | yes | ambiguous; {"matches":6,"symbols":0,"links":0,"callers":0,"observedLinks":0}; 2.8 s, peak RSS ≥ 161 MiB (observations) |
| restic-callees | pass | 0 | yes | ok; {"matches":0,"symbols":1,"links":57,"callers":0,"observedLinks":0}; 2.8 s, peak RSS ≥ 161 MiB (observations) |
| restic-impact | pass | 0 | yes | ambiguous; {"matches":3,"symbols":0,"links":0,"callers":0,"observedLinks":0}; 2.9 s, peak RSS ≥ 169 MiB (observations) |
| restic-path | pass | 0 | yes | ambiguous; {"matches":7,"symbols":0,"links":0,"callers":0,"observedLinks":0}; 3.1 s, peak RSS ≥ 159 MiB (observations) |
| writes-outside-project | pass | 1 | yes | all inside allowed places: ~/restic/ 5; ~/.npm/_logs/ 8; ~/.npm/_cacache/ 2; ~/.npm/_npx/ 2; /acc/ 3 |
| install-unchanged | pass | – | yes | 4726 files under ~/.npm/_npx unchanged |
| no-toolchain-processes | pass | – | yes | log empty in every step |
