# R1-F: clean-machine acceptance harness

Release 1 item 1 (D19, `docs/build-plan.md`; mega-plan 8.2) says `npx pymtheg`
runs on a clean machine with no Java or Quint. This chunk adds three tools:

- a repeatable harness that shows what a new user gets from the packed tarball;
- a self-test that proves the harness catches real breakage;
- a cleanup test that proves an interrupted run leaves nothing behind.

It changes no product code. Run the harness after each R1 merge, and as the
release gate (exit 0).

Every statement below was checked against the code at the commit named in the
results block, which merges main 27674435, and against that run's evidence.

## Run it

On the dev server (it needs Docker), from the repository root:

```sh
H=$(git rev-parse --short HEAD)
pymtheg-dev --name r1f-xxxx -- sh -c "node scripts/acceptance/run.mjs --commit $H --out \$PYM_SCRATCH/acc"
pymtheg-dev --name r1f-xxxx --no-sync -- sh -c "node scripts/acceptance/selftest.mjs --commit $H --out \$PYM_SCRATCH/acc"
pymtheg-dev --name r1f-xxxx --no-sync -- sh -c 'sh scripts/acceptance/cleanup-test.sh $(ls -t $PYM_SCRATCH/acceptance-tarball-*/pymtheg-1.0.0.tgz | head -1)'
for f in latest.json latest.md selftest.json selftest.md; do
  pymtheg-dev --name r1f-xxxx --no-sync -- sh -c "cat \$PYM_SCRATCH/acc/$f" > evidence/r1-f/$f
done
pymtheg-dev --name r1f-xxxx --no-sync -- sh -c 'node scripts/acceptance/summarise.mjs --evidence $PYM_SCRATCH/acc --print'   # the results block below
pymtheg-dev --name r1f-xxxx --clean
```

`npm run acceptance` runs `scripts/acceptance/run.mjs`. Its options:

| Option | Effect |
|---|---|
| `--scenarios a-node-only,f-restic` | Run a subset. An unknown name is a usage error (exit 3). |
| `--tarball PATH` | Reuse a packed tarball. Every build keeps a copy in `$PYM_SCRATCH/acceptance-tarball-<run id>/`. |
| `--pack-only` | Build the tarball, print `TARBALL=<path>`, and stop. |
| `--list-images` | Print the Docker images the selected scenarios need, and stop. |
| `--out DIR` | Write results to DIR (default `evidence/r1-f`). |
| `--commit SHA` | Record SHA in the results. |
| `--restic DIR` | Use this restic checkout (default `~/pymtheg-dev/corpora/restic`). |
| `--keep-images` | Do not remove images at the end. |

Timings and memory are observations, and nothing is asserted on them.
`latest.json` records them only for some kinds of step:

| Kind of step | `durationMs` | `peakRssKiB` |
|---|---|---|
| Each step that runs one command as a process in the container (for example the CLI commands, `git`, `find`, `node --version` and the npm installs) | yes | yes: the peak resident memory of that process tree, sampled from `/proc`, so a lower bound |
| The three build steps (`npm ci`, `npm run build`, `npm pack`) | yes | no |
| MCP calls, Studio requests, and the harness's own checks (network probe, install size and snapshot, setup, comparisons, the tarball inspection, summary rows) | no (`null`) | no (absent) |

Exit status:

| Exit | Meaning |
|---|---|
| 0 | Every required step passes. This is the release gate. |
| 2 | Nothing fails, but known gaps remain. |
| 1 | A required step fails. |
| 3 | Harness or usage error. |
| 129, 130, 141, 143 | Stopped by HUP, INT, a broken pipe or TERM. Before exiting it removes its containers, its per-run scratch folder, and the recorded pulled images that no container uses (see "Cleanup"). |

## How it works

### Building the tarball

`scripts/acceptance/run.mjs` runs on the host. It copies the source tree into a
throwaway `node:24.21.0-bookworm-slim` container. It leaves out `node_modules`,
`dist`, `dist-web`, `evidence`, `research`, `.git`, `.pymtheg` and `*.tgz`. In
the container it runs `npm ci`, `npm run build` and `npm pack`, and then checks
the tarball contents.

### Running a scenario

- **The container.** Each scenario starts a fresh container from an official
  `node:*-bookworm-slim` image.
- **What is copied in.** The tarball, the sample project
  (`test/fixtures/acceptance/sample`) and the harness files. Scenario f also
  gets the restic checkout. Scenario c also gets the Go and Rust toolchains,
  copied out of the official `golang` and `rust` images.
