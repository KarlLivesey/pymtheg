# Clean-machine acceptance — latest run

Generated 2026-11-15T17:31:25.151Z from commit 84606915 by `scripts/acceptance/run.mjs`. Verdict: **known-gaps**.

Counts: pass 138, observed 41, known-gap 60, expected-fail 10. Tarball pymtheg-1.0.0.tgz: 2.11 MiB packed, 9.59 MiB unpacked, 869 files.

Durations, sizes and memory are observations on the dev server, not limits.

## 0-build

Release build: npm ci, npm run build, npm pack in a node:24.21.0 container.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| npm-ci | pass | 0 | yes | 5.2 s (observation); 8 npm warning lines |
| npm-run-build | pass | 0 | yes | 27.9 s (observation); 0 npm warning lines |
| npm-pack | pass | 0 | yes | 2.7 s (observation); 0 npm warning lines |
| tarball-contents | pass | – | yes | 869 files, 2.11 MiB packed, 9.59 MiB unpacked; 0 source/test/evidence files |
| package-private | observed | – | no | "private": true — npm refuses to publish it, so `npx pymtheg` from the registry cannot work until the owner decides to publish; `npx ./pymtheg-*.tgz` works without publishing |
| package-engines | observed | – | no | engines.node ">=24 <25"; optionalDependencies {"@informalsystems/quint":"0.33.1"} |

## a-node-only

