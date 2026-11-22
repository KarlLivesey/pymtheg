// SPDX-License-Identifier: MIT
import {
  storagePath,
  storageDirectory,
  findProjectRoot,
} from "../storage/local.js";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  link,
  rename,
  unlink,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { identity, json } from "../shared/identity.js";
import {
  workspaceSchema,
  type WorkspaceIdentity,
} from "../shared/workspace.js";
import { loadConfig } from "./config.js";
import type { ProjectTrust } from "../shared/config.js";

/** D22: the init answer to "do you trust this repository?". */
export interface InitOptions {
  trust?: ProjectTrust;
  /**
   * An answer nobody gave (a command-line init with no terminal) is only
   * written into a settings file this init creates. Existing metadata is
   * never changed without an explicit answer.
   */
  defaulted?: boolean;
}
/** The settings file a new project starts with, with its trust answer. */
const initialSettings = (trust: ProjectTrust | undefined) =>
  json({
    version: 1,
    scenarios: {},
    ...(trust ? { graph: { trust } } : {}),
  });
/** The trust answer recorded in a project's settings, if any. */
async function recordedTrust(root: string) {
  return (await loadConfig(root)).config.graph?.trust;
}
/**
 * Records `trust` in an existing settings file that has no answer yet, keeping
 * everything else in it. Never replaces a recorded answer: re-running init
 * does not change it (D22); the settings file is where it is changed.
 */
async function recordTrust(root: string, trust: ProjectTrust | undefined) {
  if (!trust) return false;
  const current = await recordedTrust(root);
  if (current === trust) return false;
  if (current)
    throw Error(
      `This project's trust answer is already "${current}". Init does not change it; edit graph.trust in ${identity.projectConfig} to change it.`,
    );
  const file = storagePath(root, "settings", true);
  const value = JSON.parse(await readFile(file, "utf8")) as Record<
    string,
    unknown
  >;
  const graph =
    value.graph && typeof value.graph === "object"
      ? (value.graph as Record<string, unknown>)
      : {};
  const staged = resolve(dirname(file), `.settings.${randomUUID()}.tmp`);
  const handle = await open(staged, "wx", 0o600);
  try {
    await handle.writeFile(json({ ...value, graph: { ...graph, trust } }));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(staged, file);
  await validateInitConfig(root);
  return true;
}
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
/** Workspace at the nearest metadata/Git boundary. Read-only; no creation. */
export async function findWorkspace(
  input: string,
): Promise<{ root: string; workspace: WorkspaceIdentity } | null> {
  const resolved = await realpath(input);
  const root = findProjectRoot(
    (await lstat(resolved)).isDirectory() ? resolved : dirname(resolved),
  );
  const workspace = await readWorkspace(root);
  return workspace ? { root, workspace } : null;
}
async function createOnce(path: string, text: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink())
      throw Error(`Project metadata must be a regular file: ${path}`);
    return false;
  } catch (error) {
    if (!missing(error)) throw error;
  }
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
      "# Local databases and rebuildable state. Share exported history.\nshared/\nrebuildable/\n*.tmp\n",
    )
  )
    filesCreated.push(".pymtheg/.gitignore");
  return filesCreated;
}
export async function initializeWorkspace(
  input: string,
  name?: string,
  options: InitOptions = {},
) {
  try {
    return await initialize(input, name, options);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EACCES", "EPERM", "EROFS"].includes(code ?? "")) throw error;
    const failed = (error as NodeJS.ErrnoException).path ?? resolve(input);
    const path = basename(failed).endsWith(".tmp") ? dirname(failed) : failed;
    throw Error(
      `Cannot initialize project: ${path} is not writable. Choose a writable directory or grant your user write permission.`,
    );
  }
}
async function validateInitConfig(root: string) {
  try {
    await loadConfig(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw Error(
      `Invalid project settings at ${storagePath(root, "settings")}: ${message}. Repair invalid metadata without deleting your designs.`,
    );
  }
}
async function initialize(
  input: string,
  name: string | undefined,
  options: InitOptions,
) {
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
    // A nested folder uses its project's answer (D22).
    const trust = await recordedTrust(ancestor.root);
    if (options.trust && options.trust !== trust)
      throw Error(
        `This folder belongs to “${ancestor.workspace.name}” at ${ancestor.root}, whose trust answer is ${trust ? `"${trust}"` : "not recorded"}. Change it in that project's ${identity.projectConfig}.`,
      );
    return {
      ...ancestor,
      created: false,
      filesCreated: [],
      trust: trust ?? null,
      trustRecorded: false,
    };
  }
  await validateInitConfig(root);
  const previous = await readWorkspace(root);
  if (previous) {
    if (requested && requested !== previous.name)
      throw Error(
        `Project is already initialized as “${previous.name}”. Its identity and name were preserved.`,
      );
    const filesCreated = await protectLocalStorage(root);
    let trustRecorded = false;
    if (
      await createOnce(
        storagePath(root, "settings", true),
        initialSettings(options.trust),
      )
    ) {
      filesCreated.push(identity.projectConfig);
      trustRecorded = !!options.trust;
    }
    await validateInitConfig(root);
    if (!trustRecorded && !options.defaulted)
      trustRecorded = await recordTrust(root, options.trust);
    return {
      root,
      workspace: previous,
      created: false,
      filesCreated,
      trust: (await recordedTrust(root)) ?? null,
      trustRecorded,
    };
  }
  await validateInitConfig(root); // Validate existing configuration before creating metadata.
  const marker = await markerFile(root);
  await mkdir(dirname(marker), { recursive: true });
  const filesCreated: string[] = [];
  filesCreated.push(...(await protectLocalStorage(root)));
  let trustRecorded = false;
  if (
    await createOnce(
      storagePath(root, "settings", true),
      initialSettings(options.trust),
    )
  ) {
    filesCreated.push(identity.projectConfig);
    trustRecorded = !!options.trust;
  }
  await validateInitConfig(root); // A concurrent writer's configuration must also validate.
  if (!trustRecorded && !options.defaulted)
    trustRecorded = await recordTrust(root, options.trust);
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
  return {
    root,
    workspace: actual,
    created,
    filesCreated,
    trust: (await recordedTrust(root)) ?? null,
    trustRecorded,
  };
}
/**
 * Initialise `root` exactly as `pymtheg init` with no options would, unless it
 * already has a project marker. Used before the first planning write that an
 * agent or link command makes, so that write never leaves a half-made
 * `.pymtheg/` (no project.json, settings or .gitignore). Null when the
 * project was already initialised.
 */
export async function initializeBeforeWrite(root: string) {
  if (await readWorkspace(root)) return null;
  return initializeWorkspace(root);
}
