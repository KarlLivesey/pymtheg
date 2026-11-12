# W2-L: can the Go build chain supply exact code-graph links, and at what cost?

Investigation only (round 6). Evidence, helper, scripts and raw outputs:
`evidence/w2-l/`. No product code, contract or support level changes.

## The answer

**Yes, for code that is go/types-clean (which is not the same as
buildable), one build configuration at a time, with cgo files outside the
configuration.** Two rules decide which facts are definite:

- **links** (calls, identifier uses, imports): only in packages whose whole
  import closure is free of errors;
- **implementer sets and `implements` pairs**: only when no loaded package
  has errors, because they are searched over every package.

A standard-library helper (`go list` + `go/parser` + `go/types`) starts the
`go` named by its required `-go` flag (an absolute path; no PATH lookup). The
Go installation is **trusted**: it is the user's compiler, a `go` cannot be
authenticated, and choosing it is the launcher's job. It runs in a **closed
environment that inherits nothing from its caller**:

- configuration and locations from command-line flags only;
- `GOENV=off`; PATH = the Go installation's `bin`;
- offline by default (`GOPROXY=off`, `GOSUMDB=off`); `GOVCS=*:off`,
  `GOAUTH=off`, `GOTOOLCHAIN=local`;
- `CGO_ENABLED=0` unless a flag says otherwise.

It also guards the project directly:

- it pins `go.mod`, `go.sum`, `go.work` and `go.work.sum` through
  `-overlay`, so go cannot write them. As a consequence, a dependency without
  a checksum line makes go refuse the whole load;
- it fails if any file changes in the project or its local `replace` /
  `go.work` directories.

An optional OS sandbox (`-sandbox bwrap`) is an **allow-list**:

- `go` sees only the Go installation, the module cache and the project's
  directories (read-only), plus the private build cache (read-write);
- it has no network, no other host file or socket, and its own pid, user,
  ipc, uts and cgroup namespaces.

It gives:

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
  or off, and with or without the sandbox.
- **The rest, same basis:**
  - interface calls: 8.5%;
  - builtins: 8.4%;
  - function values: 4.7% (1.8% package-level variables, 0.6% fields, 2.3%
    locals);
  - conversions to predeclared types: 4.8%;
  - other: 1.7%;
  - the one file no configuration includes: 0.4%.
- **Against the hand-written module** (on `main`, version 20), every definite
  link of every kind agrees by definition position:
  - 11,771 calls;
  - 18,041 references;
  - 1,296 imports;
  - 145 embeds;
  - 1,255 receivers.

  No contract violation was found.

- **What the toolchain adds:**
  - definite std and dependency callees the module leaves unresolved by
    design: 7,624 static calls (28.7%);
  - verified `implements`: of the module's 276 candidates, 59 refuted, 211
    confirmed, and 24 added.
- **What the comparison exposed in the module** (none of it a contract
  violation): by-design imprecision in its open and unverified sets, and one
  grammar gap.

**cgo.** FakeImportC (type-checking cgo without a C compiler) gives **wrong
definite links with 0 errors**. With cgo files outside the configuration,
restic's clean run has 0 errors in every package, and a package that needs
cgo fails instead of being mislinked.

**Broken code.** A swallowed overriding method re-binds callers in
error-free importers. Measured over 340 single breakages of restic (334
broken programs):

- **Links**:
  - 0 changed targets in clean-closure packages, 2 in importers, 1,025
    inside broken packages;
  - 100% definite on the clean run; median 78.0% after one breakage (min
    4.8%).
- **Implementer sets**:
  - an error anywhere changed sets of clean callers in 29 of the 334 runs;
  - 100% definite on the clean run (1,760 records) and **0% after any
    breakage**, when they are candidate lists only;
  - no record classified definite changed.

**What runs.** Witnessed with a ptrace tracer (every `execve`), a PATH shim,
and the reviewers' own witnesses: only `go`, in every case, including every
attack from five review rounds with a hostile caller environment and the
helper started from inside a hostile project.

If the environment policy had a hole (simulated by injecting the variable),
some attacks get through **without** the sandbox:

