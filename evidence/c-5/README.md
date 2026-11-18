# C-5 evidence: library targets (core)

No language module behaviour changed, so the evidence is (a) that graphs
without library targets are stored exactly as before and measure the same,
and (b) the toy fixture language end to end.

## (a) Identity on three corpus repositories

Run on the dev server with [`run-identity.sh`](run-identity.sh): the base
commit `32ca757` and this branch, each built from source, on one repository
per language from `sweep/repos.json` ([`affected.json`](affected.json)).

**Stored rows.** [`identity.mjs`](identity.mjs) indexes each pinned checkout
with each build's graph core under a fixed project id and hashes every table,
sorted. Every table is byte-identical apart from the schema version (`3` →
`4`). The only other difference is the new table, empty on the branch:

| Repository | Language | Links | Tables differing | Library targets |
|---|---|---:|---|---:|
| charmbracelet/bubbletea | Go | 12,498 | `graph_library_targets` (absent → 0 rows) | 0 |
| rust-embedded/cortex-m | Rust | 5,200 | `graph_library_targets` (absent → 0 rows) | 0 |
| yargs/yargs | TypeScript | 12,151 | `graph_library_targets` (absent → 0 rows) | 0 |

`graph_files`, `graph_symbols`, `graph_links`, `graph_candidates`,
`graph_contexts`, `graph_parse_failures` and the rest of `graph_meta` have
the same row count and the same sha256 under both builds.

**Level 2.** `scripts/sweep/run.mjs --local-build` for each build, then
`coverage-export.mjs` and `coverage.mjs --scoreboard`. The two exports differ
only in the build digest. Every repository's breakdown is identical, and the
two scoreboards are byte-identical:

| Repository | Language | Links | Proven outside | Level 2 base | Level 2 branch |
|---|---|---:|---:|---:|---:|
| charmbracelet/bubbletea | Go | 12,498 | 2,460 | 71.39% | 71.39% |
| rust-embedded/cortex-m | Rust | 5,200 | 775 | 54.10% | 54.10% |
| yargs/yargs | TypeScript | 12,151 | 1,114 | 33.41% | 33.41% |

The branch graphs are schema 4 with no library targets, so their library
identities come from the same reconstruction as 0.1.0's.

## (b) Toy fixture end to end

[`toy-end-to-end.txt`](toy-end-to-end.txt) is the CLI text and the MCP view
pages (`answer`, `links` without refs, `candidates`) for `uses zod`,
`uses zod string`, `uses lodash map`, `uses nothere` and `callees main` on
`test/fixtures/graph-library-targets/`. Symbol and link ids are replaced by
`ID` (they depend on the random project id); library ids are project
independent and shown as stored. The same output is pinned literally in
`test/graph-library-targets.test.mjs`.

The fixture shows each case:

- `use npm:zod`: a library unit (level 1, `import-path`).
- `call zod.string`: a library symbol (level 2, `import-binding`).
- `call nothere.thing`: the unit is not imported, so it stays unresolved.
- `call map` with a local `def map` and `use npm:lodash *`: a candidate set
  of the local function and `lodash` `map` (`glob-import`, candidate only).
