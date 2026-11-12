# W2-L: can the Go build chain supply exact code-graph links, and at what cost?

Investigation only (round 4). Evidence, helper, scripts and raw outputs:
`evidence/w2-l/`. No product code, contract or support level changes.

## The answer

**Yes, for code that type-checks, one build configuration at a time, with
cgo files outside the configuration, and only for packages whose whole import
closure type-checks.**

The `go` command and the standard library are enough. The helper starts `go`
in a closed environment built from scratch: no inherited variables,
`GOENV=off`, a PATH holding only `go`, no downloads by default, no VCS
programs, no auth commands, and `CGO_ENABLED=0`. In it, nothing but `go`
runs.

A standard-library helper (`go list` + `go/parser` + `go/types`) gives:

- exact callee locations for static calls;
- for dynamic calls, the interface method, plus the implementers of the
  call's receiver interface among the types of the packages loaded for that
  configuration. A type in an unloaded package, another configuration or a
  dependent module is not seen. Sets were computed for 1,527 of 2,304
  interface calls, those outside test packages;
- identifier → declaration;
- import → directory;
- verified `implements` pairs.

On restic (one project; 26,535 call expressions counted by syntax in all 559
tracked files; shares over six configurations, which cover 558 files):

- **Static calls with an exact callee location:** 71.8%, of which 42.9%
  in-project (66.7% and 40.5% in the single configuration linux/amd64 with
  tests). Identical with cgo on or off: restic's own code has no cgo.
- **The rest, same basis:**
  - interface calls: 8.5%, where the interface method is located;
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

  0 differ, and no closed candidate set misses a target. **No contract
  violation was found.**

- **What the toolchain adds:**
  - definite std and dependency callees, which the module leaves unresolved
    by design: 7,624 static function/method calls (28.7%), or 7,712 (29.1%)
    with conversions to std/dependency named types;
  - verified `implements`: of the module's 276 candidates, it refutes 59 and
    confirms 211, and it adds 24 pairs.
- **What the comparison also exposed** (none of it a contract violation):
  - by-design imprecision in the module's open and unverified sets (348
    interface-call sets with refuted candidates; 20 open sets missing one
    dispatch hop; 8 by-name sets naming only wrong targets);
  - one grammar gap: a valid file fails, giving 30 `invalid-code` causes
    that name a valid file.

**cgo.** The standard way to type-check cgo without a C compiler
(FakeImportC) gives **wrong definite links with 0 errors**: on the reviewer's
fixture, `x.F` is linked to `T.F` instead of the C field, also in an importing
package with no cgo. With cgo files outside the configuration
(`CGO_ENABLED=0`), restic's clean run has 0 errors in every package. A
package that needs cgo is reported failed, not mislinked.

**On broken code, links can be silently wrong outside the broken package**
(a swallowed overriding method re-binds callers in error-free importers). The
rule, applied literally with no exemption:

- any package with any error is failed;
- its transitive importers are unverified;
- only clean-closure packages are definite.

In 340 single breakages of restic (334 broken programs), changed targets
appeared:

- 0 times in clean-closure packages;
- 2 times in importers;
- 1,025 times inside broken packages.

The rule keeps 100% of links definite on the clean run, and a median of
78.0% after one breakage (min 4.8%; 11.7% for a breakage in the core package
`internal/restic`).

Every toolchain link is true for one build configuration (one configuration
saw 507 of 559 files; 172 call sites have a different callee in different
configurations).

## One-minute table

Coverage: share of restic's 26,535 call expressions that are static function
or method calls with a definite callee at a known definition location
(in-project share in brackets), over the configurations each option sees.

| Option                                                                                                    | Needs installed                                                 | Runs project code / external programs / network                                                                                                                                                                       | Coverage                                                                               | On broken code                                                                                                                                                                           | Cost (restic)                                                                                               |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| (1) Hand-written module only                                                                              | nothing                                                         | no / none / no                                                                                                                                                                                                        | 41.9% (41.9%); no std or dependency targets; `implements` unverified (59 of 276 wrong) | the file with a syntax error contributes nothing; a valid file the grammar misreads fails too                                                                                            | 24–32 s, 1.6 GB (Node, whole project)                                                                       |
| (2) Toolchain required for Go (standard-library helper, source mode, closed environment, `CGO_ENABLED=0`) | `go`; a module cache (filled once, or never with offline-first) | **project code:** no.<br>**External programs:** none — only `go`, measured with a ptrace tracer, also with a hostile caller environment.<br>**Network:** none offline-first; with proxy-only, HTTP to the named proxy | 66.7% (40.5%) one configuration; 71.8% (42.9%) six                                     | definite only in packages with a clean import closure: 100% of links on the clean run, median 78.0% after one breakage (min 4.8%); packages needing cgo fail; nothing if `go list` fails | 6–15 s (load-dependent), ~600 MiB per configuration, ×6 to cover all files; a private build cache of 5.7 MB |
| (3) Toolchain when present, hand-written module as fallback                                               | `go` optional                                                   | as (2) where used                                                                                                                                                                                                     | (2) where `go` works; (1) elsewhere                                                    | toolchain links for clean-closure packages; module links for failed and unverified packages and files the toolchain cannot load                                                          | (2) + (1)                                                                                                   |

