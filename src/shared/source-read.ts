import { constants, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { open } from "node:fs/promises";
import { sourceFileByteLimit } from "./source-limits.js";

export class SourceReadError extends Error {
  constructor(
    readonly kind: "not-regular" | "too-large",
    message: string,
  ) {
    super(message);
  }
}
const flags =
  constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0);
function check(status: { isFile(): boolean; size: number }) {
  if (!status.isFile())
    throw new SourceReadError("not-regular", "Source must be a regular file");
  if (status.size > sourceFileByteLimit) tooLarge();
}
function tooLarge(): never {
  throw new SourceReadError("too-large", "File size limit (2 MiB) exceeded");
}
function chunk(size: number) {
  return Buffer.allocUnsafe(Math.min(65536, sourceFileByteLimit + 1 - size));
}

/** Worker-side source reads enforce the limit during reading, not only at stat. */
export function readSourceBytesSync(path: string): Buffer {
  const fd = openSync(path, flags);
  try {
    check(fstatSync(fd));
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const buffer = chunk(size),
        bytes = readSync(fd, buffer, 0, buffer.length, size);
      if (!bytes) return Buffer.concat(chunks, size);
      size += bytes;
      if (size > sourceFileByteLimit) tooLarge();
      chunks.push(buffer.subarray(0, bytes));
    }
  } finally {
    closeSync(fd);
  }
}

/** Coordinator-side equivalent; cancellation is observed between bounded reads. */
export async function readSourceBytes(
  path: string,
  signal: AbortSignal,
): Promise<Buffer> {
  signal.throwIfAborted();
  const handle = await open(path, flags);
  try {
    signal.throwIfAborted();
    check(await handle.stat());
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      signal.throwIfAborted();
      const buffer = chunk(size),
        { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
      signal.throwIfAborted();
      if (!bytesRead) return Buffer.concat(chunks, size);
      size += bytesRead;
      if (size > sourceFileByteLimit) tooLarge();
      chunks.push(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
}
