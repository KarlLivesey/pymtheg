# R1-F: clean-machine acceptance harness

Release 1 item 1 (D19, `docs/build-plan.md`; mega-plan 8.2): `npx pymtheg`
runs on a clean machine with no Java or Quint. This chunk adds a repeatable
harness that shows what a new user gets from the packed tarball, and records
everything that fails today. It changes no product code. Run it again after each
R1 merge and as the release gate.

## Run it

On the dev server (it needs Docker), from the repository root:

```sh
pymtheg-dev --name r1f-xxxx -- node scripts/acceptance/run.mjs --commit "$(git rev-parse --short HEAD)"
pymtheg-dev --name r1f-xxxx --no-sync -- sh -c 'cat evidence/r1-f/latest.json' > evidence/r1-f/latest.json   # copy back
pymtheg-dev --name r1f-xxxx --no-sync -- sh -c 'cat evidence/r1-f/latest.md'   > evidence/r1-f/latest.md
pymtheg-dev --name r1f-xxxx --clean
```

`npm run acceptance` runs the same script. Options: `--scenarios a-node-only,f-restic`
runs a subset; `--tarball PATH` reuses a packed tarball (each build keeps one in
`$PYM_SCRATCH/acceptance-tarball/`); `--out DIR`; `--restic DIR`; `--keep-images`.
A full run takes about 10 minutes on the dev server. The time is an observation
only: nothing is asserted on time.

Exit status: **0** every required step passes. **2** nothing fails, but known
gaps remain. **1** a required step fails. **3** harness error. The release gate
is exit 0.

## How it works

- `scripts/acceptance/run.mjs` (host side) copies the source tree, without
  `node_modules`, build output, evidence or research, into a throwaway
  `node:24.21.0-bookworm-slim` container. There it runs `npm ci`,
  `npm run build` and `npm pack`, as a release would, then checks what the
  tarball contains.
- Every scenario then gets a fresh container started from an official
  `node:*-bookworm-slim` image. The only things copied in are the tarball, the
  sample project (`test/fixtures/acceptance/sample`) and the harness's own
  files. Steps run as the unprivileged `node` user. **Only the install step has
  network.** After it, the container is disconnected from every Docker network,
  and the first offline step (`network-off`) proves the registry can no longer
  be reached.
- `scripts/acceptance/driver.mjs` (in the container, Node built-ins only) runs the
  steps. It drives MCP over stdio with a small JSON-RPC client, and checks Studio
  with plain HTTP requests (session token from the printed URL; no browser).
- Two independent detectors watch for toolchain processes:
  - `shim.sh` is installed first on `PATH` as `java`, `quint`, `go`, `cargo`,
    `rustc`, `rustup` and `tlc`. It logs each call, then runs the real program if
    one exists.
  - `spawn-trace.cjs`, preloaded with `NODE_OPTIONS=--require`, logs every child
    process any Node process starts. It catches Quint, which is started by
    absolute path as `node …/quint/dist/src/cli.js`, where a `PATH` shim cannot
    see it.
- Every output (stdout, stderr, MCP JSON, HTTP bodies) is scanned for
  Java/Quint/TLC wording.
- Statuses:
  - `pass`
  - `expected-fail`: the broken design fails with a useful diagnostic.
  - `known-gap`: every problem in the step is attributed to a named chunk:
    - R1-A: Java/Quint/TLC wording or processes, or a missing-backend failure
    - R1-B: the legacy-folder refusal
    - R1-C: no MCP graph tool
    - R1-D: no requirement-to-symbol link
    - W3-L (PR 33): Go toolchain opt-in
  - `fail`
  - `observed`: report-only steps (sizes, timings, Node version edges).
- A failure that a gap does not explain is a `fail`, never a pass. When a chunk
  merges, its rows turn `pass` without any harness change. Two exceptions need a
  harness change: R1-C and R1-D. The harness can only detect a tool or command
  whose name contains `graph`, or `link` plus `requirement`/`symbol`/`code`.
  Once their interfaces exist, extend `mcpSteps`/`coreSteps` to create and list a
  link.
- Output: `evidence/r1-f/latest.json` (schema `pymtheg.acceptance/v1`: per step
  the scenario, command, exit code, status, chunk, reason, output bytes, duration
  and an output excerpt) and `evidence/r1-f/latest.md` (tables).

