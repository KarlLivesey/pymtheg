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
import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
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
  const entry = (await readAll())[real];
  if (!entry || entry.project !== (await projectId(real))) return undefined;
  return {
    trust: entry.trust,
    ...(entry.toolchain ? { toolchain: entry.toolchain } : {}),
  };
}

/**
 * Updates the file under a lock (create-exclusive), re-reading and merging so
 * concurrent writers keep each other's entries, then writes a user-only
 * temporary file and renames it into place. A lock whose owner is gone is
 * taken over.
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
  const directory = userConfigDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // The tool's own folder (never a parent) is kept user-only.
  await chmod(directory, 0o700);
  const lock = join(directory, "trust.json.lock");
  const mine = `${process.pid} ${await startTime(process.pid)} ${randomUUID()}`;
  for (let attempt = 0; ; attempt++) {
    try {
      await writeFile(lock, mine, { flag: "wx", mode: 0o600 });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const [pid = "0", started = ""] = (
        await readFile(lock, "utf8").catch(() => "0")
      ).split(" ");
      const owner = Number(pid);
      let alive = false;
      try {
        if (owner > 0) {
          process.kill(owner, 0);
          // A reused pid has another start time (where the system says).
          alive = !started || (await startTime(owner)) === started;
        }
      } catch {
        /* gone */
      }
      if (!alive) await unlink(lock).catch(() => {});
      else if (attempt > 2000)
        throw Error(`${lock} is held by process ${owner}; try again`);
      else await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  try {
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
  } finally {
    await unlink(lock).catch(() => {});
  }
}

/** The process's start time on Linux (/proc), else empty: the lock's pid check. */
async function startTime(pid: number): Promise<string> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? "";
  } catch {
    return "";
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
