/** Decode retained text without replacing bytes. Preserve a UTF-8 BOM in the
 * stored original; parsers may ignore it when interpreting the document. */
export function decodeUtf8(
  bytes: Uint8Array | ArrayBuffer,
  label: string,
): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw Error(
      `${label} is not valid UTF-8 text. No replacement characters were imported.`,
    );
  }
}
