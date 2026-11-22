# Code graph and requirement links through MCP

This guide is the MCP resource `pymtheg://code/guide`. It is one worked
session: index a small Go and Rust project, ask about symbols and callers, then
link a requirement to code and keep the link honest. Every `js` block below is
run in order against the product by `test/mcp-code-guide.test.mjs`;
`call(name, args)` sends MCP `tools/call` and returns `structuredContent`,
`write(path, text)` is an ordinary file edit by the agent (not an MCP tool) and
`expect(condition)` checks the stated result. Comments marked `// =>` show
fields of the actual reply.

Two tools answer code questions: `code_graph` starts a question and
`graph_result` reads further pages or a job that is still running. Two tools
handle requirement links: `requirement_links` and `link_result`. Code is Go,
Rust or TypeScript/JavaScript. Pymtheg never edits code; `read_source` reads
only Pymtheg design files (`.pym`), so read code with your own file tools.

## The example project

The session starts in a folder that was never initialised (no
`.pymtheg/project.json`):

```js
// verified-mcp
await write("go.mod", "module example.test/shop\n\ngo 1.22\n");
await write("store.go", [
  "package shop",
  "",
  "type Store struct{ items map[string]int }",
  "",
  "func NewStore() *Store { return &Store{items: map[string]int{}} }",
  "",
  "func (s *Store) Put(name string, n int) { s.items[name] = n }",
  "",
  "type Box[T any] struct{ v T }",
  "",
  "func (b Box[T]) Get() T { return b.v }",
  "",
  "type Getter interface{ Get() int }",
  "",
  "func Restock(s *Store) { s.Put(\"apple\", 3) }",
  "",
].join("\n"));
await write("Cargo.toml", "[package]\nname = \"shop\"\nversion = \"0.1.0\"\nedition = \"2021\"\n");
await write("src/lib.rs", [
  "pub struct SearcherBuilder { lines: bool }",
  "",
  "impl SearcherBuilder {",
  "    pub fn new() -> SearcherBuilder { SearcherBuilder { lines: false } }",
  "    pub fn build(&self) -> bool { self.lines }",
  "}",
  "",
  "pub struct Wrap<T> { v: T }",
  "",
  "impl<T: Clone> Wrap<T> {",
  "    pub fn get(&self) -> T { self.v.clone() }",
  "}",
  "",
  "pub trait Sink { fn sink(&mut self, n: u32); }",
  "",
  "pub struct Counter { total: u32 }",
  "",
  "impl Sink for Counter {",
  "    fn sink(&mut self, n: u32) { self.total += n; }",
  "}",
  "",
  "pub fn search() -> bool { SearcherBuilder::new().build() }",
  "",
  "pub fn feed<S: Sink>(s: &mut S) { s.sink(1); }",
  "",
  "mod inner {",
  "    pub struct Deep;",
  "    impl Deep { pub fn go_deep(&self) {} }",
  "}",
  "",
  "mod outer;",
  "",
].join("\n"));
await write("src/outer.rs", "pub struct Shallow;\n\nimpl Shallow { pub fn go_shallow(&self) {} }\n");
const info = await call("project_info", {});
expect(info.initialised === false && info.workspace === null);
// => initialised: false, initialisation: "This project is not initialised: …"
expect(info.totalFiles === 0);
// => totalFiles: 0 — project_info counts design files (.pym) only, never code.
```

## Index and status

`code_graph` returns its first page inline when the job finishes within five
seconds; otherwise it returns `state: "running"` and a `jobId` for
`graph_result`. Always handle both shapes. Queries sync changed files by
content automatically, so `index` is only needed to pay the cost up front;
`status` never indexes.

