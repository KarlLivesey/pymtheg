# W2-L: can the Go build chain supply exact code-graph links, and at what cost?

Investigation only (round 3). Evidence, helper, scripts and raw outputs:
`evidence/w2-l/`. No product code, contract or support level changes.

## The answer

**Yes, for code that type-checks, one build configuration at a time, and only
for packages whose whole import closure type-checks.** It needs only the `go`
command and the standard library, and it starts no external program when the
go command is used in the measured way. A standard-library helper
(`go list` + `go/parser` + `go/types`) gives:

- exact callee locations for static calls;
- for dynamic calls, the interface method, plus the implementers of the
  call's receiver interface among the types of the packages loaded for that
  configuration (a type in an unloaded package, another configuration or a
  dependent module is not seen);
- identifier → declaration;
- import → directory;
- verified `implements` pairs.

On restic (one project; 26,535 call expressions counted by syntax in all 559
tracked files; shares over six configurations, which cover 558 files):

- **Static calls with an exact callee location:** 71.8%, of which 42.9%
  in-project (66.7% and 40.5% in the single configuration linux/amd64 with
  tests).
- **The rest, same basis:**
  - interface calls: 8.5%, where the interface method is located; implementer
    sets were computed for 1,527 of the 2,304 interface calls of
    linux/amd64, those outside test packages;
  - builtins: 8.4%;
  - function values: 4.7% (1.8% package-level variables, 0.6% fields, 2.3%
    locals);
  - conversions to predeclared types: 4.8%;
  - other: 1.7%;
  - calls in the one file no configuration includes: 0.4%.
- **Against the hand-written module** (as merged on `main`, module version
  20), every definite link of every kind agrees by definition position:
  - 11,771 calls;
  - 18,041 references;
  - 1,296 imports;
  - 145 embeds;
  - 1,255 receivers.

  0 differ, and no closed candidate set misses the toolchain's target. **No
  contract violation was found.**

- **What the toolchain adds:**
  - definite std and dependency callees, which the module leaves unresolved
    by design: 7,624 static function/method calls (28.7% of call sites), or
    7,712 (29.1%) with conversions to std/dependency named types;
  - verified `implements`: of the module's 276 unverified candidates, it
    refutes 59 and confirms 211, and it adds 24 pairs.
- **What the comparison also exposed** (none of it a contract violation):
  - by-design imprecision in the module's unverified and open sets: 348 open
    interface-call sets carry candidates the toolchain refutes; 20 open sets
    miss one dispatch hop (an interface method promoted through four
    structs); 8 open by-name sets name only wrong targets;
  - one grammar gap: the module fails a valid file (`status_test.go`), so 30
    builtin calls in its package get an `invalid-code` cause that names a
    valid file.

Every toolchain link is true for one build configuration. One configuration
saw 507 of 559 files. 172 call sites have a different callee in different
configurations.

**On broken code the toolchain can be silently wrong outside the broken
package.** When the broken text swallows a method that overrides a promoted
one, callers re-bind to the promoted method. Those callers can sit in a
package that has no error of its own but imports the broken one.

In a sweep of 340 single breakages of restic (332 produced errors), changed
targets appeared:

- 2 times in importers of a broken package, plus the reviewer's 3 in the
  `ReadPacks` case;
- 1,281 times inside broken packages;
- **0 times in packages whose whole import closure is free of errors.**

Under the sound rule this gives (a package with errors is failed, its
transitive importers are unverified, only clean-closure packages are
definite), a median of 78.3% of links stay definite after one breakage (min
4.8%). A breakage in the core package `internal/restic` leaves 11.7%.

**What runs.** Round 1 was wrong here. Its plain `go list -json` ran `git` in
a git checkout, and git obeyed the project's own `.git/config`, so a
`core.fsmonitor` hook — a command the project chooses — ran during indexing.
It also probed the C compiler.

The helper now uses `go list`'s field-list form with `-buildvcs=false`. A
PATH-wide exec log then shows no external program in any source-mode case:

- restic;
- every fixture case: cgo, vendor, workspace, toolchain line, missing
  modules;
- the git hook repro.

Programs still start for module downloads that go `direct` (git on URLs from
`go.mod`), unless settings forbid it.

## One-minute table

Coverage: share of restic's 26,535 call expressions that are static function
or method calls with a definite callee at a known definition location
(in-project share in brackets), over the configurations each option sees.

