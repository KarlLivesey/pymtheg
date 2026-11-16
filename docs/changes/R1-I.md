# R1-I: production dependency advisories

`npm audit --omit=dev` on main (2d1206ea) reported two advisories in what the
package installs. This chunk raises both packages to the lowest fixed version.
Nothing else was raised.

| Package | Before | After | Advisory |
|---|---|---|---|
| `zod` | 4.2.0 | 4.6.6 | GHSA-mrhx-c7xc-m3w5 (high, CVE-2023-54404): vulnerable below 4.6.6, first fixed 4.6.6 |
| `ajv` | 8.17.1 | 8.18.0 | GHSA-2g4f-4pwh-qvx6 (moderate, CVE-2025-69873): vulnerable 7.0.0-alpha.0 to below 8.18.0, first fixed 8.18.0 |

Both stay exact pins in `package.json`. `package-lock.json` was regenerated with
`npm install --ignore-scripts`; its only other change is npm recording the root
`"license": "MIT"` that `package.json` already had. ajv 8.18.0 has the same
four dependencies and ranges as 8.17.1, so no transitive package changed.

## Does Pymtheg reach the affected code?

**zod.** The advisory: zod validates every element of an array before it checks
the array's length, and keeps one issue object per failing element, so a large
array of bad elements can run the process out of memory. Pymtheg reaches this:
MCP tool arguments come from the MCP client and are validated by zod (in
`@modelcontextprotocol/server` with Pymtheg's `inputSchema`s), as are Studio
request bodies. Pymtheg's MCP arrays carry `.max(...)`, but in 4.2.0 that check
runs only after every element is validated (read in `v4/core/schemas.js`), and
`z.json()` fields (`inputs[].type`, `output`) accept arrays of any length. 4.6.6
checks an array's size against its `.max` before validating elements
(`capSize`). Fields without a `.max`, such as `z.json()`, are still validated
element by element; this chunk does not change Pymtheg's schemas.

**ajv.** The advisory: with the `$data` option on, a `pattern` taken from the
data being validated is compiled with `new RegExp`, so the data can supply a
catastrophic regular expression. Pymtheg does not reach this: its only two ajv
uses (`src/studio/server.ts`, `src/studio/recovery.ts`) construct ajv with
`{ allErrors: true }` and `{ strict: true }`, without `$data`, and the schema
they compile (`docs/report.schema.json`) contains no `$data`. The raise clears
the audit; it does not fix a reachable fault.

## One zod

`@modelcontextprotocol/server`, `core` and `client` 2.4.0 all declare
`zod: ^4.2.0`, which accepts 4.6.6. `npm ls zod` shows one copy, 4.6.6, deduped
under all three.

## Licence inventory

Regenerated with `node scripts/licences/inventory.mjs --write`. Component counts
are unchanged: 103 shipped (98 MIT, 3 Apache-2.0, 1 BSD-3-Clause, 1 ISC); only
the zod and ajv versions changed in the component table and
`THIRD-PARTY-NOTICES`.

The provenance notes in zod `v4/core/regexes.js` moved and two changed. Each was
re-read against the 4.6.6 source:

- email (line 35), base64 (57), host name (61), Stack Overflow answer (97): the
  comment text is unchanged; only the line moved. Whether the code after it
  ships is unchanged (email and host name: no; the other two: yes).
- emoji (44): zod added its own comment under the Kevin Scott link, saying the
  pattern is now one character class with a lookahead because the old
  alternation backtracked exponentially. The regular expression is zod's
  rewrite; the comment still names the blog post. It ships. Licence of the
  source: not checked.
- E.164 phone number (65): zod appended its own rule ("leading digit must be
  1-9; total digits … between 7-15") and the pattern is now
  `^\+[1-9]\d{6,14}$`. The comment still names Steven Levithan's blog post. It
  ships. Licence of the source: not checked.

zod 4.6.6 adds one new note, now reviewed and pinned in `embeddedNotices`:
`v4/core/schemas.js:512`, "Luhn checksum on a digit-only string. Adapted from
valibot (MIT)." The function (`isLuhnAlgo`, used by the credit-card format) has
the same loop as valibot's `_isLuhnAlgo`. valibot's npm package (1.5.0) declares
MIT and its LICENSE reads "Copyright (c) Fabian Hiller"; zod does not carry that
notice. Pymtheg does not use the credit-card format and the source map shows the
code is not in `dist-web/`. The scan now lists 19 provenance notes (18 before);
`docs/build-plan.md`'s R1-H follow-up still says 18. The test fixture in
`test/licences.test.mjs` names the zod version it reads; it now says 4.6.6.

## Build output

zod 4.6.6 has two comments Rollup cannot place (`v4/core/regexes.js:74`,
`v4/core/util.js:400`), so `vite build` now prints two "contains an annotation
that Rollup cannot interpret" warnings. Rollup removes the comments; the build
succeeds. Main's build prints none.

## Audit

Before (main):

```
ajv  7.0.0-alpha.0 - 8.17.1   moderate  GHSA-2g4f-4pwh-qvx6
zod  <4.6.6                   high      GHSA-mrhx-c7xc-m3w5
2 vulnerabilities (1 moderate, 1 high)
```

After: `npm audit --omit=dev` reports `found 0 vulnerabilities`.

Left in dev-only dependencies (`npm audit`, not fixed here): `vite` 7.2.2
(range 7.0.0–7.3.6, high; fix 7.3.8), one entry carrying ten advisories: six
for Vite (GHSA-4w7w-66w2-5vf9, GHSA-v2wj-q39q-566r, GHSA-p9ff-h696-f583,
GHSA-9jrq-w75r-8gcw, GHSA-rq7h-c2jc-7f22, GHSA-fx2h-pf6j-xcff) and four for
`launch-editor` (GHSA-v6wh-96g9-6wx3, GHSA-698v-4r3x-3vcv,
GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm). Vite builds `dist-web/`; it is not
in the production install.

## Checks (dev server, Node 24.21.0)

`npm ci --ignore-scripts`, `npm run build`, `npm run format:check`,
`node scripts/licences/inventory.mjs --check` and `npm audit --omit=dev`: all
pass. `npm test`: 2,813 tests, 2,813 pass, 0 fail, 0 cancelled, 0 skipped.

Production install of the packed tarball (`npm pack --ignore-scripts`, then
`node evidence/r1-h/tarball-smoke.mjs <tgz> <dir>`): every step passes before
and after (help, check, verify, simulate, doctor, graph index, TypeScript, Go
and Rust callers, MCP initialize and tools/list, Studio page and asset, stop).
The installed tree holds one zod (4.6.6) and ajv 8.18.0.

| | Main (2d1206ea) | After |
|---|---|---|
| Tarball bytes | 1,830,538 | 1,839,088 |
| `node_modules` bytes | 51,242,013 | 53,219,439 |
| Packages (incl. pymtheg) | 11 | 11 |
| `npm warn` lines | 0 | 0 |