```js
// verified-mcp
async function graph(args) {
  const first = await call("code_graph", args);
  return first.state === "running"
    ? call("graph_result", { jobId: first.jobId, wait: true })
    : first;
}
const indexed = await graph({ action: "index" });
expect(indexed.state === "complete" && indexed.summary.sync.complete === true);
expect(indexed.summary.counts.files === 3 && indexed.summary.counts.failed === 0);
const modules = await graph({ action: "search", query: "go_" });
expect(modules.items.map((s) => s.qualifiedName).join() === "inner::impl Deep::go_deep,impl Shallow::go_shallow");
// => an inline module prefixes its path (inner::); a file module (mod outer; in src/outer.rs) adds none.
// => summary.counts: { files: 3, failed: 0, … } (symbols, links, unresolved, …)
const status = await graph({ action: "status" });
expect(status.summary.indexExists === true && status.summary.failedFileCount === 0);
```

A file the parser cannot read is a *failed file*: it is named in every reply's
`failedFiles` preview and in section `failed_files`. An answer that touches a
failed file is incomplete; repair the file first.

## Search, then select one symbol

`search` matches part of a name or qualified name (ASCII case-folded unless
`caseSensitive: true`). Every symbol row carries `ref` (a stable
`symbol:<64 hex>` reference), `name`, `qualifiedName`, `kind`, `language` and
`at` (`file:line:column`).

```js
// verified-mcp
const found = await graph({ action: "search", query: "get" });
const names = found.items.map((s) => s.qualifiedName);
expect(names.includes("(Box).Get") && names.includes("Getter.Get"));
expect(names.includes("impl<T:Clone> Wrap<T>::get"));
// => items: [{ qualifiedName: "Getter.Get", language: "go" }, { qualifiedName: "(Box).Get" }, { qualifiedName: "impl<T:Clone> Wrap<T>::get", language: "rust" }, …]
```

`symbol`, `callers`, `callees`, `impact` and `path` take a *selector*. A selector
is one of: the exact `ref`; the exact name, if only one symbol has it; the exact
qualified name as the graph records it; or `path:line[:column]`. Qualified names
are written as follows (all measured on this project):

| Language | Declaration                         | Selector that works            |
| -------- | ----------------------------------- | ------------------------------ |
| Go       | function `NewStore`                 | `NewStore`                     |
| Go       | method on `*Store`                  | `(*Store).Put`                 |
| Go       | method on generic `Box[T]`          | `(Box).Get`                    |
| Go       | interface method                    | `Getter.Get`                   |
| Rust     | inherent method                     | `impl SearcherBuilder::new`    |
| Rust     | method in a generic impl            | `impl<T:Clone> Wrap<T>::get`   |
| Rust     | trait method declaration            | `Sink::sink`                   |
| Rust     | trait method implementation         | `impl Sink for Counter::sink`  |
| Rust     | method in an inline `mod inner { … }` | `inner::impl Deep::go_deep`  |
| Rust     | method in a file module (`mod outer;`) | `impl Shallow::go_shallow`  |
| Any      | a declaration's line                | `store.go:7`, `src/lib.rs:4:12` |

Go qualified names carry no package name. A Rust inline module prefixes its
path (`inner::`); a file module adds no prefix. Rust generic parameters are written
exactly as recorded, with no spaces (`impl<T:Clone>`, not `impl<T: Clone>`).
A plain `Type::method` is not a Rust selector: it selects nothing, and the reply
lists *near matches* instead (never selected for you):

```js
// verified-mcp
const near = await graph({ action: "symbol", query: "SearcherBuilder::new" });
expect(near.summary.status === "not-found");
expect(near.items[0].type === "near-match" && near.items[0].qualifiedName === "impl SearcherBuilder::new");
// => summary.status: "not-found", items: [{ type: "near-match", qualifiedName: "impl SearcherBuilder::new", at: "src/lib.rs:4:5" }]
// => summary.query.inputs[0].nearMatches: ["impl SearcherBuilder::new"]
const spaced = await graph({ action: "symbol", query: "impl<T: Clone> Wrap<T>::get" });
expect(spaced.items[0].type === "near-match" && spaced.items[0].qualifiedName === "impl<T:Clone> Wrap<T>::get");
for (const selector of ["impl SearcherBuilder::new", "impl<T:Clone> Wrap<T>::get", "Sink::sink", "impl Sink for Counter::sink", "inner::impl Deep::go_deep", "impl Shallow::go_shallow", "(*Store).Put", "(Box).Get", "Getter.Get", "store.go:7"]) {
  const one = await graph({ action: "symbol", query: selector });
  expect(one.summary.status === "ok" && one.items.length === 1 && one.items[0].type === "selected");
}
const many = await graph({ action: "symbol", query: "Get" });
expect(many.summary.status === "ambiguous" && many.items.every((r) => r.type === "selection" && r.ambiguous));
// => a name with several symbols lists them all as type "selection", ambiguous: true; choose one by ref.
```