## What each scenario proves

| Scenario | Proves |
|---|---|
| 0-build | `npm ci && npm run build && npm pack` work from a clean checkout. The tarball has the CLI, the web assets, both vendored grammars, README and the `pymtheg` launcher, and no `src/`, `test/`, `evidence/` or `research/`. |
| a-node-only | Node only. `npx ./pymtheg-1.0.0.tgz --help` (network), then offline: help, version, init and re-init (identity unchanged), doctor. check/verify/simulate on `designs/order.pym`. `designs/broken.pym` gives `broken.pym:7:27 error N002: Unknown value or variant charge; did you mean charges?` and exit 1. Graph: index, status, TS callers and path, Go cross-package and same-package callers, Rust cross-module and same-file callers, search. MCP: initialize, tools/list, check_design (valid and broken, then read_run findings), explore_behaviour verify and simulate, graph tool, requirement-link tool, clean shutdown. Studio: start, `GET /api/project`, `GET /` plus a script asset, SIGINT stop. Init in a folder with an old `.pymtheg-studio/`. Writes outside the project. No toolchain process anywhere. |
| b-node-git | (a) inside a git repository (git installed with apt before the install step). Init adds only `.pymtheg/.gitignore`, `.pymtheg/project.json` and `.pymtheg/settings.json` as untracked files. Tracked files are unchanged. After graph, MCP and Studio, the caches are still ignored. |
| c-node-go-rust | (a) with Go 1.27.4 and Cargo 1.100.0 on PATH (copied from the official `golang` and `rust` images). The graph results are identical to (a) (`graph-identical-to-node-only`), and nothing runs `go` or `cargo` by default. The Go toolchain opt-in is pending (PR 33 is not merged, and the opt-in is not wired into `pymtheg graph`). |
| d-global | `npm install --global ./tarball`. The binary resolves to the installed package, and grammars, web assets and MCP all work from there (the repository is not in the container at all). |
| d-local | `npm install ./tarball` into another package, then `npx --no-install pymtheg`. Same coverage. |
| e-node-24.0.0 / 25 / 26 | Report only: the lowest Node that `engines` allows, and the current Node 25 and 26 images. |
| f-restic | The pinned restic corpus (559 Go files): init, graph index, status and five queries. Time and memory are observations. |

## Today's result (commit 84606915, 15 November 2026)

Verdict **known-gaps**, harness exit 2: 138 pass, 60 known-gap, 10 expected-fail,
41 observed, **0 fail**. Per scenario:

| Scenario | pass | known-gap | expected-fail | observed | fail |
|---|---:|---:|---:|---:|---:|
| 0-build | 4 | 0 | 0 | 2 | 0 |
| a-node-only | 23 | 12 | 2 | 3 | 0 |
| b-node-git | 27 | 12 | 2 | 3 | 0 |
| c-node-go-rust | 25 | 13 | 2 | 1 | 0 |
| d-global | 25 | 11 | 2 | 1 | 0 |
| d-local | 24 | 11 | 2 | 1 | 0 |
| e-node-24.0.0 / 25 / 26 | – | – | – | 10 each | – |
| f-restic | 10 | 1 | 0 | 0 | 0 |

Two observations from this run, taken on the dev server:

- **restic** (559 files): graph index took 92 s, with at least 2.1 GiB peak RSS
  (sampled from `/proc`, so a lower bound). It found 7,356 symbols and 63,088
  links, and no file failed. Each query took about 3 s. That 3 s is mostly `npx`
  start-up: every CLI call costs about 3 s, 165 MiB.
- **Install:** `npx` first run took about 10 s and installed 211 packages. That
  is 112 MiB in `~/.npm/_npx`, plus 94.5 MiB in `~/.npm/_cacache`. A global or
  local install is the same size.

