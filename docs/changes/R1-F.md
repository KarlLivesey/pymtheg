# R1-F: clean-machine acceptance harness

Release 1 item 1 (D19, `docs/build-plan.md`; mega-plan 8.2): `npx pymtheg`
runs on a clean machine with no Java or Quint. This chunk adds a repeatable
harness that shows what a new user gets from the packed tarball, plus a
self-test that proves the gate catches real breakage. It changes no product
code. Run it after each R1 merge and as the release gate (exit 0).

## Run it

On the dev server (it needs Docker), from the repository root:

```sh
pymtheg-dev --name r1f-xxxx -- node scripts/acceptance/run.mjs --commit "$(git rev-parse --short HEAD)" --out '$PYM_SCRATCH/acc'
pymtheg-dev --name r1f-xxxx --no-sync -- sh -c 'cat $PYM_SCRATCH/acc/latest.json' > evidence/r1-f/latest.json
pymtheg-dev --name r1f-xxxx --no-sync -- sh -c 'cat $PYM_SCRATCH/acc/latest.md'   > evidence/r1-f/latest.md
pymtheg-dev --name r1f-xxxx -- node scripts/acceptance/selftest.mjs --commit "$(git rev-parse --short HEAD)"   # optional: prove the gate bites
pymtheg-dev --name r1f-xxxx --clean
```

`npm run acceptance` runs the same script. Options:

- `--scenarios a-node-only,f-restic` runs a subset. An unknown name is a usage
  error (exit 3), never "ran nothing".
- `--tarball PATH` reuses a packed tarball (each build keeps one in
  `$PYM_SCRATCH/acceptance-tarball-<run>/`).
- `--pack-only` only builds.
- `--out DIR`, `--restic DIR`, `--keep-images`.

A full run takes about 20 minutes on the dev server, and the self-test about 6.
These times are observations only: nothing is asserted on time.

Exit status:

| Exit | Meaning |
|---|---|
| **0** | Every required step passes. This is the release gate. |
| **2** | Nothing fails, but known gaps remain. |
| **1** | A required step fails. |
| **3** | Harness or usage error. |
| **129, 130, 141, 143** | Stopped by HUP, INT, a broken pipe or TERM, after removing everything the run created. |

## How it works

- **Build.** `scripts/acceptance/run.mjs` (host side) copies the source tree,
  without `node_modules`, build output, evidence or research, into a throwaway
  `node:24.21.0-bookworm-slim` container. There it runs `npm ci`,
  `npm run build` and `npm pack` as a release would, and checks the tarball
  contents.
- **Scenario containers.** Each scenario gets a fresh container from an
  official `node:*-bookworm-slim` image. Only the tarball, the sample project
  (`test/fixtures/acceptance/sample`) and the harness files are copied in.
  Steps run as the unprivileged `node` user.
- **Network.** Only the install step has network. After it, the container is
  disconnected from every network. The first offline step (`network-off`)
  proves that neither the registry nor a direct IP (`http://1.1.1.1/`) can be
  reached.
- **Driver.** `scripts/acceptance/driver.mjs` runs the steps in the container,
  using Node built-ins only. It drives MCP over stdio with a small JSON-RPC
  client, and checks Studio with plain HTTP requests (no browser).
- **Two process detectors.**
  - `shim.sh` sits first on `PATH` as `java`, `javac`, `quint`, `tlc`, `go`,
    `cargo`, `rustc` and `rustup`. It uses shell built-ins only, a fixed log
    path and a fixed fallback search path, so a call made from a stripped
    environment is still logged and still reaches the real program.
  - `spawn-trace.cjs`, preloaded through `NODE_OPTIONS`, logs every child
    process any Node process starts, including programs started by absolute
    path.
- **Wording.** `wording.mjs` is the one matcher for Java/Quint/TLC wording. It
  matches whole words or exact tokens (`\bjava\b`, `\bjavac\b`, `\bquint\b`,
  `\btlc\b`, `tla2tools`, `\bTLA+`). The self-test checks it against 22 fixed
  strings, including `JavaScript`, `quintessential` and `TLAs`, which must not
  match.