Node only: install from the tarball with npx, then init, doctor, check/verify/simulate, a broken design, graph (TypeScript, Go and Rust source-only), MCP over stdio and Studio over HTTP; no toolchain process and no Java/Quint/TLC wording.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| network-off | pass | – | yes | ok |
| install-size | observed | 0 | no | ~/.npm/_npx 112.2 MiB; ~/.npm/_cacache 94.5 MiB (apparent file sizes) |
| npx-absolute-path | observed | 126 | no | exit 126: sh: 1: /acc/pkg/pymtheg-1.0.0.tgz: Permission denied |
| help | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| version | pass | 0 | no | ok |
| cli-requirement-links | known-gap (R1-D) | 0 | yes | no requirement-link command in help |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Quint: ready — 0.33.1 \| started java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed as designed with a diagnostic |
| verify-broken | expected-fail | 1 | yes | failed as designed with a diagnostic |
| graph-index | pass | 0 | yes | 8 files, 20 symbols, 36 links |
| graph-status | pass | 0 | yes | status ok; modules go, rust, typescript |
| graph-ts-callers | pass | 0 | yes | renderBasket:definite |
| graph-ts-path | pass | 0 | yes | found true (definite) |
| graph-go-callers | pass | 0 | yes | main:definite |
| graph-go-same-package | pass | 0 | yes | ComputeTotal:definite |
| graph-rust-callers | pass | 0 | yes | main:definite |
| graph-rust-same-file | pass | 0 | yes | apply_discount:definite |
| graph-search | pass | 0 | yes | ok |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: {"result":{"tools":[{"name":"read_architecture","description":"Read the retained architecture, including planning records and complete source documents. Importe |
| mcp-check-design | pass | – | yes | ok |
| mcp-check-broken | pass | – | yes | ok |
| mcp-explore-verify | known-gap (R1-A) | – | yes | exitStatus 3, isError: {"viewSchema":"pymtheg.agent/v1","summary":{"runId":"bf557d4f-db65-46d1-b87c-110b52677b17","file":"designs/order.pym","k … ror","related":[],"path":[]}],"toolVersions":{"pymtheg":"1.0.0","node":"24 |
| mcp-explore-simulate | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: {"result":{"content":[{"type":"text","text":"{\n  \"viewSchema\": \"pymtheg.agent/v1\",\n  \"summary\": {\n    \"runId\": \"3a70412c-0f93-4cd3-818b-9dce9bf15006 \| started quint (cli.js /home/nod |
| mcp-graph-tool | known-gap (R1-C) | – | yes | no graph tool over MCP |
| mcp-requirement-links | known-gap (R1-D) | – | yes | no requirement-to-symbol link tool over MCP |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: "quint": true, |
| studio-assets | pass | – | yes | ok |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | known-gap (R1-B) | 3 | yes | exit 3, expected 0 |
| writes-outside-project | observed | 0 | no | 8747 /home/node/.npm/_npx; 213 /home/node/.npm/_cacache; 11 /home/node/.npm/_logs |
| no-toolchain-processes | known-gap (R1-A) | – | yes | doctor: java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) \| mcp-explore-simulate: quint (cli.js /home/node/.npm/ |

## b-node-git

Same as (a) in a git repository (git installed with apt before the install step), plus what init does to git state.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| setup-git | pass | – | yes | git version 2.39.5 |
| install-npx | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| network-off | pass | – | yes | ok |
| git-setup | pass | 0 | yes | ok |
| help | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| version | pass | 0 | no | ok |
| cli-requirement-links | known-gap (R1-D) | 0 | yes | no requirement-link command in help |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| git-status-after-init | pass | 0 | yes | ?? .pymtheg/.gitignore; ?? .pymtheg/project.json; ?? .pymtheg/settings.json |
| git-ignored-after-init | observed | 0 | no | ?? .pymtheg/.gitignore; ?? .pymtheg/project.json; ?? .pymtheg/settings.json |
| git-tracked-unchanged | pass | 0 | yes | ok |
| doctor | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Quint: ready — 0.33.1 \| started java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed as designed with a diagnostic |
| verify-broken | expected-fail | 1 | yes | failed as designed with a diagnostic |
| graph-index | pass | 0 | yes | 8 files, 20 symbols, 36 links |
| graph-status | pass | 0 | yes | status ok; modules go, rust, typescript |
| graph-ts-callers | pass | 0 | yes | renderBasket:definite |
| graph-ts-path | pass | 0 | yes | found true (definite) |
| graph-go-callers | pass | 0 | yes | main:definite |
| graph-go-same-package | pass | 0 | yes | ComputeTotal:definite |
| graph-rust-callers | pass | 0 | yes | main:definite |
| graph-rust-same-file | pass | 0 | yes | apply_discount:definite |
| graph-search | pass | 0 | yes | ok |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: {"result":{"tools":[{"name":"read_architecture","description":"Read the retained architecture, including planning records and complete source documents. Importe |
| mcp-check-design | pass | – | yes | ok |
| mcp-check-broken | pass | – | yes | ok |
| mcp-explore-verify | known-gap (R1-A) | – | yes | exitStatus 3, isError: {"viewSchema":"pymtheg.agent/v1","summary":{"runId":"28973a82-ec4a-4e6c-9639-9d34d76be04a","file":"designs/order.pym","k … ror","related":[],"path":[]}],"toolVersions":{"pymtheg":"1.0.0","node":"24 |
| mcp-explore-simulate | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: {"result":{"content":[{"type":"text","text":"{\n  \"viewSchema\": \"pymtheg.agent/v1\",\n  \"summary\": {\n    \"runId\": \"6b98605c-de9b-4d37-ae7f-372c6ea85fe3 \| started quint (cli.js /home/nod |
| mcp-graph-tool | known-gap (R1-C) | – | yes | no graph tool over MCP |
| mcp-requirement-links | known-gap (R1-D) | – | yes | no requirement-to-symbol link tool over MCP |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: "quint": true, |
| studio-assets | pass | – | yes | ok |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | known-gap (R1-B) | 3 | yes | exit 3, expected 0 |
| git-status-end | observed | 0 | no | ?? .pymtheg/.gitignore; ?? .pymtheg/project.json; ?? .pymtheg/settings.json |
| writes-outside-project | observed | 0 | no | 8747 /home/node/.npm/_npx; 213 /home/node/.npm/_cacache; 11 /home/node/.npm/_logs |
| no-toolchain-processes | known-gap (R1-A) | – | yes | doctor: java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) \| mcp-explore-simulate: quint (cli.js /home/node/.npm/ |

## c-node-go-rust

Same as (a) with Go and Rust toolchains (copied from the official golang and rust images) on PATH: the source-only graph is identical and nothing runs them by default; the Go opt-in when it is in the build.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| setup-toolchains | pass | – | yes | golang:1-bookworm, rust:1-slim-bookworm: go version go1.27.4 linux/amd64; cargo 1.100.0 (3acc79c0c 2026-11-05) |
| install-npx | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| network-off | pass | – | yes | ok |
| toolchains-present | observed | 0 | no | go version go1.27.4 linux/amd64; cargo 1.100.0 (3acc79c0c 2026-11-05); rustc 1.100.0 (0ef1bc386 2026-11-09) |
| help | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| version | pass | 0 | no | ok |
| cli-requirement-links | known-gap (R1-D) | 0 | yes | no requirement-link command in help |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Quint: ready — 0.33.1 \| started java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed as designed with a diagnostic |
| verify-broken | expected-fail | 1 | yes | failed as designed with a diagnostic |
| graph-index | pass | 0 | yes | 8 files, 20 symbols, 36 links |
| graph-status | pass | 0 | yes | status ok; modules go, rust, typescript |
| graph-ts-callers | pass | 0 | yes | renderBasket:definite |
| graph-ts-path | pass | 0 | yes | found true (definite) |
| graph-go-callers | pass | 0 | yes | main:definite |
| graph-go-same-package | pass | 0 | yes | ComputeTotal:definite |
| graph-rust-callers | pass | 0 | yes | main:definite |
| graph-rust-same-file | pass | 0 | yes | apply_discount:definite |
| graph-search | pass | 0 | yes | ok |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: {"result":{"tools":[{"name":"read_architecture","description":"Read the retained architecture, including planning records and complete source documents. Importe |
| mcp-check-design | pass | – | yes | ok |
| mcp-check-broken | pass | – | yes | ok |
| mcp-explore-verify | known-gap (R1-A) | – | yes | exitStatus 3, isError: {"viewSchema":"pymtheg.agent/v1","summary":{"runId":"c8d1c37f-3647-46f2-af5b-b24c1d071d56","file":"designs/order.pym","k … ror","related":[],"path":[]}],"toolVersions":{"pymtheg":"1.0.0","node":"24 |
| mcp-explore-simulate | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: {"result":{"content":[{"type":"text","text":"{\n  \"viewSchema\": \"pymtheg.agent/v1\",\n  \"summary\": {\n    \"runId\": \"95259647-a888-49a4-b9c9-723699b612e6 \| started quint (cli.js /home/nod |
| mcp-graph-tool | known-gap (R1-C) | – | yes | no graph tool over MCP |
| mcp-requirement-links | known-gap (R1-D) | – | yes | no requirement-to-symbol link tool over MCP |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: "quint": true, |
| studio-assets | pass | – | yes | ok |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | known-gap (R1-B) | 3 | yes | exit 3, expected 0 |
| go-toolchain-opt-in | known-gap (W3-L (PR 33)) | – | no | Go toolchain opt-in is not in this build (PR 33 open; not wired into `pymtheg graph`) |
| no-toolchain-processes | known-gap (R1-A) | – | yes | doctor: java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) \| mcp-explore-simulate: quint (cli.js /home/node/.npm/ |
| graph-identical-to-node-only | pass | – | yes | 8 graph results identical |

## d-global

npm install --global of the tarball: the binary resolves grammars, web assets and helpers from the installed location.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-global | pass | 0 | yes | 9.9 s (observation); 7 npm warning lines |
| network-off | pass | – | yes | ok |
| install-size | observed | 0 | no | ~/.npm/_cacache 94.5 MiB; ~/.npm-global 112.0 MiB (apparent file sizes) |
| bin-location | pass | 0 | yes | /home/node/.npm-global/lib/node_modules/pymtheg/dist/cli/main.js |
| help | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| version | pass | 0 | no | ok |
| cli-requirement-links | known-gap (R1-D) | 0 | yes | no requirement-link command in help |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Quint: ready — 0.33.1 \| started java -version; quint (cli.js /home/node/.npm-global/lib/node_modules/pymtheg/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -vers |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed as designed with a diagnostic |
| verify-broken | expected-fail | 1 | yes | failed as designed with a diagnostic |
| graph-index | pass | 0 | yes | 8 files, 20 symbols, 36 links |
| graph-status | pass | 0 | yes | status ok; modules go, rust, typescript |
| graph-ts-callers | pass | 0 | yes | renderBasket:definite |
| graph-ts-path | pass | 0 | yes | found true (definite) |
| graph-go-callers | pass | 0 | yes | main:definite |
| graph-go-same-package | pass | 0 | yes | ComputeTotal:definite |
| graph-rust-callers | pass | 0 | yes | main:definite |
| graph-rust-same-file | pass | 0 | yes | apply_discount:definite |
| graph-search | pass | 0 | yes | ok |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: {"result":{"tools":[{"name":"read_architecture","description":"Read the retained architecture, including planning records and complete source documents. Importe |
| mcp-check-design | pass | – | yes | ok |
| mcp-check-broken | pass | – | yes | ok |
| mcp-explore-verify | known-gap (R1-A) | – | yes | exitStatus 3, isError: {"viewSchema":"pymtheg.agent/v1","summary":{"runId":"cc86bf2a-5ee9-4e30-be75-e4c054bbc276","file":"designs/order.pym","k … ror","related":[],"path":[]}],"toolVersions":{"pymtheg":"1.0.0","node":"24 |
| mcp-explore-simulate | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: {"result":{"content":[{"type":"text","text":"{\n  \"viewSchema\": \"pymtheg.agent/v1\",\n  \"summary\": {\n    \"runId\": \"3e147716-0238-45ed-8ca9-826e2b199741 \| started quint (cli.js /home/nod |
| mcp-graph-tool | known-gap (R1-C) | – | yes | no graph tool over MCP |
| mcp-requirement-links | known-gap (R1-D) | – | yes | no requirement-to-symbol link tool over MCP |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: "quint": true, |
| studio-assets | pass | – | yes | ok |
| studio-stop | pass | 0 | yes | ok |
| init-with-legacy-folder | known-gap (R1-B) | 3 | yes | exit 3, expected 0 |
| no-toolchain-processes | known-gap (R1-A) | – | yes | doctor: java -version; quint (cli.js /home/node/.npm-global/lib/node_modules/pymtheg/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) \| mcp-explore-simulate: quint (cli.js /home/ |

## d-local

npm install of the tarball as a dependency of another package, then npx pymtheg.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-local | pass | 0 | yes | 9.6 s (observation); 7 npm warning lines |
| network-off | pass | – | yes | ok |
| install-size | observed | 0 | no | ~/.npm/_cacache 94.5 MiB; ~/app/node_modules 112.1 MiB (apparent file sizes) |
| help | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| version | pass | 0 | no | ok |
| cli-requirement-links | known-gap (R1-D) | 0 | yes | no requirement-link command in help |
| init | pass | 0 | yes | ok |
| init-repeat | pass | 0 | yes | ok |
| doctor | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Quint: ready — 0.33.1 \| started java -version; quint (cli.js /home/node/app/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) |
| check-valid | pass | 0 | yes | ok |
| verify-valid | pass | 0 | yes | ok |
| simulate-valid | pass | 0 | yes | ok |
| check-broken | expected-fail | 1 | yes | failed as designed with a diagnostic |
| verify-broken | expected-fail | 1 | yes | failed as designed with a diagnostic |
| graph-index | pass | 0 | yes | 8 files, 20 symbols, 36 links |
| graph-status | pass | 0 | yes | status ok; modules go, rust, typescript |
| graph-ts-callers | pass | 0 | yes | renderBasket:definite |
| graph-ts-path | pass | 0 | yes | found true (definite) |
| graph-go-callers | pass | 0 | yes | main:definite |
| graph-go-same-package | pass | 0 | yes | ComputeTotal:definite |
| graph-rust-callers | pass | 0 | yes | main:definite |
| graph-rust-same-file | pass | 0 | yes | apply_discount:definite |
| graph-search | pass | 0 | yes | ok |
| mcp-initialize | pass | – | yes | ok |
| mcp-tools-list | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: {"result":{"tools":[{"name":"read_architecture","description":"Read the retained architecture, including planning records and complete source documents. Importe |
| mcp-check-design | pass | – | yes | ok |
| mcp-check-broken | pass | – | yes | ok |
| mcp-explore-verify | known-gap (R1-A) | – | yes | exitStatus 3, isError: {"viewSchema":"pymtheg.agent/v1","summary":{"runId":"63e3224c-1f9b-4993-803b-ebdffe345322","file":"designs/order.pym","k … ror","related":[],"path":[]}],"toolVersions":{"pymtheg":"1.0.0","node":"24 |
| mcp-explore-simulate | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: {"result":{"content":[{"type":"text","text":"{\n  \"viewSchema\": \"pymtheg.agent/v1\",\n  \"summary\": {\n    \"runId\": \"a32b532d-5378-449e-9e2b-776b6fd6626a \| started quint (cli.js /home/nod |
| mcp-graph-tool | known-gap (R1-C) | – | yes | no graph tool over MCP |
| mcp-requirement-links | known-gap (R1-D) | – | yes | no requirement-to-symbol link tool over MCP |
| mcp-shutdown | pass | 0 | yes | ok |
| studio-start | pass | – | yes | ok |
| studio-status | known-gap (R1-A) | – | yes | mentions Java/Quint/TLC: "quint": true, |
| studio-assets | pass | – | yes | ok |
| studio-stop | pass | – | yes | ok |
| init-with-legacy-folder | known-gap (R1-B) | 3 | yes | exit 3, expected 0 |
| no-toolchain-processes | known-gap (R1-A) | – | yes | doctor: java -version; quint (cli.js /home/node/app/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) \| mcp-explore-simulate: quint (cli.js /home/node/app/node_modules/@informalsy |

## e-node-24.0.0

Lowest Node 24 release the engines field allows (report only). Report only.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | observed | 0 | no | would fail: mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| network-off | observed | – | no | ok |
| node-version | observed | 0 | no | v24.0.0 |
| help | observed | 0 | no | would fail: mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| init | observed | 0 | no | ok |
| doctor | observed | 0 | no | would fail: mentions Java/Quint/TLC: Quint: ready — 0.33.1 \| started java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -ve |
| check-valid | observed | 0 | no | ok |
| verify-valid | observed | 0 | no | ok |
| graph-index | observed | 0 | no | ok |
| no-toolchain-processes | observed | – | no | doctor: java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) |

## e-node-25

Node 25, outside engines (report only). Report only.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | observed | 0 | no | would fail: mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| network-off | observed | – | no | ok |
| node-version | observed | 0 | no | v25.9.0 |
| help | observed | 0 | no | would fail: mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| init | observed | 0 | no | ok |
| doctor | observed | 3 | no | would fail: exit 3, expected 0 \| mentions Java/Quint/TLC: Quint: ready — 0.33.1 \| started java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version |
| check-valid | observed | 0 | no | ok |
| verify-valid | observed | 0 | no | ok |
| graph-index | observed | 0 | no | ok |
| no-toolchain-processes | observed | – | no | doctor: java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) |

## e-node-26

Node 26, outside engines (report only). Report only.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | observed | 0 | no | would fail: mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| network-off | observed | – | no | ok |
| node-version | observed | 0 | no | v26.13.1 |
| help | observed | 0 | no | would fail: mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| init | observed | 0 | no | ok |
| doctor | observed | 3 | no | would fail: exit 3, expected 0 \| mentions Java/Quint/TLC: Quint: ready — 0.33.1 \| started java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version |
| check-valid | observed | 0 | no | ok |
| verify-valid | observed | 0 | no | ok |
| graph-index | observed | 0 | no | ok |
| no-toolchain-processes | observed | – | no | doctor: java -version; quint (cli.js /home/node/.npm/_npx/441bfdaa83333b3c/node_modules/@informalsystems/quint/dist/src/cli.js --version); java (java java -version) |

## f-restic

restic (a larger real Go project): init, graph index and five queries; time and peak memory are observations.

| Step | Status | Exit | Req. | Reason |
|---|---|---|---|---|
| install-npx | known-gap (R1-A) | 0 | yes | mentions Java/Quint/TLC: Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint. |
| network-off | pass | – | yes | ok |
| restic-init | pass | 0 | yes | 6.9 s (observation) |
| restic-graph-index | pass | 0 | yes | 559 files, 7356 symbols, 63088 links, 0 failed; 92.4 s, peak RSS ≥ 2096 MiB (observations) |
| restic-status | pass | 0 | yes | 3.4 s, peak RSS ≥ 162 MiB (observations); {"matches":0,"symbols":0,"links":0,"callers":0,"observedLinks":0} |
| restic-search | pass | 0 | yes | 3.1 s, peak RSS ≥ 170 MiB (observations); {"matches":20,"symbols":0,"links":0,"callers":0,"observedLinks":0} |
| restic-callers | pass | 0 | yes | 3.5 s, peak RSS ≥ 161 MiB (observations); {"matches":6,"symbols":0,"links":0,"callers":0,"observedLinks":0} |
| restic-callees | pass | 0 | yes | 3.3 s, peak RSS ≥ 167 MiB (observations); {"matches":0,"symbols":1,"links":57,"callers":0,"observedLinks":0} |
| restic-impact | pass | 0 | yes | 3.2 s, peak RSS ≥ 162 MiB (observations); {"matches":3,"symbols":0,"links":0,"callers":0,"observedLinks":0} |
| restic-path | pass | 0 | yes | 3.3 s, peak RSS ≥ 169 MiB (observations); {"matches":7,"symbols":0,"links":0,"callers":0,"observedLinks":0} |
| no-toolchain-processes | pass | – | yes | log empty |
