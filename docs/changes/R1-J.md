# R1-J: true docs and honest MCP surfaces

The R1-G trials (two agents, MCP only, on restic and ripgrep) met faults in the
shipped documentation and in MCP replies. Each item below was reproduced against
the built product first (`evidence/r1-j/repro.mjs`, run on the dev server over
real stdio MCP on an uninitialised Go + Rust fixture), then changed and tested.
No language module or resolver logic changed.

## A. Shipped docs that were false

**True before.** `docs/support.md` said no command, MCP tool or Studio screen
uses the code graph, that nothing runs a toolchain, that the Go module is
no-toolchain with nothing running `go`, that the toolchain route, automatic
sync and the MCP surface for the graph were "later", that requirement-link MCP
tools were not built, and that old layouts are refused (they refuse nothing;
`docs/project-init.md` was right). `docs/mcp.md` called requirement-to-Go/Rust
links "a later chunk", said no symbol-link mutation is provided, mentioned
"future symbol-link tools" and described `read_source` as reading "bounded
source lines". `docs/agent-workflow.md` (the `pymtheg://language/guide`
resource) sent agents to a `source_contract` tool (it is a `read_architecture`
section) and said the server never saves planning changes. No shipped doc
described `pymtheg graph`; the README did not mention the graph or links.
`docs/studio.md` spoke of missing backends.

**Changed.** Each statement above is corrected. `docs/support.md` gains a matrix
row for the code graph and requirement links and a section "Graph commands and
the Go toolchain route" (the CLI syntax, sync, selectors, near matches, class
counts, and the opt-in with its real setting and states); "Not built yet" now
lists only what is not built (Rust toolchain links, `go.work` in the Go route,
the model join, the explore query, a Studio graph screen, Lua). The README describes `pymtheg graph`, `pymtheg link` and the code
guide. `docs/project-init.md` describes the first-write initialisation (E).
All ten shipped docs and the README were read against the product; the
other statements checked (commands, flags, example files, test names, limits)
are true. Dated history ("Review-36 … 1,100 local tests", "348 tests") is left
as dated history.

