# W2-L: can the Go build chain supply exact code-graph links, and at what cost?

Investigation only (round 2). Evidence, helper, scripts and raw outputs:
`evidence/w2-l/`. No product code, contract or support level changes.

## The answer

**Yes, for code that type-checks, one build configuration at a time, using
only the `go` command and the standard library, without running any project
code.** A standard-library helper (`go list` + `go/parser` + `go/types`) gives
exact callee locations for static calls, the interface method for dynamic
calls plus the implementers of the call's receiver interface among the types
of the packages loaded for that configuration (a type in an unloaded package,
another configuration or a dependent module is not seen), identifier →
declaration, import → directory and verified `implements` pairs.

On restic (one project; 26,535 call expressions counted by syntax in all 559
tracked files):

- **Static calls with an exact callee location:** 66.7% in one configuration
  (linux/amd64 with tests) and 71.8% over six configurations. In-project
  callees are 40.5% and 42.9%.
- **The rest:**
  - builtins: 8.4%;
  - conversions to predeclared types: 4.8%;
  - interface calls: 8.5%, where the interface method is located and the
    implementers are computed;
  - function values: 4.7%;
  - calls in files excluded by a configuration: 7.5% in one configuration,
    0.4% (`build.go`) in six.
- **Against the hand-written module** (as merged on `main`, module version
  20): every definite module link that both sides cover agrees by definition
  position. That is 11,771 resolved calls, 18,041 resolved references and
  1,296 resolved imports; 0 differ. No closed candidate set misses the
  toolchain's target. **No contract violation was found.**
- **What the toolchain adds:**
  - definite std and dependency callees, which the module leaves unresolved by
    design: 7,624 static function/method calls (28.7% of call sites), or
    7,712 (29.1%) with conversions to std/dependency named types;
  - verified `implements`: of the module's 276 unverified candidates, it
    refutes 59 and confirms 211, and it adds 24 pairs.
- **What the comparison also exposed** (none of it a contract violation):
  - by-design imprecision in the module's unverified and open sets: 348
    open interface-call sets carry candidates the toolchain refutes; 20 open
    sets miss one reachable method; 8 open by-name sets name only wrong
    targets;
  - one grammar gap: the module fails a valid file (`status_test.go`), so 30
    builtin calls in its package get an `invalid-code` cause that names a
    valid file.

Every toolchain link is true for one build configuration. One configuration
saw 507 of 559 files; six were needed for 558. 172 call sites have a
different callee in different configurations.

On broken code `go/types` keeps going, package by package. In seven broken
variants (syntax error, two type errors, package-clause conflict, import
cycle, duplicate declaration, missing modules), what was lost became "no type
information", with errors naming positions. No surviving link changed to a
different callee.

## One-minute table

Coverage: share of restic's 26,535 call expressions that are static function
or method calls with a definite callee at a known definition location
(in-project share in brackets). Conversions and function values are left out
for both.

| Option                                                               | Needs installed               | Runs project code / network                                                                                                                                                                                                                            | Coverage                                                                               | On broken code                                                                                                 | Cost (restic)                                             |
| -------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| (1) Hand-written module only (PR 12)                                 | nothing                       | no / no                                                                                                                                                                                                                                                | 41.9% (41.9%); no std or dependency targets; `implements` unverified (59 of 276 wrong) | the file with a syntax error contributes nothing; a valid file the grammar misreads fails too                  | 32 s, 1.6 GB (Node, whole project)                        |
| (2) Toolchain required for Go (standard-library helper, source mode) | `go`; modules downloaded once | no project code; `go list` only (plus one `cc -###` probe when cgo is on). Network: module download on the first run of each configuration (93 modules, 1.03 GB), and a toolchain download if `go.mod` asks for a newer Go, unless `GOTOOLCHAIN=local` | 66.7% (40.5%) one configuration; 71.8% (42.9%) six                                     | partial per package, errors with positions; nothing at all if `go list` fails (e.g. `go.mod` needs a newer Go) | 7–12 s, ~600 MiB per configuration; ×6 to cover all files |
| (3) Toolchain when present, hand-written module as fallback          | `go` optional                 | as (2) where used                                                                                                                                                                                                                                      | (2) where `go` works; (1) elsewhere                                                    | toolchain partial results; module for files and packages the toolchain cannot load                             | (2) + (1)                                                 |

The export-data variant of (2) is 3 s warm, but 35 s and 768 MB of build
cache cold. It compiles every dependency and runs the C compiler on cgo code,
including the project's own. It adds nothing measured here, so it is not
recommended.

## Recommendation: option 3 — toolchain when present, hand-written module as fallback

1. **Where `go` works, it matched or improved on every link both sides
   cover.** It matched every definite module link. It adds std and dependency
   targets, verified `implements` and implementer sets computed by the type
   checker (per configuration, over the loaded program), and it is the
   authority on what is a syntax error. What it does not give: links in files
   no configuration includes, and one answer across configurations (it needs
   a run per configuration).
2. **It does not need to execute project code** (measured: `go list` only, no
   compiler, no build step). So the open W2-K decision on running project code
   need not hold Go back, provided the product uses source mode and never
   export mode.
3. **The fallback is still needed:**
   - when `go` is missing;
   - when `go.mod` needs a newer Go than installed (with `GOTOOLCHAIN=local`);
   - when modules are not downloaded and the network is not allowed;
   - for files no configuration includes;
   - for a package `go list` cannot load as a whole (a package-clause
     conflict drops the package's other files).

   Option 2 alone leaves those with nothing.

What each option costs the user:

- (1): nothing to install; structure-level precision only.
- (2): `go` plus a one-time module download (on restic, 1 GB for one
  configuration); a run per configuration.
- (3): the same as (2) where `go` is used; nothing extra otherwise.

What (3) costs Pymtheg:

- two implementations;
- every link records its route and configuration;
- a toolchain link never overrides a module link silently.

**Decisions for Karl:**

1. **Network.** May indexing let `go list` download modules (as the user's own
   `go build` would), or must it run with `GOPROXY=off`, leaving calls into
   undownloaded modules unresolved with an error?
2. **Toolchain downloads.** Recommended: always `GOTOOLCHAIN=local`, so a
   `go.mod` can never make indexing fetch and run another Go. The cost is
   that such a module gets fallback links only.
3. **Configurations.** Index the host configuration only, or a set that covers
   all files (six for restic, about six times the cost)? Either way, links are
   keyed by configuration. A callee that differs between configurations is a
   set labelled by configuration, never several definite links.
4. **Snapshot rule (W1-C).** `go list -overlay` can supply the snapshot's
   project files, but dependencies and std are read from the module cache and
   `GOROOT`, and local `replace` targets and `go.work` modules may lie outside
   the indexed directory. Is reading outside the project acceptable? If so,
   the re-index cache key must cover the content of every such non-immutable
   file the loader read (taken from `go list -json`), not only the project's
   files: a measured repro shows a link change with every project file
   unchanged (`evidence/w2-l/README.md`, part G).

Not measured: other projects, gopls, `x/tools/go/packages`, implementer sets
for calls in test packages, private module proxies and `direct` VCS fetches.

Checks: see the pull request.
