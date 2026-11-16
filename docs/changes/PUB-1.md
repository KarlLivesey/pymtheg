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
