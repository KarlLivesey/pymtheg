// SPDX-License-Identifier: MIT
/**
 * D22: Pymtheg asks Git about a folder (the commit, whether files changed)
 * whatever the folder's trust answer, so the folder's own Git configuration
 * must not be able to start a program. Git reads `.git/config` (and anything
 * it includes) from the folder itself, which can arrive with an archive or
 * a shared copy. Every Git call goes through here, with each configuration
 * key that can run a command for the commands we use overridden on the
 * command line:
 *
 *   core.fsmonitor         run by status and other index reads
 *   core.hooksPath         hooks (status runs none; set anyway)
 *   core.pager, pager.*    no pager is started (also GIT_PAGER, PAGER)
 *   core.sshCommand, core.gitProxy, credential.helper
 *                          network and credential helpers (not used here)
 *   diff.external          an external diff program
 *   filter.<driver>.clean, .smudge, .process
 *                          content filters status may run when it re-reads a
 *                          file; every driver the folder's configuration
 *                          names is emptied, which disables it
 *   diff.<driver>.textconv text conversion (status does not run it; emptied)
 *   uploadpack.packObjectsHook, core.editor, sequence.editor, gpg.program
 *                          not reached by the commands used; emptied anyway
 *
 * The folder's configuration is listed first with `git config --list`, which
 * parses it (following includes) without starting anything. Prompts and
 * optional index writes are off.
 */
import { runProcess, type ProcessResult } from "../backends/process.js";

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
  /^(filter\.[^\n]+\.(clean|smudge|process)|diff\.[^\n]+\.(textconv|command)|pager\.[^\n]+|merge\.[^\n]+\.driver)$/i;

const environment = (): NodeJS.ProcessEnv => ({
  ...process.env,
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_EXTERNAL_DIFF: "",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
});

const overrides = (pairs: [string, string][]) =>
  pairs.flatMap(([key, value]) => ["-c", `${key}=${value}`]);

/** Runs `git <args>` in `cwd` with the folder's configuration unable to start a program. */
export async function safeGit(
  args: readonly string[],
  options: {
    cwd: string;
    signal?: AbortSignal;
    timeoutMs: number;
    maxBytes: number;
  },
): Promise<ProcessResult> {
  const run = (argv: string[], maxBytes: number) =>
    runProcess("git", argv, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      maxBytes,
      env: environment(),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  const base = overrides(fixed);
  const listed = await run(
    [...base, "config", "--includes", "--null", "--name-only", "--list"],
    1024 * 1024,
  );
  const named =
    listed.kind === "exited" && listed.code === 0
      ? [
          ...new Set(
            listed.stdout.split("\0").filter((key) => executing.test(key)),
          ),
        ]
      : [];
  if (listed.kind === "cancelled") return listed;
  return run(
    [...base, ...overrides(named.map((key) => [key, ""])), ...args],
    options.maxBytes,
  );
}
