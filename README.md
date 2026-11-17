<img src="assets/icon.svg" width="64" height="64" alt="">

# Pymtheg

Pymtheg is a local tool for planning and checking software designs and for
answering questions about existing code. You write a design in small `.pym`
files and Pymtheg checks it before any code exists. For TypeScript, Go and Rust
code it builds a call graph and keeps track of which requirement each piece of
code serves. A coding agent can drive all of it over MCP (the Model Context
Protocol, which coding agents use to call tools).

What it does today:

- **Designs and design documents.** Keep requirements, decisions and design
  documents with their revision history. Write `.pym` designs and check them for
  missing outcomes, resources that are never cleaned up, work multiplied by
  loops and retries, and the same rule copied in several places. Explore
  behaviour with a built-in exhaustive search (`verify`) or a seeded sampler
  (`simulate`: random runs that repeat exactly for the same seed), and follow
  each counterexample back to the design.
- **Code graph** for TypeScript/JavaScript, Go and Rust: search, callers, callees,
  paths between two symbols, and the impact of a change. Every call says how
  certain it is.
- **Requirement links** between requirements and code symbols. `link check`
  reports which links are still `ok` and which code has changed, moved or gone.
- **MCP server** (`pymtheg mcp`) so a coding agent can check designs, read
  findings and counterexamples, query the graph and manage requirement links.
- **Studio**, a local web workspace for designs, documents and requirements.
- **Scaffolds**: TypeScript, Rust or Go types and signatures from a checked
  design, with stubs that fail until you write the body.

## Why it exists

Someone changing code, person or agent, needs answers before the edit: what
calls this, what does a change here affect, and which requirement does this
code serve? Reading files by hand gives partial answers and no warning when
they are incomplete. Pymtheg answers from a graph of the whole project and says
which answers are certain.

A design is cheaper to fix than code. Pymtheg checks a design for the faults
that are expensive later: an error path that leaks a file, a retry that charges
a customer twice, a loop that makes 600 remote calls against a budget of 500.
The intended loop is short: write or generate a design, check it, read the
finding, correct it, check again, then write the code.

Requirement links keep the "why" next to the code. When the linked code
changes, moves or disappears, `link check` says so instead of the link silently
going stale.

## Who it is for

- Developers working on TypeScript/JavaScript, Go or Rust code who want to
  plan, check and trace their work locally.
- Coding agents (through MCP) that need reliable answers about a codebase and a
  way to check a design before writing code.

It is not for you if you need:

