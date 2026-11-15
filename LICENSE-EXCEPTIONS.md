# Pymtheg licence: additional permission and plugin declaration

Copyright (C) 2026 Karl Livesey.

Pymtheg is licensed under the Reciprocal Public License 1.5 (SPDX `RPL-1.5`),
whose full text is in [LICENSE](LICENSE). Karl Livesey is the Licensor. This
file adds one permission (part 1) and declares how the licence covers plugins
(part 2). Capitalised terms such as Licensed Software,
Extensions, Modifications, Derivative Works, Required Components, Deploy,
Research, Personal Use and Source Code have the meanings given in Section 1 of
the licence.

## 1. Additional permission: output and project files

The Licensor grants this permission in addition to the licence. It removes
duties for the material listed below; it takes away no right the licence gives.

Covered material:

1. **Output.** Everything Pymtheg generates when it runs: reports, findings,
   counterexamples and traces, graph data and code-graph databases, requirement
   and code links, recorded and exported history, and emitted or generated code
   (scaffolds, types, functions and stubs from `pymtheg scaffold`, `pymtheg emit`,
   Studio or the MCP server). Copies or builds of Pymtheg's own code are not
   output, even when Pymtheg makes them while it runs (for example the Go
   helper it compiles from its own `golinks.go`).
2. **Project files.** The files `pymtheg init` writes into a project
   (`.pymtheg/project.json`, `.pymtheg/settings.json` and `.pymtheg/.gitignore`)
   and the local databases Pymtheg creates under `.pymtheg/`.
3. **Starting points.** When used as a starting point for your own designs:
   the bundled example designs and model files under `examples/` (for instance
   `examples/mvp/`, `examples/self/` and `examples/workbench/`), Studio's
   recipes, the MCP server's design recipes and declaration templates, and the
   examples in Pymtheg's documentation, including the language and workflow
   guides the MCP server gives to agents (`docs/grammar.md`,
   `docs/agent-workflow.md`).

**Not covered: the bundled example plugins in `examples/plugins/`.** Part 2
applies to them.

Anyone may use, copy, change and distribute covered material, for any purpose,
without restriction and without any duty under the licence, even where it
contains text that ships with Pymtheg. Covered material, and anything made from
it, is not treated as Licensed Software, a Modification, a Derivative Work, a
Required Component or an Extension, and need not carry the License Notice or
any other notice.

Your own source code, `.pym` designs, documents and data are not covered by
the licence merely because Pymtheg read, checked, imported, graphed or linked
them.

This permission does not cover Pymtheg itself. Changing Pymtheg's own files,
including a recipe, template or example as it ships inside Pymtheg, is a
Modification under the licence. Copying a covered example into your own
project and changing that copy is not treated as one; this does not apply to
the example plugins in `examples/plugins/`.

## 2. Plugins

Plugins are welcome. **The Licensor declares that a plugin, and any other code
that Pymtheg itself loads and runs to change or add to Pymtheg's behaviour, is
deemed an Extension of the Licensed Software and is covered by the Reciprocal
Public License 1.5 on the same terms as a change to Pymtheg's own code,
including when it is used only inside one business or organisation.**

This covers code Pymtheg itself loads and runs: today, a language emitter
loaded with `--plugin` (see [docs/output-plugins.md](docs/output-plugins.md)),
and any plugin mechanism Pymtheg adds later. Software that merely runs
Pymtheg, talks to it over MCP or uses its output is not covered by this
declaration, and part 1 is unaffected.

This is a term on which the Licensor offers Pymtheg: by using Pymtheg with
such code, you accept that it is covered in this way. For code copied or
derived from Pymtheg, including the example plugins in `examples/plugins/`,
the licence's own definitions apply: "any new file or storage that contains
any part of Licensed Software" is a Modification (Section 1.10(ii)), and a
Derivative Work is an Extension (Sections 1.3 and 1.5). For code written
independently, the Licensor relies on Section 1.10(iii) (a file "which replaces
or otherwise alters the original functionality of Licensed Software at
runtime") and Section 1.3.

So anyone who Deploys such code (Section 1.2: uses, Serves, sublicenses or
distributes it other than for their own internal Research or Personal Use,
including any use or distribution only inside their own business or
organisation) must make its Source Code available under the licence as
Section 6 requires, so that it can be integrated into Pymtheg's core. Writing
a feature as a plugin, rather than as a change to Pymtheg's code, does not
avoid this.