- **Root setup first.** File ownership, and in b an `apt-get install git`, run
  as root before the scenario. Every scenario step runs as the unprivileged
  `node` user.
- **Network.** The container has network only until its install steps finish;
  b's `apt-get` comes before them. Then it is disconnected from every network.
  `network-off` proves that neither `https://registry.npmjs.org/` nor
  `http://1.1.1.1/` can be reached.
- **The driver.** `scripts/acceptance/driver.mjs` runs the steps. It uses Node
  built-ins and `wording.mjs` only. It drives MCP over stdio with a small
  JSON-RPC client, and checks Studio with plain HTTP (no browser).

### Detecting processes

Two detectors watch for `java`, `javac`, `quint`, `tlc`, `go`, `cargo`, `rustc`
and `rustup`:

- **`shim.sh`** is first on `PATH` under each of those names. It logs the call,
  then runs the real program if there is one. It uses shell built-ins only, a
  fixed log path and a fixed fallback search path, so it still works when
  called from a stripped environment.
- **`spawn-trace.cjs`** is preloaded through `NODE_OPTIONS`. It records every
  child process a Node process starts, through `ChildProcess.prototype.spawn`,
  `spawnSync`, `execFileSync` and `execSync`. That catches programs started by
  absolute path, for example `node …/quint/dist/src/cli.js`. It does not see
  processes started by non-Node programs; those are seen only if they go
  through `PATH`, where the shim is.

### What every step is checked for

A step passes only if all of these hold:

1. **Its own exact expectation is met:** exit code, and exact JSON fields or
   output lines.
2. **No backend ran:** no `java`, `javac`, `quint` or `tlc` process.
3. **No toolchain ran:** no `go`, `cargo`, `rustc` or `rustup` process. The
   opted-in Go steps (`go-toolchain-*`) may run `go` and nothing else.
4. **No Java, Quint or TLC wording** (defined by `wording.mjs`, choices below)
   appears in any of these places:
   - stdout or stderr;
   - any string value of the step's parsed JSON;
   - any JSON line on stdout (every raw MCP answer, both its
     `structuredContent` and its text content).

   JSON nested in a string is expanded too.
5. **No internal-error output** appears in those same places:
   - a stack frame (`^\s+at .+:\d+:\d+\)?$`);
   - a line matching `^\s*\w*Error: `. A step may list exact expected lines,
     but none does today. The broken-design diagnostic reads
     `…/broken.pym:7:27 error N002: …` and is asserted whole;
   - the word `unhandled` or `uncaught`.
6. **No Node process warning** appears on stderr: no line matching
   `^\(node:\d+\) (?:\[[A-Z0-9_]+\] )?\w*Warning: `, with or without a code.

Some rules are skipped in three places:

- Rules 4, 5 and 6 are skipped for steps whose output is the harness's own (git,
  find, sizes, the network probe, `node --version`).
- Rules 4 and 5 are skipped for the minified web bundle fetched by
  `studio-assets`; rule 6 still applies there.
- Rule 6 is skipped for the npm install steps. Rules 4 and 5 still apply to
  their output.

Statuses:

| Status | Meaning |
|---|---|
| pass | All six rules hold. |
| expected-fail | The step was designed to fail (the broken design, the violating design, a changed requirement link) and failed exactly as specified. |
| known-gap | The step's only problem is its expectation, and that step's own gap matcher recognises the exact output a named chunk will change. Or its only problem is a warning listed in `KNOWN_WARNING_GAPS`. No gap is defined today. |
| fail | Anything else. |
| observed | Report-only steps: sizes, the absolute-path `npx` form, the toolchain versions in c, `node --version` in e. |

### Wording matcher choices

The matcher is
`\b(?:java|javac|java_home|java_opts|java_tool_options|jdk|jre|openjdk|quint|tlcs?)\d*\b|tla2tools|\bTLA\+`,
case-insensitive.

- `JAVA_HOME`, `JAVA_OPTS` and `JAVA_TOOL_OPTIONS` are listed as their own
  tokens, because `\b` treats `_` as a word character.
- `java.exe` matches through `\bjava\b`.
- `TLCs` matches, because in this product's output it can only mean runs of the
  TLC checker.
- `jdk`, `jre` and `openjdk` match as whole words.
- Every token may carry a version suffix (`jdk21`, `java21`).

