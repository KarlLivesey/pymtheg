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
3. No `go`, `cargo`, `rustc` or `rustup` process ran, unless the step is the Go
   opt-in.
4. No Java/Quint/TLC wording appears in stdout, stderr or the decoded text of an
   MCP answer. `wording.mjs` defines the wording (choices below).
5. No internal-error output appears:
   - a stack frame (`^\s+at .+:\d+:\d+\)?$`);
   - a line starting `\w*Error: ` that the step does not list as an expected,
     asserted line;
   - an `unhandled` or `uncaught` rejection.

   This also covers stack traces inside MCP JSON strings, because their text is
   decoded before checking. No step today expects an `Error:` line: the
   broken-design diagnostic reads `…/broken.pym:7:27 error N002: …` and is
   asserted whole.
6. No Node process warning (`^\(node:\d+\) (?:\[[A-Z0-9_]+\] )?\w*Warning: `,
   with or without a code) appears. There is one exception, the R1-H gap: the
   exact SQLite `ExperimentalWarning` and its trace hint, on Node 24.0.x or 25.x
   only. Any extra warning still fails.

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

The self-test checks 32 fixed strings:

| Must match | Must not match |
|---|---|
| `java -version`, `java.exe`, `JAVA_HOME is not set`, `set java_home first`, `openjdk 21.0.2`, `Install a JDK`, `JRE 17`, `javac 21`, `Quint: ready`, `--backend quint`, `TLC requires …`, `two TLCs ran`, `tla2tools.jar`, `TLA+`, … | `JavaScript`, `TypeScript/JavaScript`, `javascript:void(0)`, `Javadoc-style`, `quintessential`, `quintuple`, `atlc`, `tlcx`, `TLAs`, `java_home_dir`, `jdkfoo`, … |

## What each scenario proves

| Scenario | Proves |
|---|---|
| 0-build | `npm ci`, `npm run build` and `npm pack` work from a clean checkout. The tarball has the CLI, web assets, both vendored grammars, README and the launcher. It ships no TypeScript sources, tests, evidence or research. The one helper source it runs (`src/graph/languages/go/toolchain/golinks.go`) is allowed and listed. |
| a-node-only | The full list below, with Node only. |
| b-node-git | Scenario (a) inside a git repository. After init, and again at the end, `git status` shows exactly the three `.pymtheg/` files, and tracked files are unchanged. The link edit is undone. |
| c-node-go-rust | Scenario (a) with Go 1.27.4 and Cargo 1.100.0 on PATH: the graph answers are identical to (a), and with the setting off no `go` or `cargo` runs. With `graph.toolchain.go` set to the real `<GOROOT>/bin/go` on the sample's Go module, `go` must run and the route must report `used` with upgraded links > 0. Today that is 1 link and 2 `go` processes. With the setting removed again, no `toolchain` is reported. |
| d-global / d-local | `npm i -g` and `npm i` of the tarball. The binary resolves to the installed package and everything works from there. |
| e-node-24.0.0 / 25 / 26 | Required, because engines is `">=24"`: install, help, init, doctor (all ready), check, verify, simulate, the broken design, graph index, callers, and no writes outside the project. |
| f-restic | The pinned restic corpus (559 Go files): init, index with 0 failed files, status and five queries. Time and memory are observations. |

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
- **`pymtheg link`:**
  - Requirement `plan:R1` is linked to `ComputeTotal` (Go), `apply_discount`
    (Rust) and `formatTotal` (TypeScript).
  - `list` and `check` report all three `ok`, and `check` exits 0.
  - After an edit to the body of `apply_discount`, `check` exits 1, with exactly
    that link `changed` and the others `ok`.
  - `refresh` makes it ok again, and `check` exits 0.
  - The edit is undone, refreshed and checked again.
- **MCP:** initialize, `tools/list`, and then **every listed tool** with a
  checked result (table below). `mcp-tool-coverage` fails if any listed tool was
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
| mcp-read_architecture | `{section:"summary"}` | a store exists, with one revision (R1) |
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
- **`~/.npm` and the global prefix:** npm and npx write their own cache, logs
  and npx store there on every invocation.