- `GOAUTH` and `GOCACHEPROG` hooks run;
- git runs for a direct fetch;
- a checksum-database fetch writes `go.work.sum` into the project (the
  helper's assertion catches it).

**The sandbox, as measured in round 6.** Round 5's sandbox (a read-only
view of the whole filesystem) **did not contain a planted program**: through
the session bus it started a process outside the sandbox (`systemd-run`),
which wrote a host file and reached a host listener. It also reached
`docker.sock` and read `~/.ssh`.

The round-6 allow-list sandbox stopped each of these:

- a planted program's attempts on every host path and socket failed;
- loopback and abstract sockets were refused;
- it saw 3 processes;
- host-side witnesses saw no marker, no connection and no new systemd
  unit.

It does not protect against:

- a kernel exploit;
- whatever is deliberately bound: the project and module cache are
  readable, the private cache writable;
- a system without unprivileged user namespaces. There the helper refuses
  to run with `-sandbox`, and never silently runs without it (measured).

## One-minute table

Coverage: share of restic's 26,535 call expressions that are static function
or method calls with a definite callee at a known definition location
(in-project share in brackets).

| Option                                                                                          | Needs installed                                                        | Runs project code / external programs / network                                                                                                     | Coverage                                                                               | On broken code                                                                                                                                                                                    | Cost (restic)                                                                                      |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| (1) Hand-written module only                                                                    | nothing                                                                | no / none / no                                                                                                                                      | 41.9% (41.9%); no std or dependency targets; `implements` unverified (59 of 276 wrong) | the file with a syntax error contributes nothing; a valid file the grammar misreads fails too                                                                                                     | 24–32 s, 1.6 GB (Node)                                                                             |
| (2) Toolchain required for Go (helper in a closed environment, `-cgo off`; optional OS sandbox) | `go`; a module cache; for the sandbox, bubblewrap or `unshare` (Linux) | **project code:** no.<br>**External programs:** only `go` (plus `bwrap` with the sandbox).<br>**Network:** none offline-first; proxy-only by choice | 66.7% (40.5%) one configuration; 71.8% (42.9%) six                                     | **links:** definite in clean-closure packages, 100% clean / median 78.0% after one breakage (min 4.8%).<br>**Implementer sets:** 100% clean / 0% after any breakage.<br>Packages needing cgo fail | 9–11 s, ~600 MiB per configuration (+~1 s sandboxed), ×6 for all files; private build cache 5.7 MB |
| (3) Toolchain when present, hand-written module as fallback                                     | `go` optional                                                          | as (2) where used                                                                                                                                   | (2) where `go` works; (1) elsewhere                                                    | toolchain facts where definite; module links for failed and unverified packages and for files the toolchain cannot load                                                                           | (2) + (1)                                                                                          |

The export-data variant of (2) compiles every dependency (36 s cold, 3 s
warm). It adds nothing measured here, so it is not recommended.

## Recommendation: option 3, in two layers

1. **Where `go` works, it matched or improved on every fact both sides
   cover.**
   - It matched every definite module link of every kind.
   - It adds std and dependency targets, verified `implements`, and
     implementer sets (computed for 1,527 of 2,304 interface calls: not in
     test variants; generic types skipped).
   - It is the authority on syntax errors.
   - It does not cover files no configuration includes, or give one answer
     across configurations.
2. **Two layers of protection:**
   - **The closed environment, always.** It fixes the configuration, keeps
     cgo out, never writes the project, and starts nothing but `go`.
   - **The allow-list OS sandbox wherever the platform offers one.** It
     costs about 1 s and changes no record. **Without the sandbox, the
     no-network and no-write guarantees rest on the environment policy being
     complete** — and each of the last four review rounds found a hole in the
     protection.

     In the measured allow-list sandbox, a planted program that does start
     reaches nothing outside the bound paths. Round 5's read-only-root
     sandbox did not stop it, so the allow-list form matters.

   Linux has `unshare` (util-linux) everywhere and bubblewrap as a package;
   both ran unprivileged here. Not measured: macOS `sandbox-exec` (ships,
   deprecated) and Windows AppContainer or a restricted token.

3. **Two soundness rules:**
   - **links:** a package with any error is failed; its importers are
     unverified; only clean-closure packages are definite;
   - **implementer sets and `implements` pairs:** definite only with no
     error in any loaded package; otherwise candidate lists.
