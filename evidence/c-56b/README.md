# C-56b evidence

Pins: restic 74f00280, cli/cli 42d52b4c (`sweep/repos.json`). Measured on this chunk's first base: main is 54cd0e6f (C-55 before its reviews), head is this chunk on it (b06e44de). The branch has since merged main; the suite on the pushed tree is in `suite.txt`.

- `<pin>.same-cold.json`: a cold index of the pin by main and by head into stores with one project id, compared row for row (`scripts/reindex/same-cold.mjs`). Both: no difference. The server path of the checkout is replaced by the pin.
- `<pin>.seeded.json`: 35 seeded edits each through the MCP worker on head (`random-edits.mjs --mcp --more-go`, seeds 5501 restic and 5502 cli/cli), each compared with a cold index. All 70 equal.
- `suite.txt`: the build, type check, format check, `npm test` and `npm run test:backend` on this branch.
