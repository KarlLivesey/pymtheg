import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  linkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
import { storageDirectory } from "./local.js";
import type { HistoryWriter, Origin } from "./recorded-history.js";
/** Local writer identity is durable but deliberately outside shared/exported data. */
export function localHistoryWriter(root: string): HistoryWriter {
  const directory = join(storageDirectory(root, "marker", true), "local");
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  if (
    !lstatSync(directory).isDirectory() ||
    lstatSync(directory).isSymbolicLink()
  )
    throw Error("Local identity directory must be real");
  for (const [name, text] of [
    [".gitignore", "*\n"],
    [
      "writer.json",
      JSON.stringify({
        machine: randomUUID(),
        actor: randomUUID(),
        author: userInfo().username,
      }),
    ],
  ]) {
    const staged = join(directory, randomUUID() + ".tmp");
    writeFileSync(staged, text!, { flag: "wx", mode: 0o600 });
    try {
      linkSync(staged, join(directory, name!));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    } finally {
      unlinkSync(staged);
    }
  }
  const file = join(directory, "writer.json");
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
    throw Error("Invalid local writer identity file");
  const origin = JSON.parse(readFileSync(file, "utf8")) as Origin;
  if (!origin || Object.keys(origin).sort().join() !== "actor,author,machine")
    throw Error("Invalid local writer identity");
  return { origin, now: () => new Date().toISOString() };
}