The self-test checks every fixed string in `WORDING_CASES`. The count is in the
results block.

| Must match | Must not match |
|---|---|
| `java -version`, `java.exe`, `JAVA_HOME is not set`, `JAVA_OPTS=-Xmx2g`, `Picked up JAVA_TOOL_OPTIONS: …`, `jdk21`, `java21 is required`, `openjdk 21.0.2`, `Install a JDK`, `JRE 17`, `javac 21`, `Quint: ready`, `--backend quint`, `TLC requires …`, `two TLCs ran`, `tla2tools.jar`, `TLA+`, … | `JavaScript`, `JavaScript21`, `javascript:void(0)`, `Javadoc-style`, `quintessential`, `quintuple`, `atlc`, `tlcx`, `TLAs`, `java_home_dir`, `java_opts_file`, `jdkfoo`, … |

## What each scenario proves

| Scenario | Proves |
|---|---|
| 0-build | `npm ci`, `npm run build` and `npm pack` work from a clean copy of the source. The tarball has `dist/cli/main.js`, `dist-web/index.html`, both vendored grammar `.wasm` files, `package.json`, `README.md` and the `pymtheg` launcher. It ships no TypeScript sources, tests, evidence or research. The one helper source the product runs, `src/graph/languages/go/toolchain/golinks.go`, is allowed and listed. |
| a-node-only | The full list below, with Node only. |
| b-node-git | Scenario a inside a git repository. After init, and again at the end, `git status --porcelain --untracked-files=all` shows exactly the three `.pymtheg/` files, and tracked files are unchanged. The link edits are undone. |
| c-node-go-rust | Scenario a with the Go and Rust toolchains on `PATH` (versions in its `toolchains-present` row). The graph answers must be identical to a's, and with the setting off no `go` or `cargo` runs. The Go opt-in is described after this table. |
| d-global, d-local | `npm i -g` and `npm i` of the tarball, then scenario a's steps. In d-global, `pymtheg` must resolve to the installed `dist/cli/main.js`. |
| e-node-24.0.0, e-node-25, e-node-26 | Required, because engines is `">=24"`. Covers install, help, init, doctor (all checks ready), check, verify, simulate, the broken design, graph index, callers, no writes outside the project, and the install left unchanged. |
| f-restic | The pinned restic corpus: init, index with 0 failed files, status, and five queries (search, callers, callees, impact, path). Time and memory are observations. |

The Go opt-in in scenario c:

- `graph.toolchain.go` is set to the real `/usr/local/go/bin/go`, on the
  sample's Go module run as a project of its own.
- `graph index` must report the route `used` with upgraded links greater than
  0.
- Its spawn trace must show three things: `go env`, `go build … golinks.go`,
  and the resolving helper running from the project's
  `.pymtheg/rebuildable/toolchain/`.
- `graph callers Add` must itself report the route `used`. It must return
  exactly five definite calls from `main`, each `decidedBy: "toolchain"`,
  including the generic-result call at `main.go:13`.
- With the setting removed, no `toolchain` is reported. The same query must then
  return exactly the four other calls, source-decided, and not line 13. So the
  check proves the opt-in made the difference.

What scenario a runs. Every step is offline after the install:

- **Install:** `npx --yes ./pymtheg-1.0.0.tgz --help`, then
  `npx --yes file:/acc/pkg/pymtheg-1.0.0.tgz --version`, with network. npx keys
  its store by the package spec, so both forms are installed up front.
- **Basic commands:**
  - help: includes `graph index`, `link requirement` and `init [DIRECTORY]`.
  - version: a `x.y.z` version.
  - init: reports "3 existing documents found", and creates or changes no file
    outside `.pymtheg/`. Running it again leaves the metadata bytes identical.
  - `doctor --format json`: every check `ready`.
- **Designs:**
  - `check` on the valid design: 0 diagnostics.
  - `verify`: each of its three properties is `no_counterexample`, complete and
    `exhaustive: true`.
  - `simulate`: each property is `no_counterexample`, complete and
    `exhaustive: false`.
  - `verify` on `designs/overcharge.pym`: exit 1 with `chargedOnce`
    `counterexample`.
  - `check` and `verify` on the broken design: exit 1 with an output line equal
    to `…/broken.pym:7:27 error N002: Unknown value or variant charge; did you mean charges?`.