The export-data variant of (2) is 3 s warm, but 35 s and 768 MB of build
cache cold. It compiles every dependency with go's own tools. With cgo on it
needs a C compiler and pkg-config. It adds nothing measured here, so it is
not recommended.

## Recommendation: option 3 — toolchain when present, hand-written module as fallback

1. **Where `go` works and the import closure type-checks, it matched or
   improved on every link both sides cover.**
   - It matched every definite module link of every kind.
   - It adds std and dependency targets, verified `implements`, and
     implementer sets among the loaded packages' types (computed for 1,527
     of 2,304 interface calls: not in test variants; generic types skipped).
   - It is the authority on what is a syntax error.
   - It does not give links in files no configuration includes, or one
     answer across configurations: it needs a run per configuration.
2. **It starts no program besides `go` and executes no project code** in the
   closed environment. Measured:
   - restic and the fixtures;
   - the fsmonitor and GOAUTH attacks, and a hostile caller environment (the
     git-credential variant did not fire here even when injected);
   - downloads through a proxy and offline;
   - toolchain lines in `go.mod`.

   So the open W2-K decision on running project code need not hold Go back.

3. **Toolchain links must follow the rule, literally:** any package with any
   error is failed, its importers unverified, and only clean-closure
   packages definite. With `CGO_ENABLED=0`, a package that needs cgo fails
   rather than being mislinked.
4. **The fallback is still needed:**
   - when `go` is missing;
   - when `go.mod` needs a newer Go than installed;
   - when modules are missing (offline);
   - for files no configuration includes;
   - for packages that need cgo;
   - for failed and unverified packages.

What each option costs the user:

- (1): nothing to install; structure-level precision only.
- (2): `go`; a module cache (filled by the user's own builds, or by indexing
  if decision 2 allows); a run per configuration; links only for packages
  untouched by a breakage.
- (3): the same as (2) where `go` is used; nothing extra otherwise.

What (3) costs Pymtheg:

- two implementations;
- every link records its route, configuration and soundness status;
- a toolchain link never overrides a module link silently.

**Decisions for Karl:**

1. **May indexing start programs?** Recommended: no — only `go` itself, in
   the closed environment (part F of the evidence lists every variable). That
   rules out:
   - git for VCS stamping (field-list `go list`, `-buildvcs=false`);
   - the C compiler (no compiler on PATH; `CGO_ENABLED=0`);
   - VCS tools for direct fetches (`GOVCS='*:off'`, no `direct`);
   - auth commands and credential helpers (`GOAUTH=off`);
   - cache programs (`GOCACHEPROG` empty);
   - another Go toolchain (`GOTOOLCHAIN=local`).

   What it costs: modules no unauthenticated proxy serves, and packages that
   need cgo, get fallback links.

2. **May indexing download modules, and through what?**
   - Recommended: **offline-first** — never download, report missing modules
     as missing (`GOPROXY=off`). It gives identical links when the user's
     module cache is warm, and failed packages (0.4% of restic's links
     definite) when it is cold.
   - Alternative: a **module proxy only**, over HTTP, checked against
     `go.sum` (93 modules, 1.03 GB for restic), with no `direct` and no
     auth.
3. **cgo** (three choices, measured in part H):
   - **(i) `CGO_ENABLED=0`, recommended:** cgo files are not in the
     configuration. Packages needing them fail, and their importers are
     unverified. Nothing runs, and restic stays 100% definite.
   - **(ii) FakeImportC,** with every faked-C package and its importers
     unverified: wrong links are possible otherwise, and on restic this
     leaves 3.3% of links definite.
   - **(iii) real cgo processing:** exact, but it runs gcc, cc1, as and ld
     with project-controlled `#cgo` flags, contrary to decision 1.
4. **Configurations.** Index the host configuration only, or a set that covers
   all files (six for restic, about six times the cost)? Either way, links are
   keyed by configuration. A callee that differs between configurations is a
   set labelled by configuration, never several definite links.
5. **What indexing may read and write outside the snapshot.** Project files
   can come from the snapshot alone: restic overlaid into an empty directory
   gave identical records.
   - **Read:** the module cache (immutable, keyed by version and `go.sum`);
     `GOROOT`, including `$GOROOT/go.env`; local `replace` / `go.work`
     targets unless overlaid.
   - **Not read:** the user's go env file (`GOENV=off`).
   - **Written:** a build cache, which `go list -test` requires.
     Recommended: a private one under `.pymtheg/` (5.7 MB for restic).

   The re-index cache key must cover every non-immutable file the loader
   read, plus the effective configuration. In the closed environment that
   is the helper's settings plus the go installation; `go env` alone
   misreported an unset `GOAMD64` here.

   Is this acceptable?

Not measured: other projects, gopls, `x/tools/go/packages`, implementer sets
for calls in test packages, private module proxies, what git does after a
successful `ls-remote`, a project whose own packages need cgo, and breakages
beyond the 340-mutation sweep.

Checks: see the pull request.
