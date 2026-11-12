# W2-L: can the Go build chain supply exact code-graph links, and at what cost?

Investigation only (round 8). Evidence, helper, scripts and raw outputs:
`evidence/w2-l/`. No product code, contract or support level changes.

## The answer

**Links: yes, for code that is go/types-clean (which is not the same as
buildable), one build configuration at a time, with cgo files outside the
configuration.** Two rules decide which facts are definite:

- **links** (calls, identifier uses, imports): only in packages whose whole
  import closure is free of errors;
- **implementer sets and `implements` pairs**: only when no loaded package
  has errors, because they are searched over every package.

**Safety: running the Go toolchain on a project is as trusted as building
that project.** The measurements below make the route clean for a project
you would build anyway. They do not make it safe on a project you only
opened.

A standard-library helper (`go list` + `go/parser` + `go/types`) gives:

- exact callee locations for static calls;
- for dynamic calls, the interface method, plus the implementers of the
  call's receiver interface among the loaded packages' types (computed for
  1,527 of 2,304 interface calls: not in test variants);
- identifier → declaration;
- import → directory;
- verified `implements` pairs.

On restic (one project; 26,535 call expressions counted by syntax in all 559
tracked files; shares over six configurations, which cover 558 files):

- **Static calls with an exact callee location:** 71.8%, of which 42.9%
  in-project (66.7% and 40.5% in one configuration). Identical with cgo on
  or off.
- **The rest, same basis:**
  - interface calls: 8.5%;
  - builtins: 8.4%;
  - function values: 4.7%;
  - conversions to predeclared types: 4.8%;
  - other: 1.7%;
  - the one file no configuration includes: 0.4%.
- **Against the hand-written module** (on `main`, version 20), every definite
  link of every kind agrees by definition position: 11,771 calls, 18,041
  references, 1,296 imports, 145 embeds, 1,255 receivers. No contract
  violation was found.
- **What the toolchain adds:**
  - definite std and dependency callees the module leaves unresolved by
    design (7,624 static calls, 28.7%);
  - verified `implements` (of the module's 276 candidates: 59 refuted, 211
    confirmed, 24 added).
- **cgo:** FakeImportC gives wrong definite links with 0 errors. With cgo
  off, restic's clean run has 0 errors; a package that needs cgo fails
  instead of being mislinked.
- **Broken code** (340 single breakages of restic, 334 broken programs):
  - links: 0 changed targets in clean-closure packages; 100% definite clean,
    median 78.0% after one breakage (min 4.8%);
  - implementer sets: 100% definite clean, 0% after any breakage (candidate
    lists only), no definite record changed.

## Threat model and safety status

This section is the single statement of the safety status; the evidence
README points here.

**The closed environment is measured hygiene, not a security boundary
against a hostile project.** The helper runs the `go` named by a required
`-go` flag (the Go installation is trusted and chosen by the launcher). The
environment of every `go` it starts is built from scratch; no variable of
the caller's is passed on:

- configuration and locations from flags;
- `GOENV=off`, PATH = the Go installation's `bin`;
- offline (`GOPROXY=off`, `GOSUMDB=off`), `GOVCS=*:off`, `GOAUTH=off`,
  `GOTOOLCHAIN=local`;
- cgo off;
- the project's `go.mod`, `go.sum`, `go.work` and `go.work.sum` pinned
  through `-overlay`;
- a fresh throwaway build cache per run, created under `-tmp` (default
  `/tmp`);
- a hash assertion over the project.

**What the helper's process reads from its caller** (`golinks.go` header):

- **The helper's own code acts on** only `HOME` (the default `-gopath`
  `$HOME/go`, and so which module cache; give `-gopath` or `-gomodcache` to
  fix it), `PWD` (Go's `os.Getwd` uses it only when it names the current
  directory), `GODEBUG` (if set, the helper re-executes itself without it)
  and the two experiment escapes below.