- **Graph:**
  - index: 9 files, 0 failed. Status lists modules go, rust and typescript.
  - Six callers queries, each returning exactly the expected caller and file,
    with `definite` certainty and the right target. Five are cross-file
    (TypeScript ×2, Go ×2, Rust ×1) and one is same-file (`percent_of`).
  - path: found, definite. search: exactly two symbols and one file.
- **`pymtheg link` (CLI):**
  - Requirement `plan:R2` is linked to `ComputeTotal` (Go), `apply_discount`
    (Rust) and `formatTotal` (TypeScript).
  - `list` and `check` report all three `ok`, and `check` exits 0.
  - After an edit to the body of `apply_discount`, `check` exits 1 with exactly
    that link `changed`.
  - `refresh` makes it ok again. The edit is then undone, refreshed and checked
    again.
- **MCP:** initialize, `tools/list`, and then every listed tool, each with a
  checked result (table below).
- **Studio:** start, `GET /api/project` (the workspace name), `GET /` and every
  asset it references, then a SIGINT to the process group.
- **Legacy folder:** init in a folder with `.pymtheg-studio/` exits 0, names the
  folder on its output, and leaves it untouched.
- **Final checks:** `writes-outside-project`, `install-unchanged`, and the
  `no-toolchain-processes` summary.

The MCP steps:

| MCP step | Call | Exact check |
|---|---|---|
| mcp-initialize | `initialize` | a `serverInfo` name |
| mcp-tools-list | `tools/list` | a non-empty list containing `check_design`, `read_run`, `explore_behaviour`, `project_info` |
| mcp-project_info | `project_info {}` | `totalFiles` 3 |
| mcp-design_recipe | `{action:"list"}` | includes recipe `decision` |
| mcp-read_source | `designs/order.pym` line 2 | `["machine Order {"]` |
| mcp-check_design | the valid design | exitStatus 0, 0 errors, 0 warnings |
| mcp-check_design-broken | the broken design, then `read_run` findings | exitStatus 1, and exactly one finding: `{code:"N002", message:"Unknown value or variant charge; did you mean charges?", file:"designs/broken.pym", line:7, column:27, severity:"error"}` |
| mcp-explore_behaviour-verify, -simulate | then `read_run` properties | summary: exitStatus 0, 0 counterexamples, 0 unresolved, `exhaustive` true / false. Properties: only `finite_model_check/no_counterexample/complete/true`, and only `simulation/no_counterexample/complete/false` |
| mcp-try_inputs | flow `next`, given only as a buffer, `n:"41"` | complete, output `"42"` |
| mcp-design_interface | `check_design` on that buffer, then `symbols` | flow check exitStatus 0; symbol `next` |
| mcp-emit_scaffold | TypeScript | source has `function next(`, and an emission id |
| mcp-read_scaffold | one page | equals the emitted source, no next page, `totalCharacters` matches, SHA-256 `contentHash` |
| mcp-emit_implementation_check | Go, `*Worker` | source has `PymthegContracts` |
| mcp-code_graph-index | `code_graph {action:"index"}` (`graph_result` if still running) | complete, status ok, 0 failed files |
| mcp-code_graph-search | `search Total`, then the symbols page | exactly `ComputeTotal@service/pricing/total.go`, `formatTotal@web/src/format.ts`, `total.go` |
| mcp-code_graph-callers-ts, -go, -rust | `callers`, links page, then symbols page | exactly one link each: `renderBasket@web/src/main.ts`, `main@service/main.go`, `main@engine/src/main.rs` → the target, `definite` |
| mcp-requirement_links-requirement | `{action:"requirement", id:"R1"}` | status `created`; items `["plan:R1"]` |
| mcp-requirement_links-add-go | `code_graph {action:"symbol", query:"taxFor"}`, then `add` with that `symbol:<hex>` ref | `created`; one link, `plan:R1` → `taxFor`, with the same ref |
| mcp-requirement_links-add-rust, -add-ts | `add percent_of` / `add roundCents` | `created`; one link each, with exact record, name and path |
| mcp-requirement_links-list | `{action:"list", record:"R1"}` | exactly `percent_of`, `roundCents`, `taxFor`, all `ok` |
| mcp-requirement_links-check | `{action:"check"}` | all six project links (`plan:R1` ×3 by MCP, `plan:R2` ×3 by the CLI) `ok`; `passed: true` |
| mcp-requirement_links-check-after-edit | after editing `roundCents`'s body | exactly `plan:R1/roundCents` `changed` with `differs: ["body"]`, the others `ok`; `passed: false` |
| mcp-requirement_links-refresh, -check-after-refresh, -refresh-restored, -check-final | `refresh` that link; undo the edit; `refresh` again | `refreshed` with the same link id; all six `ok`; `passed: true` |
| mcp-requirement_links-requirements_for | `{symbol:"percent_of"}` | exactly `plan:R1`, `direct`, `percent_of` |
| mcp-requirement_links-unlinked | `{symbols:true, section:"symbols"}` | one complete page holding exactly Go `Add`, `Cart`, `First`, `Items`, `Load`, `NewCart` (`service/pricing/cart.go`) and TypeScript `renderBasket` |
| mcp-link_result-handle | `check` with `wait:false`, then `link_result {wait:true}` | a `running` handle with a jobId; the result is `complete`, same jobId, `passed: true`, all six `ok` |
| mcp-read_architecture | `{section:"summary"}` | a store with two revisions (`plan:R2` by the CLI, `plan:R1` by MCP) |
| mcp-observe_implementation | `read_implementation` versions, then observe `web/src/main.ts` | a revision receipt |
| mcp-link_implementation | planned `plan:R1` and observed `renderBasket`, `reviewed:true` | a reviewed receipt; `plan:R1` has 1 link |
| mcp-compare_implementation | the same pair | `source.equal` true; the note is kept |
| mcp-unlink_implementation | the same pair | a receipt; `plan:R1` has 0 links |
| mcp-tool-coverage | — | every tool in `tools/list` was called above |
| mcp-shutdown | close stdin | the server exits 0 |

