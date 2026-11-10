import { open, rename, unlink } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { randomUUID } from "node:crypto";
export async function atomicWrite(
  destination: string,
  contents: string,
  signal?: AbortSignal,
): Promise<void> {
  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    if (signal?.aborted) throw Error("Publication cancelled");
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    if (signal?.aborted) throw Error("Publication cancelled");
    await rename(temporary, destination);
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch((e) => {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    });
  }
}