- **The Go runtime and standard-library initialisation inside the helper's
  process additionally read** variables including the runtime variables
  `GODEBUG`, `GOMEMLIMIT`, `GOGC`, `GOMAXPROCS` and `GOTRACEBACK`, and the build-configuration variables `GOOS`, `GOARCH`, `GOROOT`, `GOPATH`, `CGO_ENABLED`, `GOEXPERIMENT`, `GOAMD64`, `GO386`, `GOARM`, `GOARM64`, `GOMIPS`, `GOMIPS64`, `GOPPC64`, `GORISCV64`, `GOWASM`, `GOFIPS140` and `GO_EXTLINK_ENABLED` (through
  `go/build` and `internal/buildcfg`, which `go/importer` links in). A
  malformed `GODEBUG` or `GOMEMLIMIT` aborts the helper before `main` (exit
  2, 0 records); none of them changes the records: with hostile values for
  every listed variable except `GODEBUG` (`GOMEMLIMIT` well-formed), the
  sorted records were identical apart from the
  fresh-cache path (`scripts/process-env.sh`, `raw/process-env.txt`;
  `raw/exec-attacks.txt` for `GODEBUG`). So **the launcher must start the
  helper with a clean environment**.
- **Two experiment escapes**, `GOLINKS_EXTRA_ENV` (adds variables to `go`'s
  environment) and `GOLINKS_NOPIN` (turns off the pin of the four project
  files). They exist in this evidence helper only, so the scripts can
  re-open holes on purpose, and **a product must not have them**. They do
  re-open every hole: with `GOLINKS_EXTRA_ENV="GOCACHEPROG=<hook>"`, go runs
  the hook; with `GOLINKS_NOPIN=1`, a workspace with a cached module and no
  `go.work.sum` exits 3 (`project-written`) and leaves `go.work.sum` in the
  project (`scripts/experiment-escapes.sh`, `raw/experiment-escapes.txt`).

`PATH` and `TMPDIR` are not read by the helper's code: there is no default
`go`, and the fresh build cache goes under `-tmp`. Two default runs with a
caller `TMPDIR` set made two distinct directories under `/tmp`, none under
`TMPDIR`, and removed both (`raw/hazards.txt`, "defaults").

**With the experiment escapes unset**, measured in the committed runs:

- for **an ordinary project** (restic, the fixtures) and **a hostile CALLER
  environment**, only `go` starts: three `go` processes, nothing else
  (ptrace tracer; `raw/exec-closed.txt`, `raw/exec-attacks.txt`);
- offline it makes **no network call at all**: the ptrace tracer logged 0
  socket, connect and send calls on the fixture and restic, with a clean and
  a hostile caller environment (proxy variables and `GOPROXY` pointing at a
  loopback listener, which received nothing), and on a project whose module
  is missing. The same witness on a run that must connect logged go's
  `connect` to the proxy (`scripts/netwitness.sh`, `raw/netwitness.txt`);
- it writes nothing into the project (`H` records in every run).

It is **not** a security boundary against a hostile **project**.

**The bubblewrap sandbox in this PR is a prototype; its containment is not
established.** In the plain fixture it held:

- only the bound paths visible;
- 3 processes; no capabilities;
- a planted program reached no host path, socket or listener.

Review found escapes and hazards anyway. Each row is a requirement for a
real sandbox. The mechanism column says what a committed run showed; where a
mechanism comes only from a reviewer's report, it says so.

