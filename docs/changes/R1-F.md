# R1-F: clean-machine acceptance harness

Release 1 item 1 (D19, `docs/build-plan.md`; mega-plan 8.2) is that `npx pymtheg`
runs on a clean machine with no Java or Quint. This chunk adds two things:

- a repeatable harness that shows what a new user gets from the packed tarball;
- a self-test that proves the harness catches real breakage.

It changes no product code. Run the harness after each R1 merge and as the
release gate, which is exit 0.

## Run it

On the dev server (it needs Docker), from the repository root:

```sh
pymtheg-dev --name r1f-xxxx -- node scripts/acceptance/run.mjs --commit "$(git rev-parse --short HEAD)" --out '$PYM_SCRATCH/acc'
pymtheg-dev --name r1f-xxxx --no-sync -- sh -c 'cat $PYM_SCRATCH/acc/latest.json' > evidence/r1-f/latest.json
pymtheg-dev --name r1f-xxxx --no-sync -- sh -c 'cat $PYM_SCRATCH/acc/latest.md'   > evidence/r1-f/latest.md
pymtheg-dev --name r1f-xxxx -- node scripts/acceptance/selftest.mjs --commit "$(git rev-parse --short HEAD)"   # prove the gate bites
pymtheg-dev --name r1f-xxxx -- sh scripts/acceptance/cleanup-test.sh TARBALL                               # prove cleanup under TERM/HUP/PIPE
pymtheg-dev --name r1f-xxxx --clean
```

`npm run acceptance` runs the same script. Options:

- `--scenarios a-node-only,f-restic` runs a subset. An unknown name is a usage
  error (exit 3).
- `--tarball PATH` reuses a packed tarball. Each build keeps one in
  `$PYM_SCRATCH/acceptance-tarball-<run>/`.
- `--pack-only` builds the tarball and stops.
- `--out DIR`, `--restic DIR` and `--keep-images`.

On the dev server a full run takes about 22 minutes and the self-test about 11.
These times are observations; nothing is asserted on time.

Exit status:

| Exit | Meaning |
|---|---|
| 0 | Every required step passes. This is the release gate. |
| 2 | Nothing fails, but known gaps remain. |
| 1 | A required step fails. |
| 3 | Harness or usage error. |
| 129, 130, 141, 143 | Stopped by HUP, INT, a broken pipe or TERM, after removing everything the run created. |

## How it works

**Building the tarball.** `scripts/acceptance/run.mjs` runs on the host. It
copies the source tree, without `node_modules`, build output, evidence or
research, into a throwaway `node:24.21.0-bookworm-slim` container. There it runs
`npm ci`, `npm run build` and `npm pack`, and then checks the tarball contents.

**Running a scenario.**

- Each scenario starts a fresh container from an official
  `node:*-bookworm-slim` image.
- Only the tarball, the sample project (`test/fixtures/acceptance/sample`) and
  the harness files are copied in.
- Steps run as the unprivileged `node` user.
- Only the install step has network. After it, the container is disconnected,
  and `network-off` proves that neither the registry nor a direct IP can be
  reached.
- `scripts/acceptance/driver.mjs` runs the steps, using Node built-ins only. It
  drives MCP over stdio with a small JSON-RPC client and checks Studio with plain
  HTTP (no browser).

**Detecting processes.** Two detectors record every `java`, `javac`, `quint`,
`tlc`, `go`, `cargo`, `rustc` and `rustup` process:

- `shim.sh`, placed first on `PATH`. It uses shell built-ins only, a fixed log
  path and a fixed fallback search path, so it still works under a stripped
  environment.
- `spawn-trace.cjs`, preloaded through `NODE_OPTIONS`. It logs every child
  process that a Node process starts.

### What every step is checked for

A step passes only if all of these hold:

1. Its own exact expectation is met: exit code, and exact JSON fields or output
   lines.
2. No `java`, `javac`, `quint` or `tlc` process ran.
3. No `go`, `cargo`, `rustc` or `rustup` process ran. The Go opt-in steps may
   run `go` only, never `cargo` or `rustc`.
4. No Java/Quint/TLC wording appears in stdout, stderr or any string value of
   parsed JSON output (see item 5). `wording.mjs` defines the wording (choices below).
