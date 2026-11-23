# C-47 evidence

[Change note](../../docs/changes/C-47.md)

The hanging tree is oclif/core at its pinned commit, installed, after 17
seeded edits from `scripts/reindex/random-edits.mjs` at seed 4242 (step 16).
To rebuild it, run that script with the main build until it stops at step 16.

- `main-cold-times.txt`: cold indexes of copies of that tree by main
  (`bca89e9`), several at once on the dev server. A wall time of 900 s or
  400 s with exit 0 is the `timeout -s KILL` limit, not a finish. The same
  tree finished in 54 s, 207 s and 322 s in other runs, and twice did not
  finish within 900 s.
- `profile-hung-run.txt`: V8's tick profile of a hung run (`node --prof`,
  processed with `--prof-process`, paths shortened). The time is in the
  structural judgement (`judge.js`), calling `getSymbolAtLocation`.
- `head-cold-times.txt`: four cold indexes by this branch, at once on
  copies of the tree. All finished. Their link rows are identical; only
  the copies' `node_modules` context stamps differ.
- `same-cold.json`: cold stores of main and this branch on vitest-dev/vitest,
  vitejs/vite and puppeteer/puppeteer (`scripts/reindex/same-cold.mjs`).
  Every row is identical once the module version string is normalised.
- `seeded-edits-oclif-{4242,3307,911}.json`: 30 seeded edits each on
  oclif/core with this branch. Every incremental store equals a cold one.
  The 4242 sequence includes the step that hung on main.

## Review 2

- `review-2/cold-runs.json`: cold indexes of five pins with a central file
  broken (`const = ;` appended), by this branch merged with main
  (`49ddae13`), by main, and on Excalidraw by the previous head
  (`c19202a`). It also holds three clean pins against main, redux-toolkit
  and Excalidraw at two other stack sizes, and the link-by-link outcome of
  the 95 links the previous head bounded on Excalidraw. Row comparisons
  normalise the module version string. Several runs went at once on the
  dev server; the seconds are observations only.
- `review-2/seeded-edits-oclif-{4242,3307,911}.json`: 30 seeded edits each
  on oclif/core with this branch (the pin copied with its symlinks kept).
  Every incremental store equals a cold one.
