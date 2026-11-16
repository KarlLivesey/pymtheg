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
the model join, the explore query, a Studio graph screen, Lua, a vendored Rust
grammar). The README describes `pymtheg graph`, `pymtheg link` and the code
guide. `docs/project-init.md` describes the first-write initialisation (E).
All ten shipped docs and the README were read against the product; the
other statements checked (commands, flags, example files, test names, limits)
are true. Dated history ("Review-36 … 1,100 local tests", "348 tests") is left
as dated history.

**Tested.** `test/shipped-docs-names.test.mjs` reads the package's real doc
list and the server's `tools/list`. It fails when a shipped doc names a tool
that does not exist: `call("x")`, `**x**`, `` `x` tool``, "MCP `x`", and, in the
three agent guides, any backticked snake_case word that is not a tool, an
action value, a schema property, or a section value in a sentence that says
"section". It also proves it catches the original `source_contract` sentence.
A second test fails when a shipped doc names a `pymtheg` command, a
`pymtheg graph` action or a `pymtheg link` subcommand the CLI does not have.

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
by a refresh, which is a new meaning, not a slip.

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

**Changed.** `callers` counts `definite`, `candidateSet` and `unresolved`
totals up to 1,000 or the limit, whichever is larger (`CALLER_COUNT_BOUND`),
whatever the item limit; `countsTruncated` means a total reached that bound;
`countBound` reports it. Items stay bounded by `limit` (`summary.truncated`
unchanged). CLI text now reads "Call classes (totals)". Impact's per-frontier
counts are unchanged.

**Tested.** `test/mcp-honesty.test.mjs` (F): MCP at limit 20 reports
`unresolved: 150`, `countsTruncated: false`, a 20-item page; the CLI's JSON
reports the same 150. Existing `test/graph-command-review.test.mjs` counts
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
