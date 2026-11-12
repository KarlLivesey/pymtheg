# W2-L: can the Go build chain supply exact code-graph links, and at what cost?

Investigation only (round 7). Evidence, helper, scripts and raw outputs:
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

**The closed environment is measured hygiene, not a security boundary
against a hostile project.** The helper runs the `go` named by a required
`-go` flag (the Go installation is trusted and chosen by the launcher). It
runs it in a closed environment that inherits nothing from its caller:

- configuration from flags;
- `GOENV=off`, PATH = the Go installation's `bin`;
- offline (`GOPROXY=off`, `GOSUMDB=off`), `GOVCS=*:off`, `GOAUTH=off`,
  `GOTOOLCHAIN=local`;
- cgo off;
- the project's `go.mod`, `go.sum`, `go.work` and `go.work.sum` pinned
  through `-overlay`;
- a fresh throwaway build cache per run;
- a hash assertion over the project.

With it, measured in the committed runs:

- for **an ordinary project** (restic, the fixtures) and **a hostile CALLER
  environment** (`exec-closed.sh`, `exec-attacks.sh`), only `go` starts
  (ptrace tracer);
- offline it makes no connection (`exec-closed.sh`, `network.sh`);
- it writes nothing into the project (`H` records in every run).

It is **not** a security boundary against a hostile **project**.

**The bubblewrap sandbox in this PR is a prototype; its containment is not
established.** In the plain fixture it held:

- only the bound paths visible;
- 3 processes; no capabilities;
- a planted program reached no host path, socket or listener.

Review found escapes and hazards anyway. Each is a requirement for a real
sandbox:

| #   | Escape or hazard                                                                                          | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status in this PR                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | git runs with the project's `.git/config` (`core.fsmonitor` command)                                      | a plain `go list -json` stamps VCS info by running git                                                                                                                                                                                                                                                                                                                                                                                     | closed by the field-list `go list` and `-buildvcs=false`                                                                                                            |
| 2   | auth commands and git credential helpers                                                                  | `GOAUTH` runs a command before an HTTPS module fetch                                                                                                                                                                                                                                                                                                                                                                                       | closed by `GOAUTH=off` (inherited value ignored)                                                                                                                    |
| 3   | toolchain self-download                                                                                   | a `go`/`toolchain` line newer than the installed Go, `GOTOOLCHAIN=auto`; also through the helper's own location probe run in the caller's directory                                                                                                                                                                                                                                                                                        | closed by `GOTOOLCHAIN=local`; one `runGo` with the full policy                                                                                                     |
| 4   | checksum-database access; `go.work.sum` written into the project                                          | `GOPROXY=off` alone still uses `sum.golang.org`; with `GOSUMDB=off`, go still writes `go.work.sum`                                                                                                                                                                                                                                                                                                                                         | closed by `GOSUMDB=off` + overlay pin + project assertion                                                                                                           |
| 5   | path sockets reachable from the sandbox                                                                   | `--ro-bind / /` leaves the session bus (→ `systemd-run` outside the sandbox), `docker.sock` and agents connectable                                                                                                                                                                                                                                                                                                                         | allow-list binds                                                                                                                                                    |
| 6   | the project chooses the sandbox's binds                                                                   | a `replace … => /run/user/<uid>` (or `/`, `/run`, `$HOME`) target was bound; the session bus was reached again                                                                                                                                                                                                                                                                                                                             | refused unless trusted (`-trust-outside-deps`); a requirement, not a proof                                                                                          |
| 7   | build-cache poisoning across runs and projects                                                            | go's module index is keyed by Go version and path and stored in the writable `GOCACHE`; a hostile run wrote a false entry, and a later clean run gave a wrong definite link with 0 errors                                                                                                                                                                                                                                                  | a fresh throwaway cache per run by default; a persistent cache must never be shared between trust levels                                                            |
| 8   | a fake `go`                                                                                               | a `go` found on PATH cannot be authenticated                                                                                                                                                                                                                                                                                                                                                                                               | `-go` required; the Go installation is trusted                                                                                                                      |
| 9   | inherited `CGO_ENABLED` silently enabling faked C (wrong links)                                           | caller variables passed through                                                                                                                                                                                                                                                                                                                                                                                                            | nothing inherited                                                                                                                                                   |
| 10  | hazard: a FIFO in the project hangs the helper                                                            | the project hash reads it                                                                                                                                                                                                                                                                                                                                                                                                                  | open                                                                                                                                                                |
| 11  | hazard: a project symlink to a host file is read unsandboxed, and its first token appears in a diagnostic | the helper parses files itself, outside the sandbox                                                                                                                                                                                                                                                                                                                                                                                        | open                                                                                                                                                                |
| 12  | hazard: a planted program can execute inside the sandbox                                                  | whatever is bound is reachable; only containment limits it                                                                                                                                                                                                                                                                                                                                                                                 | inherent                                                                                                                                                            |
| 13  | hazard: no sandbox where unprivileged user namespaces are unavailable                                     | bubblewrap needs them                                                                                                                                                                                                                                                                                                                                                                                                                      | the helper refuses (`-sandbox` required); not silently downgraded                                                                                                   |
| 14  | sockets and FIFOs inside a bound tree are live IPC endpoints                                              | a read-only mount preserves IPC through special files. A host listener at `<project>/listener` received a planted program's message, and through it a host process wrote outside every bound directory and reached a loopback listener; a project FIFO accepted bytes; an unused local `replace` made another directory's listener reachable. The helper exited 0 with identical project hashes: a content hash does not see special files | **open** — requirement for a real sandbox: present the project as plain files (copied or overlaid from the snapshot), never bind it                                 |
| 15  | a required sandbox silently disappears                                                                    | `-bwrap ''` was read as "unsandboxed" (exit 0, records, no bubblewrap); a relative `-bwrap bwrap` resolved through the caller's PATH to a fake wrapper that stripped the sandbox                                                                                                                                                                                                                                                           | `-bwrap` must be an absolute path when `-sandbox bwrap` is given, else exit 2 and 0 records (measured); bubblewrap, like `go`, is trusted and named by the launcher |

