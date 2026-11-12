import { storagePath, storageDirectory } from "../storage/local.js";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  link,
  unlink,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { identity, json } from "../shared/identity.js";
import {
  workspaceSchema,
  type WorkspaceIdentity,
} from "../shared/workspace.js";
import { loadConfig } from "./config.js";
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";
async function markerFile(root: string): Promise<string> {
  const marker = storagePath(root, "marker"),
    folder = dirname(marker);
  try {
    const metadata = await lstat(folder);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      throw Error(
        "Project metadata directory must be a directory, not a symbolic link or file",
      );
  } catch (error) {
    if (!missing(error)) throw error;
  }
  try {
    if (
      !(await lstat(marker)).isFile() ||
      (await lstat(marker)).isSymbolicLink()
    )
      throw Error("Project marker must be a regular file");
  } catch (error) {
    if (!missing(error)) throw error;
  }
  return marker;
}
export async function readWorkspace(
  root: string,
): Promise<WorkspaceIdentity | null> {
  const marker = await markerFile(root);
  let raw: string;
  try {
    if ((await lstat(marker)).size > 16384)
      throw Error("Project marker exceeds 16 KiB");
    raw = await readFile(marker, "utf8");
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  try {
    return workspaceSchema.parse(JSON.parse(raw));
  } catch {
    throw Error(
      `Invalid project marker at ${marker}. Restore or repair it; initialization will not overwrite it.`,
    );
  }
}
/** Nearest initialized ancestor. Read-only; no implicit workspace creation. */
export async function findWorkspace(
  input: string,
): Promise<{ root: string; workspace: WorkspaceIdentity } | null> {
  const resolved = await realpath(input);
  let root = (await lstat(resolved)).isDirectory()
    ? resolved
    : dirname(resolved);
  for (;;) {
    const workspace = await readWorkspace(root);
    if (workspace) return { root, workspace };
    const parent = dirname(root);
    if (parent === root) return null;
    root = parent;
  }
}
async function createOnce(path: string, text: string): Promise<boolean> {
  const staged = resolve(
    dirname(path),
    `.${basename(path)}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(staged, "wx", 0o600);
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(staged, path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  } finally {
    await handle?.close();
    await unlink(staged).catch((error) => {
      if (!missing(error)) throw error;
    });
  }
}
async function protectLocalStorage(root: string): Promise<string[]> {
  const filesCreated: string[] = [];
  const storage = storageDirectory(root, "marker", true);
  await mkdir(storage, { mode: 0o700 }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  });
  const storageStat = await lstat(storage);
  if (!storageStat.isDirectory() || storageStat.isSymbolicLink())
    throw Error(
      "Local architecture storage must be a directory, not a symbolic link",
    );
  if (
    await createOnce(
      resolve(storage, ".gitignore"),
      "# Local databases and rebuildable state. Share exported history.\nshared/\nrebuildable/\n",
    )
  )
    filesCreated.push(".pymtheg/.gitignore");
  return filesCreated;
}
export async function initializeWorkspace(input: string, name?: string) {
  const requested = name?.trim();
  if (name !== undefined && (!requested || requested.length > 160))
    throw Error("Choose a project name of 1–160 characters");
  await mkdir(resolve(input), { recursive: true });
  const root = await realpath(input);
  const ancestor = await findWorkspace(root);
  if (ancestor && ancestor.root !== root) {
    if (requested && requested !== ancestor.workspace.name)
      throw Error(
        `This folder belongs to “${ancestor.workspace.name}” at ${ancestor.root}. Initialize outside that project to create a separate workspace.`,
      );
    return { ...ancestor, created: false, filesCreated: [] };
  }
  await loadConfig(root);
  const previous = await readWorkspace(root);
  if (previous) {
    if (requested && requested !== previous.name)
      throw Error(
        `Project is already initialized as “${previous.name}”. Its identity and name were preserved.`,
      );
    return {
      root,
      workspace: previous,
      created: false,
      filesCreated: await protectLocalStorage(root),
    };
  }
  await loadConfig(root); // Validate existing configuration before creating metadata.
  const marker = await markerFile(root);
  await mkdir(dirname(marker), { recursive: true });
  const filesCreated: string[] = [];
  filesCreated.push(...(await protectLocalStorage(root)));
  if (
    await createOnce(
      storagePath(root, "settings", true),
      json({ version: 1, scenarios: {} }),
    )
  )
    filesCreated.push(identity.projectConfig);
  await loadConfig(root); // A concurrent writer's configuration must also validate.
  const workspace: WorkspaceIdentity = {
    schema: "pymtheg.workspace/v1",
    id: randomUUID(),
    name: requested ?? (basename(root).trim().slice(0, 160) || "New project"),
    created: new Date().toISOString(),
  };
  const created = await createOnce(marker, json(workspace));
  if (created) filesCreated.push(identity.projectMarker);
  const actual = await readWorkspace(root);
  if (!actual) throw Error("Initialization did not publish a project identity");
  if (requested && actual.name !== requested)
    throw Error(
      `Another initializer named this project “${actual.name}”; no identity was overwritten.`,
    );
  return { root, workspace: actual, created, filesCreated };
}
