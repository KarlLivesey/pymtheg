# Comparing Pymtheg with other code-graph tools

`run.mjs` runs Pymtheg and other code-graph tools on the same pinned public
repositories, puts their output into one shape and lists what each finds that
the others do not. Results of the pilot are in
[`evidence/sw-2/summary.md`](../../evidence/sw-2/summary.md).

Run it on the dev server, never on a workstation. It reads the same list
format as `sweep/repos.json`, including ids of the form `owner/name` (stored
in folders named `owner__name`).

## Install the tools once

Into a scratch folder (`$PYM_SCRATCH/tools` below). Nothing is installed
globally and no project is installed.

```sh
T=$PYM_SCRATCH/tools; mkdir -p $T
npm install --prefix $T/pym pymtheg@0.1.0
npm install --prefix $T/cg @colbymchenry/codegraph@1.6.2
# graphify is a Python package (PyPI `graphifyy`). The server has python3 but
# no pip, so fetch uv's standalone binary and make a virtual environment.
curl -sSfL https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz | tar xz -C $T
export UV_CACHE_DIR=$T/uvcache UV_PYTHON_INSTALL_DIR=$T/uvpy
$T/uv-x86_64-unknown-linux-gnu/uv venv $T/gfy --python 3.12
$T/uv-x86_64-unknown-linux-gnu/uv pip install --python $T/gfy/bin/python graphifyy==0.9.112
```

## Run

```sh
pymtheg-dev --name sw2 -- node --max-old-space-size=32768 scripts/compare/run.mjs \
  --repos scripts/compare/pilot-repos.json --out "$PYM_SCRATCH/compare" \
  --tools-dir "$PYM_SCRATCH/tools" --jobs 6
```

`--help` lists the options. A rerun reuses every result already written;
`--force` reruns the tools, `--keep` keeps each tool's working copy and
`--renormalise` rebuilds the normalised output and diffs from kept copies.
`--node-heap MB` raises the heap limit of the Node-based tools; it is off by
default so that a default run shows what a user gets, and it is recorded in
the results when used. The harness itself holds every tool's output for one
repository in memory, hence its own larger heap above.
At most 12 tool runs at once (`--jobs`), because the machine is shared.

What each tool runs:

| Tool             | Command                                                                                              | Reads                               |
| ---------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Pymtheg 0.1.0    | `pymtheg init`, `pymtheg graph index --json` (source only; the Go toolchain route is off by default) | `.pymtheg/rebuildable/graph.sqlite` |
| CodeGraph 1.6.2  | `codegraph init -y` (telemetry off)                                                                  | `.codegraph/codegraph.db`           |
| graphify 0.9.112 | `graphify extract --code-only --no-cluster --max-workers 4`                                          | `graphify-out/graph.json`           |

Safety: repositories are untrusted. Each is fetched shallow at its pinned
commit with git hooks off and no submodules or LFS. Each tool gets its own
copy, a scratch `HOME`, an environment with no API keys and no network
(`unshare -rn`). If `unshare -rn` does not work on the machine the run stops
with a message; `--no-isolate` runs the tools with network on purpose, and
`run.json` and each outcome then record `isolated: false`. Nothing runs a repository's install
scripts, builds or tests. None of the three tools runs the project's
toolchain in these modes.

## Output

Under `--out`: `repos/<id>/<tool>/outcome.json` (exit, wall time, peak memory,
counts), `repos/<id>/<tool>/normalised.jsonl` (JSON Lines: a header, then one
line per symbol and per edge), `repos/<id>/diff.json`, and
`summary.md` / `summary.json` across repositories. `show.mjs` prints a diff
bucket's sampled edges with their source lines for hand-checking:

```sh
node scripts/compare/show.mjs --out "$PYM_SCRATCH/compare" --repo chi --bucket others-not-pymtheg --context 2
```

A tool run that crashed or timed out is reported in the tables but left out of
that repository's diff, because its partial output would show as misses.
Wall time and peak memory are observations on a shared machine (peak memory is
the largest single process, from `/usr/bin/time`), never pass or fail. The wall
limit (`--timeout`, default 30 minutes) is only a safety limit.

## The normalised shape

```text
symbol { file, line, kind, name, container? }
edge   { kind, class, from: { file, line, symbol, container?, declLine },
         to: { file, line, symbol, container? } | { symbol, unresolved | external },
         certainty, set? }
```

`from.line` is the line the link is written on; `to.line` is the target's
declaration line. `kind` is the tool's own edge kind; `class` groups kinds that
mean the same across tools (`call`, `reference`, `heritage`, `import`,
`structure`). `certainty` keeps each tool's own wording:

- Pymtheg: `definite`, `candidate` (one edge per member of a candidate set, with
  `set: { size, open }`; a set is never turned into a definite link),
  `unresolved` or `failed` with Pymtheg's reason.
- CodeGraph: its `resolvedBy` and `confidence`, plus `heuristic` when CodeGraph
  marks the edge so (for example `instance-method@0.7`, `exact-match@0.4+heuristic`).
- graphify: `EXTRACTED`, `INFERRED` or `AMBIGUOUS`, with its score when present.

## The matching rule

Only in-project symbol-to-symbol links are matched: classes `call`,
`reference` and `heritage`, both ends in a TypeScript/JavaScript, Go or Rust
file, target known. Imports are counted but not matched, because the tools
model them at different levels (file to file, file to package, file to import
statement). Two links from different tools are the same link when:

1. source file and normalised source name match, target file and normalised
   target name match (`.Get()` = `Get`, generic parameters dropped, a qualified
   name keeps its last part), and both declaration lines are within 3 lines
   (declaration line versus name line, decorators, doc comments). The
   container (receiver, class, impl type) only breaks ties; or
2. failing that, they have the same target (as in 1) and are written in the same
   file with a call-site line within 1 line, which absorbs differences in which
   enclosing symbol a call is attributed to.

Edge kinds are not part of the match: a CodeGraph `instantiates` and a Pymtheg
`references` between the same two symbols are one link with both kinds kept.
Several call sites between the same two symbols are one link. Inputs are sorted
first, so the same inputs give the same output. Samples per bucket are the 25
links with the smallest SHA-256 of `seed|bucket|link`, seed 1 by default.

For a link that a tool lacks, `absentState` says what that tool has at the same
site: `unresolved(<reason>)`, `same-target-other-source` (it has the link but
attributes it to another enclosing symbol), `other-target`, `external-target`,
`no-link-at-site`, `file-failed` or `file-not-indexed`.