5. No internal-error output appears:
   - a stack frame (`^\s+at .+:\d+:\d+\)?$`);
   - a line starting `\w*Error: ` that the step does not list as an expected,
     asserted line;
   - an `unhandled` or `uncaught` rejection.

   JSON keeps a stack trace on one line with escaped newlines, so every string
   value of parsed JSON output is checked as text too: CLI `--json` output, MCP
   `structuredContent`, and MCP text content (and JSON nested in a string is
   expanded). No step today expects an `Error:` line: the
   broken-design diagnostic reads `…/broken.pym:7:27 error N002: …` and is
   asserted whole.
6. No Node process warning (`^\(node:\d+\) (?:\[[A-Z0-9_]+\] )?\w*Warning: `,
   with or without a code) appears. No warning is excepted: the
   `KNOWN_WARNING_GAPS` list is empty. Node 24.0.0's SQLite
   `ExperimentalWarning` was the last exception (R1-H); PR 45 removed the
   warning, and the entry has been deleted.

Statuses:

- **pass**
- **expected-fail:** the step was designed to fail (the broken design, the
  violating design, a changed requirement link) and failed exactly as specified.
- **known-gap:** given only when the step's sole problem is its expectation, and
  that step's own matcher recognises the exact output the named chunk will
  change.
- **fail:** anything else.
- **observed:** sizes, timings, and the absolute-path `npx` form.

### Wording matcher choices

The matcher is
`\b(?:java|javac|java_home|jdk|jre|openjdk|quint|tlcs?)\b|tla2tools|\bTLA\+`,
case-insensitive.

- `JAVA_HOME` is listed as its own token, because `\b` treats `_` as a word
  character.
- `java.exe` matches through `\bjava\b`.
- `TLCs` matches: in this product's output it can only mean runs of the TLC
  checker.
- `jdk`, `jre` and `openjdk` match as whole words.

The self-test checks every fixed string in `WORDING_CASES` (the count is in the results block below):

| Must match | Must not match |
|---|---|
| `java -version`, `java.exe`, `JAVA_HOME is not set`, `set java_home first`, `openjdk 21.0.2`, `Install a JDK`, `JRE 17`, `javac 21`, `Quint: ready`, `--backend quint`, `TLC requires …`, `two TLCs ran`, `tla2tools.jar`, `TLA+`, … | `JavaScript`, `TypeScript/JavaScript`, `javascript:void(0)`, `Javadoc-style`, `quintessential`, `quintuple`, `atlc`, `tlcx`, `TLAs`, `java_home_dir`, `jdkfoo`, … |

## What each scenario proves

| Scenario | Proves |
|---|---|
| 0-build | `npm ci`, `npm run build` and `npm pack` work from a clean checkout. The tarball has the CLI, web assets, both vendored grammars, README and the launcher. It ships no TypeScript sources, tests, evidence or research. The one helper source it runs (`src/graph/languages/go/toolchain/golinks.go`) is allowed and listed. |
| a-node-only | The full list below, with Node only. |
| b-node-git | Scenario (a) inside a git repository. After init, and again at the end, `git status` shows exactly the three `.pymtheg/` files, and tracked files are unchanged. The link edit is undone. |
| c-node-go-rust | Scenario (a) with Go 1.27.4 and Cargo 1.100.0 on PATH: the graph answers are identical to (a), and with the setting off no `go` or `cargo` runs. With `graph.toolchain.go` set to the real `<GOROOT>/bin/go` on the sample's Go module, the route must report `used` with upgraded links > 0. Its process evidence must show both `go env` and the resolving helper (built from `golinks.go`) running from the project's `.pymtheg/rebuildable/toolchain/`; `go env` alone does not count. The actual links are then checked: `graph callers Add` must return exactly five definite calls from `main`, each `decidedBy: "toolchain"`, including the generic-result call at `main.go:13` (`pricing.First(...).Add(5)`). With the setting removed, no `toolchain` is reported, and the same query must return exactly the four other calls (source-decided) and not line 13. So the check proves the opt-in made the difference. |
| d-global / d-local | `npm i -g` and `npm i` of the tarball. The binary resolves to the installed package and everything works from there. |
| e-node-24.0.0 / 25 / 26 | Required, because engines is `">=24"`: install, help, init, doctor (all ready), check, verify, simulate, the broken design, graph index, callers, and no writes outside the project. |
| f-restic | The pinned restic corpus: init, index with 0 failed files, status and five queries. Time and memory are observations. |