**Tested.** `test/shipped-docs-names.test.mjs` reads the package's real doc
list and the server's `tools/list`. It fails when a shipped doc names a tool
that does not exist, found by these patterns only: `call("x")` and
`refuse("x")`; `**x_y**`; `` `x_y` tool(s)``; "the x_y tool" with or without
backticks; backticked snake_case words after "MCP" or "tool(s)"; in any shipped
doc, a backticked snake_case word that shares its first or last word with a
tool name (`graph_results`, `read_sources`) unless it is a value the tool
schemas take (a property name or enum value); and, in the three agent guides
(`agent-workflow.md`, `code-guide.md`, `mcp.md`), every backticked snake_case
word that is not a tool, an action value or a schema property, or a section
value in a sentence that says "section". It checks itself on the original
`source_contract` sentence and on `graph_results` / "the requirement_link
tool". A tool named in prose without backticks and without the word "tool"
is not caught. A second test fails when a shipped doc names a `pymtheg`
command, a `pymtheg graph` action (read from the CLI's own help text) or a
`pymtheg link` subcommand (read from its usage text) the CLI does not have.

## B. MCP resources said nothing about code

**True before.** Only `pymtheg://language/guide` and `pymtheg://language/syntax`
existed; neither mentions `code_graph`, `requirement_links`, selector forms or
result sections. Selector behaviour reproduced: `SearcherBuilder::new` not
found, `impl SearcherBuilder::new` found; `impl<T: Clone> Wrap<T>::get` not
found because the recorded identity is `impl<T:Clone> Wrap<T>::get` (no
spaces); Go methods are `(*Store).Put`, `(Box).Get`, `Getter.Get`, with no
package name; a trait-method implementation is `impl Sink for Counter::sink`.

**Changed.** New shipped doc `docs/code-guide.md`, served as the resource
`pymtheg://code/guide` and named in the server instructions: one worked session
(index, status, search, symbol, callers/callees, reading `answer`, `links`,
`symbols`, `possible_callers`, `candidates`, `legend`, `detail`), a measured
selector table for Go and Rust, certainty labels and match kinds, default and
maximum limits and how to raise them, requirement create/add/check/refresh/
requirements_for/unlinked with per-action arguments, and the Go toolchain route.
The route cannot be turned on over MCP: no tool writes `.pymtheg/settings.json`;
the guide says so plainly and gives the edit
(`"graph": {"toolchain": {"go": true}}`, or an absolute path to `go`).

A selector that selects nothing now answers with up to five near matches,
never selected (`src/graph/command-queries.ts`, about 30 lines): symbols whose
identity, written without `impl`, generic arguments, a `Trait for` prefix,
receiver punctuation or spaces, ends with the input written the same way, else
symbols with the input's last name. MCP shows them as `type: "near-match"`
rows in `answer` and `summary.query.inputs[].nearMatches`; the CLI prints
"Near matches (not selected)"; `requirement_links add` names them in its
not-found message.

**Tested.** `test/mcp-code-guide.test.mjs` runs every `// verified-mcp` block of
the guide in order over real stdio MCP in a folder that was never initialised,
checks the served resource equals the file, and checks every tool and action the
guide names exists (and that its argument table lists exactly the
`requirement_links` actions). Every `// =>` comment was copied from the replies
of that run (logged with `R1J_GUIDE_LOG`). On the dev server, where Go 1.27.4 is
on `PATH`, the route reported `state: "used"`, 1 clean package, 8 confirmed
links; the test accepts `used` or `unavailable` so it does not depend on the
machine having Go. `test/mcp-honesty.test.mjs` checks near matches over MCP and
in CLI text.

The selector table also gives a Rust inline module's prefix
(`inner::impl Deep::go_deep`) and a file module's absence of one
(`impl Shallow::go_shallow`), both run in the guide (review round 1).

## C. `read_source`

**True before.** It reads only `.pym` files; its description said "source
lines within this project"; a Go file was refused with "Only specification
source files are allowed".

**Changed.** Description: reads one Pymtheg design file (`.pym`); does not read
code or other files; use your own file tools and ask `code_graph` about code.
Refusal: "read_source reads Pymtheg design files (.pym) only, and main.go is not
one. Read code and other files with your own file tools; ask code_graph about
Go, Rust and TypeScript/JavaScript code." Not extended to code files.

**Tested.** `test/mcp-honesty.test.mjs` (C).

## D. `requirement_links` arguments by action

**True before.** `refresh` refused `note` and `unlinked` refused `file` with
"`note` is not accepted by refresh", while the shared schema offers both.

**Changed.** The second option: the tool description lists each action's
arguments, and a refusal names what the action accepts, for example "note is not
accepted by refresh. refresh accepts link, plus wait, section, limit and
noSync." `note` on refresh was not accepted: the link's note would be replaced
by a refresh, which is a new meaning, not a slip. Review round 1: `symbolLimit`
had a default and was silently accepted by every action, so the description's
"others are refused" was false; it now has no schema default, is refused by
every action but `unlinked` (where it defaults to 200), and its schema says so.

**Tested.** `test/mcp-honesty.test.mjs` (D and H) and the guide.

## E. Writes into an uninitialised project

**True before.** `requirement_links requirement` in a folder with no
`.pymtheg/project.json` created `.pymtheg/shared/architecture.sqlite` and
`.pymtheg/local/writer.json` and nothing else; `git status` showed the
database; `project_info.workspace` stayed null. The CLI link commands use the
same library and did the same.

**Chosen and changed.** Initialise, reusing the init routine: init needs no
choice an agent must make (the name defaults to the folder, documentation import
is opt-in). `initializeBeforeWrite(root)` (`src/project/workspace.ts`) runs
`initializeWorkspace` when the folder has no marker; it is called before every
planning write in `src/architecture/code-links.ts` (so the CLI and MCP behave
the same) and, through `StudioService.initializeOnFirstWrite` (set by the MCP
workspace and by `createRequirement`), before the first architecture write of
`observe_implementation`, `link_implementation` and the other architecture
writes. Studio itself is unchanged. Old-layout folders still refuse nothing, as
for init. A graph index alone initialises nothing. `project_info` now reports
`initialised` and, when false, a plain `initialisation` sentence. The record
field `document: "architecture/plan.json"` is unchanged: it names the native
plan document inside the planning database, which the guide now says is not a
file on disk.

**Tested.** `test/mcp-honesty.test.mjs` (E, MCP): before, `initialised:false`;
after a graph index, still false; after `requirement`, `.gitignore` and
`settings.json` are byte-identical to a fresh `pymtheg init`, the workspace is
named after the folder, and a legacy `.pymtheg-architecture/` changes nothing.
(E, CLI): `pymtheg link requirement` creates the marker and ignore file. The
guide test checks `git status` shows exactly `.pymtheg/.gitignore`,
`project.json` and `settings.json`.

## F. Possible-caller totals

**True before.** `callers` counted classes over at most `limit` items: MCP
(limit at most 100) reported `unresolved: 100, countsTruncated: true` where the
CLI (default limit 1,000) reported 441 in the trial. Reproduced on a fixture
with 150 possible callers: MCP at limit 20 reported `unresolved: 20`.

**Changed.** `callers` reports class totals whatever the item limit:
`definite` and `candidateSet` are exact, from one indexed count query
(`SqliteGraphStore.incomingCallCounts`, the same rows as the callers list);
`unresolved` is counted up to 1,000 or the limit, whichever is larger
(`CALLER_COUNT_BOUND`); `countsTruncated` means there are more possible callers
than the bound (exactly 1,000 gives `unresolved: 1000`, `countsTruncated: false`);
`countBound` reports it. (Round 1 of review found the first version counted
definite and candidate-set calls together against one bound of 1,000: 600 + 600
callers reported 499 + 501. Reproduced, then fixed as above.) Items stay bounded by `limit` (`summary.truncated`
unchanged). CLI text now reads "Call classes (totals)". Impact's per-frontier
counts are unchanged.

**Tested.** `test/mcp-honesty.test.mjs` (F): MCP at limit 20 reports
`unresolved: 150`, `countsTruncated: false`, a 20-item page; the CLI's JSON
reports the same 150. A TypeScript fixture with 600 definite and 600
candidate-set callers reports 600 and 600, `countsTruncated: false`, over MCP
and the CLI. Existing `test/graph-command-review.test.mjs` counts
still pass.

## G. Misleading messages

| Before | After |
| --- | --- |
| `emit_implementation_check` on a passed run whose typed model expired: "Check a design without errors…" | "The typed model for this run is no longer retained (only the three newest are kept). Check the design again and use the new runId." (a run with errors names how many) |
| `unlink_implementation` on a link that never existed: "That implementation link is no longer present." | "No implementation link joins plan:R1 to NODE in the current revision; nothing was removed. List current links with read_implementation." |
| `emit_scaffold` on a machine-only design with no errors: "the design has errors or omitted declarations" | "Partial contract baseline: 1 declaration is omitted from it (Counter: Behavioural machines are specifications, not callable implementation contracts.)…" (each reason named; `complete` unchanged) |
| `link_implementation` with no observation at all: "Code observation changed…" | "No code observation is retained in this project yet. Capture code with observe_implementation, then choose a declaration from read_implementation before linking." (a changed observation keeps the old message) |
| `try_inputs` on a machine: "Choose a unique structured flow." | "“Counter” is a machine. try_inputs runs one structured flow (a flow declaration) with its inputs; explore machines with explore_behaviour (simulate or verify)." (and separate messages for no such flow and several flows) |

**Tested.** `test/mcp-honesty.test.mjs` (G) asserts each new text exactly.

`matchKind: "target-hint"` on a name-only match: **left, noted for R1-K.** The
label is computed correctly from stored data: it means the Rust module recorded
this symbol among a call's would-be targets (`data.targets`). Reproduced:
`e.run()` with `E: Runner` lists `impl Engine::run` as a would-be target though
`Engine` does not implement `Runner`; the would-be targets themselves are
chosen by name in the Rust resolver, so the fix belongs there.

## H. `project_info.totalFiles`

**True before.** `files`, `totalFiles` and `matchingFiles` count `.pym` design
files; a Go project with no designs reports 0.

**Changed.** The tool description says so and points to `code_graph status`
for code files. **Tested.** `test/mcp-honesty.test.mjs` (D and H).

## Other changes

- Server instructions name both resources and say which tools write metadata.
- `package.json` ships `docs/code-guide.md` (eleven shipped docs);
  `test/package-contents.test.mjs` lists it.
- `docs/decisions.md`: the first-write initialisation and callers' totals.

## Review round 1: `docs/support.md` code-graph audit

Both reviewers found further stale `support.md` sentences by running the
installed package (module version numbers; an unpatched Rust grammar and an
unbuilt vendored one; cross-crate exported macros unresolved; TypeScript syntax
failures never cached). After fixing those, every factual claim of the code
graph part of `support.md` was checked once more, section by section, either by
a run of `evidence/r1-j/support-audit.mjs` (the built CLI's `graph … --json` on
small projects; 62 claims, all passing after the corrections below; output in
`evidence/r1-j/support-audit.jsonl`) or by pointing at code or tests.

| Section | How checked | Result |
| --- | --- | --- |
| Code graph (consumers, store, `.codegraph/`, discovery) | run: `general/*` (modules discovered are go, rust, typescript; `.codegraph/` not claimed); store schema 3 and refusal: `src/graph/store.ts` (schema check on open) | true. Module version numbers removed from the headings: every graph answer reports them (`modules`), so the doc no longer states numbers that go stale (Go was 23 in the doc, 25 in code; Rust 23/26; TypeScript 16/17). `test/shipped-docs-names.test.mjs` fails if a shipped doc states `module version N` |
| Link outcomes table | run: open Go sets carry `data.open` reasons; failed links carry `reason: "invalid-code"`, `cause.files`; Rust `uncertainty`; the 16 would-be targets: `TARGET_HINT_LIMIT` in `src/graph/languages/rust/index.ts` | true |
| Unreadable code is failed | run: a broken Go file is listed failed with no symbols; a call into its package is `invalid-code` with the file as cause | true |
| Failure caching | run: a broken Go file and a broken TypeScript file each index twice, `indexed` then `unchanged`, still failed; code: `src/graph/indexer.ts` (analyze-only results cached when `failureKind: "content"`) | **corrected**: TypeScript content failures are cached; other analysis failures are not |
| Internal errors | code and tests: `test/graph-typescript-crash.test.mjs`, `test/graph-core-robustness*.test.mjs` | true |
| Go | run: package-qualified call, concrete receiver, promotion, in-module import (definite); interface dispatch, reassigned function local, build variants (candidate sets, open); `implements` unresolved with `interfaceId`; builtins, standard library, unexported names of another package, generic-method instantiation, cgo `import "C"` (unresolved); locals not symbols; package symbol; `{; G() }` fails the file | **corrected**: a name-only set needs two or more project methods of the name and an unknown receiver type; a receiver of a standard-library type is unresolved. The rest is true. Not run: elements of function containers, `new(variable).M()`, `go.work`, `vendor/` (code: `src/graph/languages/go/resolve.ts`) |
| Go grammar | run (`{; G() }` fails); manifest and `test/grammar-vendored.test.mjs` | true |
| Rust | run: associated call, path call, re-export, `mod`, `impl Trait for`, owned and `&self` dot calls on parameters (definite); annotated `let` + `&self` (later probe step), unannotated `let` (receiver unverified), opaque attribute, standard library (unresolved); statement macro withholds, `crate::` still resolves, expression macro and `println!` withhold nothing | **corrected**: a `#[macro_export]` macro of another project crate resolves by path, `use` and `#[macro_use] extern crate` (run); only macros of crates outside the project are unresolved (run: `serde_json::json!`). One sentence changed; Rust rows otherwise untouched (R1-K edits them) |
| Rust grammar | run: nine constructs, each in its own file; `grammars/rust/manifest.json`, `grammars/README.md`, `docs/changes/W2-V.md` | **corrected**: patched v0.24.2 (six upstream PRs, two own patches); `&raw`, `unsafe extern` with `safe fn`, `#[cfg]` in patterns read; stacked parameter attributes, closure-parameter attributes, primitive-named turbofish and `impl A + for<'a> B<'a>` still fail (run) |
| TypeScript and JavaScript | run: eleven files of all eight extensions claimed, none failed; barrel `export *`, rename, default export, heritage, `new`, JSX, literal `require` (definite); computed `require`, standard library (`external`), `node_modules` import (`external-package`) (unresolved); duplicate JavaScript functions (candidate set); uncaptured `extends` (partial, `incomplete-config`); a failed file adds `assumes: ["no-unseen-declarations"]`; `let let = 1` in `.js` stays clean | true. Not run: pnpm workspaces, AMD, module augmentation, compiler stack limits (code and W2-D tests) |
| Graph commands and Go toolchain route | code: `src/graph/commands.ts` (depth default 5, max 100; limit default 1,000, max 10,000; `status` read-only); run: `status` does not index; route off with no setting; `unavailable` for no `go.mod`, `go.work` and a missing `go`; `used` with Go 1.27.4 (guide run) | true |
| Not built yet | code: no Rust toolchain route, no Studio graph screen | **corrected**: the vendored Rust grammar is built and was removed from the list |
| Requirement links | tests: `test/code-links.test.mjs`, `test/link-baseline*.test.mjs`, `test/graph-link-index.test.mjs`, `test/mcp-links.test.mjs`; the 30 s writer wait: `writerWaitMs` in `src/storage/local.ts` | true |

Callers' class counts (Opus round 1): the first version counted definite and
candidate-set callers together against one bound (600 + 600 reported as 499 +
501, reproduced); now exact per class (see F).

## Left, and why

- `read_source` for code files, `note` on refresh, an MCP tool that changes
  settings or runs init on demand: out of this chunk.
- Impact's per-frontier possible-caller counts stay capped at the limit.
- `target-hint` labels from name-chosen Rust would-be targets: R1-K.
- Studio's "Connect agent" text and Studio's own implementation-check message
  were not changed (not MCP).

## Checks run (dev server, commit f45e57bc plus evidence)

- `npm test`: 2,827 tests, 2,827 pass, 0 fail (main: 2,814; 13 added).
- `npm run format:check` and `node scripts/licences/inventory.mjs --check`: pass.
- `npm pack`: 832 files, 1.9 MB, ships `docs/code-guide.md`; the production
  install smoke (`evidence/r1-h/tarball-smoke.mjs`): `ok: true`, 11 packages.
- Acceptance gate: verdict pass, 466 pass, 10 observed, 23 expected-fail, the
  same counts as R1-F on main; no gate expectation needed changing
  (`evidence/r1-j/acceptance-latest.md`). Self-test: every sabotage caught;
  cleanup test ok, no containers left (`evidence/r1-j/acceptance-selftest.md`).
- `evidence/r1-j/repro.mjs` output after the change: `evidence/r1-j/repro-after.jsonl`.

Review round 1 fixes, on a normal merge of main (LIC-2): `npm test` 2,831
tests, 2,831 pass, 0 fail; format check, `node scripts/spdx-tags.mjs --check`
and the licence inventory check pass; `npm pack` 832 files, 1.9 MB. The
acceptance gate was not re-run for these fixes (its MCP and CLI caller
assertions compare caller sets, not class counts).

Review round 2 (docs only, no code or test changes): `countsTruncated` is
described as "more possible callers than the bound" in the guide, `support.md`,
`mcp.md`, `decisions.md` and this note (exactly 1,000 report
`countsTruncated: false`); `support.md` says the Go toolchain setting is a key
added to the existing `settings.json` (a file with only that key is
`settings-unreadable`) and links the guide's full example.
