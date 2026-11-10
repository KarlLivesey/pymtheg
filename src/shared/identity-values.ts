/** Provisional public names are shared by Node and the browser without runtime dependencies.
 * Storage and protocol IDs are separate compatibility identities; keep them stable
 * through a marketing/CLI rename unless a migration is explicitly designed. */
export const identity = {
  cli: "pymtheg",
  extension: ".pym",
  projectMarker: ".pymtheg/project.json",
  projectConfig: ".pymtheg.json",
  version: "1.0.0",
  schema: "pymtheg.report/v1",
  semantics: "1.0",
} as const;

export function sourceFileName(stem: string): string {
  return stem.endsWith(identity.extension) ? stem : stem + identity.extension;
}