What scenario (a) runs, every step offline after the install:

- **Install:** `npx ./pymtheg-1.0.0.tgz --help`, with network.
- **Basic commands:**
  - help and version.
  - init: reports "3 existing documents found", and creates or changes no file
    outside `.pymtheg/`.
  - Running init again leaves the metadata bytes identical.
  - `doctor --format json` reports every check `ready`.
- **Designs:**
  - `check` on the valid design reports 0 diagnostics.
  - `verify` reports each property `no_counterexample`, complete and
    `exhaustive: true`.
  - `simulate` reports each property `no_counterexample`, complete and
    `exhaustive: false`.
  - `verify` on `designs/overcharge.pym` exits 1 with `chargedOnce`
    `counterexample`, complete.
  - `check` and `verify` on the broken design exit 1 with an output line equal
    to `…/broken.pym:7:27 error N002: Unknown value or variant charge; did you mean charges?`.
- **Graph:**
  - index (9 files, 0 failed) and status.
  - Six exact callers queries: each returns exactly the expected caller and
    file, with `definite` certainty and the right target. Five are cross-file
    (TypeScript ×2, Go ×2, Rust ×1) and one is same-file (`percent_of`).
  - The path query (definite) and the search query (exactly two symbols and one
    file).
- **`pymtheg link` (CLI):**
  - Requirement `plan:R2` is linked to `ComputeTotal` (Go), `apply_discount`
    (Rust) and `formatTotal` (TypeScript).
  - `list` and `check` report all three `ok`, and `check` exits 0.
  - After an edit to the body of `apply_discount`, `check` exits 1, with exactly
    that link `changed` and the others `ok`.
  - `refresh` makes it ok again, and `check` exits 0.
  - The edit is undone, refreshed and checked again.
- **MCP:** initialize, `tools/list`, and then **every listed tool** with a
  checked result (table below). This includes requirement links using MCP calls
  only. Every MCP answer is scanned in both its forms: `structuredContent` and
  every text content block. `mcp-tool-coverage` fails if any listed tool was
  not called, so a new tool fails the gate until the harness exercises it.
- **Studio:** start, `GET /api/project` (the workspace name), `GET /` plus every
  asset it references, and a SIGINT stop.
- **Legacy folder:** init in a folder that has `.pymtheg-studio/` exits 0,
  names the folder in a notice, and leaves it untouched.
- **Processes:** the `no-toolchain-processes` summary must be empty.
- **Writes:** `writes-outside-project` (see "Writes outside the project" below).