| #   | Escape or hazard                                                                                | Mechanism (what a run showed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status in this PR                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | git runs with the project's `.git/config` (`core.fsmonitor` command)                            | a plain `go list -json` stamps VCS information: the PATH shim and the tracer saw 7 git commands on the fixture, and the project's fsmonitor command ran (`raw/exec-fsmonitor.txt`)                                                                                                                                                                                                                                                                                                                                                                             | closed by the field-list `go list` and `-buildvcs=false` (same file, "current")                                                                                                                            |
| 2   | auth commands and git credential helpers                                                        | `GOAUTH=<command>`, injected through the experiment escape, ran the command before an HTTPS module fetch (`raw/exec-attacks.txt`, `GOAUTH` HOLE row)                                                                                                                                                                                                                                                                                                                                                                                                           | closed by `GOAUTH=off`; the caller's value is not passed                                                                                                                                                   |
| 3   | toolchain self-download                                                                         | with a `toolchain go1.99.0` line and `GOTOOLCHAIN=auto` injected, go tried to download that toolchain and wrote the module cache (`raw/exec-attacks.txt`, HOLE row)                                                                                                                                                                                                                                                                                                                                                                                            | closed by `GOTOOLCHAIN=local`, also when the helper is started inside the project                                                                                                                          |
| 4   | checksum-database access; `go.work.sum` written into the project                                | with `GOSUMDB=sum.golang.org` injected and no pin, go wrote `go.work.sum` into the workspace and sumdb state under `GOPATH` (`raw/exec-attacks.txt`, HOLE row); with no pin alone, `go.work.sum` was written and the run exited 3 (`raw/experiment-escapes.txt`)                                                                                                                                                                                                                                                                                               | closed by `GOSUMDB=off` + overlay pin + project assertion                                                                                                                                                  |
| 5   | path sockets reachable from the sandbox                                                         | under the round-4 sandbox (`--ro-bind / /`, network namespace only), a planted program connected to the session bus, and a `systemd-run` unit started through it wrote a marker outside the sandbox and reached a loopback listener; `docker.sock` answered (`raw/escape.txt`, "round-4")                                                                                                                                                                                                                                                                      | allow-list binds: in the plain fixture the bus, `docker.sock` and listeners were absent (`raw/escape.txt`, "allow-list"); see rows 8 and 16                                                                |
| 6   | host files readable from the sandbox                                                            | under the round-4 sandbox, the whole host filesystem was visible read-only: `~/.ssh` was listed and the gpg/ssh agent directory under `/run/user/<uid>` was visible (`raw/escape.txt`, "round-4")                                                                                                                                                                                                                                                                                                                                                              | allow-list binds: only the Go installation, the module cache, the project's directories and a private cache; `~/.ssh` and the agent directory absent in the plain fixture (`raw/escape.txt`, "allow-list") |
| 7   | host processes visible (and possibly signalable)                                                | without a pid namespace the round-4 sandbox listed 735 host processes in `/proc` (`raw/escape.txt`, "round-4"); signalling them was not tested                                                                                                                                                                                                                                                                                                                                                                                                                 | `--unshare-all` gives a new pid namespace and a fresh `/proc`: 3 processes visible (`raw/escape.txt`, "allow-list")                                                                                        |
| 8   | the project chooses the sandbox's binds                                                         | with an unused `replace example.com/unused => /run/user/<uid>` and `-trust-outside-deps`, the allow-list sandbox bound that directory: the planted program connected to the session bus and saw the agent directory (`raw/hazards.txt`, "row 6"). `systemd-run` was not in the sandbox; the reviewer's raw D-Bus `StartTransientUnit` call that started a host process is reported in review, not reproduced here                                                                                                                                              | refused unless trusted (`-trust-outside-deps`); a requirement, not a proof                                                                                                                                 |
| 9   | build-cache poisoning across runs and projects                                                  | reported in review, not reproduced here: go's module index is keyed by Go version and path and stored in the writable `GOCACHE`; a hostile run wrote a false entry, and a later clean run gave a wrong definite link with 0 errors                                                                                                                                                                                                                                                                                                                             | a fresh throwaway cache per run by default; a persistent cache must never be shared between trust levels                                                                                                   |
| 10  | a fake `go`                                                                                     | a `go` found on PATH cannot be authenticated; before `-go` was required, a fake `go` first on PATH was started                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `-go` required: without it, exit 2 and 0 records; the fake is not run (`raw/exec-attacks.txt`)                                                                                                             |
| 11  | caller variables changing results, e.g. `CGO_ENABLED=1` silently enabling faked C (wrong links) | caller variables were passed through to go                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | nothing passed: with a caller `CGO_ENABLED=1`, go's effective value is 0 (`raw/exec-attacks.txt`)                                                                                                          |
| 12  | hazard: a FIFO or other blocking special file with a `.go` name hangs the run                   | the **Go loader** opens it as a source file: with a FIFO `cmd/review_fifo.go`, the tracer showed `go list` open it and sleep in `wait_for_partner` until a writer appeared, five times in one run. A FIFO without a `.go` name was opened by nothing: exit 0, 5 calls, project hashes unchanged (the project hash reads content only for regular files) (`raw/hazards.txt`, "row 10a/10b")                                                                                                                                                                     | open                                                                                                                                                                                                       |
| 13  | hazard: a project symlink to a host file is read, and its first token appears in a diagnostic   | without the sandbox, both `go list` and the helper's own parser read the target: two error records quote its first token (`raw/hazards.txt`, "row 11"). With `-sandbox bwrap` and a target outside the bound paths, go could not see it and the helper did not open it (0 records quote it)                                                                                                                                                                                                                                                                    | open                                                                                                                                                                                                       |
| 14  | hazard: a planted program can execute inside the sandbox                                        | it did: the probe started as `GOCACHEPROG` ran and reported each attempt (`raw/escape.txt`, "allow-list")                                                                                                                                                                                                                                                                                                                                                                                                                                                      | inherent: whatever is bound is reachable; only containment limits it                                                                                                                                       |
| 15  | hazard: no sandbox where unprivileged user namespaces are unavailable                           | bubblewrap needs them: with namespaces disabled, bwrap fails (`raw/escape.txt`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | when `-sandbox bwrap` is given, the helper refuses (exit 2, 0 records); not silently downgraded                                                                                                            |
| 16  | sockets and FIFOs inside a bound tree are live IPC endpoints                                    | a read-only mount preserves IPC through special files. Under the allow-list sandbox, a planted program connected to a host listener at `<project>/listener` and wrote bytes into a project FIFO that a host process read; an unused trusted local `replace` made another directory's listener reachable. The helper exited 0 with unchanged project hashes: a content hash does not see special files (`raw/hazards.txt`, "row 14"). The reviewer's further step (a host process then writing outside every bound directory) depends on what the listener does | **open** — requirement for a real sandbox: present the project as plain files (copied or overlaid from the snapshot), never bind it                                                                        |
| 17  | a required sandbox silently disappears                                                          | `-bwrap ''` was read as "unsandboxed"; a relative `-bwrap bwrap` resolved through the caller's PATH to a fake wrapper that stripped the sandbox                                                                                                                                                                                                                                                                                                                                                                                                                | `-bwrap` must be an absolute path when `-sandbox bwrap` is given, else exit 2 and 0 records; the fake never ran (`raw/escape.txt`); bubblewrap, like `go`, is trusted and named by the launcher            |
| 18  | a malformed caller `GODEBUG` (e.g. a removed setting) or `GOMEMLIMIT`                           | the Go runtime aborts the helper before `main` (`raw/exec-attacks.txt`, `raw/process-env.txt`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | the launcher must start the helper with a clean environment (requirement)                                                                                                                                  |
| 19  | the helper's experiment escapes                                                                 | `GOLINKS_EXTRA_ENV` and `GOLINKS_NOPIN` re-open the holes above (`raw/experiment-escapes.txt`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | evidence helper only; a product must not have them                                                                                                                                                         |

Rows 1–17 came from review, over six rounds; rows
18 and 19 from this investigation's own runs and review round 6. Each fix
was followed by a new finding. That is why the sandbox is a prototype.

**Threat model.** For a developer's own code — the owner's assumption, with
the build chain on the dev machine and the developer building this code
anyway — the closed environment is adequate. A code-graph tool changes one
thing: indexing may happen automatically on whatever an agent opens, and
**opening is not building**. So the toolchain route is safe to offer **only
as an explicit per-project opt-in** ("I trust this project enough to build
it"), unless and until a properly engineered and separately reviewed
sandbox exists.

## One-minute table

Coverage: share of restic's 26,535 call expressions that are static function
or method calls with a definite callee at a known definition location
(in-project share in brackets).

| Option                                                                                      | Needs installed      | Runs project code / external programs / network                                                                                                                            | Coverage                                                                               | On broken code                                                                                                                                                                                    | Cost (restic)                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) Hand-written module only                                                                | nothing              | no / none / no                                                                                                                                                             | 41.9% (41.9%); no std or dependency targets; `implements` unverified (59 of 276 wrong) | the file with a syntax error contributes nothing; a valid file the grammar misreads fails too                                                                                                     | 24–32 s, 1.6 GB (Node)                                                                                                                                                                                                                       |
| (2) Toolchain route (closed environment, `-cgo off`), opted-in projects only                | `go`; a module cache | **as trusted as building the project.** For an ordinary project, with the experiment escapes unset: only `go` starts; offline, no network call; the project is not written | 66.7% (40.5%) one configuration; 71.8% (42.9%) six                                     | **links:** definite in clean-closure packages, 100% clean / median 78.0% after one breakage (min 4.8%).<br>**Implementer sets:** 100% clean / 0% after any breakage.<br>Packages needing cgo fail | 9–12 s, ~600 MiB per configuration, ×6 for all files; the fresh build cache per run had no measurable cost (observations on a loaded machine: 9.1 / 9.5 s against 7.1 s empty / 8.5 s warm with a persistent cache; within run-to-run noise) |
| (3) Toolchain for opted-in projects when `go` is present; the hand-written module otherwise | `go` optional        | as (2) for opted-in projects; as (1) for the rest                                                                                                                          | (2) where opted in; (1) elsewhere                                                      | toolchain facts where definite; module links for failed and unverified packages                                                                                                                   | (2) + (1)                                                                                                                                                                                                                                    |

The bubblewrap sandbox (`-sandbox bwrap`, Linux; `unshare` not measured) is a
prototype and is not part of any option.

## Recommendation

**Use the toolchain route when `go` is present and the project is opted in;
use the hand-written module otherwise, and always as the fallback** for
failed and unverified packages, files no configuration includes, and
packages that need cgo.

Where it is used, the toolchain route:

- matched every definite link of the hand-written module;
- adds std and dependency targets, verified `implements` and implementer sets;
- is the authority on syntax errors.

Both soundness rules apply: links per import closure, implementer sets per
universe.

**Requirement, not a choice:** the launcher names the trusted Go installation
(`-go`, an absolute path) and starts the indexer with a clean environment. A
`go` found on a PATH cannot be authenticated, and a malformed `GODEBUG` or
`GOMEMLIMIT` aborts any Go program before `main` (`raw/exec-attacks.txt`,
`raw/process-env.txt`).

**Decisions for Karl:**

1. **Trust model.** The toolchain route:
   - as an explicit per-project opt-in ("I trust this project enough to
     build it") — **recommended**;
   - never;
   - automatic on whatever is opened — not recommended: it would need a real
     sandbox, which does not exist.
2. **Commission a sandbox as its own chunk?** It would have to withstand
   every row of the table above, not just the routes found so far, and come
   with its own design and review. It must present the project as plain
   files (a copy or the snapshot overlay), never a bind of the project
   directory (row 14). Its executables, like `go`, must be named by the
   launcher (row 15). Platforms: Linux bubblewrap or `unshare`
   (the `unshare` form is not measured); macOS and Windows are not measured.
3. **Downloads.**
   - Recommended: **offline-first** — never download, never ask the checksum
     database, report missing modules. With a warm cache the links are
     identical. With a cold one, 571 of 136,338 located links (0.4%) stay
     definite. A dependency without a checksum line makes the whole load
     fail (0 records).
   - Alternative: a separate download step through a module proxy only.
4. **cgo:**
   - **off, recommended:** packages needing cgo fail, and nothing extra
     runs;
   - faked C: faked packages and importers unverified; 3.3% of restic's
     links stay definite;
   - real cgo processing: exact, but it runs the C toolchain.
5. **Configurations.** One configuration — the one the helper's flags set
   (cgo off, `GOAMD64=v1`, the given GOOS/GOARCH; not necessarily the host's
   default build) — or a set covering all files (six for restic, about six
   times the cost). Links are keyed by configuration either way.
6. **Reads and writes outside the snapshot.**
   - **Read:**
     - the module cache;
     - `GOROOT`, including `$GOROOT/go.env`;
     - local `replace` / `go.work` directories inside the project. Ones
       outside are refused unless explicitly trusted.
   - **Not read:** the user's go env file. What the helper reads from its
     caller is listed under "Threat model and safety status".
   - **Written:**
     - **a fresh build cache per run**, under `-tmp` (thrown away; no measurable
       cost on restic in the observed timings, `raw/cachekey.txt`; a helper
       killed by a signal leaves it behind, so a product must clean up on
       termination). A persistent cache must never be shared
       between trust levels;
     - module-cache lock files for a module go was asked to find;
     - with downloads, the modules and checksum state.
   - **Never written**, with the experiment escapes unset: the project
     (pinned and asserted on every run).

Not measured: other projects; gopls; `x/tools/go/packages`; implementer sets
in test packages; private module proxies; a project whose own packages need
cgo; any sandbox beyond the prototype; macOS and Windows.

Checks: see the pull request.