`read_run`, `graph_result` and `link_result` are called inside the steps above.
Every MCP step fails if `tools/list` did not succeed or does not list a tool
the step uses. A newly listed tool fails `mcp-tool-coverage` until the harness
calls it.

### Writes outside the project

`writes-outside-project` runs after each whole scenario. It lists every file or
symlink newer than the marker written after the install. It searches with
`find / -xdev`, skipping `/proc`, `/sys` and `/dev`. It fails on any path that
contains `/node_modules/pymtheg/`, or that lies outside these places:

- **The project folders the scenario works in:** the sample, the legacy copy,
  the Go project, restic and the local-install app folder.
- **npm's own folders:** `~/.npm/_cacache`, `_logs`, `_npx` and
  `_update-notifier-last-checked`. Nothing else under `~/.npm` is allowed, and
  the global prefix is not allowed after the install.
- **`/tmp/node-compile-cache/`:** Node's module compile cache, which the npm CLI
  turns on for itself. Pymtheg's source never calls `enableCompileCache`. This
  run's evidence shows where it appears. Nothing else under `/tmp` is allowed.
- **`/acc`:** the harness's own files.

Nothing is allowed for Go. The product runs `go` in a closed environment with
no `HOME` (`closedEnv` in `src/graph/languages/go/toolchain.ts`). The harness's
own `go version` in c also runs without `HOME`. A probe showed why that matters:
Go 1.27's `go version` writes telemetry counters to `~/.config/go` even with
`GOTELEMETRY=off` in the environment, and writes nothing when `HOME` is unset.
Earlier rounds allowed `~/.config/go` because of that harness call; the
allowance is gone.

`install-unchanged` is a separate check. After the install it records every
file of the installed package tree: its path, size and SHA-256 (a symlink is
recorded by its path only). The tree is the
whole npx store, the global `pymtheg` folder with its nested dependencies, or
the local `node_modules`. At the end of the scenario the tree must be unchanged.

What these checks do not see:

- files created and removed again within the scenario;
- files on other filesystems in the container, because `-xdev` stays on the
  root filesystem;
- files whose modification time was set back to before the marker;
- changes to directories or permissions alone, because only files and symlinks
  are listed.

## Results

The block below is generated by `node scripts/acceptance/summarise.mjs` from
`evidence/r1-f/latest.json` and `evidence/r1-f/selftest.json`. Every count in it
comes from those files.

<!-- acceptance-results:start -->
Harness run on commit dec50ae1 (2026-11-16): verdict **pass**, **466 pass**, **0 known-gap**, **23 expected-fail**, **10 observed**, **0 fail** (499 rows; `evidence/r1-f/latest.json`).

