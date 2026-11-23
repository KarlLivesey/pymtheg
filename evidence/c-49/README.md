# C-49 evidence

- `<owner_repo>.commits.json`: the 20 single-file commits replayed per pin (commit, file).
- `{hono,vitest,excalidraw}.{main,head}.replay.json`: per commit, files and rows written and changed in meaning, wall and CPU time, whether the redo equals the first store (`scripts/keys/commit-replay.mjs`). Hono main is from the first run; the others from the second (same commits).
- `<owner_repo>.keys.json`: key forms on main and head (`meaning.mjs --forms`) and the main-against-head meaning comparison of cold stores.
- `{hono,vitest}.seeded-edits.json`: 30 seeded edits each with sibling edits (`random-edits.mjs --siblings`), each compared with a cold index.
- `cold-cost.json`: cold indexes, main and head alternating, two rounds (observations).
- `key-cost.txt`: the key walk by itself against parsing (`key-cost.mjs`).

Pins: honojs/hono 676c8f80, vitest-dev/vitest 161e25f6, excalidraw/excalidraw 680f58cc, dependencies installed.
