import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";

// This event loop never parses code. Its IPC channel is the owner's lifetime:
// even SIGKILL of the owner closes the channel while the parser is busy.
const root = process.argv[2]!;
let parser: ChildProcess | undefined;
let closing = false;
let bytes = 0;
let outputLimited = false;
function send(value: unknown) {
  if (process.connected) process.send?.(value, () => {});
}
function killParser() {
  if (parser?.pid) {
    try {
      process.kill(-parser.pid, "SIGKILL");
    } catch {
      /* already exited */
    }
  }
}
async function close() {
  if (closing) return;
  closing = true;
  const stopped =
    parser && parser.exitCode === null && parser.signalCode === null
      ? new Promise<void>((resolve) => parser!.once("close", () => resolve()))
      : Promise.resolve();
  killParser();
  await stopped;
  await rm(root, { recursive: true, force: true });
  process.exitCode = 0;
  if (process.connected) process.disconnect();
}
process.on("disconnect", () => {
  void close();
});
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const)
  process.on(signal, () => {
    void close();
  });
process.on("message", (raw: unknown) => {
  if (closing || !raw || typeof raw !== "object" || !("kind" in raw)) return;
  if (raw.kind === "close") {
    void close();
    return;
  }
  if (raw.kind !== "start" || parser) return;
  const request = raw as {
    kind: "start";
    runner: string;
    input: string;
    heap: number;
  };
  parser = spawn(
    process.execPath,
    [
      `--max-old-space-size=${request.heap}`,
      request.runner,
      request.input,
      root,
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    },
  );
  send({ kind: "parser", pid: parser.pid });
  for (const stream of ["stdout", "stderr"] as const)
    parser[stream]!.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        outputLimited = true;
        killParser();
        return;
      }
      send({ kind: stream, text: chunk.toString("utf8") });
    });
  parser.on("error", (error) =>
    send({
      kind: "result",
      result: {
        kind: "spawn_failed",
        code: null,
        signal: null,
        error: error.message,
      },
    }),
  );
  parser.on("close", (code, signal) => {
    send({ kind: "parser-stopped" });
    if (!closing)
      send({
        kind: "result",
        result: {
          kind: outputLimited ? "output_limit" : "exited",
          code,
          signal,
        },
      });
    // Remain alive until the owner finishes reading the receipt and closes us.
    // Owner death during that read must also remove the private source copy.
  });
});
send({ kind: "ready" });