| MCP step | Call | Exact check |
|---|---|---|
| mcp-project_info | `project_info {}` | `totalFiles` 3 |
| mcp-design_recipe | `{action:"list"}` | includes recipe `decision` |
| mcp-read_source | `designs/order.pym` line 2 | `["machine Order {"]` |
| mcp-check_design | valid design | exitStatus 0, 0 errors, 0 warnings |
| mcp-check_design-broken | broken design + `read_run` findings | exitStatus 1; exactly one finding: `{code:"N002", message:"Unknown value or variant charge; did you mean charges?", file:"designs/broken.pym", line:7, column:27, severity:"error"}` |
| mcp-explore_behaviour-verify / -simulate | + `read_run` properties | summary: exitStatus 0, 0 counterexamples, 0 unresolved, `exhaustive` true/false; properties: `finite_model_check/no_counterexample/complete/true` and `simulation/no_counterexample/complete/false` |
| mcp-try_inputs | flow `next` given only as a buffer, `n:"41"` | complete, output `"42"` |
| mcp-design_interface | `check_design` on the buffer, then `symbols` | flow check exitStatus 0; symbol `next` |
| mcp-emit_scaffold / mcp-read_scaffold | TypeScript | the source has `function next(`; one page equals the emitted source, is complete and has a SHA-256 contentHash |
| mcp-emit_implementation_check | Go, `*Worker` | the source has `PymthegContracts` |
| mcp-code_graph-index | `code_graph {action:"index"}` (+ `graph_result` if running) | complete, status ok, 0 failed files |
| mcp-code_graph-search | `search Total` + symbols page | exactly `ComputeTotal@service/pricing/total.go`, `formatTotal@web/src/format.ts`, `total.go` |
| mcp-code_graph-callers-ts/-go/-rust | `callers` (links page + symbols page) | exactly one link each: `renderBasket@web/src/main.ts`, `main@service/main.go`, `main@engine/src/main.rs` → target, `definite` |
| mcp-requirement_links-requirement | `{action:"requirement", id:"R1"}` | status `created`; items `["plan:R1"]` |
| mcp-requirement_links-add-go | `code_graph {action:"symbol", query:"taxFor"}`, then `add` with that `symbol:<hex>` ref | `created`; one link: `plan:R1` → `taxFor`, with the same ref |
| mcp-requirement_links-add-rust / -ts | `add` `percent_of` / `roundCents` | `created`; one link each, with the exact record, name and path |
| mcp-requirement_links-list | `{action:"list", record:"R1"}` | exactly `percent_of`, `roundCents`, `taxFor`, all `ok` |
| mcp-requirement_links-check | `{action:"check"}` | all six links in the project (plan:R1 ×3 by MCP, plan:R2 ×3 by CLI) `ok`; `passed: true` |
| mcp-requirement_links-check-after-edit | after editing `roundCents`'s body | exactly `plan:R1/roundCents` `changed`, with `differs: ["body"]`, the others `ok`; `passed: false` |
| mcp-requirement_links-refresh, -check-after-refresh, -refresh-restored, -check-final | `refresh` that link; undo the edit; refresh again | `refreshed` (same link id); all six `ok`, `passed: true` |
| mcp-requirement_links-requirements_for | `{symbol:"percent_of"}` | exactly `plan:R1`, `direct`, `percent_of` |
| mcp-requirement_links-unlinked | `{symbols:true, section:"symbols"}` | one complete page, exactly: Go `Add`, `Cart`, `First`, `Items`, `Load`, `NewCart` (`service/pricing/cart.go`) and TypeScript `renderBasket`. No linked symbol and no private one |
| mcp-link_result-handle | `check` with `wait:false`, then `link_result {wait:true}` | handle `running` with a jobId; result `complete`, same jobId, `passed: true`, all six `ok` |
| mcp-read_architecture | `{section:"summary"}` | a store exists, with two revisions (plan:R2 by CLI, plan:R1 by MCP) |
| mcp-observe_implementation | `read_implementation` versions, then observe `web/src/main.ts` | a revision receipt |
| mcp-link_implementation | planned `plan:R1` + observed `renderBasket`, `reviewed:true` | reviewed receipt; `plan:R1` has 1 link |
| mcp-compare_implementation | the same pair | `source.equal` true, note retained |
| mcp-unlink_implementation | the same pair | receipt; `plan:R1` has 0 links |

`read_run` and `graph_result` are called within the steps above. Every MCP step
**fails** if `tools/list` did not succeed or does not list the tool it uses.

### Writes outside the project

`writes-outside-project` runs after each whole scenario. It fails if any file
newer than the marker (written after the install) exists outside the places
below:

- **The project folders the scenario works in:** the sample, the legacy copy,
  the Go project, restic and the local-install app.
- **npm's own folders:** `~/.npm/_cacache`, `_logs`, `_npx` and
  `_update-notifier-last-checked`. npm and npx write there on every
  invocation. Nothing else under `~/.npm` is allowed, and neither is the global
  prefix after the install.
- **Node's compile cache, `/tmp/node-compile-cache/`:** the npm CLI enables it
  for itself, and Pymtheg's source never calls `enableCompileCache`. It appears
  in d-local, where `npx` runs from the app folder. Nothing else in `/tmp` is
  allowed, so a temporary file left behind after the scenario fails the step.
- **Never inside the installed package.** Any written path containing
  `/node_modules/pymtheg/` fails, even where its folder is otherwise allowed.
  Separately, `install-unchanged` snapshots the installed package tree after
  the install (paths, sizes and SHA-256, in the npx store, the global prefix or
  the local `node_modules`). It requires that tree to be byte-for-byte
  unchanged at the end of every scenario.
- **In scenario c only:** Go's build cache (`~/.cache/go-build`), its module
  cache (`~/go`) and its config folder (`~/.config/go`, local telemetry
  counters). These are written by the `go` the project opted into.