## Callers, callees and how to read the answer

Every completed reply has the same shape: `summary` (status, sync, project
counts, truncation, `query`), the requested `section` with `items`, `total` and
`nextOffset`, and `failedFiles`. The default section `answer` lists what the
question selected; for `callers` and `callees` the calls themselves are in
section `links`, and calls that might reach the symbol but were not resolved are
in section `possible_callers`. The `answer` page also carries `previews` (the
first row of `symbols`, `links`, `possibleCallers` and `failedFiles`).

Every call has a certainty:

- `definite`: the graph found exactly this target.
- `library`: the target is a library outside this project; the row's `library`
  field names its ecosystem, unit and (when proven) symbol. It is not a missing
  local symbol. `code_graph` action `uses` (`query` a unit, optional `symbol`)
  lists the project's links to one. No production language records these yet.
- `candidate-set`: one of several listed targets (`candidateCount`); read
  section `candidates` with `ref` set to the link's `ref`. Never pick one. A
  candidate may be a library (a `library` field instead of a `symbol`).
- `unresolved`: the target is unknown. When it might be this symbol it appears
  under section `possible_callers` with `matchKind` `target-hint` (the language module
  recorded this symbol as a would-be target), `receiver-qualified` (the written
  receiver type matches) or `name-only` (only the name matches; other types
  share it). A possible caller is a suggestion, never a call.
- `decidedBy: "toolchain"` marks a link the Go toolchain route decided (below).

```js
// verified-mcp
const callers = await graph({ action: "callers", query: "impl SearcherBuilder::new" });
const links = await call("graph_result", { jobId: callers.jobId, section: "links" });
expect(links.items.length === 1 && links.items[0].certainty === "definite");
expect(links.items[0].at === "src/lib.rs:22:27");
// => links: [{ certainty: "definite", kind: "calls", at: "src/lib.rs:22:27", source: "symbol:…" }]
const caller = await call("graph_result", { jobId: callers.jobId, section: "symbols", ref: links.items[0].source });
expect(caller.items[0].qualifiedName === "search");
expect(callers.summary.query.classCounts.definite === 1);
// => summary.query.classCounts: { definite: 1, candidateSet: 0, unresolved: 0 }

const sink = await graph({ action: "callers", query: "impl Sink for Counter::sink" });
expect(sink.summary.query.hasPossibleCallers === true && sink.summary.query.classCounts.definite === 0);
const possible = await call("graph_result", { jobId: sink.jobId, section: "possible_callers" });
expect(possible.items[0].certainty === "unresolved" && possible.items[0].targetName === "s.sink" && possible.items[0].at === "src/lib.rs:24:35");
// => possible_callers: [{ certainty: "unresolved", targetName: "s.sink", matchKind: "target-hint", at: "src/lib.rs:24:35" }]
// An empty links list with hasPossibleCallers: true does not mean "nobody calls this".

const callees = await graph({ action: "callees", query: "Restock" });
const out = await call("graph_result", { jobId: callees.jobId, section: "links" });
expect(out.items.some((l) => l.certainty === "definite" && l.targetName === "s.Put"));
```

`classCounts` are totals whatever the item `limit`: `definite` and
`candidateSet` are exact counts of the stored calls; `unresolved` counts
possible callers exactly up to 1,000 (or the `limit`, if larger); when there
are more than that bound, `unresolved` shows the bound and
`countsTruncated: true` says it is a lower bound (`countBound` gives the
bound). Exactly 1,000 possible callers report `unresolved: 1000` with
`countsTruncated: false`. Section `legend` expands reason codes such as `r1` in `reasons`;
section `detail` with a `ref` returns the exact stored JSON.