### How a step is judged

| Status | When |
|---|---|
| `pass` | Every exact expectation is met. No backend or unrequested toolchain process ran, there is no Java/Quint/TLC wording in any output, and there is no Node process warning. |
| `expected-fail` | The broken design failed exactly as specified (exit 1 and the exact diagnostic line). |
| `known-gap` | Only in the cases below. |
| `fail` | Everything else, including a crash, an unexpected exit code, a harness exception, any `java`/`javac`/`quint`/`tlc` process, or any such wording. |
| `observed` | Report-only rows: sizes, timings, the absolute-path `npx` form, writes outside the project. |

A step is `known-gap` only when the step's sole problem is its expectation
failure, and that step's own gap matcher recognises the exact output the named
chunk will change. There is one exception: the SQLite `ExperimentalWarning`,
on Node 24.0.x or 25.x only, and nothing else.

## What each scenario proves

| Scenario | Proves |
|---|---|
| 0-build | `npm ci`, `npm run build` and `npm pack` work from a clean checkout. The tarball has the CLI, web assets, both vendored grammars, README and the launcher. It ships no TypeScript sources, tests, evidence or research; a helper source the product runs is allowed and listed (`src/graph/languages/go/toolchain/golinks.go`). |
| a-node-only | See the table below. |
| b-node-git | (a) inside a git repository. After init, `git status` shows exactly `?? .pymtheg/.gitignore`, `?? .pymtheg/project.json` and `?? .pymtheg/settings.json`, and tracked files are unchanged. After graph, MCP and Studio, the same three files and nothing else are visible. |
| c-node-go-rust | (a) with Go 1.27.4 and Cargo 1.100.0 on `PATH`. The graph answers are identical to (a), and nothing runs `go` or `cargo` while the setting is off. With `graph.toolchain.go` naming the real `go` (on the sample's Go module as its own project), `go` must run and the answer must report the route `used` with upgraded links > 0. With the setting removed again, no `toolchain` is reported. |
| d-global / d-local | `npm i -g` and `npm i` of the tarball. The binary resolves to the installed package, and everything works from there (the repository is not in the container). |
| e-node-24.0.0 / 25 / 26 | engines is `">=24"`, so all three are **required**: install, help, init, doctor (all ready), check, verify, simulate, the broken design, graph index and callers. |
| f-restic | The pinned restic corpus (559 Go files): init, index with 0 failed files, status and five queries. Time and memory are observations. |

Scenario (a), Node only, runs:

- **Install:** `npx ./pymtheg-1.0.0.tgz --help`, with network.
- **Basics (offline):** help, version and init. Init must report
  "3 existing documents found". Re-init must leave the metadata bytes
  identical.
- **doctor --format json:** every check must be `ready`.
- **Checking the valid design:**
  - `check` gives 0 diagnostics.
  - `verify`: each of the three properties is `no_counterexample`, complete
    and `exhaustive: true`.
  - `simulate`: each is `no_counterexample` and `exhaustive: false`.
- **The broken design:** `check` and `verify` exit 1 with the exact line
  `…/broken.pym:7:27 error N002: Unknown value or variant charge; did you mean charges?`.
- **Graph:**
  - index (9 files, 0 failed) and status (modules go, rust, typescript).
  - Callers, each exactly one caller symbol, in one file, with `definite`
    certainty and the queried target. Five calls cross files (TypeScript ×2,
    Go ×2, Rust ×1) and one stays in its file (`percent_of`).
  - The TypeScript path `renderBasket` → `roundCents` (definite).
  - `search Total`, which gives exactly two symbols and one file.
- **Requirement links:** `link requirement`, `link add` and `link check`.
- **MCP:**
  - `check_design` on the valid design gives exitStatus 0 with 0 errors and 0
    warnings.
  - On the broken design it gives exitStatus 1. After `read_run`, the
    findings include one at line 7, column 27 with "Unknown value or variant
    charge".
  - `explore_behaviour`: verify gives 0 counterexamples with
    `exhaustive: true`; simulate gives 0 counterexamples with
    `exhaustive: false`.
  - `code_graph` callers, a requirement-link tool, and a clean shutdown
    (exit 0).
- **Studio:** start, `GET /api/project` (the workspace name), `GET /` plus
  every asset it references, and a SIGINT stop.
- **Legacy folder:** init in a folder that has `.pymtheg-studio/`. It must
  exit 0, name the folder in a notice and leave it untouched.
- **Processes:** a `no-toolchain-processes` summary row, plus the writes made
  outside the project.

## Today's result (commit 43bee54d, merged main with R1-A, R1-B and PR 33)

Verdict **known-gaps**, harness exit 2: **215 pass, 35 known-gap,
12 expected-fail, 12 observed, 0 fail.**

| Scenario | pass | known-gap | expected-fail | observed | fail |
|---|---:|---:|---:|---:|---:|
| 0-build | 4 | 0 | 0 | 2 | 0 |
| a-node-only | 33 | 5 | 2 | 3 | 0 |
| b-node-git | 38 | 5 | 2 | 1 | 0 |
| c-node-go-rust | 37 | 6 | 2 | 1 | 0 |
| d-global | 34 | 5 | 2 | 1 | 0 |
| d-local | 33 | 5 | 2 | 1 | 0 |
| e-node-24.0.0 | 3 | 9 | 0 | 1 | 0 |
| e-node-25 | 11 | 0 | 1 | 1 | 0 |
| e-node-26 | 11 | 0 | 1 | 1 | 0 |
| f-restic | 11 | 0 | 0 | 0 | 0 |

There are no R1-A or R1-B gaps left. Every scenario's process log is empty
(apart from the Go opt-in step, which must run `go`), and no output contains
Java/Quint/TLC wording.

Observations from this run on the dev server:

- **Install:** `npx` installs in about 8 s. That is 133 packages and 84.9 MiB
  in `~/.npm/_npx`, plus 69.5 MiB in `~/.npm/_cacache`.
- **restic** (559 files): index took 108 s with at least 2.1 GiB peak RSS. It
  found 7,356 symbols and 63,088 links, and no file failed.

### Every remaining known gap

| Chunk | Steps | Exact condition that is accepted | Turns green when |
|---|---|---|---|
| R1-C (PR 40) | `mcp-code-graph` in a, b, c, d-global, d-local | tool `code_graph` is not in `tools/list` | The tool exists and `code_graph {action:"callers", query:"formatTotal"}` (with `graph_result` if it is still running) answers definite `renderBasket`. |
| R1-D (PR 38) | `link-requirement`, `link-add`, `link-check` in a, b, c, d-global, d-local | exit 3, empty stdout, and stderr exactly `pymtheg: Unknown command or missing file. Commands: …. See --help.` | `link requirement R1` exits 0, `link add R1 ComputeTotal` reports `created`, and `link check` exits 0 naming `ComputeTotal`. |
| R1-D | `mcp-requirement-links` in the same five | no tool whose name contains `code_link` or `requirement` | When such a tool appears, this row **fails** until the harness is extended to exercise it, because a tool the harness has not tested never passes. |
| W3-L2 (PR 42) | `go-toolchain-index` in c | exit 0, status ok, no `toolchain` field in the answer, and no `go` process | The route is `used`, upgraded links > 0, and a `go` process ran. Verified before merge: on PR 42's branch this row passes, with 1 link upgraded and 2 `go` processes (the other failures on that branch predate R1-A). |
| R1-H | 9 steps in e-node-24.0.0 | Node 24.0.x or 25.x, and stderr's only Node warning is exactly `(node:N) ExperimentalWarning: SQLite is an experimental feature and might change at any time` plus its trace hint | The warning is gone. Node 25.9.0 already shows no warning. |

A gap applies to its own step and exact output only. A command that is missing,
crashes, prints something else or exits with another code is a `fail`. The
self-test shows this: `link-crashes` makes `pymtheg link` exit 77, and those rows
fail instead of becoming R1-D gaps.

## Self-test: the gate bites

`scripts/acceptance/selftest.mjs` builds the tarball once. It makes ten copies,
each broken in one way, and runs the real harness (scenario a-node-only) on each
copy and on an unmodified control, five runs at a time; this also exercises
overlapping runs on one Docker host. Before a run, each sabotage is checked to
have actually applied: its anchor must be found exactly once. Result on commit
43bee54d (`evidence/r1-f/selftest.md`): **matcher 22/22, control clean, 10/10
sabotages caught.**

| Case | Break | Harness exit | Named step(s) |
|---|---|---|---|
| control | none | 2 | 0 failed; the 5 R1-C/R1-D gaps only |
| check-exits-0 | `check` exits 0 on the broken design | 1 | check-broken: fail |
| grammar-removed | vendored Go grammar removed | 1 | tarball-contents, graph-index (and every graph step, doctor): fail |
| mcp-check-design-throws | MCP `check_design` throws | 1 | mcp-check-design: fail |
| callers-no-links | `callers` returns no links | 1 | graph-ts-callers (and the other five callers): fail |
| caller-target-renamed | a caller link's target renamed | 1 | graph-ts-callers (and the other five): fail |
| certainty-downgraded | certainty becomes `name-only` | 1 | graph-ts-callers (and the other five): fail |
| prints-java | `--help` prints "java" | 1 | help (and install-npx): fail |
| index-runs-java | `graph index` runs `java -version` | 1 | graph-index, no-toolchain-processes: fail |
| mcp-wrong-verdict | MCP reports exitStatus 1 for the valid design | 1 | mcp-check-design (and both explore steps): fail |
| link-crashes | `pymtheg link` exits 77 | 1 | link-requirement, link-add, link-check: fail (not R1-D gaps) |

## Cleanup and concurrent runs

- **Labels and bounded life.** Every container is named
  `pymtheg-acc-<scenario>-<run id>` and labelled `pymtheg-acc=1`,
  `pymtheg-acc.owner=<user@host>`, `pymtheg-acc.run` and `pymtheg-acc.pid`. Its
  own process is `sleep 14400`, so a lost container removes itself (`--rm`)
  within four hours.
- **Leftovers.** At start-up the harness removes only containers with its own
  owner label whose recorded run process has ended. It never touches another
  owner's containers or a live run's.
- **Images.** Images present before any run of this harness are never removed.
  An image a run pulls is recorded in `~/.cache/pymtheg-acceptance/pulled-images`
  (a locked file shared by overlapping runs). Whichever run finishes last
  removes it, once no container of any run uses it. The harness uses no
  `docker build` and never prunes.
- **Stopping.** SIGINT, SIGTERM and SIGHUP remove this run's containers and
  pulled images. So does a broken pipe, which is what a dropped `pymtheg-dev`
  ssh session (no tty) produces.

`scripts/acceptance/cleanup-test.sh` stops a real run midway with TERM, then
with HUP, then by closing its output pipe. On 15 November 2026 all three
modes exited with their code (143, 129, 141) and left 0 containers and 0 added
images. A real `pymtheg-dev` session was also killed mid-scenario: the remote
run stopped and left 0 containers and 0 images. The self-test's 11 overlapping
runs also left nothing behind.

## Gap list: rough edges with no owning chunk

1. **`"private": true`** (`package.json:4`). npm refuses to publish the package,
   so `npx pymtheg` from the registry cannot work until it is published.
   `npx ./pymtheg-1.0.0.tgz` works today. Publishing is the owner's decision.
2. **`npx /absolute/path/pymtheg-1.0.0.tgz`** exits 126 (`sh: 1: …tgz: Permission denied`),
   because npm runs an absolute path as a command. `./name.tgz` and
   `file:/abs/path.tgz` work. Docs should show the `./` form.
3. **Install size.** 84.9 MiB in 133 packages. Some runtime `dependencies`
   look unused at runtime and should be confirmed before changing anything:
   - `tree-sitter-go`, `tree-sitter-rust` and `@tree-sitter-grammars/tree-sitter-lua`
     (`package.json`). The graph loads the vendored `grammars/*/tree-sitter-*.wasm`.
   - `react`, `react-dom`, `react-markdown`, `remark-gfm`, `@lezer/highlight`
     and most `@codemirror/*` are bundled into `dist-web/`. Only
     `@codemirror/state` is imported by server code
     (`src/studio/completion-position.ts:1`).
4. **Install-script warnings.** `npm i -g` and `npm i` print 6
   `npm warn install-scripts` lines for the three tree-sitter packages
   (`node-gyp-build`), suggesting `--allow-scripts`. None is needed. `npx`
   prints none.
5. **The Go toolchain opt-in needs `go.mod` at the project root.** In a mixed
   repository with the Go module in a subfolder (the sample's `service/`), the
   route reports `unavailable: no go.mod at the project root`. It also
   rightly refuses any `go` that is not `<GOROOT>/bin/go`, such as a wrapper
   on PATH ("/acc/shims/go is not <GOROOT>/bin/go"), so a version-manager shim
   needs the setting to name the real binary.
6. **Stopping through `npx` by PID.** A SIGINT sent only to the `npx` process
   does not stop Studio or the MCP server: `sh -c pymtheg …` and the server
   keep running, and `npx` itself may not exit either. A terminal's Ctrl-C
   signals the whole process group, so interactive use is fine. A supervisor
   or agent that stops `npx pymtheg studio` or `npx pymtheg mcp` by PID should
   signal the group.
7. **Every CLI call through `npx` costs about 3 s and 165 MiB** before doing
   any work (an observation). Agents should use MCP or a global install.
8. **MCP `check_design` on a broken design** returns counts only. The finding
   text needs a second `read_run` call, as documented in `docs/mcp.md`.
9. **Writes outside the project:** only npm's own `~/.npm/_npx`,
   `~/.npm/_cacache` and `~/.npm/_logs`.

Resolved since round 1 (on main now): Java, Quint and TLC are gone from help,
doctor, MCP, Studio and processes (R1-A). The legacy-folder refusal is gone
(R1-B). engines is `">=24"`, and Node 25 and 26 pass with doctor fully ready.

## Validation

All on the dev server:

- `npm test`: 2,737/2,737 pass, with 0 fail, cancelled or skipped.
- `npm run format:check`: passes.
- One earlier `npm test` run hit a 180 s timeout in
  `project-init-clean.test.mjs:420`, while three harness runs shared the
  server. Run alone, it passed.
- The harness: exit 2, as above.
- The self-test: exit 0.
- The cleanup test: exit 0.

## Files

- `scripts/acceptance/run.mjs`: the host orchestrator.
- `scripts/acceptance/driver.mjs`: in-container steps.
- `scripts/acceptance/wording.mjs`: the matcher and its fixed cases.
- `scripts/acceptance/spawn-trace.cjs` and `scripts/acceptance/shim.sh`: the
  process detectors.
- `scripts/acceptance/selftest.mjs` and `scripts/acceptance/cleanup-test.sh`.
- `test/fixtures/acceptance/sample/`: TypeScript `web/`, Go module `service/`
  (including receivers that only the toolchain can type: a generic result, a
  type assertion and a multi-value return), Rust crate `engine/`, `docs/`, and
  `designs/order.pym` and `designs/broken.pym`.
- `package.json`: the `acceptance` script.
- `evidence/r1-f/latest.{json,md}` and `evidence/r1-f/selftest.{json,md}`.
