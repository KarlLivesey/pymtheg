# W3-L: Go toolchain-backed links (opt-in)

Implements the W2-L recommendation (`docs/changes/W2-L.md`) under decisions
D16 and D17. A project can opt in to links decided by the Go toolchain's own
loader and type checker (`go list` + `go/types`). Without the opt-in,
everything is exactly as before. Go module version 24. Evidence:
`evidence/w3-l/`.

## The opt-in

In `.pymtheg/settings.json`:

```json
{ "version": 1, "scenarios": {}, "graph": { "toolchain": { "go": true } } }
```

- `true` uses the `go` found first on the user's PATH, resolved to its real
  path. An absolute path names the trusted `go` instead.
- `false`, or no `graph` setting, is off, the default.
- Anything else is a configuration error (`graphConfig`, `src/shared/config.ts`).

`graphToolchains(config)` turns the setting into `IndexOptions.toolchains`
for whoever calls `indexProject`. The graph commands chunk wires the command
line; this chunk does not touch `src/graph/commands.ts`, `src/cli/graph.ts` or
`src/cli/main.ts`.

**Running the toolchain on a project is as trusted as building it.** The
opt-in says "I trust this project enough to build it". There is no sandbox
(D17). The closed environment below is hygiene, not a boundary against a
hostile project (W2-L, "Threat model and safety status").

## What runs

A standard-library Go helper, `src/graph/languages/go/toolchain/golinks.go`,
is cut down from the W2-L prototype (`evidence/w2-l/golinks.go`). It is built
on demand with the user's own `go`, never at install. The binary lives in the
rebuildable folder, `.pymtheg/rebuildable/toolchain/go/` by default
(`IndexOptions.toolchainDirectory`), under a name that includes a hash of the
helper source and the Go version. `package.json` lists the `.go` source so the
installed package can build it.

Every process runs through `runProcess` (`src/backends/process.ts`, the owned
process group of W2-T): it is bounded (30 minutes, 1 GiB of output) and
cancellable through `IndexOptions.signal`. A cancelled index reports
`Indexing was cancelled` as an analysis error and leaves no run directory.

Policy, for every `go` process:

- the trusted `go` by absolute path, checked to be `<GOROOT>/bin/go`, and
  go1.22 or newer;
- an environment built from nothing: `GOENV=off`, `PATH=<GOROOT>/bin`,
  `GOTOOLCHAIN=local`, offline (`GOPROXY=off`, `GOSUMDB=off`, `GOVCS=*:off`,
  `GOAUTH=off`), `GOFLAGS=-mod=readonly`, or `-mod=vendor` when
  `vendor/modules.txt` exists (never `-mod=mod`);
- cgo off;
- ONE configuration: the installation's host GOOS/GOARCH, `GOAMD64=v1`, no
  tags;
- the helper itself is started with an empty environment;
- `go.mod`, `go.sum`, `go.work` and `go.work.sum` are pinned through
  `-overlay`, and the snapshot's Go files are given as the overlay, so the
  facts are about exactly the captured text;
- a fresh build cache per run, removed afterwards;
- the module root is hashed before and after, and the helper exits 3 if
  anything changed (dot- and underscore-directories, which go ignores, are
  not hashed).

It reads the module cache and the Go installation, and writes only the
rebuildable folder and the throwaway cache. It never downloads.

If `go` is missing or too old, the helper fails to build or run, `go list`
fails, the root has no `go.mod`, or the project is a `go.work` workspace, the
index still succeeds source-only. The report then carries
`toolchains: [{ module: "go", note: { status: "unavailable", reason } }]`.

## Which facts are definite (the two W2-L rules)

- **Calls and identifier uses:** only in packages whose whole import closure
  has no parse, type or list error.
- **Implementer sets and `implements` pairs:** only when NO loaded package has
  an error.

The helper applies both rules itself: it emits records only for clean-closure
packages, and implementer sets and pairs only for a clean universe.

## Merging

The facts are joined to the module's own link drafts in `analyze`, as the W2-L
comparison did:

- a call by its callee's end;
- a reference, embed or receiver by the identifier's end;
- bytes are converted to UTF-16.

`GoResolver` then decides each link with a fact. It runs in `analyze`, for the
link notes, and again in the real resolution.

- **Upgrades:** an unresolved, failed (`invalid-code`) or candidate link
  becomes definite, and a candidate set becomes a **verified implementer set**:
  the interface method plus the project methods go/types says are reached.
  - A verified set keeps `external-implementers-possible`: a dependency's or
    a dependent module's type may implement it. It drops
    `structural-match-unverified`.
  - It also keeps any source-only member declared in a file outside the
    configuration.
- **No verified set is claimed** (the source-only set stands) when:
  - a reached method is outside the graph: in a failed file, or promoted from
    an external embedded type;
  - a reached method is itself an interface method (a nested dispatch through
    an embedded interface);
  - a main-module generic type has a method of that name (the search does not
    instantiate generics);
  - a main-module `_test.go` type has a method of that name (the call also
    runs in the test binary).
