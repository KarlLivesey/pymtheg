# PUB-1: private project names out of the package test

`test/package-contents.test.mjs` checks that the files the npm package ships
carry no private details. One rule listed the owner's private project names
as literals, and a test used them as cases. A public repository cannot hold
those names, so the test no longer spells them.

The names now come from an optional file at the repository root,
`private-names.local`, which git ignores. Each non-blank line that does not
start with `#` is a JavaScript regular expression source, optionally followed
by `/flags` (write a literal slash inside a pattern as `\/`). Every pattern is
checked against every shipped text file, as the old rule was. A hit fails the
test with the shipped file, its line and the pattern's line number in
`private-names.local`; the matched text is never printed.

Without the file the rule has no patterns; the other rules (home paths, the
owner's name, private addresses, host names, internal docs) run as before.
A file that exists but cannot be read, or holds an invalid pattern or flag,
fails the test with the line number, so the rule is never switched off
silently.

A new test drives the mechanism with made-up names in a temporary pattern
file passed by path: a hit, a miss, a capitalised word-bounded pattern that
ignores the lower-case word, ignored comments and blank lines, an invalid
pattern, an unreadable file and a missing file.

## Internal documents about private trial projects

Internal documents about the owner's private trial projects are no longer in
the repository; the owner keeps private copies outside git. Removed: the mega
plan, the architecture workspace plan, the first-use and readiness audits, the
completion goal, the architecture review resolution, the post-ninth self-audit,
the ninth, tenth, thirteenth, sixteenth and twenty-fourth review briefs, the
project-fit design update and the private workspace audit script.

Live documents that named the private projects or their findings
(`docs/progress.md`, `docs/requirements.md`, `docs/decisions.md`,
`docs/changes/R1-H.md`) had only those lines reworded or the clause dropped.
References to the removed files were reworded so they stay true without a
link (for example "the mega plan (kept privately)"); history in
`docs/build-plan.md` and `docs/changes/` is otherwise unchanged. `.gitignore`
also ignores `/private/`, which holds the owner's private notes.