- **`/acc`:** the harness's own files.

What this check does not see:

- files created and removed again within the scenario (transient temp files);
- writes outside the container's root filesystem (none is mounted);
- changes to directories or permissions alone (only files and symlinks are
  compared).

## Results

The block below is generated from `evidence/r1-f/latest.json` and
`evidence/r1-f/selftest.json` by `node scripts/acceptance/summarise.mjs`. Every
count in it comes from those files.

<!-- acceptance-results:start -->
Harness run on commit 0857f2f2 (2026-11-16): verdict **pass**, **466 pass**, **0 known-gap**, **23 expected-fail**, **10 observed**, **0 fail** (499 rows; `evidence/r1-f/latest.json`).

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

- Install (a, `npx`): 3.9 s (observation); 0 npm warning lines; ~/.npm/_npx 97.7 MiB; ~/.npm/_cacache 30.5 MiB (apparent file sizes).
- Go opt-in (c): index 1 links upgraded; processes: sh -c, go env, go build, golinks-b78189ed4ced0505 -go, golinks-b78189ed4ced0505 -go; callers of Add opted in: main@main.go:10->Add:definite:toolchain, main@main.go:10->Add:definite:toolchain, main@main.go:13->Add:definite:toolchain, main@main.go:15->Add:definite:toolchain, main@main.go:17->Add:definite:toolchain; with the setting off: main@main.go:10->Add:definite:source, main@main.go:10->Add:definite:source, main@main.go:15->Add:definite:source, main@main.go:17->Add:definite:source.
- restic (f): 559 files, 7356 symbols, 63088 links, 0 failed; 86.6 s, peak RSS ≥ 2074 MiB (observations).

Self-test on commit 437bb2e5 (2026-11-16): **passed**. Wording matcher 39/39; control clean (exit 0); **30/30 sabotages caught** (`evidence/r1-f/selftest.json`).

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

**None.** The harness keeps one list, `KNOWN_WARNING_GAPS` in `driver.mjs`, and
it is now empty. That is the normal state: the harness exits 0 when nothing
fails, and `latest.md` says "Known gaps: None". A chunk still in flight would add
one entry, matched to its exact warning and Node versions.

Every earlier gap is deleted and its rows are required checks: R1-A, R1-B,
R1-C, R1-C2, R1-D, W3-L2 and, since PR 45, R1-H.

## Self-test: the gate bites

`scripts/acceptance/selftest.mjs`:

1. Builds the tarball once.
2. Makes one copy per sabotage, each broken in one way. Each sabotage is first
   checked to have actually applied: its anchor must be found exactly once,
   otherwise the case reports NOT APPLIED.
3. Runs the real harness on each copy and on an unmodified control, six at a
   time, in the scenario the case names.
4. A sabotage counts as caught only if the harness exits 1 and every named step
   is `fail`. The control must be clean: exit 0, with no failed step and no
   gap.

The cases and their results are in the generated block above.

## Cleanup and concurrent runs

- **Containers.** Every container is named `pymtheg-acc-<scenario>-<run id>` and
  carries the labels `pymtheg-acc=1`, `.owner`, `.run` and `.pid`. Its own
  process is `sleep 14400` with `--rm`, so a lost container removes itself.
- **Leftovers.** At start-up the harness removes only containers with its own
  owner label whose run process has ended.
- **Images.** An image is pulled only when absent, and every image this run
  pulls is recorded, whatever was on the server when the run started.
  - The record is `~/.cache/pymtheg-acceptance/pulled-images`, a locked list
    shared by overlapping runs.
  - The last run to finish removes a recorded image once no container of any
    run uses it.
  - Images the harness did not pull are never removed.
  - The harness uses no `docker build` and never prunes.
- **Stopping.** SIGINT, SIGTERM and SIGHUP all clean up. So does a broken pipe,
  which is what a dropped `pymtheg-dev` ssh session produces.

`scripts/acceptance/cleanup-test.sh` judges only this harness's labelled
containers and recorded images, never the host-wide image list. On 15 November
2026:

- TERM exited 143, HUP 129 and PIPE 141. Each left 0 containers and no recorded
  image unused.