4. **The fallback is still needed:**
   - when `go` is missing;
   - when `go.mod` needs a newer Go;
   - when modules are missing (offline);
   - for files no configuration includes;
   - for packages needing cgo;
   - for failed and unverified packages.

Costs:

- **(1) for the user:** nothing to install; structure-level precision only.
- **(2) for the user:** `go`, a module cache, a run per configuration;
  bubblewrap for the sandbox where it is not installed. After any breakage,
  implementer sets are candidates only.
- **(3) for Pymtheg:**
  - two implementations;
  - every fact records its route, configuration and soundness status;
  - a toolchain fact never overrides a module link silently;
  - the indexer must be launched with a clean environment: a removed
    `GODEBUG` setting aborts any Go program at startup.

**Decisions for Karl:**

**Requirement, not a choice:** the launcher names the Go installation
(`-go`, an absolute path) and starts the indexer with a clean environment.
The Go installation is trusted; a `go` found on a PATH cannot be
authenticated. A layout-passing fake first on PATH is not consulted when
`-go` names the real one (measured).

1. **May indexing start programs?** Recommended: only `go` (and the
   sandbox's `bwrap`), in the closed environment, part F. That rules out:
   - git for VCS stamping;
   - the C compiler;
   - VCS tools for direct fetches;
   - auth commands and credential helpers;
   - cache programs;
   - another Go toolchain.

   The cost: modules no unauthenticated proxy serves, and packages that need
   cgo, get fallback links.

2. **Enforcement.** Should the OS sandbox be required where available
   (recommended), optional, or not used? Without it, guarantees rest on the
   environment policy alone.
3. **May indexing download modules, and through what?**
   - Recommended: **offline-first** — never download and never ask the
     checksum database (`GOPROXY=off`, `GOSUMDB=off`); report missing
     modules. With a warm cache the links are identical; with a cold one,
     571 of the cold run's 136,338 located links (0.4%) stay definite. A
     dependency with no line in `go.sum` / `go.work.sum` makes go refuse the
     **whole load** (0 records), not just that module.
   - Alternative: a **module proxy only** (HTTP, with the checksum
     database; no `direct`, no auth). This is incompatible with the sandbox,
     so downloads would be a separate, unsandboxed step.
4. **cgo** (part H):
   - **(i) `-cgo off`, recommended:** packages needing cgo fail, their
     importers are unverified, and nothing runs;
   - **(ii) `-cgo fakec`:** faked packages and their importers are
     unverified (on restic, 3.3% of links stay definite);
   - **(iii) `-cgo real`:** exact, but it runs the C toolchain, against
     decision 1.
5. **Configurations.** Index one configuration — the one the helper sets
   from its flags (cgo off, `GOAMD64=v1`, the required GOOS/GOARCH; not
   necessarily the host's default build) — or a set covering all files (six for restic, about six
   times the cost)? Links are keyed by configuration either way.
6. **What indexing reads and writes outside the snapshot.** Project files
   can come from the snapshot alone (restic overlaid into an empty
   directory: identical records).
   - **Read:**
     - the module cache (immutable by version and `go.sum`);
     - `GOROOT`, including `$GOROOT/go.env`;
     - local `replace` / `go.work` targets, unless overlaid.
   - **Not read:** the user's go env file.
   - **Written:**
     - a private build cache (required with tests; recommended under
       `.pymtheg/`; 5.7 MB for restic);
     - without the sandbox, lock files in the module cache for a module
       go was asked to find;
     - with `-net proxy`, downloaded modules and checksum state under
       `$GOPATH/pkg/sumdb`.
   - **Never written:** the project and its local `replace` / `go.work`
     directories (pinned and asserted, also on error exits).

   The re-index cache key covers every non-immutable file read, plus the
   helper's flags and the Go installation.

Not measured: other projects; gopls; `x/tools/go/packages`; implementer sets
in test packages; private module proxies; what git does after a successful
`ls-remote`; a project whose own packages need cgo; the sandbox on macOS and
Windows; breakages beyond the 340-mutation sweep.

Checks: see the pull request.