- **References to an interface method** (method values) keep the source-only
  dispatch set.
- **`implements`:** with a clean universe, the `implements` links are the
  toolchain's verified pairs: definite, to the interface,
  `data.origin: "toolchain"`, with `pointerReceiver`. A source-only link
  involving a generic type or interface stands.
- **Origin:** every link the toolchain decided records
  `data.toolchain = { origin: "toolchain", go, configuration, upgrade, from }`.
  Every file records `data.toolchain.status`:
  - `in-configuration`;
  - `package-has-errors`: its links are source-only;
  - `outside-configuration`, with a reason: build constraints, cgo, or not
    loaded. Its links are source-only.
- **Disagreements:** where the source-only route had a different definite
  target, the toolchain's is used for this configuration, the source's is kept
  as `data.toolchain.sourceOnly`, and the report lists every one (`merged`
  note, `disagreements`).
  - A source-only definite target where the toolchain says
    standard-library, dependency or builtin is withdrawn the same way.
  - So is a failed-file cause (`invalid-code`) on a link go/types checked
    clean. That happens for a valid file the grammar misreads.
  - Restic: 0 disagreements.
- **External targets:** the store has no external symbols. Calls into the
  standard library and dependencies keep their source-only resolution; the
  fact (`data.tc.ext`, package path and name) is recorded on the link but is
  not a target. Adding external symbols needs a store change and is not done
  here.

## Caching

The helper's output is kept in the rebuildable folder, keyed by:

- the helper source;
- the `go` path and version, the configuration and the module-cache path;
- `go.mod`, `go.sum`, `go.work`, `go.work.sum` and `vendor/modules.txt`;
- which `go.sum` modules have a zip in the module cache, so a later download
  changes the key;
- every captured Go file's path and content hash.

Unchanged inputs reuse it without running anything. **Any change re-runs the
whole helper.** Whether a package's links are definite depends on its whole
import closure, and implementer sets depend on every loaded package, so no
smaller re-run is sound. Warm == cold, byte for byte (tests; restic, evidence).

## Core-file changes (all additive)

- `src/graph/types.ts`: `ToolchainRequest`; optional
  `ProjectAnalysisContext.toolchain`.
- `src/graph/indexer.ts`: optional `IndexOptions.toolchains`,
  `toolchainDirectory`, `environment` and `signal`. It passes a
  `ToolchainRequest` to a module's `analyze` only for an opted-in module, and
  adds optional `IndexReport.toolchains` notes.
- `src/shared/config.ts`: the `graph` setting (`GraphConfig`, `graphConfig`,
  `graphToolchains`).
- `package.json`: `files` lists the helper source. No dependency, no install
  hook.

## Results

- **Fixtures** (`test/fixtures/graph-go-toolchain/`, compiler-checked;
  `test/graph-go-toolchain.test.mjs`):
  - methods on inferred and generic types upgraded;
  - a verified implementer set that drops a same-count wrong-signature
    method;
  - embedded promotion;
  - a type error: that package and its importers stay source-only, and there
    are no implementer sets;
  - a cgo file and a `windows` file outside the configuration;
  - a generic implementer and a test-file implementer: no set claimed;
  - `go` missing: identical to off, with the report saying why;
  - opt-in off: no toolchain data anywhere;
  - warm == cold; the project not written; cancellation.
- **Restic** `c734245`, offline, local module cache (`evidence/w3-l/`):
  - every package loaded clean;
  - definite links 39,918 → 40,895: 744 upgraded links, plus 233 definite
    `implements` (209 confirmed, 24 new, 61 refuted);
  - 120 candidate sets verified;
  - 0 disagreements;
  - 30 sampled upgrades read and correct;
  - off == main and warm == cold, byte for byte.

## Not done, and known limits

- **Configurations:** one only, the host's. Files of other configurations keep
  source-only links.
- **Modules:** a single module at the project root. `go.work` workspaces and
  nested modules are reported unavailable and stay source-only.
- **cgo:** off. A package needing cgo has errors, so it and its importers stay
  source-only.
- **Dependency and standard-library callees** are recorded on the link
  (`data.tc.ext`) but are not targets, because the store has no external
  symbols.
- **Verified sets** are verified for the packages loaded in this
  configuration, and are left out in the four cases listed under "Merging".
  Calls inside test files (test variants) get no verified set, only definite
  call and use links.
- **Function values** (calls through a variable) are not decided by the
  toolchain; the source-only route stands.
- A target declared in a file the grammar cannot read (a grammar gap) has no
  symbol, so its link keeps the source-only answer.
- **The setting is read by the caller.** Until the graph commands chunk passes
  `graphToolchains(config)` to `indexProject`, the opt-in has an effect only
  through that API.
- **No sandbox** (D17). As trusted as building the project.
