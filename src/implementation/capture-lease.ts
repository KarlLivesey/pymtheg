// SPDX-License-Identifier: MIT
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  readdir,
  lstat,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
export type CaptureResult = {
  kind: "exited" | "spawn_failed" | "output_limit";
  code: number | null;
  signal: string | null;
  stderr: string;
};

/** PIDs establish ownership only inside the same boot and PID namespace. */
export async function captureOwnerScope(): Promise<string | null> {
  try {
    const [boot, namespace] = await Promise.all([
      readFile("/proc/sys/kernel/random/boot_id", "utf8"),
      readlink("/proc/self/ns/pid"),
    ]);
    return `${boot.trim()}:${namespace}`;
  } catch {
    return null;
  }
}

/** Reap only our own marked directories whose owner demonstrably no longer exists. */
export async function reapStaleCaptures() {
  const scope = await captureOwnerScope();
  if (!scope) return; // Ownership cannot be established; supervisor cleanup still works.
  for (const name of await readdir(tmpdir())) {
    if (!name.startsWith("pym-code-process-")) continue;
    const root = join(tmpdir(), name);
    try {
      const info = await lstat(root);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (process.getuid && info.uid !== process.getuid())
      )
        continue;
      const marker = await lstat(join(root, "owner.json"));
      if (!marker.isFile() || marker.isSymbolicLink() || marker.size > 4096)
        continue;
      const owner = JSON.parse(
        await readFile(join(root, "owner.json"), "utf8"),
      ) as { schema?: string; pid?: number; scope?: string };
      if (
        owner.schema !== "pymtheg.capture-owner/v2" ||
        owner.scope !== scope ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid! <= 0
      )
        continue;
      try {
        process.kill(owner.pid!, 0);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH")
          await rm(root, { recursive: true, force: true });
      }
    } catch {
      /* Unknown/active/legacy directories are never inferred to be ours. */
    }
  }
}
export async function captureLease(
  root: string,
  signal: AbortSignal,
  onReady?: () => void,
) {
  await writeFile(
    join(root, "owner.json"),
    JSON.stringify({
      schema: "pymtheg.capture-owner/v2",
      pid: process.pid,
      scope: await captureOwnerScope(),
    }),
    { flag: "wx" },
  );
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./capture-supervisor.js", import.meta.url)), root],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      shell: false,
    },
  );
  let readyResolve!: () => void, readyReject!: (e: Error) => void;
  let resultResolve!: (r: CaptureResult) => void,
    resultReject!: (e: Error) => void;
  let closeResolve!: () => void;
  let finished = false,
    closed = false,
    stderr = "",
    parserPid: number | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const result = new Promise<CaptureResult>((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  const stopped = new Promise<void>((resolve) => {
    closeResolve = resolve;
  });
  // A failure may arrive while the owner is still writing its captured input.
  void ready.catch(() => {});
  void result.catch(() => {});
  const fail = (error: Error) => {
    readyReject(error);
    if (!finished) {
      finished = true;
      resultReject(error);
    }
  };
  const abort = () => {
    fail(
      signal.reason instanceof Error
        ? signal.reason
        : Error("Code capture cancelled"),
    );
    if (child.connected) child.send({ kind: "close" });
  };
  child.on("message", (raw: unknown) => {
    if (!raw || typeof raw !== "object" || !("kind" in raw)) return;
    const message = raw as {
      pid?: number;
      kind: string;
      text?: string;
      result?: Omit<CaptureResult, "stderr"> & { error?: string };
    };
    if (message.kind === "ready") readyResolve();
    if (message.kind === "parser") parserPid = message.pid;
    if (message.kind === "parser-stopped") parserPid = undefined;
    if (message.kind === "stderr") stderr += message.text ?? "";
    if (message.kind === "stdout" && message.text?.includes("ready"))
      onReady?.();
    if (message.kind === "result" && !finished) {
      finished = true;
      resultResolve({
        ...message.result!,
        stderr: stderr + (message.result?.error ?? ""),
      });
    }
  });
  child.on("error", fail);
  child.on("close", () => {
    if (parserPid) {
      try {
        process.kill(-parserPid, "SIGKILL");
      } catch {}
    }
    closed = true;
    signal.removeEventListener("abort", abort);
    fail(
      Error(
        "Code capture supervisor stopped before completing the request; previous versions were preserved.",
      ),
    );
    closeResolve();
  });
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  return {
    ready,
    result,
    start(runner: string, input: string, heap: number) {
      signal.throwIfAborted();
      if (!child.connected) throw Error("Capture supervisor is unavailable");
      child.send({ kind: "start", runner, input, heap });
    },
    async close() {
      if (!closed && child.connected) child.send({ kind: "close" });
      await stopped;
    },
  };
}
