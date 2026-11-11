const folders = new Set([
  "docs",
  "doc",
  "documentation",
  "design",
  "architecture",
  "spec",
  "specs",
]);
export function documentationDirectory(path: string): boolean {
  return folders.has(path.split("/")[0]!.toLowerCase());
}
export function projectDocumentationPath(path: string): boolean {
  return path.includes("/")
    ? documentationDirectory(path)
    : /\.(md|txt|rst)$/i.test(path) ||
        /^(architecture|design|requirements|decisions|contracts)[^/]*\.json$/i.test(
          path,
        );
}

/** Setup reports authored document changes, not the accompanying import ledger. */
export function documentationChanges<
  T extends { added: string[]; changed: string[]; removed: string[] },
>(summary: T): T {
  const visible = (path: string) => !path.startsWith(".pymtheg");
  return {
    ...summary,
    added: summary.added.filter(visible),
    changed: summary.changed.filter(visible),
    removed: summary.removed.filter(visible),
  };
}
