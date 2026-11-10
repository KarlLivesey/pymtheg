# Local audit after the twelfth candidate freeze

The frozen candidate `/tmp/pym-twelfth-candidate-7zo91903` remains unchanged.
External Claude review was rejected by automatic approval review, pending explicit
user authorization for transferring this private candidate. No external reviewer
has started. This does not erase the standing 8.4 independent score.

Karl subsequently explicitly authorized that external Claude Opus 5.5 review.
The current build is receiving its final post-fix validation before a refreshed
candidate is frozen. The earlier frozen candidate remains unchanged.

## Document browsing

The default document list includes `.pymtheg-sources.json`, heading identities,
source contracts and native planning JSON even though the overview correctly
counts only design documents. The metadata reader also offers an Edit action
which the server necessarily rejects. This is an avoidable first-use dead end.

Main-workspace correction: default browsing lists design documents; an explicit,
bounded Workspace data files section retains access to complete planning JSON and
metadata. Managed metadata has a read-only explanation and no edit action. Full
exports and persistent bytes are unchanged. This is a presentation correction;
searching planning text and explicitly opening retained paths remain available.

The new browser journey passes and confirms unchanged retained bytes. The first
attempt failed with four files in the default list where one design document was
expected. A follow-up pass also completed this journey, but its next reader test
lost the native Chromium process during a concurrent project's browser run. The
reader/accessibility result is unresolved for this follow-up, not a failed design
assertion or a passed test. Its unit journal is retained separately.

## Explicit compiler-check options

Go checks operate in the implementation's package; a supplied contracts module
was being ignored. Rust similarly ignored an implementation module. The main
workspace now rejects these unused options, and its CLI, GUI and installed-package
client send only the applicable fields. The TypeScript, Rust and Go real-compiler
probes and CLI/MCP checks pass. These changes are outside the frozen candidate.

## Compiler preview invalidation

A fresh design check could cancel a pending compiler-check preview without
explaining why the result disappeared. The form now retains settings and says
to preview again. Its browser regression holds the old request, starts a genuinely
new check, verifies the notice/settings, then releases and retries. Static
language-output checks disable automatic checking and await real responses;
no startup sleeps or tight timing assertions were added.

## Current follow-up evidence

- Local suite: 410 passed, no failures or skips (`parent-post-twelfth-local.txt`).
- Real TypeScript/Rust/Go compiler and CLI/MCP option checks: four passed.
- Installed private package check passed (`parent-post-twelfth-package.txt`).
- New document-browsing journey passed. The reader/axe journey subsequently
  passed with clean native shutdown (`parent-post-twelfth-reader-debug.txt`).
- Exact 125-document paging, planning and accessibility checks passed in the
  final GUI group; the compiler preview's first run exposed the invalidation
  race above. Its controlled follow-up passes, with screenshots under
  `parent-post-twelfth-check-final`.
- Formatting passes. The frozen candidate still has 2,471 matching fingerprints.

The failed browser runs and the 102-vs-100 paging regression are retained, not
counted as passes. The latter exposed workspace-file buttons being classified as
search-result rows; workspace controls now have their own class, preserving the
original exact paging assertions. There is no new independent score.

## Behaviour-entry selection

The full current GUI sweep found an empty behaviour selector after switching
from an edited checkout flow to the task machine. The original workflow's
TaskRunner assertion is preserved. Entry display/request selection now derives
from the selected source's available entries, retaining an explicit valid choice
and otherwise selecting the first available one. This removes a separate repair
effect whose scheduling could leave the value empty. The original full workflow
passes; additional tests exercise explicit second-flow preference and dirty-file
switching before resuming the whole sweep.

## Cross-browser evidence

A focused first-use workflow passed on installed Firefox 153.0: real type finding,
source correction and recheck, behaviour entry selection, native planning
save/edit, narrow layout and automated axe scan. The first probe wrongly expected
the whole call to be highlighted; the diagnostic correctly highlighted the bad
argument. That failed probe is retained, and the corrected assertion checks the
exact argument.

The installed WebKit runtime could not start because libicudata.so.74 is absent.
No compatibility pass is claimed, and no system library or resource limit was
changed to obtain one. This is not a substitute for manual screen-reader testing.

## Narrow header containment

Visual inspection found wrapped header controls below a fixed 68px grid row.
A geometry assertion reproduced the issue: controls extended to y=144 while the
header ended at y=68. The mobile grid row now grows with the header. The direct
Chromium probe passes at 390, 500 and 980px. A Firefox geometry recheck lost its
native context before the assertion; this remains unverified rather than passed.
The broader Firefox workflow had passed before this final CSS-only correction.

All 65 registered Chromium journeys passed after the entry-selection fix and
before this CSS-only change. The final installed-package smoke and formatting
checks pass. Exact boundaries are in `twelfth-ready-validation.json`; no new
independent rating is claimed.
