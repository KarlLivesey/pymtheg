import { storagePath, findProjectRoot } from "../storage/local.js";
import { readFile, realpath, stat } from "node:fs/promises";
import { relative, sep } from "node:path";
import { projectConfig, type ProjectConfig } from "../shared/config.js";
import { hash } from "../shared/identity.js";
export async function loadConfig(
  root: string,
): Promise<{ config: ProjectConfig; hash: string | null }> {
  try {
    const file = await realpath(storagePath(root, "settings"));
    const child = relative(await realpath(root), file);
    if (child === ".." || child.startsWith(".." + sep))
      throw Error("Project configuration is outside the project root");
    if ((await stat(file)).size > 2 * 1024 * 1024)
      throw Error("Project configuration exceeds 2 MiB");
    const text = await readFile(file, "utf8");
    return {
      config: projectConfig(JSON.parse(text) as unknown),
      hash: hash(text),
    };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { config: { version: 1, scenarios: {} }, hash: null };
    throw e;
  }
}
export async function findConfig(
  start: string,
): Promise<{ root: string; config: ProjectConfig; hash: string | null }> {
  const root = findProjectRoot(start);
  return { root, ...(await loadConfig(root)) };
}
