# C-55 evidence

Pins: restic (the server's pinned corpus), cli/cli 42d52b4c, installed as checked out.

- `<pin>.seeded-edits.{main,head}.json`: 35 seeded edits each through the MCP worker (`random-edits.mjs --mcp --more-go`, seeds 5501 restic and 5502 cli/cli), each compared with a cold index. `head-frozen` files are the earlier build that froze kept inputs in production; `head` is the final build.
- `seeded-compare.txt`: main against head for the same seeded edits (`scripts/kept/compare-steps.mjs`): CPU, records decoded, input stages, kept size and live heap. The main runs record no stage times (their script predates them).
- `cases-main-head.txt`: the body and export edits of `scripts/reindex/cases.json` through the worker (`scripts/resident/mcp-edits.mjs`), main and head, per step.
- `freeze-cost.txt`: decoding against deep-freezing every stored record of a store.
- `<pin>.seeded60.json` (second review): 60 distinct seeded edits per pin on the final build through the MCP worker (`random-edits.mjs --mcp --more-go --gomod-meaning --no-edit-runs`, seeds 5521 restic and 5522 cli/cli). Each edit's run, and then a run with nothing edited, is compared with a cold index: all equal.
