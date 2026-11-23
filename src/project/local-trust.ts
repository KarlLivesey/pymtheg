// SPDX-License-Identifier: MIT
/**
 * D22: the trust answer belongs to the user, never to the repository. It is
 * kept outside every checkout, in the user's own configuration, the way
 * coding agents keep theirs: one file mapping each checkout's real path (with
 * the project's id as a cross-check) to the answer and any local tool paths.
 * Anything inside a working tree is under the repository's control (a file
 * can be force-added; checkout paths are often predictable), so nothing under
 * a checkout is ever read as a trust answer or a tool path.
 *
 * Location: $PYMTHEG_CONFIG_HOME, else $XDG_CONFIG_HOME/pymtheg, else
 * ~/Library/Application Support/pymtheg on macOS, %APPDATA%\pymtheg on
 * Windows and ~/.config/pymtheg elsewhere; the file is `trust.json`, created
 * with user-only permissions. An unreadable, corrupt or wrong-typed file, or
 * an entry for another project at that path, is unanswered: never trusted.
 * A moved or copied checkout is unanswered (another real path); each Git
 * worktree is its own path and is asked once.
 */
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, realpathSync } from "node:fs";
import {
  chmod,
  link,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { identity, json } from "../shared/identity.js";
import {
  projectTrustValues,
  type LocalTrust,
  type ProjectTrust,
} from "../shared/config.js";

const schema = "pymtheg.trust/v1";

/** The directory of the user's Pymtheg configuration. */
export function userConfigDirectory(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (env.PYMTHEG_CONFIG_HOME && isAbsolute(env.PYMTHEG_CONFIG_HOME))
    return env.PYMTHEG_CONFIG_HOME;
  if (env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME))
    return join(env.XDG_CONFIG_HOME, "pymtheg");
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "pymtheg");
  if (process.platform === "win32" && env.APPDATA)
    return join(env.APPDATA, "pymtheg");
  return join(homedir(), ".config", "pymtheg");
}
/**
 * The user's cache folder: $PYMTHEG_CACHE_HOME, else $XDG_CACHE_HOME/pymtheg,
 * ~/Library/Caches/pymtheg on macOS, %LOCALAPPDATA%\pymtheg on Windows and
 * ~/.cache/pymtheg elsewhere.
 */
export function userCacheDirectory(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (env.PYMTHEG_CACHE_HOME && isAbsolute(env.PYMTHEG_CACHE_HOME))
    return env.PYMTHEG_CACHE_HOME;
  if (env.XDG_CACHE_HOME && isAbsolute(env.XDG_CACHE_HOME))
    return join(env.XDG_CACHE_HOME, "pymtheg");
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Caches", "pymtheg");
  if (process.platform === "win32" && env.LOCALAPPDATA)
    return join(env.LOCALAPPDATA, "pymtheg");
  return join(homedir(), ".cache", "pymtheg");
}
/**
 * D22: where the toolchain routes build their helpers and keep their cached
 * facts for one checkout: the user's cache folder, keyed by the checkout's
 * real path, never inside the checkout, so nothing found in the working tree
 * is ever run or read as toolchain output.
 */
export function toolchainWorkDirectory(root: string): string {
  // A test run must never touch the user's real cache (as for trust answers).
  if (process.env.PYMTHEG_TEST && !process.env.PYMTHEG_CACHE_HOME)
    throw Error(
      "PYMTHEG_TEST is set but PYMTHEG_CACHE_HOME is not: refusing to use the real cache from a test run",
    );
  let real = root;
  try {
    real = realpathSync(root);
  } catch {
    /* a missing root keys by its path */
  }
  const cache = userCacheDirectory();
  // The cache folders are user-only; a folder the user named is left as it is.
  mkdirSync(cache, { recursive: true, mode: 0o700 });
  if (!process.env.PYMTHEG_CACHE_HOME || basename(cache) === "pymtheg")
    chmodSync(cache, 0o700);
  const key = createHash("sha256").update(real).digest("hex").slice(0, 24);
  const work = join(cache, "toolchain", key);
  mkdirSync(work, { recursive: true, mode: 0o700 });
  chmodSync(join(cache, "toolchain"), 0o700);
  chmodSync(work, 0o700);
  return work;
}
/** Whether the cache folder resolves inside the checkout (then no toolchain runs). */
export async function cacheInsideCheckout(root: string): Promise<boolean> {
  return insideCheckout(userCacheDirectory(), root);
}
/**
 * Whether a folder is the checkout or lies inside it, by file identity: it
 * and each parent up to the file-system root are compared with the checkout
 * root by device and inode, so neither spelling, symlinks nor a
 * case-insensitive or normalising file system can hide it.
 */