| Scenario | pass | known-gap | expected-fail | observed | fail |
|---|---:|---:|---:|---:|---:|
| 0-build | 4 | 0 | 0 | 2 | 0 |
| a-node-only | 79 | 0 | 4 | 2 | 0 |
| b-node-git | 84 | 0 | 4 | 0 | 0 |
| c-node-go-rust | 86 | 0 | 4 | 1 | 0 |
| d-global | 79 | 0 | 4 | 1 | 0 |
| d-local | 78 | 0 | 4 | 1 | 0 |
| e-node-24.0.0 | 14 | 0 | 1 | 1 | 0 |
| e-node-25 | 14 | 0 | 1 | 1 | 0 |
| e-node-26 | 14 | 0 | 1 | 1 | 0 |
| f-restic | 14 | 0 | 0 | 0 | 0 |

Known gaps in this run:

None.

Observations quoted from the same run (timings and sizes are observations, not limits):

- Install (a, `npx`): 3.9 s (observation); 0 npm warning lines; ~/.npm/_npx 101.5 MiB; ~/.npm/_cacache 31.0 MiB (apparent file sizes).
- Go opt-in (c): index 1 links upgraded; processes: sh -c, go env, go build, golinks-b78189ed4ced0505 -go, golinks-b78189ed4ced0505 -go; callers of Add opted in: main@main.go:10->Add:definite:toolchain, main@main.go:10->Add:definite:toolchain, main@main.go:13->Add:definite:toolchain, main@main.go:15->Add:definite:toolchain, main@main.go:17->Add:definite:toolchain; with the setting off: main@main.go:10->Add:definite:source, main@main.go:10->Add:definite:source, main@main.go:15->Add:definite:source, main@main.go:17->Add:definite:source.
- restic (f): 559 files, 7356 symbols, 63088 links, 0 failed; 85.7 s, peak RSS ≥ 1905 MiB (observations).
- One CLI call through `npx` (a, `--version`): 2214 ms, peak RSS ≥ 146 MiB.
- Absolute-path `npx` (a): exit 126: sh: 1: /acc/pkg/pymtheg-1.0.0.tgz: Permission denied.

Self-test on commit dec50ae1 (2026-11-16): **passed**. Wording matcher 39/39; control clean (exit 0); **30/30 sabotages caught** (`evidence/r1-f/selftest.json`).

| Case | Break | Scenario | Named step(s), each must be `fail` | Exit | Verdict |
|---|---|---|---|---|---|
| control | unmodified tarball | a-node-only | – | 0 | clean |
| check-exits-0 | `check` exits 0 on the broken design | a-node-only | check-broken | 1 | caught |
| grammar-removed | the vendored Go grammar is missing from the tarball | a-node-only | tarball-contents, graph-index | 1 | caught |
| mcp-check-design-throws | MCP `check_design` throws | a-node-only | mcp-check_design | 1 | caught |
| callers-no-links | `graph callers` returns no links | a-node-only | graph-ts-callers | 1 | caught |
| caller-target-renamed | a caller link's target is renamed | a-node-only | graph-ts-callers | 1 | caught |
| certainty-downgraded | caller certainty downgraded to name-only | a-node-only | graph-ts-callers | 1 | caught |
| prints-java | a command prints "java" | a-node-only | help | 1 | caught |
| index-runs-java | `graph index` silently runs `java -version` | a-node-only | graph-index, no-toolchain-processes | 1 | caught |
| mcp-wrong-verdict | MCP reports a failing verdict for the valid design | a-node-only | mcp-check_design | 1 | caught |
| link-crashes | `pymtheg link` crashes (exit 77) | a-node-only | link-requirement | 1 | caught |
| stack-trace-exit-0 | `--version` prints an internal-error stack trace and exits 0 | a-node-only | version | 1 | caught |
| wrong-diagnostic-message | the N002 suggestion text changes | a-node-only | check-broken, mcp-check_design-broken | 1 | caught |
| listed-tool-throws | a listed MCP tool (`design_recipe`) throws | a-node-only | mcp-design_recipe | 1 | caught |
| deprecation-warning | a coded DeprecationWarning (DEP0005) on Node 24.22 | a-node-only | help | 1 | caught |
| deprecation-warning-24.0.0 | the same DeprecationWarning on Node 24.0.0 | e-node-24.0.0 | help | 1 | caught |
| tools-list-error | `tools/list` answers with a JSON-RPC error | a-node-only | mcp-tools-list, mcp-project_info, mcp-tool-coverage, mcp-requirement_links-requirement | 1 | caught |
| simulate-exhaustive-true | MCP simulate reports `exhaustive: true` | a-node-only | mcp-explore_behaviour-simulate | 1 | caught |
| init-writes-root-file | `init` writes a file in the project root | a-node-only | init | 1 | caught |
| engine-hides-violation | the built-in engine turns a violation into no_counterexample | a-node-only | verify-violation | 1 | caught |
| link-check-passes-changed | `link check` exits 0 with a changed link | a-node-only | link-check-after-edit | 1 | caught |
| mcp-link-check-ok-after-edit | MCP `requirement_links check` reports every link ok after a body edit | a-node-only | mcp-requirement_links-check-after-edit | 1 | caught |
| link-add-stores-nothing | `add` reports created but stores no link | a-node-only | mcp-requirement_links-add-go, link-add-go | 1 | caught |
| go-facts-discarded | Go toolchain facts counted but discarded at final resolution | c-node-go-rust | go-toolchain-callers | 1 | caught |
| stack-in-mcp-json | `project_info` carries a TypeError stack in a `debug` field (structuredContent and text) | a-node-only | mcp-project_info | 1 | caught |
| stack-in-graph-json | `graph status --json` carries a TypeError stack in a `debug` field | a-node-only | graph-status | 1 | caught |
| writes-into-install | `graph index` writes a cache file inside the installed package (next to import.meta.url) | a-node-only | install-unchanged, writes-outside-project | 1 | caught |
| stack-in-mcp-text-only | `project_info` carries a TypeError stack in its text content only (structuredContent untouched) | a-node-only | mcp-project_info | 1 | caught |
| unlinked-includes-linked | MCP `unlinked` also lists the already-linked `apply_discount` | a-node-only | mcp-requirement_links-unlinked | 1 | caught |
| unlinked-ignores-rust-links | `unlinked` ignores links to Rust symbols (lists the linked `apply_discount`) | a-node-only | mcp-requirement_links-unlinked | 1 | caught |
| code-graph-candidate | MCP `code_graph` reports a definite caller as a candidate | a-node-only | mcp-code_graph-callers-ts | 1 | caught |
<!-- acceptance-results:end -->