Rows 1–9, 14 and 15 were found by review across seven rounds, and each fix
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

| Option                                                                                      | Needs installed      | Runs project code / external programs / network                                                                                       | Coverage                                                                               | On broken code                                                                                                                                                                                    | Cost (restic)                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (1) Hand-written module only                                                                | nothing              | no / none / no                                                                                                                        | 41.9% (41.9%); no std or dependency targets; `implements` unverified (59 of 276 wrong) | the file with a syntax error contributes nothing; a valid file the grammar misreads fails too                                                                                                     | 24–32 s, 1.6 GB (Node)                                                                                                                                                            |
| (2) Toolchain route (closed environment, `-cgo off`), opted-in projects only                | `go`; a module cache | **as trusted as building the project.** For an ordinary project: only `go` starts; offline, no connection; the project is not written | 66.7% (40.5%) one configuration; 71.8% (42.9%) six                                     | **links:** definite in clean-closure packages, 100% clean / median 78.0% after one breakage (min 4.8%).<br>**Implementer sets:** 100% clean / 0% after any breakage.<br>Packages needing cgo fail | 9–12 s, ~600 MiB per configuration, ×6 for all files; the fresh build cache per run had no measurable cost (8.7 / 6.9 s against 10.7 s cold / 9.4 s warm with a persistent cache) |
| (3) Toolchain for opted-in projects when `go` is present; the hand-written module otherwise | `go` optional        | as (2) for opted-in projects; as (1) for the rest                                                                                     | (2) where opted in; (1) elsewhere                                                      | toolchain facts where definite; module links for failed and unverified packages                                                                                                                   | (2) + (1)                                                                                                                                                                         |

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
`go` found on a PATH cannot be authenticated, and a removed `GODEBUG` setting
aborts any Go program before `main`.

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
   - **Not read:** the user's go env file.
   - **Written:**
     - **a fresh build cache per run** (thrown away; no measurable cost on
       restic, `raw/cachekey.txt`). A persistent cache must never be shared
       between trust levels;
     - module-cache lock files for a module go was asked to find;
     - with downloads, the modules and checksum state.
   - **Never written:** the project (pinned and asserted on every run).

Not measured: other projects; gopls; `x/tools/go/packages`; implementer sets
in test packages; private module proxies; a project whose own packages need
cgo; any sandbox beyond the prototype; macOS and Windows.

Checks: see the pull request.
