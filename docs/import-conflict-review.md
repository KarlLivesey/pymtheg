# Updating an architecture without losing local work

In Studio, **Import documents** lets you name a new source or refresh an existing
one. Select the source identity even if you selected files from a moved folder.
The revision name describes this save; the source name describes where the files
come from. They are separate.

The preview lists added, changed and removed documents. When both local and
incoming versions changed, review each version and choose:

- **Keep my current version**: retain local content and remember the newly reviewed
  upstream baseline.
- **Use incoming version**: replace that source-owned document, or remove it if
  the source removed it. This is unavailable for protected native/shared content.
- **Keep both**: retain the current document and put the incoming one under an
  `imports/` path. Planning IDs remain unchanged; collisions remain visible.

**Review resolved import** calculates a new preview. **Save reviewed import** is
unavailable until every conflict is resolved. Both version hashes and the current
workspace revision are checked again; a later edit requires another review.
Large inline versions are shortened with a complete-text download available.
Nothing changes in the original source folder.

The CLI has the same merge policy:

```sh
pymtheg import-architecture ./design --into ./workspace --name Baseline --source-name "Service design"
pymtheg import-architecture ./moved-design --into ./workspace --source-id SOURCE_ID --preview
pymtheg import-architecture ./moved-design --into ./workspace --source-id SOURCE_ID --resolutions choices.json --name "Reviewed refresh"
```

Get the retained ID from `changes.sources` in the initial import output. A
conflicted preview returns status 2 and `conflicts`; nothing is committed. Each
entry in `choices.json` contains `path`, `localHash`, `incomingHash`, and `choice`
(`keep-local`, `take-incoming`, or `keep-both`) copied from the reviewed conflict.
These are explicit choices, not an automatic merge algorithm.

Ordinary refresh retains a custom source name and skips an unchanged checkpoint.
Use `--name` to record an explicit equal-content checkpoint. A possibly moved
folder requires `--source-id`; use `--new-source` only when intentionally adding
a separate source with overlapping document paths. CLI imports that introduce
broken native planning links stop before saving. Review their JSON preview and
use `--allow-broken-links` only to accept those broken links explicitly.