### Known gaps

**None.** The harness keeps one list of accepted gaps, `KNOWN_WARNING_GAPS` in
`driver.mjs`, and it is empty. That is the normal state: the harness exits 0
when nothing fails, and `latest.md` says "Known gaps: None".

These earlier gaps are all deleted, and their rows are now required checks:
R1-A, R1-B, R1-C, R1-C2, R1-D, W3-L2 and R1-H.

## Self-test: the gate bites

`scripts/acceptance/selftest.mjs` works in four steps:

1. It builds the tarball once (`run.mjs --pack-only`).
2. It makes one copy per sabotage, each broken in one way. A sabotage counts as
   applied only if both of these hold:
   - its anchor was found exactly once;
   - every file it changed still parses (`node --check`).

   Otherwise the case reports NOT APPLIED, which fails the self-test.
3. It runs the real harness on each copy and on an unmodified control, six at a
   time, in the scenario the case names.
4. A sabotage is caught only if the harness exits 1 and every named step is
   `fail`. The control must exit 0 with no failed step and no gap.

The cases and their results are in the results block.

## Cleanup and concurrent runs

- **Containers.**
  - Scenario and build containers are named `pymtheg-acc-<scenario or
    "build">-<run id>`. They carry the labels `pymtheg-acc=1`,
    `pymtheg-acc.owner`, `pymtheg-acc.run` and `pymtheg-acc.pid`.
  - They run `sleep 14400` with `--rm` and `--pull never`, so a lost container
    removes itself within four hours.
  - The toolchain source containers in c (`docker create`, same labels) are
    removed as soon as their files are copied.
- **Leftovers.** At start-up the harness removes containers that carry its own
  owner label and whose recorded run process is no longer a running
  `scripts/acceptance/run.mjs`.
- **Images.** The harness pulls an image only when it is missing, and records
  every image it pulls in `~/.cache/pymtheg-acceptance/pulled-images`.
  - That record is shared, under a lock, by every run of this user.
  - At the end, each run removes every recorded image that no container
    (of any run) uses.
  - So an image pulled by another run of the same user can be removed by this
    run, and is pulled again by whichever run needs it next.
  - Images that are not in the record are never removed. The harness uses no
    `docker build` and never prunes.
- **Stopping.** SIGINT, SIGTERM, SIGHUP and a broken pipe (what a dropped
  `pymtheg-dev` ssh session produces) all clean up the same way before exiting.

