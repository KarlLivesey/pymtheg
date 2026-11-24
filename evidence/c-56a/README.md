# C-56a evidence

Pins: restic 74f00280, cli/cli 42d52b4c (`sweep/repos.json`). Main is 54cd0e6f; head is this branch.

- `<pin>.same-cold.json`: a cold index of the pin by main and by head into stores with one project id, compared row for row (`scripts/reindex/same-cold.mjs`). Both: no difference. The server path of the checkout is replaced by the pin.
- `<pin>.seeded.json` (head) and `<pin>.seeded.main.json` (main): 35 seeded edits each through the MCP worker (`random-edits.mjs --mcp --more-go`, seeds 5501 restic and 5502 cli/cli), each compared with a cold index. All 140 equal.
- `suite.txt`: the build, type check, format check, `npm test` and `npm run test:backend` on this branch.
- `writes-main-head.txt`: for the same seeded edits, main's and head's per-step write counters (files, symbol rows, link rows inserted and deleted, links whose stored resolution changed), totalled per pin, and for the body edits the files written other than the edited one. Every counter of every step is the same on both builds (`countersDiffering: 0`). Body edits write no other file, before and after.