- A real `pymtheg-dev` session killed mid-run (round 2) also left nothing.
- After every run, 0 `pymtheg-acc` containers remained, and the recorded-image
  list was empty.

## Gap list: rough edges with no owning chunk

1. **`"private": true`.** `npx pymtheg` from the registry needs the owner's
   publish decision. `npx ./pymtheg-1.0.0.tgz` works today.
2. **`npx /absolute/path.tgz`** exits 126, because npm runs an absolute path as a
   command. Docs should show `./name.tgz` or `file:/abs/path.tgz`.
3. **Install size** (see the install observation in the results block). Some
   runtime `dependencies` look unused at runtime (to be confirmed before
   changing anything):
   - the npm tree-sitter grammar packages, because the graph loads the vendored
     `.wasm` files;
   - React, react-markdown, remark-gfm, `@lezer/highlight` and most of
     CodeMirror, because they are bundled into `dist-web/`. Only
     `@codemirror/state` is imported by server code.
4. **Install-script warnings.** `npm i -g` and `npm i` print
   `npm warn install-scripts` lines for the tree-sitter packages (listed in the
   `install-global` and `install-local` rows of `evidence/r1-f/latest.json`). None of those
   scripts is needed.
5. **The Go opt-in needs `go.mod` at the project root.** A Go module in a
   subfolder reports `unavailable`. The opt-in also rightly refuses a `go` that
   is not `<GOROOT>/bin/go`.
6. **The Go opt-in writes Go telemetry counters.** Running `go` writes
   `~/.config/go/telemetry/local/…count`, which is outside the project. The route
   could set `GOTELEMETRY=off`, or document it.
7. **Signalling only the `npx` PID** does not stop Studio or the MCP server, and
   `npx` may not exit either. Supervisors should signal the process group.
8. **Each CLI call through `npx` has a start-up cost** before doing any work
   (see each row's `durationMs` and `peakRssKiB` in `latest.json`).

Re-checked against main at the time of this run (merge of 1eddce6a):

- Items 1, 3 and 4: `package.json` still has `"private": true`, the tree-sitter
  and React/CodeMirror dependencies, and only `@codemirror/state` is imported
  under `src/`. The install-script warning lines are in this run's evidence.
- Item 2: this run's `npx-absolute-path` row shows the exit 126.
- Item 5: `src/graph/languages/go/index.ts` still returns `unavailable` with
  "no go.mod at the project root".
- Item 6: the telemetry file appears in this run's (c) `writes-outside-project`
  note.
- Item 7: observed in round 1, when the harness first signalled only the `npx`
  PID. The harness now signals the process group, so it does not retest this.

Removed as stale: "`check_design` returns counts only". On current main,
`check_design` returns the findings themselves (`src/mcp/check-findings.ts`):
code, message and location, paged, with `read_run` for the full text.

## Validation

All on the dev server:

- `npm test`: 2,813/2,813 pass, with 0 fail, cancelled or skipped.
- `npm run format:check`: passes.
- The harness and the cleanup test ran on commit 0857f2f2:
  - the harness exits 0: verdict pass, with no known gap;
  - the cleanup test exits 0 (TERM 143, HUP 129, PIPE 141, each with 0
    containers left and no recorded image left unused).
- The self-test ran on commit 437bb2e5 and exits 0. That commit only changes one
  self-test anchor.
- Later commits change only this note and the evidence.

## Files

- `scripts/acceptance/run.mjs`: the host orchestrator.
- `scripts/acceptance/driver.mjs`: the steps that run in the container.
- `scripts/acceptance/wording.mjs`: the wording matcher and its fixed cases.
- `scripts/acceptance/spawn-trace.cjs` and `scripts/acceptance/shim.sh`: the
  process detectors.
- `scripts/acceptance/selftest.mjs` and `scripts/acceptance/cleanup-test.sh`.
- `test/fixtures/acceptance/sample/`:
  - TypeScript `web/`;
  - the Go module `service/`, with receivers that only the toolchain can type;
  - the Rust crate `engine/`;
  - `docs/`;
  - `designs/order.pym` (valid), `designs/broken.pym` (a type error) and
    `designs/overcharge.pym` (a behaviour violation).
- `package.json`: the `acceptance` script.
- `evidence/r1-f/latest.{json,md}` and `evidence/r1-f/selftest.{json,md}`.