## Limits and how to raise them

| What                                          | Default | Maximum                    |
| --------------------------------------------- | ------- | -------------------------- |
| `code_graph` `limit` (items the query keeps)  | 20      | 100                        |
| `code_graph` `depth` (`impact`, `path`)       | 5       | 100                        |
| `graph_result` `limit` (items per page)       | 20      | 100 (detail: 16,384 chars) |
| `requirement_links` / `link_result` `limit`   | 20      | 100                        |
| `requirement_links` `symbolLimit` (unlinked)  | 200     | 1,000                      |
| inline wait before a job handle is returned   | 5 s     | `wait: false` returns at once |

Raise `limit` on the `code_graph` call itself. When `summary.truncated` is true
the query kept only `limit` items and further pages cannot recover the rest:
ask again with a larger `limit` (up to 100) or a narrower selector. Replies are
capped at 64 KiB, so pages may hold fewer items than `limit`; always follow
`nextOffset`. The CLI (`pymtheg graph … --limit N`) takes up to 10,000.

## Requirements linked to code

`requirement_links` records that a requirement is implemented by a symbol and
later tells you when that symbol changed. The first planning write in a project
that was never initialised initialises it exactly as `pymtheg init` would
(`.pymtheg/project.json`, `.pymtheg/settings.json` and `.pymtheg/.gitignore`;
the planning database itself is ignored by Git). That write needs the answer
to init's question, whether the repository is trusted (decision D22):
`trust: "trusted"` lets the languages' official tools run on it, as building
it would, and `trust: "source-only"` means Pymtheg starts no program on its behalf, neither a build tool nor Git. Without it, the
call returns the question and initialises nothing; ask your user or follow
your standing instructions, then call again with `trust`.

Arguments by action (anything else is refused, naming what the action
accepts; `wait`, `section`, `limit` and `noSync` apply to all):

| Action             | Arguments                                         |
| ------------------ | ------------------------------------------------- |
| `requirement`      | `id`, `title` (both required), `text`, `owner`, `trust` |
| `add`              | `record`, `selector` (both required), `note`, `trust` |
| `remove`           | `link` (required)                                  |
| `refresh`          | `link` (required)                                  |
| `list`             | `record`, `symbol`, `file`                         |
| `check`            | `allowMoved`                                       |
| `requirements_for` | `symbol` or `file` (exactly one), `impact`, `depth` |
| `unlinked`         | `symbols`, `symbolLimit`                           |
| `history`          | none                                               |

```js
// verified-mcp
async function links_(action, args = {}) {
  const first = await call("requirement_links", { action, ...args });
  return first.state === "running"
    ? call("link_result", { jobId: first.jobId, wait: true, section: args.section ?? "items" })
    : first;
}
const asked = await call("requirement_links", { action: "requirement", id: "R1", title: "Restocking records the amount" }).catch((e) => String(e));
expect(asked.includes("Do you trust this repository?"));
// => the question comes back; nothing is initialised until it is answered.
const record = await links_("requirement", { id: "R1", title: "Restocking records the amount", trust: "source-only" });
expect(record.items[0].id === "plan:R1");
const after = await call("project_info", {});
expect(after.initialised === true && after.workspace.name.length > 0);
// => the project is now initialised; git status shows only .pymtheg/.gitignore, project.json and settings.json.
const added = await links_("add", { record: "R1", selector: "(*Store).Put", note: "Put stores the amount" });
expect(added.summary.status === "created" && added.items[0].symbol.identity === "(*Store).Put");
const linkId = added.items[0].id;
const notFound = await links_("add", { record: "R1", selector: "Store.Put" });
expect(notFound.summary.status === "selector-not-found" && notFound.summary.message.includes("(*Store).Put"));
// => message: "No symbol matches “Store.Put”. Near matches (not selected): “(*Store).Put” at store.go:7. Nothing was linked."
const clean = await links_("check");
expect(clean.summary.passed === true && clean.items[0].state === "ok");
```

