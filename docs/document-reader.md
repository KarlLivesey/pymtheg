# Retained document reading

The architecture workspace must let a person read a design, not only inspect its
serialized source. Add a reading view for Markdown with headings, paragraphs,
lists, tables and code. The existing document bytes remain authoritative and
unchanged; an explicit Source view and download preserve exact access.

Rendering is presentation, never verification. Imported HTML must not execute;
images must not initiate network requests. External links open only on an explicit
click, with no opener/referrer. Relative links navigate only to documents retained
in the selected architecture revision; missing targets are explained. This never
loads a live filesystem path or silently switches revision.

Use maintained Markdown tooling rather than a second handwritten Markdown parser.
Pin react-markdown 10.1.0 and remark-gfm 4.0.1 (MIT). Render React nodes, not injected
HTML. Include readable tables, a source toggle, long-document bounds, and keyboard
navigation. Do not claim support for executable Markdown, embedded scripts, remote
image loading, or semantic interpretation of arbitrary document claims.

First probe: render a real Markdown design containing a heading, list, code fence,
table, HTML/script, local link, remote link and remote image. Assert structure and
that no executable/raw HTML or image request appears. Browser checks follow after
the independent reviewer releases the shared browser; the frozen candidate remains
unchanged during this work.

## Current evidence

The current local suite passes 362/362. Focused static rendering confirms real
headings, lists, GFM tables and fenced code; scripts remain text, images produce
no network-bearing elements, and unsafe link schemes have no active anchor.
Retained-link tests cover Unicode paths, missing documents and path traversal.
The common agent/source pager still passes its Unicode and retention tests.

The new dependencies are installed in an isolated temporary directory and only
new module entry symlinks were added to the development node_modules. Existing
modules used by the tenth review were not replaced. After that review completes,
a clean lockfile installation and package smoke must validate the ordinary setup.
Browser tests remain queued, and no GUI-readiness claim is inferred from SSR.

The private installed-package smoke now passes with the added dependencies. An
ordinary clean lockfile install also builds and passes all eight reader/link/
transport checks. Its five GUI assets match development byte-for-byte; see
post-tenth-reader-clean-install.json. The first offline attempt reported an
uncached existing development package; allowing its download resolved setup.
The clean workspace was removed after the check. The active review's dependency
tree was not replaced.

Packaging follow-up: the build emits original licence/notice text for its 87
bundled third-party packages. The private installed-package smoke verifies that
the notice file ships alongside the GUI. Existing runtime dependency notices are
also retained by npm. This is recorded in post-tenth-browser-notices.json and
post-tenth-package-notices.txt.
