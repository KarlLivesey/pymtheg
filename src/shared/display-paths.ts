/** Presentation only: persisted evidence keeps its original provenance. */
export function displayProjectPaths(value: string, root: string) {
  const prefix = root.replace(/\/$/, "") + "/";
  return root ? value.replaceAll(prefix, "") : value;
}