The d-global "largest packages" row in this run measured the wrong folder (the
global prefix, not the package's nested `node_modules`). This is fixed in the
harness after the run, and only that observation row is affected.

## Gap list

Known gaps being fixed by other chunks (the harness turns these rows green as
they merge):

1. **R1-A: Java/Quint/TLC still present.**
   - `pymtheg --help` mentions `--backend quint`, "TLC requires --tlc-jar" and
     "Explicit Quint/TLC backends" (`src/cli/help.ts:26`, `:30`, `:33`, `:64`).
   - `pymtheg doctor` runs `java -version` and `node …/@informalsystems/quint/dist/src/cli.js --version`,
     then prints `Quint: ready — 0.33.1`, `Java: incompatible — java: not installed…`
     and `TLC: missing — Set PYM_TLC_JAR…` (`src/project/doctor.ts:24-80`).
   - The MCP tool descriptions mention Quint/TLC. `explore_behaviour` says "Run the
     real Quint simulator or TLC verifier" (`src/mcp/server.ts:415`).
   - **MCP `explore_behaviour` with `method:"verify"` fails on a clean machine**
     (exitStatus 3, isError; the properties name TLC), because MCP and Studio use
     `backend: kind === "verify" ? "tlc" : "quint"` (`src/mcp/workspace.ts:185`,
     `src/studio/service.ts:3445`). The CLI's `verify` works (built-in).
   - `method:"simulate"` "works" only by running Quint, which `npx` installs as an
     optional dependency (`package.json:40`).
   - Studio `GET /api/project` reports `"quint": true` (`src/studio/service.ts:3260`).

   These cover every `no-toolchain-processes` row and most known-gap rows.
2. **R1-B: legacy-folder refusal.** `pymtheg init` in a folder with
   `.pymtheg-studio/` gives exit 3: "Old Pymtheg storage layout at …: .pymtheg-studio.
   No migration is provided…" (`src/storage/local.ts:30`). PR 35 removes this
   refusal.
3. **R1-C: no graph tools over MCP.** tools/list has no graph tool
   (`mcp-graph-tool`).
4. **R1-D: no requirement-to-symbol links**, in CLI help or over MCP
   (`cli-requirement-links`, `mcp-requirement-links`).
5. **W3-L (PR 33): Go toolchain opt-in** is not on main, and it is not wired into
   `pymtheg graph` yet (the W3-G backlog in `docs/build-plan.md`). The step is
   non-required and pending.

Rough edges with no owning chunk (owner's decision, or a new chunk):

6. **`"private": true`** (`package.json:4`). npm refuses to publish the package,
   so `npx pymtheg` from the registry cannot work until it is published. Today
   only `npx ./pymtheg-1.0.0.tgz` works. Publishing is the owner's decision; this
   chunk changed nothing.
7. **`npx /absolute/path/pymtheg-1.0.0.tgz` fails** with `sh: 1: …tgz: Permission denied`
   (exit 126). npm treats an absolute path as a command. Only `./name.tgz`,
   `file:/abs/path.tgz` or `--package=…` work. Any doc that shows the tarball
   form should use `./`.
8. **Node pin.**
   - `engines` is `">=24 <25"` (`package.json:7`). Mega-plan 8.1 wants
     "24 or newer".
   - On Node 25.9.0 and 26.13.1, install prints `npm warn EBADENGINE`, and then
     help, init, check, verify and graph index all work.
   - `doctor` reports `Node: incompatible — … (supported: 24 LTS)` and exits 3
     (`src/project/doctor.ts:19`, `src/cli/main.ts:674`).
   - There is no clean refusal: it simply works with a warning.
9. **Node 24.0.0** works, but every command prints
   `ExperimentalWarning: SQLite is an experimental feature…` on stderr. That is
   noise for users, and confusing for an agent that reads stderr. Raising the
   `engines` minimum to the first 24.x where `node:sqlite` is stable would remove
   it.
10. **Install size and contents:** 112 MiB in 211 packages. The largest are:

    | Package | Size |
    |---|---:|
    | typescript | 22.5 MiB |
    | tree-sitter-rust | 14.4 MiB |
    | pymtheg | 9.6 MiB |
    | react-dom | 7.0 MiB |
    | @modelcontextprotocol/server | 6.7 MiB |
    | web-tree-sitter | 4.5 MiB |
    | @octokit/openapi-types | 4.3 MiB |
    | zod | 4.0 MiB |
    | tree-sitter-go | 3.7 MiB |
    | @informalsystems/quint | 3.4 MiB |

    Several runtime `dependencies` are not used at runtime:
    - `tree-sitter-go`, `tree-sitter-rust` and `@tree-sitter-grammars/tree-sitter-lua`
      (`package.json:51`, `:57-58`). The graph loads the vendored
      `grammars/*/tree-sitter-*.wasm` (`src/graph/languages/go/index.ts:28`,
      `src/graph/languages/rust/parse.ts:278`), and nothing under `src/` imports
      the npm grammar packages. These are also the source of the install-script
      warnings in item 11.
    - `react`, `react-dom`, `react-markdown`, `remark-gfm`, `@lezer/highlight` and
      most `@codemirror/*` (`package.json:43-56`) are bundled into `dist-web/` at
      build time. Only `@codemirror/state` is imported by server code
      (`src/studio/completion-position.ts:1`).
    - `@octokit/openapi-types` and `protobufjs` arrive through the Quint optional
      dependency.

    Moving the build-only packages to `devDependencies` and dropping the unused
    grammar packages would cut the install substantially. Item 10 is the
    harness's best reading and should be confirmed before changing it.
11. **Install-script warnings.** `npm install -g` and `npm install` of the tarball
    (npm 11.19, Node 24.22.3) print 7 `npm warn install-scripts` lines. These name
    `tree-sitter-lua`, `tree-sitter-go` and `tree-sitter-rust` (`node-gyp-build`)
    and `protobufjs` (postinstall), and suggest `--allow-scripts`. None of the
    scripts is needed: everything works with them blocked, and no compiler is
    present. On Node 24.0.0 (npm 11.3) the hooks run and fall back to prebuilds
    without error. For a first-time user, the warning reads like something they
    must act on.
12. **Writes outside the project:** only npm's own `~/.npm/_npx`, `~/.npm/_cacache`
    and `~/.npm/_logs`. The Quint simulate run used a temporary
    `/tmp/pymtheg-*` folder and removed it. Nothing else was written.
13. **Signals through `npx`.** A single SIGINT sent to the `npx` process ends
    `npx`, but leaves `sh -c pymtheg … studio` and the Studio server running. A
    terminal's Ctrl-C signals the whole process group, so interactive users are
    unaffected. A supervisor or agent that stops `npx pymtheg studio`/`mcp` by
    PID will orphan the server. The harness signals the process group.
14. **Every CLI call through `npx` costs about 3 s and 165 MiB** before doing any
    work (measured on the dev server; an observation). Agents that shell out
    repeatedly should be pointed at MCP, or at a global install.
15. **MCP `check_design` on a broken design** returns only counts. The finding text
    (`charge`, `did you mean charges?`) needs a second `read_run` call. This is as
    documented in `docs/mcp.md`; it is noted here because an agent that reads only
    the first answer sees no reason.

Confirmed working, and worth keeping green:

- The tarball has everything needed.
- `init` is idempotent, offers the `docs/` preview ("3 existing documents found")
  and leaves git state clean.
- CLI check/verify/simulate are fully built-in: no process started, no Java.
- The broken design gives a precise `file:line:col` diagnostic and exit 1.
- The TypeScript, Go and Rust graph resolves all six sample cross-file calls as
  `definite`, without toolchains, identically with toolchains present.
- Global and local installs resolve grammars and web assets from the installed
  location.
- Studio serves its API and assets.
- MCP starts, answers and shuts down cleanly with exit 0.

## Files

- `scripts/acceptance/run.mjs`, `driver.mjs`, `spawn-trace.cjs`, `shim.sh`: the
  harness.
- `test/fixtures/acceptance/sample/`: the sample project:
  - TypeScript `web/`, Go module `service/` and Rust crate `engine/`, each with
    cross-file calls
  - `docs/`
  - `designs/order.pym` (valid) and `designs/broken.pym` (deliberate undeclared
    name)
- `package.json`: an `acceptance` script entry.
- `evidence/r1-f/latest.json`, `latest.md`: today's run.

Validation on the dev server: `npm test` 2,630/2,630 pass (0 fail, skip or
cancelled); `npm run format:check` passes.

Docker hygiene: every container and image name starts with `pymtheg-acc-`. The
harness removes every image it pulled that was not already present (the Node
images and the `golang` and `rust` images it copies toolchains from), and every
container. It uses no `docker build`, so it leaves no build cache, and it never
prunes.
