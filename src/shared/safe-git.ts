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
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
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
const readText = (path: string) =>
  readFile(path, "utf8").then(
    (text) => text,
    () => null,
  );

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
): Promise<string | null> {
  let dir = resolve(start);
  let gitDir: string | null = null;
  for (;;) {
    const candidate = join(dir, ".git");
    const info = await stat(candidate).catch(() => null);
    if (info?.isDirectory()) {
      gitDir = candidate;
      break;
    }
    if (info?.isFile()) {
      const text = (await readText(candidate)) ?? "";
      const named = /^gitdir:\s*(.+?)\s*$/m.exec(text)?.[1];
      if (!named) return null;
      gitDir = isAbsolute(named) ? named : resolve(dir, named);
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  const common = await readText(join(gitDir, "commondir"));
  const commonDir = common?.trim()
    ? isAbsolute(common.trim())
      ? common.trim()
      : resolve(gitDir, common.trim())
    : gitDir;
  let head = (await readText(join(gitDir, "HEAD")))?.trim() ?? "";
  for (let hops = 0; hops < 8; hops++) {
    if (SHA.test(head)) return head;
    const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
    if (!ref || ref.includes("..")) return null;
    const loose =
      (await readText(join(gitDir, ref)))?.trim() ??
      (await readText(join(commonDir, ref)))?.trim();
    if (loose !== undefined && loose !== null) {
      head = loose;
      continue;
    }
    const packed = (await readText(join(commonDir, "packed-refs"))) ?? "";
    for (const line of packed.split("\n")) {
      const [sha, name] = line.trim().split(" ");
      if (name === ref && sha && SHA.test(sha)) return sha;
    }
    return null;
  }
  return null;
}
