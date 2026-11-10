import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
export interface ProcessClock {
  schedule(callback: () => void, milliseconds: number): unknown;
  cancel(handle: unknown): void;
}
const systemClock: ProcessClock = {
  schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
  cancel: (handle) => clearTimeout(handle as NodeJS.Timeout),
};
export interface ProcessResult {
  kind: "exited" | "spawn_failed" | "timed_out" | "cancelled" | "output_limit";
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
  cleanup: string;
}
export async function runProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
    signal?: AbortSignal;
    maxBytes?: number;
    env?: NodeJS.ProcessEnv;
    clock?: ProcessClock;
    onStdout?: (text: string) => void;
    input?: string;
  },
): Promise<ProcessResult> {
  const start = performance.now();
  const clock = options.clock ?? systemClock;
  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    let kind: ProcessResult["kind"] = "exited",
      stdout = "",
      stderr = "",
      bytes = 0,
      done = false,
      killTimer: unknown = null,
      finishTimer: unknown = null;
    const outDecoder = new StringDecoder("utf8"),
      errDecoder = new StringDecoder("utf8");
    const max = options.maxBytes ?? 1024 * 1024;
    const kill = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid) process.kill(-child.pid, signal);
      } catch {
        /* already gone */
      }
    };
    const stop = (reason: ProcessResult["kind"]): void => {
      if (kind === "exited") kind = reason;
      kill("SIGTERM");
      if (!killTimer) killTimer = clock.schedule(() => kill("SIGKILL"), 100);
    };
    const abort = (): void => stop("cancelled");
    const finish = (code: number | null, signal: string | null): void => {
      if (done) return;
      done = true;
      clock.cancel(timer);
      if (killTimer) clock.cancel(killTimer);
      if (finishTimer) clock.cancel(finishTimer);
      options.signal?.removeEventListener("abort", abort);
      kill("SIGKILL");
      child.stdout?.destroy();
      child.stderr?.destroy();
      stdout += outDecoder.end();
      stderr += errDecoder.end();
      resolve({
        kind,
        code,
        signal,
        stdout,
        stderr,
        elapsedMs: performance.now() - start,
        cleanup:
          "Owned process group sent SIGKILL; leader reaped; orphan descendant reaping belongs to OS",
      });
    };
    const timer = clock.schedule(() => stop("timed_out"), options.timeoutMs);
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? process.env,
        detached: true,
        stdio: [
          options.input === undefined ? "ignore" : "pipe",
          "pipe",
          "pipe",
        ],
        shell: false,
      });
    } catch (e) {
      clock.cancel(timer);
      resolve({
        kind: "spawn_failed",
        code: null,
        signal: null,
        stdout: "",
        stderr: String(e),
        elapsedMs: performance.now() - start,
        cleanup: "not spawned",
      });
      return;
    }
    if (options.input !== undefined && child.stdin) {
      child.stdin.on("error", () => {
        /* Early child exit is classified by exit/output. */
      });
      child.stdin.end(options.input);
    }
    const capture = (chunk: Buffer, which: "stdout" | "stderr"): void => {
      bytes += chunk.length;
      if (bytes > max) {
        stop("output_limit");
        return;
      }
      if (which === "stdout") {
        const text = outDecoder.write(chunk);
        stdout += text;
        if (text) options.onStdout?.(text);
      } else stderr += errDecoder.write(chunk);
    };
    child.stdout?.on("data", (x: Buffer) => capture(x, "stdout"));
    child.stderr?.on("data", (x: Buffer) => capture(x, "stderr"));
    child.on("error", (e) => {
      kind = "spawn_failed";
      stderr += String(e);
      finish(null, null);
    });
    // exit is separate from close: a descendant may retain inherited pipes.
    child.on("exit", (code, signal) => {
      kill("SIGTERM");
      finishTimer = clock.schedule(() => finish(code, signal), 120);
    });
    child.on("close", (code, signal) => finish(code, signal));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}