`scripts/acceptance/cleanup-test.sh` stops a real run three ways: TERM, HUP,
and closing its output pipe. It judges only this harness's labelled containers
and recorded images, never the host-wide image list. Its result for this round
is under Validation.

### Images a reviewer needs

`node scripts/acceptance/run.mjs --list-images` prints the images from the
harness's own code:

- `node:24.21.0-bookworm-slim` (the build; not needed with `--tarball`)
- `node:24-bookworm-slim`, `node:24.0.0-bookworm-slim`, `node:25-bookworm-slim`
  and `node:26-bookworm-slim`
- `golang:1-bookworm` and `rust:1-slim-bookworm` (for scenario c)

A reviewer who may not pull during a run can fetch them first:

```sh
pymtheg-dev --name r1f-rev -- sh -c 'node scripts/acceptance/run.mjs --list-images | xargs -n1 docker pull -q'
```

The harness does not record images it did not pull. So a run removes a
pre-fetched image only if the record already lists it, from a run of the same
user that pulled it and has not yet cleaned up. Remove the images afterwards
with the same list and `docker image rm`.

## Rough edges with no owning chunk

1. **`"private": true`** (`package.json`). npm refuses to publish the package,
   so `npx pymtheg` from the registry needs the owner's decision.
   `npx ./pymtheg-1.0.0.tgz` works today.
2. **`npx /absolute/path.tgz`** fails, because npm runs an absolute path as a
   command. This run's `npx-absolute-path` row is quoted in the results block.
   Docs should show `./name.tgz` or `file:/abs/path.tgz`.
3. **The Go opt-in needs `go.mod` at the project root**
   (`src/graph/languages/go/index.ts`: "no go.mod at the project root"). A Go
   module in a subfolder of a mixed repository reports `unavailable`. The route
   also refuses any `go` that is not `<GOROOT>/bin/go`
   (`src/graph/languages/go/toolchain.ts`), so a version-manager shim needs the
   setting to name the real binary.

The install size and the per-call `npx` cost are observations; they are quoted
in the results block.

Re-checked for this round, against the merged tree and this run's evidence:

- Removed as false or not this product's: unused runtime dependencies (R1-H
  moved them to devDependencies; runtime dependencies are now only
  `@modelcontextprotocol/server`, `ajv`, `typescript`, `web-tree-sitter` and
  `zod`).
- Removed: install-script warnings. This run's install rows report 0 npm
  warning lines.
- Removed: Go telemetry. It came from the harness's own `go version`, as
  explained under "Writes outside the project".
- Removed: `npx` signal handling. It was observed in round 1, and this run does
  not test it.
- Removed: "`check_design` returns counts only". It now returns the findings
  (`src/mcp/check-findings.ts`).

## Validation

These ran on the dev server, on commit dec50ae1, which contains main 27674435.
Later commits change only this note, the evidence, and
`scripts/acceptance/summarise.mjs`, which generates the results block and is
not run by the harness.

- `npm test`: 2,814/2,814 pass, with 0 fail, cancelled or skipped.
- `npm run format:check`: passes. It does not cover `scripts/`; that is
  backlog.
- Harness: exit 0, with the counts in the results block.
- Self-test: exit 0, with the counts in the results block.
- Cleanup test: exit 0. TERM exited 143, HUP 129 and PIPE 141. Each left 0
  containers and no recorded image unused.
- Afterwards: 0 `pymtheg-acc` containers remained, and the recorded-image list
  was empty.

## Files

- `scripts/acceptance/run.mjs`: the host orchestrator.
- `scripts/acceptance/driver.mjs`: the in-container steps.
- `scripts/acceptance/wording.mjs`: the wording matcher and its fixed cases.
- `scripts/acceptance/spawn-trace.cjs` and `scripts/acceptance/shim.sh`: the
  process detectors.
- `scripts/acceptance/selftest.mjs`: the self-test.
- `scripts/acceptance/cleanup-test.sh`: the cleanup test.
- `scripts/acceptance/summarise.mjs`: the generated results block.
- `test/fixtures/acceptance/sample/`, the sample project:
  - TypeScript `web/`;
  - the Go module `service/`, including receivers that only the toolchain can
    type;
  - the Rust crate `engine/`;
  - `docs/`;
  - `designs/order.pym` (valid), `designs/broken.pym` (a type error) and
    `designs/overcharge.pym` (a behaviour violation).
- `package.json`: the `acceptance` script.
- `evidence/r1-f/latest.{json,md}` and `evidence/r1-f/selftest.{json,md}`.
