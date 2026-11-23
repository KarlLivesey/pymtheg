// SPDX-License-Identifier: MIT
// C-45 review: a module that keeps a table of each file's declared name
// (`k=<name>`) and re-derives only the changed files, so a kept table that
// is not proved current shows in the stored results.
export const tableModule = {
  id: "table",
  version: "1",
  extensions: [".k"],
  parse() {
    return { status: "clean", diagnostics: [], symbols: [], links: [] };
  },
  analyze(context) {
    const kept = context.kept?.get("table", "v1");
    const table = new Map(kept ?? []);
    const changed = new Set(
      kept ? context.changedFiles : context.files.map((file) => file.path),
    );
    for (const file of context.files)
      if (changed.has(file.path) || !table.has(file.path))
        table.set(file.path, /k=(\S*)/.exec(file.text)?.[1] ?? null);
    for (const path of [...table.keys()])
      if (!context.files.some((file) => file.path === path)) table.delete(path);
    context.kept?.set("table", "v1", [...table]);
    return context.files.map((file) => ({
      path: file.path,
      result: {
        status: "clean",
        diagnostics: [],
        symbols: [],
        links: [],
        data: { name: table.get(file.path) },
      },
    }));
  },
};
