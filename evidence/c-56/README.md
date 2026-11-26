# C-56 evidence

Pins: restic 74f00280, cli/cli 42d52b4c (`sweep/repos.json`).

- `body-edits-base-head.txt`: the body edits of `scripts/reindex/cases.json` and their reverts through the MCP worker (`scripts/resident/mcp-edits.mjs --edits body`), on PR 74's head (C-56b, base) and this build (head): job CPU and wall time, type and interface pairs considered, implements decisions reused, and the CPU of `go.globalIndex`, `analyze.go` and `resolve.go.withInput`. Each final store equals a cold index.
- `<pin>.seeded60.json`: 60 distinct seeded edits per pin through the MCP worker with `PYMTHEG_CHECK_KEPT=1` (`random-edits.mjs --mcp --more-go --gomod-meaning --no-edit-runs`, seeds 5621 restic and 5622 cli/cli). Each edit's run, and then a run with nothing edited, is compared with a cold index: all equal.
- `suite.txt`: the build, type check, format check, `npm test` and `npm run test:backend`.
- `<pin>.seeded60.summary.json`: per pin, the steps, how many equal cold, the no-edit runs and how many equal, how often the kept decisions were reused, and how often a reuse was made again and found identical.
