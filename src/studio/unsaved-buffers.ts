/** Cached source is not an edit. Share this distinction across checks, recovery and imports. */
export function unsavedBuffers(
  buffers: Readonly<Record<string, string>>,
  files: readonly {
    path: string;
    text: string;
    exists?: boolean | undefined;
    loaded?: boolean | undefined;
  }[],
): Record<string, string> {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return Object.fromEntries(
    Object.entries(buffers).filter(([path, text]) => {
      const original = byPath.get(path);
      return (
        !original ||
        original.exists === false ||
        original.loaded === false ||
        original.text !== text
      );
    }),
  );
}