Edit the linked code and `check` reports the link `changed` with what differs.
`refresh` accepts the current code after you have reviewed it; it never runs on
its own, and suggestions are never applied.

```js
// verified-mcp
await write("store.go", [
  "package shop",
  "",
  "type Store struct{ items map[string]int }",
  "",
  "func NewStore() *Store { return &Store{items: map[string]int{}} }",
  "",
  "func (s *Store) Put(name string, n int) { s.items[name] += n }",
  "",
  "type Box[T any] struct{ v T }",
  "",
  "func (b Box[T]) Get() T { return b.v }",
  "",
  "type Getter interface{ Get() int }",
  "",
  "func Restock(s *Store) { s.Put(\"apple\", 3) }",
  "",
].join("\n"));
const changed = await links_("check");
expect(changed.summary.passed === false && changed.items[0].state === "changed" && changed.items[0].differs.includes("body"));
// => items: [{ state: "changed", differs: ["body"], next: "Review current code, then explicitly refresh this link if accepted." }]
const refreshed = await links_("refresh", { link: linkId });
expect(refreshed.summary.status === "refreshed");
const forFile = await links_("requirements_for", { file: "store.go", impact: true });
expect(forFile.items.some((r) => r.record === "plan:R1"));
const unlinked = await links_("unlinked", { symbols: true, section: "symbols" });
expect(unlinked.items.some((s) => s.identity === "NewStore") && !unlinked.items.some((s) => s.identity === "(*Store).Put"));
// => section symbols lists public symbols no requirement links to.
const refused = await call("requirement_links", { action: "unlinked", file: "store.go" }).catch((e) => String(e));
expect(String(refused).includes("unlinked accepts symbols, symbolLimit"));
```

Check states are `ok`, `changed`, `moved` (unconfirmed until `refresh`, or
pass `allowMoved: true`), `ambiguous`, `missing` and `unverifiable` (a failed or unreadable
file). `summary.passed` is false when any link needs attention or the graph
could not verify every link. Links record reviewed intent, never proof that the
code meets the requirement. Requirement records live in the project's planning
database (`.pymtheg/shared/architecture.sqlite`) as entries of its native plan
document `architecture/plan.json`; that is not a file on disk.

## The Go toolchain route

By default nothing runs `go`: Go links come from the source alone. A checkout
that is **trusted on this machine** (decision D22) has its Go links checked with
the Go toolchain (`go list` and `go/types`), which runs the project's `go`
build configuration and is as trusted as building it. The answer is yours,
kept in your own Pymtheg configuration and never in a repository, so a cloned
repository is asked again. Nothing committed can turn the route on: a committed
`"graph": {"trust": "source-only"}` forbids it on every machine, and a committed
`"graph": {"toolchain": {"go": false}}` turns Go off; a tool path is honoured
only from your own answer file (`"toolchain": {"go": "/usr/local/go/bin/go"}`).

Over MCP, `summary.trust` says which applies: `trusted`, `source-only` or
`unanswered` (with `summary.trustAnswer` saying how to answer). On an
initialised checkout with no answer here, ask your user "Do you trust this
repository?" and pass `trust: "trusted"` or `"source-only"` to `code_graph`; an
existing answer is never changed. With the route on, `summary.toolchain`
reports it: `go.state` is `used` (with counts of links it upgraded, confirmed
or disagreed with), `unavailable` (with the reason, for example no `go.mod` at
the project root, a `go.work` workspace, or no `go` found) or `not-indexed`.
Go 1.22 or newer is required.

```js
// verified-mcp
const routed = await graph({ action: "symbol", query: "(*Store).Put" });
expect(routed.summary.trust === "source-only");
expect(routed.summary.toolchain === null);
// => this checkout was answered "source-only" by the first planning write above, so nothing runs.
```

`pymtheg trust` lists your answers and `pymtheg trust --revoke` removes one.