export async function insideCheckout(
  folder: string,
  root: string,
): Promise<boolean> {
  let rootInfo;
  try {
    rootInfo = await stat(root);
  } catch {
    return false;
  }
  let dir = folder;
  try {
    dir = await realpath(folder);
  } catch {
    /* compare what exists of it */
  }
  for (;;) {
    try {
      const info = await stat(dir);
      if (info.dev === rootInfo.dev && info.ino === rootInfo.ino) return true;
    } catch {
      /* an unreadable or missing level: keep walking up */
    }
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}
/** Whether a tool file lies inside the checkout (its folder, by identity). */
export async function toolInsideCheckout(
  tool: string,
  root: string,
): Promise<boolean> {
  let path = tool;
  try {
    path = await realpath(tool);
  } catch {
    /* the route reports a missing tool */
  }
  return insideCheckout(dirname(path), root);
}
/** The user's trust answers. */
export const trustFile = () => join(userConfigDirectory(), "trust.json");

interface Entry {
  project: string;
  trust: ProjectTrust;
  toolchain?: Record<string, boolean | string>;
  recorded: string;
}

const object = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Every well-formed entry; an unreadable or corrupt file has none. */
/**
 * Every well-formed entry, and whether the file was whole: absent, or every
 * part of it well formed. An unreadable or corrupt file has no entries.
 */
async function readFileEntries(): Promise<{
  entries: Record<string, Entry>;
  whole: boolean;
}> {
  let text: string;
  try {
    text = await readFile(trustFile(), "utf8");
  } catch (error) {
    return {
      entries: {},
      whole: (error as NodeJS.ErrnoException).code === "ENOENT",
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { entries: {}, whole: false };
  }
  if (!object(value) || value.schema !== schema || !object(value.checkouts))
    return { entries: {}, whole: false };
  let whole = true;
  const entries: Record<string, Entry> = {};
  for (const [path, entry] of Object.entries(value.checkouts)) {
    if (
      !isAbsolute(path) ||
      !object(entry) ||
      typeof entry.project !== "string" ||
      !projectTrustValues.includes(entry.trust as ProjectTrust)
    ) {
      whole = false;
      continue;
    }
    let toolchain: Record<string, boolean | string> | undefined;
    if (entry.toolchain !== undefined) {
      // A wrong-typed tool setting makes the whole entry unanswered.
      if (!object(entry.toolchain)) {
        whole = false;
        continue;
      }
      toolchain = {};
      let valid = true;
      for (const [key, setting] of Object.entries(entry.toolchain)) {
        if (
          typeof setting !== "boolean" &&
          !(typeof setting === "string" && isAbsolute(setting))
        )
          valid = false;
        else toolchain[key] = setting;
      }
      if (!valid) {
        whole = false;
        continue;
      }
    }
    entries[path] = {
      project: entry.project,
      trust: entry.trust as ProjectTrust,
      ...(toolchain && Object.keys(toolchain).length ? { toolchain } : {}),
      recorded: typeof entry.recorded === "string" ? entry.recorded : "",
    };
  }
  return { entries, whole };
}
async function readAll(): Promise<Record<string, Entry>> {
  return (await readFileEntries()).entries;
}

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

/** The user's answer for the checkout at `root`, or undefined. */
export async function readLocalTrust(
  root: string,
): Promise<LocalTrust | undefined> {
  let real: string;
  try {
    real = await realpath(root);
  } catch {
    return undefined;
  }
  // A configuration folder inside the checkout is the repository's: refused.
  if (await insideCheckout(userConfigDirectory(), real)) return undefined;
  const entry = (await readAll())[real];
  if (!entry || entry.project !== (await projectId(real))) return undefined;
  return {
    trust: entry.trust,
    ...(entry.toolchain ? { toolchain: entry.toolchain } : {}),
  };
}

/** Test seam: a pause inside a write, while the lock is held. */
export const trustLockHooks: { afterLock?: () => Promise<void> } = {};

/** How long a writer waits for another to finish (SQLite busy timeout). */
const LOCK_WAIT_MS = 30_000;
/** Writes in this process, one at a time (the database lock is per connection). */
let inProcess: Promise<unknown> = Promise.resolve();

/** Whether the configuration folder is the tool's own (only that is chmodded). */
const ownFolder = (directory: string) =>
  !process.env.PYMTHEG_CONFIG_HOME || basename(directory) === "pymtheg";

/**
 * Updates the answers file under a lock the operating system owns: a write
 * transaction (BEGIN IMMEDIATE) on a lock-only SQLite database beside the
 * file. The lock is released when its holder commits, rolls back or dies, so
 * there is no stale lock to judge or take over. Inside it the file is
 * re-read, merged, written to a user-only temporary file and renamed into
 * place. A lock database that cannot be opened or locked fails the write:
 * nothing is ever written unlocked.
 */
async function update(
  change: (entries: Record<string, Entry>) => void,
): Promise<void> {
  // A test run (npm test sets PYMTHEG_TEST) must never write the user's real
  // file: a process that lost its isolated folder fails loudly instead.
  if (process.env.PYMTHEG_TEST && !process.env.PYMTHEG_CONFIG_HOME)
    throw Error(
      "PYMTHEG_TEST is set but PYMTHEG_CONFIG_HOME is not: refusing to write the real trust answers from a test run",
    );
  const run = inProcess.then(() => locked(change));
  inProcess = run.catch(() => {});
  return run;
}
async function locked(
  change: (entries: Record<string, Entry>) => void,
): Promise<void> {
  const directory = userConfigDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // The tool's own folder (never a parent, never a folder the user named) is
  // kept user-only; the files always are.
  if (ownFolder(directory)) await chmod(directory, 0o700);
  const lockPath = join(directory, "trust.lock.sqlite");
  let db: import("node:sqlite").DatabaseSync;
  try {
    const { DatabaseSync } = process.getBuiltinModule(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    db = new DatabaseSync(lockPath);
    await chmod(lockPath, 0o600);
    db.exec(`PRAGMA busy_timeout=${LOCK_WAIT_MS}`);
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    throw Error(
      `The trust answers cannot be locked (${lockPath}): ${error instanceof Error ? error.message : String(error)}. Nothing was written.`,
    );
  }
  try {
    await trustLockHooks.afterLock?.();
    const { entries, whole } = await readFileEntries();
    if (!whole) {
      const aside = await setAside();
      process.stderr.write(
        `Pymtheg: the trust answers file was unreadable or not well formed; it was moved to ${aside} and a new one written with its valid entries.\n`,
      );
    }
    change(entries);
    const staged = join(directory, `.trust.${randomUUID()}.tmp`);
    await writeFile(staged, json({ schema, checkouts: entries }), {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(staged, 0o600);
    await rename(staged, trustFile());
    db.exec("COMMIT");
  } finally {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.close();
  }
}

/** Moves a bad answers file aside (trust.json.corrupt-<n>, user-only). */
async function setAside(): Promise<string> {
  for (let n = 1; ; n++) {
    const aside = `${trustFile()}.corrupt-${n}`;
    try {
      await link(trustFile(), aside);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    await chmod(aside, 0o600);
    await unlink(trustFile());
    return aside;
  }
}

/** Records the user's answer for the checkout at `root`. */
export async function writeLocalTrust(
  root: string,
  trust: ProjectTrust,
): Promise<void> {
  const real = await realpath(root);
  const project = await projectId(real);
  if (!project) throw Error("The trust answer needs an initialised project");
  if (await insideCheckout(userConfigDirectory(), real))
    throw Error(
      `The Pymtheg configuration folder ${userConfigDirectory()} lies inside this checkout, so no trust answer is kept there. Set PYMTHEG_CONFIG_HOME to a folder outside it.`,
    );
  await update((entries) => {
    entries[real] = { project, trust, recorded: new Date().toISOString() };
  });
}

/** Every recorded answer (for `pymtheg trust --list`). */
export async function listTrust(): Promise<
  { root: string; project: string; trust: ProjectTrust; recorded: string }[]
> {
  return Object.entries(await readAll())
    .map(([root, entry]) => ({ root, ...entry }))
    .sort((a, b) => (a.root < b.root ? -1 : a.root > b.root ? 1 : 0));
}

/** Removes the answer for a checkout path (real or as recorded). */
export async function revokeTrust(root: string): Promise<boolean> {
  let key = root;
  try {
    key = await realpath(root);
  } catch {
    /* a deleted checkout: the recorded path itself */
  }
  let removed = false;
  await update((entries) => {
    if (entries[key]) {
      delete entries[key];
      removed = true;
    }
  });
  return removed;
}
