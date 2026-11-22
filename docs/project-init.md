# First-class project initialization

`pymtheg init` is a CodeGraph-like entry point, with Studio and MCP aware of
the same project. Most projects begin empty. Existing documentation may
be brought in, but it is not required and never becomes verified by import.

## Current capability and acceptance boundary

Initialization, nearest-project discovery, optional document previews, explicit
imports, conflict review and portable project identity are implemented. Current
validation includes real CLI/MCP and Studio journeys, concurrent initialization,
relocation and native-plan continuity. See the
[current completion audit](https://github.com/KarlLivesey/pymtheg/blob/main/docs/current-completion-audit.md) for the exact final
validation records; the chronological counts below describe earlier checkpoints.
Sharing uses explicit history archives. It is not live team synchronization.

## Contract for the first slice

- `pymtheg init [DIRECTORY] [--name NAME] [--format text|json]` creates a local
  workspace identity and a default `.pymtheg/settings.json` only when that config is
  absent. Everything Pymtheg stores for the project is under `.pymtheg/` (see
  [Local state and sharing](#local-state-and-sharing)).
  No sample program, requirement or decision is invented.
- `.pymtheg/project.json` stores a versioned UUID/name, not an absolute path.
  Re-running initialization preserves identity, configuration and design content.
  Studio and MCP discover the nearest ancestor marker from a nested working
  directory. Explicitly opening a different project still selects that project.
- Reads validate metadata and write nothing. Initialization never follows a
  marker-directory symlink outside the chosen root. Existing malformed metadata
  is an actionable error, not an excuse to replace project identity.
- File creation is create-only and atomic: concurrent initializers observe one
  complete winner. Marker publication is the final initialization step. The
  CLI reports initialization and any documentation-preview failure separately.
- An empty workspace is ready for guided design and agent proposals. Studio
  starts with its existing architecture-first welcome and component/planning tools.
- Existing root Markdown/text and conventional docs/design/architecture folders
  are offered as a bounded import preview. `--import-docs` is an explicit import
  action, reusing the existing source-scoped import/merge and revision pipeline.
  Subsequent imports preserve native planning and surface conflicts. Arbitrary
  source-code ingestion and automatic implementation inference are not added.
- No global project registry or automatic agent-server installation is needed.
  MCP's project_info returns the initialized project's portable identity. An
  omitted MCP directory resolves from the current working directory.

## Evidence to collect

Blank-folder init → repeat without byte changes → open from a subfolder through
Studio/MCP → propose/check a new design without saving it. Then initialize a
repository containing documentation → inspect preview without imported state →
explicitly import → repeat without duplicate plans or unnecessary checkpoints.
Move the project and retain identity; reject malformed metadata, symlink escape,
concurrent partial records and attempts to overwrite an existing configuration.
All tests use identities, exact bytes and operation outcomes, not wall-clock speed.

## Working commands

```sh
pymtheg init ./my-project --name "My project"
cd my-project
pymtheg studio .
pymtheg mcp
```

The MCP process discovers the nearest initialized ancestor, even when launched
from a subfolder. `project_info.workspace` reports the same UUID/name used by
Studio. The server stays confined to that project; no global folder access or
agent-client configuration is installed automatically.

Default documentation discovery includes root Markdown/text, conventional
architecture/design JSON filenames, and supported text inside docs,
documentation, design, architecture, spec and specs folders. Other locations
remain available through explicit folder import. Generated/private folders are
excluded. Preview reads and indexes these documents without creating a saved
architecture. To keep them, run `pymtheg init . --import-docs`; a later invocation
refreshes that source, preserves native plans and refuses unresolved conflicts.
An unchanged refresh does not create another checkpoint.

Core tests: `workspace-init`, `project-documents`, `mcp-init`. These exercise an
empty folder, reinitialization, actual folder relocation, metadata corruption,
concurrent creation, source-preserving MCP checks and native-plan continuity.
Rendered initialization and project-setup journeys now pass, including restart,
subfolder discovery and rejecting an import whose files changed after preview.
The independent ninth review used a pre-initialization frozen candidate; the
tenth candidate includes this behavior.

After the first integration check, seven initialization tests cover the shared
identity, actual movement and corruption behavior. Four documentation tests cover
preview/import/no-op/cancellation, and a real MCP test covers automatic discovery
from a subfolder and read-only unsaved checking. The temporary installed-package
smoke also initializes and reads the same project identity through MCP.

The current broader local run passed 348 tests; one additional CLI documentation
journey passed afterward. A fresh consolidated run will capture the final count.

## Studio setup

The toolbar's **Project setup** action uses the same initializer. It names an
empty project, then previews existing documentation when present. Importing uses
a retained preview token and checks the source hashes before committing; changed
documents require another preview. The architecture view refreshes without a
page reload or replacing source buffers. The control remains available in narrow
layouts. API behavior and the rendered setup/conflict journeys are now tested. The
earlier pending status is retained in the chronological evidence above.

`examples/self/initialization.pym` records why publication is create-only. The
built-in exhaustive search finds no violation in its finite atomic-publication
model and replays an identity overwrite in the deliberately unsafe alternative
(first shown with TLC, since removed). This does not prove the host
filesystem primitive, which has its own real concurrent-initializer regression.

## Local state and sharing

A folder inside an initialised project uses that project; init names the workspace and its root.
A nested Git root gets its own project.

Initialization creates
`.pymtheg/project.json`, `.pymtheg/settings.json` and `.pymtheg/.gitignore`. That
ignore file excludes `.pymtheg/shared/` and `.pymtheg/rebuildable/`. No database
is created by initialization or a document preview.

| Path                                          | Holds                                                                                                                  | Kind                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `.pymtheg/project.json`                       | Stable workspace identity                                                                                              | Commit                                                    |
| `.pymtheg/settings.json`                      | Project configuration and scenarios                                                                                    | Commit                                                    |
| `.pymtheg/shared/architecture.sqlite`         | Requirements, links, decisions, retained observations, checkpoint history, recorded-change ledger, architecture drafts | Shared data, local database; share it by exported history |
| `.pymtheg/shared/drafts.sqlite`               | Unsaved Studio buffers and form/context drafts                                                                         | Authored, local                                           |
| `.pymtheg/local/writer.json`                  | This installation's writer identity and author label                                                                   | Local only; ignores itself; never copy to another machine |
| `.pymtheg/rebuildable/graph.sqlite`           | Code graph cache                                                                                                       | Rebuildable; ignores itself                               |
| `.pymtheg/rebuildable/graph.sqlite-turnstile` | Empty lock file: writers of the graph take turns through it (C-37)                                                     | Rebuildable; never written, only locked                   |
| `.pymtheg/rebuildable/runs.sqlite`            | The three most recent Studio runs                                                                                      | Rebuildable; ignores itself                               |

Deleting `.pymtheg/rebuildable/` loses nothing that cannot be regenerated.
Commit `.pymtheg/project.json`, `.pymtheg/settings.json`, `.pym` files and ordinary
design documents with the project.

Old layouts (`.pymtheg.json`, `.pymtheg-architecture/`, `.pymtheg-studio/`,
`.pymtheg-implementation-links.json`, `.pymtheg-observed-code.json`,
`.pymtheg-heading-identities.json` and `.pymtheg-source-contracts.json`) are unused
dead data. Pymtheg never reads, migrates or deletes them, and their presence does
not affect discovery or refuse any command. Only `init` and `doctor` print one
short notice naming the entries found at the project root and saying they are
unused and safe to delete. The notice is text on stderr, leaving JSON output
intact. Nothing is deleted automatically. Discovery stops at the nearest
`.pymtheg/` or Git root.

Re-running `init` reports the opened workspace and root and leaves complete
metadata unchanged. If initialization was interrupted, running it again creates
missing metadata while preserving existing settings and identity. Unpublished
`*.tmp` staging files are ignored and left untouched. Invalid metadata is reported
with its path and repair guidance; permission errors ask for a writable directory.
After initialization, run `pymtheg doctor`, `pymtheg studio .`, and `pymtheg mcp`.
Planning databases and rebuildable caches are created only when a feature needs
them, rather than by `init` itself. The first planning write in a folder that
was never initialised — a `pymtheg link` write (`requirement`, `add`, `remove`,
`refresh`), or over MCP `requirement_links` with those actions,
`observe_implementation` or `link_implementation` — first initialises it exactly as `pymtheg init` with no
options would (the folder's name becomes the project name; documentation is not
imported), so `.pymtheg/.gitignore` is in place before any database is written.
MCP `project_info` reports `initialised: false` until then. A graph index alone
does not initialise a project; its cache ignores itself.

To share planning records and their revisions, choose **Architecture → Export
all history**, then put the resulting `pymtheg-architecture-history.json` in your
team's normal shared storage or repository. Teammates use **Import documents**
and select that archive, review its branch information, then accept the import.
Export again after changing plans. This is an explicit snapshot exchange, not
live synchronization; importing history preserves branches and does not resolve
conflicting decisions automatically. Keep one shared project identity when
copying the repository. Do not copy an open SQLite database between machines.

Documentation sources keep their initial documentation filter when refreshed
through either CLI or Studio. A folder upload cannot silently expand that source
to package metadata or arbitrary source files. To import a different scope, add
an explicitly separate source.

If incoming documentation conflicts with a local edit, **Project setup** shows
both versions and offers keep current, use incoming, or keep both. Review the
resolved preview before importing. The CLI equivalent is `init --import-docs
--format json`, followed by `--resolutions choices.json` containing the displayed
path, localHash, incomingHash and chosen resolution. `--allow-broken-links` is a
separate explicit choice for an import that leaves planning links unresolved.

Folder discovery imports visible documentation only. Dotfile documents and hidden
directories are excluded consistently by CLI and Studio, including WebKit folder
pickers. A hidden document retained by an older folder import is preserved on
refresh; an omitted picker entry never means deletion. Use an individual file
import or the document editor when you explicitly want hidden content.

If a folder was accidentally imported as a second source, retain its history but
retire its current documents by refreshing that exact source with an empty folder.
First identify its source ID in Architecture, then run:

```sh
mkdir /tmp/pymtheg-empty-source
pymtheg import-architecture /tmp/pymtheg-empty-source --into /path/to/project --source-id SOURCE_ID --name "Retire duplicate source" --preview
```

Inspect the preview: it must name only the intended source and its removals.
Repeat the same command without `--preview` to commit those removals. This
creates a revision removing that source's current documents; older revisions stay
available. Use `init --import-docs` to refresh the original documentation source.
