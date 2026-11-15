# Pymtheg licence: additional permission and plugin statement

Copyright (C) 2026 Karl Livesey.

Pymtheg is licensed under the Reciprocal Public License 1.5 (SPDX `RPL-1.5`),
whose full text is in [LICENSE](LICENSE). Karl Livesey is the Licensor. This
file adds one permission (part 1) and states how the Licensor applies the
licence to plugins (part 2). Capitalised terms such as Licensed Software,
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
   Studio or the MCP server).
2. **Project files.** The files `pymtheg init` writes into a project
   (`.pymtheg/project.json`, `.pymtheg/settings.json` and `.pymtheg/.gitignore`)
   and the local databases Pymtheg creates under `.pymtheg/`.
3. **Starting points.** The bundled example designs and model files under
   `examples/` (for instance `examples/mvp/`, `examples/self/` and
   `examples/workbench/`), Studio's recipes, and the MCP server's design recipes
   and declaration templates, when used as a starting point for your own designs.

**Not covered: the bundled example plugins in `examples/plugins/`.** Part 2
applies to them.

Anyone may use, copy, change and distribute covered material, for any purpose,
without restriction and without any duty under the licence, even where it
contains text that ships with Pymtheg. Covered material, and anything made from
it, is not treated as Licensed Software, a Modification, a Derivative Work, a
Required Component or an Extension, and need not carry the License Notice or
any other notice.

Your own source code, `.pym` designs, documents and data are not covered by
the licence because Pymtheg read, checked, imported, graphed or linked them.

This permission does not cover Pymtheg itself. Changing Pymtheg's own files,
including a recipe, template or example as it ships inside Pymtheg, is a
Modification under the licence; copying an example into your own project and
changing that copy is not.

## 2. Plugin statement

This part is not an extra term and not a relaxation of the licence. It states
how the Licensor reads and applies the licence to plugins.

Plugins are welcome. A plugin is any software written to extend or change what
Pymtheg does, whether through its plugin interface (for example a language
emitter loaded with `--plugin`; see [docs/output-plugins.md](docs/output-plugins.md))
or any other way. The Licensor treats a plugin as an Extension in the same way
as a change to Pymtheg's own code: a file that alters the original
functionality of the Licensed Software at runtime is a Modification under
Section 1.10(iii), and a plugin that copies any part of Pymtheg, including the
examples in `examples/plugins/`, is one under Section 1.10(ii).

So anyone who Deploys a plugin, which means any use other than for Research or
Personal Use, including use only inside their own business or organisation,
must make its Source Code available under the licence as Section 6 requires,
so that it can be integrated into Pymtheg's core. Writing a feature as a plugin
rather than as a change to Pymtheg's code does not avoid this.