- other languages (Python, Java, C#, Lua and others are not supported);
- a proof that production code does what a design says (Pymtheg does not
  check that);
- a hosted or team-synchronised service (everything is local; teams share by
  committing files and exporting history).

## When to use it, and when not to

Use it before a change, to see callers and impact; when planning a feature, to
check the design first; and to keep requirements tied to the code that serves them.

Read the answers with their limits:

- **Definite, candidate, unresolved, failed.** A definite call has exactly one
  target. A candidate set lists the possible targets in the project and never
  picks one; a set marked open may have further targets outside the project or
  members that are not verified. An unresolved call has no target. A failed
  link depends on a file that could not be read; Pymtheg never guesses its
  target.
- Graph answers come from reading source. Pymtheg never runs your code. Only Go
  can optionally use the project's own `go` toolchain for more definite answers.
- A sampled `simulate` run that finds nothing is not a proof. Only a completed
  `verify` covers every reachable state, and only of the finite design you wrote.
- A design check is not a proof that production code follows the design.
- Not built yet: toolchain-backed Rust links, a Studio screen for the graph,
  links from `.pym` declarations to code, live team synchronisation.

The full support matrix is in [docs/support.md](docs/support.md).

## Where it runs and where things live

- Runs on your machine. Requires **Node 24 or newer**. No Java, no account and
  no cloud service.
- After install it needs no network. The release acceptance gate installs the
  package, cuts the network, then runs `init`, `doctor`, design checks, `verify`,
  `simulate`, graph indexing and queries, requirement links, the MCP server and
  Studio.
- `pymtheg init` creates `.pymtheg/project.json`, `.pymtheg/settings.json` and
  `.pymtheg/.gitignore` in the project folder, and nothing else. Commit those
  three. Databases are created later, only when a feature needs them, under
  `.pymtheg/shared/` (requirements, decisions, history) and
  `.pymtheg/rebuildable/` (graph cache), which the generated `.gitignore`
  excludes. Details: [docs/project-init.md](docs/project-init.md#local-state-and-sharing).
- The acceptance gate checks that a whole session creates or changes no file
  outside the project folders, npm's own cache and Node's compile cache, and
  nothing inside the installed package.
- Optional toolchains: with `go` (1.22 or newer) installed and the Go toolchain
  route turned on in `.pymtheg/settings.json`, indexing also asks `go` for type
  facts, which can make more Go calls definite. It runs with network off. Rust
  is source-only: `cargo` and `rustc` are not used.

## Quick start

Create the project files, then check the setup:

```sh
cd /path/to/my-project
npx pymtheg init . --name "My project"
npx pymtheg doctor
```

`init` works in an empty folder too. It never invents source or plans. If the
folder has documentation, it offers a preview; `--import-docs` keeps it.

Index the code and ask a question:

```sh
npx pymtheg graph index --root .
npx pymtheg graph callers total --root .
npx pymtheg graph impact total --root .
```

Link a requirement to the code that serves it, and check the link later:

```sh
npx pymtheg link requirement R1 --title "The basket shows its total" --root .
npx pymtheg link add R1 render --root .
npx pymtheg link check --root .
```

Connect a coding agent. The agent starts the server itself and talks to it
over stdio (its standard input and output). Started inside an initialised
project, the server finds the project from any subfolder. For an agent, install
once so the server starts quickly:

```sh
npm install --global pymtheg
```

Then add it to your agent's MCP configuration (formats vary by client):

```json
{
  "mcpServers": {
    "pymtheg": { "command": "pymtheg", "args": ["mcp", "/absolute/path/to/my-project"] }
  }
}
```

Studio's **Connect agent** button shows the exact configuration for your
installation, with a **Copy configuration** button. Agents start with [docs/agent-workflow.md](docs/agent-workflow.md)
and [docs/code-guide.md](docs/code-guide.md); both are also served as MCP resources.

Open Studio, then open the printed private session URL in Firefox:

```sh
npx pymtheg studio .
```

### From source

For contributors, from a clone of this repository:

```sh
npm ci --ignore-scripts
npm run build
./pymtheg doctor
./pymtheg check examples/mvp/files-buggy.pym
./pymtheg init /path/to/my-project --name "My project"
./pymtheg studio /path/to/my-project
```

`files-buggy.pym` is a deliberately faulty example and exits 1. The examples
are walked through in [docs/journeys.md](docs/journeys.md).

## Documentation

- [docs/code-guide.md](docs/code-guide.md): a worked MCP session with the code graph and requirement links.
- [docs/mcp.md](docs/mcp.md): starting the MCP server, and every tool with a tested example.
- [docs/agent-workflow.md](docs/agent-workflow.md): how a coding agent works on a design.
- [docs/project-init.md](docs/project-init.md): `init`, importing documents, local state and sharing.
- [docs/studio.md](docs/studio.md): the Studio workspace.
- [docs/grammar.md](docs/grammar.md): the `.pym` language.
- [docs/journeys.md](docs/journeys.md): five worked design examples.
- [docs/output-plugins.md](docs/output-plugins.md): scaffolds, contracts and adding output languages.
- [docs/support.md](docs/support.md): what is supported, and the exact meaning of each result.
- [docs/licences.md](docs/licences.md): licences of everything the package ships.

## More detail

**Exit codes** for `check`, `verify` and `simulate`: **0** the requested
checks completed without errors; **1** design errors or a counterexample;
**2** incomplete, unsupported, timed out or stale; **3** invocation, file,
integration or internal failure; **130** cancelled. When several apply,
cancellation wins, then a failure (3), then errors (1), then incomplete (2).
`verify` stops at `--state-budget` distinct states (default 1,000,000);
properties it has not violated by then are inconclusive (exit 2), never passed.
`--format json` gives versioned output; every behaviour result carries
`exhaustive`, which is `true` only for a search that covered every reachable
state.

**Options for `check`, `verify` and `simulate`.** `--timeout 500ms` or `45s`
bounds the checking work (default 45s, at most 120s); running out leaves the
result incomplete. `--out report.json` also writes the JSON report to a file,
atomically, and still prints the findings. `--verbose` prints progress phases
on stderr, so stdout stays clean.

**Running under `npx`.** Each `npx` call costs a few seconds and some memory
before any work, so prefer the MCP server (one long-running process) or a global
install for agents. `pymtheg studio` and `pymtheg mcp` stop cleanly on SIGINT
and SIGTERM. Under `npx`, npm passes a signal only to its own child shell; where
that shell stays as the parent (as in some Debian-based images) the signal never
reaches Pymtheg. A terminal's Ctrl-C is not affected. A supervisor that stops
the server by PID should signal the process group (`kill -INT -- -PGID`) or run
the installed `pymtheg` binary directly.

**What the install brings.** Five runtime dependencies (ten packages in all)
and no install scripts. Studio's browser app and the code-graph grammars ship
prebuilt.

**Installing from a local tarball.** After `npm run build`, `npm pack
--ignore-scripts` writes a tarball. Write it as `./name.tgz` or
`file:/absolute/path/name.tgz` (for example `npx ./pymtheg-<version>.tgz
--help`): npm treats a bare absolute path as a command and fails with exit 126.

## Status, contributing and licence

Version 0.1.0 is the first public release. It is early: commands, MCP tools
and file formats may change before 1.0.

Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Tests run
with `npm test`.

Pymtheg is licensed under the MIT License; see [LICENSE](LICENSE). Third-party
components and their licences are listed in [docs/licences.md](docs/licences.md),
with full notices in [THIRD-PARTY-NOTICES](THIRD-PARTY-NOTICES).
