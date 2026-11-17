# TP-1: prune tests that guard no behaviour (Studio, MCP, browser)

Slice: every file in `test/` whose name starts with `studio`, `mcp` or
`browser`. Each test was read and judged against the owner's rules: keep a
test only if it changes when, and only when, the intended behaviour changes;
prune tests that depend on the past, on nothing, or on the implementation, and
copies of a test that already guards the same behaviour.

## Counts

| | Before | After |
| --- | ---: | ---: |
| Files in the slice | 138 | 137 |
| Node test files (`*.test.mjs`, `mcp.integration.mjs`) | 24 | 24 |
| Node tests declared (`test(...)` calls) | 77 | 76 |
| Node tests at run time (`mcp.integration.mjs` makes two from one loop) | 78 | 77 |
| Browser journeys (`studio*.browser.mjs`, one journey each, run by `scripts/gui-check.mjs`) | 111 | 110 |
| Browser helpers (`browser-evidence.mjs`, `browser-journey.mjs`, `browser-launch.mjs`) | 3 | 3 |

## Deleted or rewritten tests

| File | Test | Rule | Why |
| --- | --- | --- | --- |
| `test/mcp-links.test.mjs` | every documented requirement-link call executes as written | duplicate of `test/mcp-design-loop.test.mjs` "every documented MCP call executes as written" | Both run the `// verified-mcp` blocks of `docs/mcp.md`. The design-loop pattern also matches the `// verified-mcp` + `// requirement-links` block, so that block already runs there; the deleted test ran only that same block. Its extra check (the block calls only graph and link tools) tests the document, not the product. |
| `test/studio-entry-dirty-switch.browser.mjs` (whole file) | Dirty-file switch selects TaskRunner | duplicate of `test/studio.browser.mjs` | Lines 1 to 62 are the same steps as `studio.browser.mjs` (same fixture, same unsaved edit, same recheck, same switch to `task-buggy.pym`), and both then assert the entry point becomes `TaskRunner`. The rest of the file only prints debugging output. |

No test was rewritten.

## Other code removed

- `test/mcp-links.test.mjs`: the `log` array in the `session` fixture, and its
  `log.push(...)` in `raw`. Only the deleted test read it. It also wrote
  evidence when `R1C2_EVIDENCE` was set; nothing else uses that variable.
- `scripts/gui-check.mjs`: the `test/studio-entry-dirty-switch.browser.mjs`
  entry in the journey list.
- No production code existed only for the deleted tests.

`docs/changes/W2-E.md` still names the deleted browser file; it is a historical
record and was left unchanged.

## Kept but doubtful

- `test/mcp-graph-inline.test.mjs`, all three tests: they assert
  `job.listeners.size === 0` and `deadlines[i].cleared`. These are internal
  state (rule: implementation), but they are the only check that an inline
  wait releases its listener and its deadline, so they guard against a leak.
  Kept; a reviewer may prefer to drop just those assertions.
- `test/studio-planning-a11y.browser.mjs`: an axe scan of the planning form.
  `studio-cross-browser.browser.mjs` and `studio-architecture.browser.mjs` also
  scan that form, but with the WCAG tag filter; this one runs every axe rule on
  a project that already has a record. Overlapping, not identical; kept.
- `test/studio-legacy-review.browser.mjs`: built on a database downgraded to
  the old review schema. It guards reading and migrating databases written by
  older versions, which users may still have, so it is not a "past" test. Kept.
- `test/mcp-honesty.test.mjs` "C: read_source ..." and "D and H: ..." assert
  wording inside MCP tool descriptions and refusals. That wording is the MCP
  output agents read, so it is kept as a public surface.
- `test/mcp-code-guide.test.mjs` "every tool and action the code guide names
  exists in tools/list" checks the guide against the tool list. It is a
  document/product agreement check rather than a behaviour check; kept because
  the guide is served to agents as an MCP resource.

## Possible duplicates in other slices

None found.

## Checks

Run on the dev server.

- `npm ci`, `npm run build`, `tsc --noEmit` for the core and the web app: pass.
- `node --check scripts/gui-check.mjs`: pass.
- `node --test test/studio*.test.mjs test/mcp*.test.mjs`: 74 tests, 74 pass.
- `node --test test/mcp.integration.mjs`: 3 tests, 3 pass, none skipped.
- Full `npm test`: 2922 tests, 2922 pass, 0 fail, 0 skipped.
- Browser journeys were not run: this chunk has no browser access, and the
  only journey change is a deleted file.