| Option                                                                                     | Needs installed                                 | Runs project code / external programs / network                                                                                                                                                                                                                                                                     | Coverage                                                                               | On broken code                                                                                                                         | Cost (restic)                                                              |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| (1) Hand-written module only                                                               | nothing                                         | no / none / no                                                                                                                                                                                                                                                                                                      | 41.9% (41.9%); no std or dependency targets; `implements` unverified (59 of 276 wrong) | the file with a syntax error contributes nothing; a valid file the grammar misreads fails too                                          | 32 s, 1.6 GB (Node, whole project)                                         |
| (2) Toolchain required for Go (standard-library helper, source mode, field-list `go list`) | `go`; modules downloaded once per configuration | **project code:** no.<br>**External programs:** none measured with the settings below.<br>**Network and its programs:** a module download on the first run of each configuration (93 modules, 1.03 GB); git for `direct` fetches; a toolchain download if `go.mod` asks for a newer Go — each avoidable by settings | 66.7% (40.5%) one configuration; 71.8% (42.9%) six                                     | definite only in packages with a clean import closure: median 78.3% of links after one breakage (min 4.8%); nothing if `go list` fails | 8–20 s (load-dependent), ~600 MiB per configuration; ×6 to cover all files |
| (3) Toolchain when present, hand-written module as fallback                                | `go` optional                                   | as (2) where used                                                                                                                                                                                                                                                                                                   | (2) where `go` works; (1) elsewhere                                                    | toolchain links for clean-closure packages; module links for failed and unverified packages and files the toolchain cannot load        | (2) + (1)                                                                  |

The export-data variant of (2) is 3 s warm, but 35 s and 768 MB of build
cache cold. It compiles every dependency and runs pkg-config, gcc, as and ld
for cgo code, including the project's own (90 programs on the fixture). It
adds nothing measured here, so it is not recommended.

## Recommendation: option 3 — toolchain when present, hand-written module as fallback

1. **Where `go` works and the import closure type-checks, it matched or
   improved on every link both sides cover.**
   - It matched every definite module link of every kind.
   - It adds std and dependency targets, verified `implements`, and
     implementer sets among the loaded packages' types.
   - It is the authority on what is a syntax error.
   - It does not give links in files no configuration includes, or one
     answer across configurations: it needs a run per configuration.
2. **It need not start any external program, and it executes no project
   code,** with these settings (all measured):
   - `go list` in the field-list form with `-buildvcs=false`;
   - source mode;
   - `GOTOOLCHAIN=local`;
   - `GOFLAGS` set explicitly, never `-mod=mod`;
   - `GOPROXY` without `direct` (or `off`), and `GOVCS='*:off'`.

   So the open W2-K decision on running project code need not hold Go back.

3. **Toolchain links must follow the sound rule.** A package with errors is
   failed; its importers, transitively, are unverified; only packages with a
   clean import closure are definite. Marking only the packages with errors
   is not enough (measured wrong links in error-free importers).
4. **The fallback is still needed:**
   - when `go` is missing;
   - when `go.mod` needs a newer Go than installed;
   - when modules are not downloaded and the network is not allowed;
   - for files no configuration includes;
   - for failed and unverified packages.

What each option costs the user:

- (1): nothing to install; structure-level precision only.
- (2): `go` plus module downloads (on restic, 1 GB for one configuration); a
  run per configuration; after a breakage, links only for packages untouched
  by it.
- (3): the same as (2) where `go` is used; nothing extra otherwise.

What (3) costs Pymtheg:

- two implementations;
- every link records its route, configuration and soundness status;
- a toolchain link never overrides a module link silently.

**Decisions for Karl:**

1. **External programs the go command may start.** All three are avoidable,
   at the costs shown:
   - git for VCS stamping: avoidable, with no loss, by the field-list
     `go list` plus `-buildvcs=false`;
   - the C compiler probe: avoidable the same way;
   - VCS tools for `direct` module fetches (git on URLs from `go.mod` or
     imports): avoidable by `GOPROXY` without `direct` and `GOVCS='*:off'`.
     This loses modules no proxy serves, including private ones.

   Should indexing forbid all three (recommended)?

2. **Network.** May indexing download modules from a module proxy (HTTP
   only, checked against `go.sum`), or must it run with `GOPROXY=off`? With
   `GOPROXY=off`, calls into undownloaded modules are left unresolved, with
   an error.
3. **Toolchain downloads.** Recommended: always `GOTOOLCHAIN=local`, so a
   `go.mod` can never make indexing fetch and run another Go. The cost is
   that such a module gets fallback links only.
4. **Configurations.** Index the host configuration only, or a set that covers
   all files (six for restic, about six times the cost)? Either way, links are
   keyed by configuration. A callee that differs between configurations is a
   set labelled by configuration, never several definite links.
5. **Snapshot rule (W1-C).** A snapshot-only route works.
   - Measured: all of restic supplied through `go list -overlay` into an
     empty directory gives identical records; nothing is read from the
     project directory.
   - Still read from disk: the module cache (immutable, keyed by version and
     `go.sum`), `GOROOT`, and local `replace` / `go.work` targets unless they
     are put in the overlay too.
   - The re-index cache key must cover every non-immutable file the loader
     read (taken from `go list -json`). A measured repro changes a link with
     every project file unchanged.

   Is reading the module cache and `GOROOT` acceptable?

Not measured: other projects, gopls, `x/tools/go/packages`, implementer sets
for calls in test packages, private module proxies, what git does after a
successful `ls-remote`, and breakages beyond the 340-mutation sweep.

Checks: see the pull request.
