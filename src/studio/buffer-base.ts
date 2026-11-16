// SPDX-License-Identifier: MIT
/** A buffer's save precondition belongs to that buffer, not the latest disk list. */
export class SourceBufferBases {
  private readonly hashes = new Map<string, string | null>();
  expected(path: string, fallback: string | null): string | null {
    return this.hashes.has(path) ? this.hashes.get(path)! : fallback;
  }
  /** Explicit load/reload or a reviewed conflict resolution adopts this base. */
  loaded(path: string, hash: string | null): void {
    this.hashes.set(path, hash);
  }
  /** Another save can acknowledge identical content, but cannot rebase different text. */
  observed(
    file: { path: string; hash: string; text: string },
    buffer: string | undefined,
  ): boolean {
    if (buffer === undefined || buffer === file.text) {
      this.loaded(file.path, file.hash);
      return false;
    }
    return this.expected(file.path, null) !== file.hash;
  }
  /** A matching owned write may advance its base while newer typing stays unsaved. */
  acknowledged(path: string, expected: string | null, savedHash: string): void {
    if (!this.hashes.has(path) || this.hashes.get(path) === expected)
      this.loaded(path, savedHash);
  }
}
