// SPDX-License-Identifier: MIT
/**
 * D22: the trust answer belongs to the machine, never to Git. It is kept in
 * `.pymtheg/local/trust.json`, a folder that ignores itself, with the
 * project's identity (project.json's id) and the checkout's absolute, real
 * path. A copied or moved checkout, which carries the same id to another
 * path, or a different project's file, is unanswered and asks again: an
 * answer is about this checkout on this machine. Nothing committed can grant
 * trust: `graph.trust: "trusted"` in the committed settings is only the
 * answer init preselects, while `"source-only"` binds (see graphToolchains).
 *
 * The local file may also name tool paths (`toolchain`), which a committed
 * file never can: a committed path to a "rust-analyzer" inside the
 * repository would run the repository's code.
 */
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { storageDirectory } from "../storage/local.js";
import { identity, json } from "../shared/identity.js";
import {
  projectTrustValues,
  type LocalTrust,
  type ProjectTrust,
} from "../shared/config.js";

export const localTrustFile = ".pymtheg/local/trust.json";
const schema = "pymtheg.trust/v1";

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

async function projectId(root: string): Promise<string | undefined> {
  try {
    const marker = JSON.parse(
      await readFile(join(root, identity.projectMarker), "utf8"),
    ) as { id?: unknown };
    return typeof marker.id === "string" ? marker.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * This machine's answer for the project at `root`, or undefined when there
 * is none for this project at this path. A malformed file is an error: it
 * names the file to repair or remove.
 */
export async function readLocalTrust(
  root: string,
): Promise<LocalTrust | undefined> {
  const path = join(root, localTrustFile);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error(
      `${localTrustFile} is not JSON; repair it or remove it to answer again.`,
    );
  }
  if (
    !object(value) ||
    value.schema !== schema ||
    !projectTrustValues.includes(value.trust as ProjectTrust)
  )
    throw Error(
      `${localTrustFile} is not a trust answer; repair it or remove it to answer again.`,
    );
  // Another project's answer, or this checkout copied or moved: unanswered.
  const [id, real] = [await projectId(root), await realpath(root)];
  if (value.project !== id || value.root !== real) return undefined;
  const toolchain: Record<string, boolean | string> = {};
  if (value.toolchain !== undefined) {
    if (!object(value.toolchain))
      throw Error(`${localTrustFile}: toolchain must be an object`);
    for (const [key, setting] of Object.entries(value.toolchain)) {
      if (
        typeof setting !== "boolean" &&
        !(typeof setting === "string" && setting.startsWith("/"))
      )
        throw Error(
          `${localTrustFile}: toolchain.${key} must be true, false or an absolute path`,
        );
      toolchain[key] = setting;
    }
  }
  return {
    trust: value.trust as ProjectTrust,
    ...(Object.keys(toolchain).length ? { toolchain } : {}),
  };
}

/** Records this machine's answer for the project at `root` (atomically). */
export async function writeLocalTrust(
  root: string,
  trust: ProjectTrust,
): Promise<void> {
  const id = await projectId(root);
  if (!id) throw Error("The trust answer needs an initialised project");
  const directory = join(storageDirectory(root, "marker", true), "local");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw Error("Local identity directory must be real");
  // The folder ignores itself, as the writer identity's does.
  await writeFile(join(directory, ".gitignore"), "*\n", {
    flag: "wx",
    mode: 0o600,
  }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const staged = join(directory, `.trust.${randomUUID()}.tmp`);
  await writeFile(
    staged,
    json({ schema, project: id, root: await realpath(root), trust }),
    { flag: "wx", mode: 0o600 },
  );
  await rename(staged, join(directory, "trust.json"));
}