- **`/tmp`:** the temp dir that Pymtheg's workers may use. Nothing was written
  there in today's run.
- **In scenario c only:** Go's build cache (`~/.cache/go-build`), its module
  cache (`~/go`) and its config folder (`~/.config/go`, local telemetry
  counters). These are written by the `go` the project opted into.
- **`/acc`:** the harness's own files.

## Today's result (commit 12c7fa74: main with R1-A, R1-B, R1-C, R1-D, W3-L2 and PR 43 merged)

Verdict **known-gaps**, harness exit 2: **370 pass, 14 known-gap,
22 expected-fail, 10 observed, 0 fail.**

| Scenario | pass | known-gap | expected-fail | observed | fail |
|---|---:|---:|---:|---:|---:|
| 0-build | 4 | 0 | 0 | 2 | 0 |
| a-node-only | 63 | 1 | 4 | 2 | 0 |
| b-node-git | 68 | 1 | 4 | 0 | 0 |
| c-node-go-rust | 68 | 1 | 4 | 1 | 0 |
| d-global | 64 | 1 | 4 | 1 | 0 |
| d-local | 63 | 1 | 4 | 1 | 0 |
| e-node-24.0.0 | 4 | 9 | 0 | 1 | 0 |
| e-node-25 | 12 | 0 | 1 | 1 | 0 |
| e-node-26 | 12 | 0 | 1 | 1 | 0 |
| f-restic | 12 | 0 | 0 | 0 | 0 |

### Every remaining known gap

| Chunk | Steps | Exact condition accepted | Turns green when |
|---|---|---|---|
| R1-C2 | `mcp-requirement-links` in a, b, c, d-global, d-local | `tools/list` succeeded and no listed tool's name contains `code_link`, `requirement` or `symbol_link` | When such a tool appears, the row **fails** (and so does `mcp-tool-coverage`) until `mcpSteps` creates, lists and checks a link through it. |
| R1-H | 9 steps in e-node-24.0.0 | Node 24.0.x or 25.x; the only Node warning lines are exactly `(node:N) ExperimentalWarning: SQLite is an experimental feature and might change at any time` and its trace hint | The warning is gone. Node 25.9.0 already shows none. |

The R1-C, R1-D and W3-L2 gaps are deleted, and their rows are real required
checks.

Observations:

- **Install:** `npx` installs in about 8 s. That is 85.2 MiB in `~/.npm/_npx`,
  plus 69.6 MiB in `~/.npm/_cacache`.
- **restic** (559 files): index took 92 s with at least 2.1 GiB peak RSS. It
  found 7,356 symbols and 63,088 links, and no file failed.

## Self-test: the gate bites

`scripts/acceptance/selftest.mjs` runs on commit 0ab4b8cb. The commit after it
only adds `~/.config/go` to scenario (c)'s allowed places, which no self-test
case uses.

1. It builds the tarball once.
2. It makes 20 copies, each broken in one way. Each sabotage is first checked to
   have actually applied: its anchor must be found exactly once, otherwise the
   case reports NOT APPLIED.
3. It runs the real harness on each copy and on an unmodified control, six at a
   time.
4. A case is caught only if the harness exits 1 and every named step is `fail`.

Result (`evidence/r1-f/selftest.md`): **matcher 32/32, control clean, 20/20
caught.**

