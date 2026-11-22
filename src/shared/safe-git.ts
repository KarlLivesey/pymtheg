// SPDX-License-Identifier: MIT
/**
 * D22: what Pymtheg learns from Git about a folder, by trust.
 *
 * Untrusted (unanswered or source only): no Git process is started at all.
 * The commit is read from the repository's files (\`gitCommitFromFiles\`),
 * and whether the working tree has changes is \`unknown\`.
 *
 * Trusted: Git may run, and \`safeGit\` still keeps the folder's own
 * configuration from naming a program, as defence in depth. The folder's
 * configuration is listed first (parsing it starts nothing); each key that
 * can run a command is then overridden through GIT_CONFIG_COUNT,
 * GIT_CONFIG_KEY_n and GIT_CONFIG_VALUE_n, which keep key and value apart
 * (a \`-c key=value\` argument splits at the first "=", which a filter driver's
 * own name may contain). If the listing does not finish with exit 0 within
 * its limit, Git is not run.
 */
import { constants } from "node:fs";
import { lstat, open, realpath, stat, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { runProcess, type ProcessResult } from "../backends/process.js";

/** Keys that can name a command, and the value that disables each. */
const fixed: [string, string][] = [
  ["core.fsmonitor", "false"],
  ["core.hooksPath", "/dev/null"],
  ["core.pager", "cat"],
  ["core.sshCommand", ""],
  ["core.gitProxy", ""],
  ["core.editor", ""],
  ["sequence.editor", ""],
  ["credential.helper", ""],
  ["diff.external", ""],
  ["uploadpack.packObjectsHook", ""],
  ["gpg.program", ""],
  ["safe.bareRepository", "explicit"],
];
/** Keys of the folder's configuration that name a command to run. */
const executing =
  /^(filter\..+\.(clean|smudge|process)|diff\..+\.(textconv|command)|pager\..+|merge\..+\.driver)$/is;
/** The most configuration the listing may print before Git is refused. */
const LISTING_LIMIT = 8 * 1024 * 1024;

const environment = (pairs: [string, string][]): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_PAGER: "cat",
    PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_EXTERNAL_DIFF: "",
    GIT_ASKPASS: "",
    SSH_ASKPASS: "",
    GIT_CONFIG_COUNT: String(pairs.length),
  };
  pairs.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${i}`] = key;
    env[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return env;
};

/**
 * Runs \`git <args>\` in \`cwd\` with the folder's configuration unable to name
 * a program. For a trusted folder only. Null when the configuration could
 * not be listed completely: then no Git ran.
 */
export async function safeGit(
  args: readonly string[],
  options: {
    cwd: string;
    signal?: AbortSignal;
    timeoutMs: number;
    maxBytes: number;
  },
): Promise<ProcessResult | null> {
  const run = (argv: string[], pairs: [string, string][], maxBytes: number) =>
    runProcess("git", argv, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      maxBytes,
      env: environment(pairs),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  const listed = await run(
    ["config", "--includes", "--null", "--name-only", "--list"],
    fixed,
    LISTING_LIMIT,
  );
  if (listed.kind !== "exited" || listed.code !== 0) return null;
  const named = [
    ...new Set(listed.stdout.split("\0").filter((key) => executing.test(key))),
  ];
  return run(
    [...args],
    [...fixed, ...named.map((key): [string, string] => [key, ""])],
    options.maxBytes,
  );
}

const SHA = /^[0-9a-f]{40}$|^[0-9a-f]{64}$/;
/** The most a ref-like file (HEAD, a loose ref, .git, commondir) may hold. */
const REF_LIMIT = 4096;
/** The most `packed-refs` may hold; beyond it the commit is not read. */
const PACKED_LIMIT = 32 * 1024 * 1024;

/**
 * A regular file's text, or null. Nothing that is not a regular file is
 * read: a FIFO, a device or a socket is refused before it is opened, the
 * file is opened non-blocking without following a final link, and the open
 * descriptor is checked again (`fstat`) before reading. A symbolic link is
 * followed only to a regular file inside one of `within` (the git folder or
 * its common folder). A file larger than `limit` is not read. The abort
 * signal is checked between steps.
 */
async function readRegular(
  path: string,
  limit: number,
  within: readonly string[],
  signal?: AbortSignal,
): Promise<string | null> {
  signal?.throwIfAborted();
  let target = path;
  const info = await lstat(path).catch(() => null);
  if (!info) return null;
  if (info.isSymbolicLink()) {
    const real = await realpath(path).catch(() => null);
    if (!real) return null;
    const inside = await Promise.all(
      within.map(async (folder) => {
        const base = await realpath(folder).catch(() => null);
        return base !== null && (real === base || real.startsWith(base + sep));
      }),
    );
    if (!inside.some(Boolean)) return null;
    target = real;
    const linked = await lstat(target).catch(() => null);
    if (!linked?.isFile()) return null;
  } else if (!info.isFile()) return null;
  signal?.throwIfAborted();
  let handle: FileHandle;
  try {
    handle = await open(
      target,
      constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0),
    );
  } catch {
    return null;
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > limit) return null;
    const buffer = Buffer.alloc(Math.min(opened.size, limit) + 1);
    let read = 0;
    while (read < buffer.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await handle.read(
        buffer,
        read,
        buffer.length - read,
        read,
      );
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    if (read > limit) return null;
    return buffer.toString("utf8", 0, read);
  } finally {
    await handle.close();
  }
}

/**
 * The commit checked out in the repository containing \`start\`, read from
 * its files without running Git: the nearest \`.git\` (a folder, or a file
 * naming the git folder, as worktrees and submodules have), its \`HEAD\`
 * (detached, or a ref followed through loose refs and \`packed-refs\` in the
 * common folder). Null when there is no repository or the commit cannot be
 * read.
 */
export async function gitCommitFromFiles(
  start: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let dir = resolve(start);
  let gitDir: string | null = null;
  for (;;) {
    const candidate = join(dir, ".git");
    signal?.throwIfAborted();
    const info = await lstat(candidate).catch(() => null);
    // A .git that is a link is not followed: it could lead anywhere.
    if (info?.isSymbolicLink()) return null;
    if (info?.isDirectory()) {
      gitDir = candidate;
      break;
    }
    if (info?.isFile()) {
      const text =
        (await readRegular(candidate, REF_LIMIT, [dir], signal)) ?? "";
      const named = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1];
      if (!named) return null;
      gitDir = isAbsolute(named) ? named : resolve(dir, named);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  if (!(await stat(gitDir).catch(() => null))?.isDirectory()) return null;
  const common = await readRegular(
    join(gitDir, "commondir"),
    REF_LIMIT,
    [gitDir],
    signal,
  );
  const commonDir = common?.trim()
    ? isAbsolute(common.trim())
      ? common.trim()
      : resolve(gitDir, common.trim())
    : gitDir;
  const within = [gitDir, commonDir];
  let head =
    (
      await readRegular(join(gitDir, "HEAD"), REF_LIMIT, within, signal)
    )?.trim() ?? "";
  for (let hops = 0; hops < 8; hops++) {
    if (SHA.test(head)) return head;
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
    if (!ref || ref.includes("..")) return null;
    const loose =
      (
        await readRegular(join(gitDir, ref), REF_LIMIT, within, signal)
      )?.trim() ??
      (
        await readRegular(join(commonDir, ref), REF_LIMIT, within, signal)
      )?.trim();
    if (loose !== undefined && loose !== null) {
      head = loose;
      continue;
    }
    const packed =
      (await readRegular(
        join(commonDir, "packed-refs"),
        PACKED_LIMIT,
        within,
        signal,
      )) ?? "";
    for (const line of packed.split("\n")) {
      const [sha, name] = line.trim().split(" ");
      if (name === ref && sha && SHA.test(sha)) return sha;
    }
    return null;
  }
  return null;
}