| Case | Break | Scenario | Named step(s), all `fail` | Exit |
|---|---|---|---|---|
| control | none | a | 0 failed; only R1-C2 | 2 |
| check-exits-0 | `check` exits 0 on the broken design | a | check-broken | 1 |
| grammar-removed | vendored Go grammar removed | a | tarball-contents, graph-index | 1 |
| mcp-check-design-throws | MCP `check_design` throws | a | mcp-check_design | 1 |
| callers-no-links | `graph callers` returns no links | a | graph-ts-callers | 1 |
| caller-target-renamed | link target renamed | a | graph-ts-callers | 1 |
| certainty-downgraded | certainty becomes `name-only` | a | graph-ts-callers | 1 |
| prints-java | `--help` prints "java" | a | help | 1 |
| index-runs-java | `graph index` runs `java -version` | a | graph-index, no-toolchain-processes | 1 |
| mcp-wrong-verdict | MCP exitStatus 1 for the valid design | a | mcp-check_design | 1 |
| link-crashes | `pymtheg link` exits 77 | a | link-requirement | 1 |
| stack-trace-exit-0 | `--version` prints a TypeError stack and exits 0 | a | version | 1 |
| wrong-diagnostic-message | N002 suggestion text changed | a | check-broken, mcp-check_design-broken | 1 |
| listed-tool-throws | `design_recipe` throws | a | mcp-design_recipe | 1 |
| deprecation-warning | `[DEP0005] DeprecationWarning` on Node 24.22 | a | help | 1 |
| deprecation-warning-24.0.0 | the same, on Node 24.0.0 beside the R1-H warning | e-node-24.0.0 | help | 1 |
| tools-list-error | `tools/list` answers a JSON-RPC error | a | mcp-tools-list, mcp-project_info, mcp-tool-coverage, mcp-requirement-links | 1 |
| simulate-exhaustive-true | MCP simulate says `exhaustive: true` | a | mcp-explore_behaviour-simulate | 1 |
| init-writes-root-file | `init` writes `PYMTHEG.md` in the project root | a | init | 1 |
| engine-hides-violation | the built-in engine reports a violation as `no_counterexample` | a | verify-violation | 1 |
| link-check-passes-changed | `link check` exits 0 with a changed link | a | link-check-after-edit | 1 |
| code-graph-candidate | MCP `code_graph` reports a definite caller as `candidate-set` | a | mcp-code_graph-callers-ts | 1 |

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
- After every run in this round, 0 `pymtheg-acc` containers remained, and the
  recorded-image list was empty.

## Gap list: rough edges with no owning chunk

1. **`"private": true`.** `npx pymtheg` from the registry needs the owner's
   publish decision. `npx ./pymtheg-1.0.0.tgz` works today.
2. **`npx /absolute/path.tgz`** exits 126, because npm runs an absolute path as a
   command. Docs should show `./name.tgz` or `file:/abs/path.tgz`.
3. **Install size.** 85 MiB. Some runtime `dependencies` look unused at runtime
   (to be confirmed before changing anything):
   - the npm tree-sitter grammar packages, because the graph loads the vendored
     `.wasm` files;
   - React, react-markdown, remark-gfm, `@lezer/highlight` and most of
     CodeMirror, because they are bundled into `dist-web/`. Only
     `@codemirror/state` is imported by server code.
4. **Install-script warnings.** `npm i -g` and `npm i` print 6
   `npm warn install-scripts` lines for the tree-sitter packages. None of those
   scripts is needed.
5. **The Go opt-in needs `go.mod` at the project root.** A Go module in a
   subfolder reports `unavailable`. The opt-in also rightly refuses a `go` that
   is not `<GOROOT>/bin/go`.
6. **The Go opt-in writes Go telemetry counters.** Running `go` writes
   `~/.config/go/telemetry/local/…count`, which is outside the project. The route
   could set `GOTELEMETRY=off`, or document it.
7. **Signalling only the `npx` PID** does not stop Studio or the MCP server, and
   `npx` may not exit either. Supervisors should signal the process group.
8. **Each CLI call through `npx`** costs about 3 s and 165 MiB before doing any
   work.
9. **`check_design` returns counts only.** An agent needs a second `read_run`
   call to see the finding text.

## Validation

All on the dev server:

- `npm test`: 2,771/2,771 pass, with 0 fail, cancelled or skipped.
- `npm run format:check`: passes.
- The harness exits 2, as above.
- The self-test exits 0.
- The cleanup test exits 0.

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
