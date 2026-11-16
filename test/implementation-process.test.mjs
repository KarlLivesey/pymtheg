// SPDX-License-Identifier: MIT
import { within, processState } from "./process-safety.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { captureImplementation as productionCapture } from "../dist/implementation/capture.js";

function captureImplementation(root, paths, label, signal, execution) {
  const controller = new AbortController();
  const running = productionCapture(
    root,
    paths,
    label,
    AbortSignal.any([signal, controller.signal]),
    execution,
  );
  return within(running, "capture completion or parser readiness", async () => {
    controller.abort();
    await within(
      running.catch(() => {}),
      "capture cancellation cleanup",
    );
  });
}

test("a native fatal child signal falls back without aborting its caller or changing source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-native-capture-"));
  try {
    const a = "export function a() { return 1; }";
    await writeFile(join(root, "a.ts"), a);
    await writeFile(join(root, "b.ts"), "export function b() { return 2; }");
    const runner = join(root, "force-native-abort.mjs");
    const production = new URL(
      "../dist/implementation/capture-child.js",
      import.meta.url,
    ).href;
    await writeFile(
      runner,
      String.raw`import {readFileSync} from 'node:fs';
const lines=readFileSync(process.argv[2],'utf8').trim().split('\n');
// Native abort is deterministic. Real large-corpus probes independently exercise
// V8 heap failure; this regression must not depend on GC allocation behavior.
if(lines.length>2) process.abort();
else await import(${JSON.stringify(production)});`,
    );
    const graph = await captureImplementation(
      root,
      ["a.ts", "b.ts"],
      "After native failure",
      new AbortController().signal,
      { runnerURL: pathToFileURL(runner), partitionBytes: 1, heapMiB: 128 },
    );
    assert.equal(graph.reader.id, "typescript-ast-partitioned/v15");
    assert.equal(graph.nodes.filter((n) => n.kind === "function").length, 2);
    assert.ok(
      graph.limitations.some(
        (text) =>
          /SIGABRT|exit code 134/.test(text) && /cause is unknown/.test(text),
      ),
    );
    assert.equal(await readFile(join(root, "a.ts"), "utf8"), a);
    const next = await captureImplementation(
      root,
      ["a.ts"],
      "Still usable",
      new AbortController().signal,
    );
    assert.equal(next.files.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture cancellation waits for process cleanup after a ready handshake", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-capture-cancel-"));
  try {
    await writeFile(join(root, "a.ts"), "export const a = 1;");
    const runner = join(root, "busy.mjs");
    await writeFile(
      runner,
      String.raw`process.stdout.write('ready\n'); for (;;) {}
`,
    );
    const controller = new AbortController();
    await assert.rejects(
      captureImplementation(root, ["a.ts"], "Cancelled", controller.signal, {
        runnerURL: pathToFileURL(runner),
        onReady: () => controller.abort(),
      }),
      /abort/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("abrupt owner death reaps a busy parser and removes its private source transfer", async () => {
  const { spawn } = await import("node:child_process");
  const { readdir, access } = await import("node:fs/promises");
  const { createServer } = await import("node:net");
  const { once } = await import("node:events");
  for (const competingReaper of [false, true]) {
    for (const signal of ["SIGKILL", "SIGHUP"]) {
      const project = await mkdtemp(join(tmpdir(), "pym-owner-death-"));
      // Isolate supervisor-only transfers from other full-suite startup reapers.
      const transfers = competingReaper ? tmpdir() : join(project, "transfers");
      if (!competingReaper) await mkdir(transfers);
      let owner, ownerClosed, busyPid, transfer, connection, supervisorPid;
      const server = createServer();
      const socketPath = join(project, "supervisor.sock");
      let supervisorReady, supervisorStopped;
      const connected = new Promise((resolve, reject) => {
        server.once("error", reject);
        server.once("connection", (socket) => {
          connection = socket;
          let text = "";
          supervisorReady = new Promise((ready) => {
            socket.on("data", (chunk) => {
              text += chunk;
              if (text.includes("\n")) ready(Number(text.split("\n")[0]));
            });
          });
          supervisorStopped = new Promise((stopped, fail) => {
            socket.on("end", () => {
              if (text.includes("STOPPED\n")) stopped();
              else
                fail(
                  Error("Supervisor disconnected without cleanup completion"),
                );
            });
            socket.on("error", fail);
          });
          void supervisorStopped.catch(() => {});
          resolve();
        });
      });
      server.listen(socketPath);
      await within(once(server, "listening"), "supervisor observer listening");
      try {
        await writeFile(
          join(project, "a.ts"),
          'export const secret = "private source";',
        );
        const parser = join(project, "busy.mjs");
        await writeFile(
          parser,
          'import {writeFileSync} from "node:fs"; writeFileSync(' +
            JSON.stringify(join(project, "pid")) +
            ',String(process.pid)); process.stdout.write("ready\\n"); for(;;) {}',
        );
        const module = new URL(
          "../dist/implementation/capture.js",
          import.meta.url,
        ).href;
        const script = join(project, "owner.mjs");
        await writeFile(
          script,
          `import {captureImplementation} from ${JSON.stringify(module)}; import {pathToFileURL} from 'node:url'; await captureImplementation(${JSON.stringify(project)},['a.ts'],'Private',new AbortController().signal,{runnerURL:pathToFileURL(${JSON.stringify(parser)}),onReady:()=>process.send({kind:'ready'})});`,
        );
        owner = spawn(process.execPath, [script], {
          stdio: ["ignore", "ignore", "pipe", "ipc"],
          env: {
            ...process.env,
            TMPDIR: transfers,
            PYM_TEST_SUPERVISOR_SOCKET: socketPath,
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${new URL("./capture-supervisor-observer.mjs", import.meta.url).href}`,
          },
        });
        ownerClosed = once(owner, "close");
        void ownerClosed.catch(() => {});
        await within(
          Promise.all([once(owner, "message"), connected]),
          "busy parser readiness and supervisor connection",
        );
        supervisorPid = await within(supervisorReady, "supervisor PID");
        const pid = Number(await readFile(join(project, "pid"), "utf8"));
        busyPid = pid;

        for (const name of await readdir(transfers)) {
          if (!name.startsWith("pym-code-process-")) continue;
          try {
            const data = JSON.parse(
              await readFile(join(transfers, name, "owner.json"), "utf8"),
            );
            if (data.pid === owner.pid) transfer = join(transfers, name);
          } catch {}
        }
        assert.ok(transfer);
        if (competingReaper) {
          // Force the ordering seen with concurrent captures: startup recovery can
          // remove the dead owner's transfer before its supervisor is scheduled.
          process.kill(supervisorPid, "SIGSTOP");
          await processState(
            supervisorPid,
            ["T"],
            "supervisor stopped at the cleanup gate",
          );
        }
        const exited = once(owner, "exit");
        owner.kill(signal);
        await within(exited, `owner ${signal} exit`);
        if (competingReaper) {
          const { reapStaleCaptures } = await import(
            "../dist/implementation/capture-lease.js"
          );
          await reapStaleCaptures();
          await assert.rejects(access(transfer), { code: "ENOENT" });
          // Removal alone is insufficient: the parser is demonstrably still alive.
          process.kill(pid, 0);
          process.kill(supervisorPid, "SIGCONT");
        }
        await within(
          supervisorStopped,
          "supervisor completion after parser reaping",
        );
        await assert.rejects(access(transfer), { code: "ENOENT" });
        assert.throws(
          () => process.kill(pid, 0),
          (error) => error.code === "ESRCH",
        );
      } finally {
        owner?.kill("SIGKILL");
        if (supervisorPid) {
          try {
            process.kill(supervisorPid, "SIGCONT");
          } catch {}
        }
        let cleanupError;
        if (supervisorStopped) {
          try {
            await within(supervisorStopped, "supervisor cleanup in finally");
          } catch (error) {
            cleanupError = error;
            try {
              process.kill(supervisorPid, "SIGKILL");
            } catch {}
          }
        }
        connection?.destroy();
        await within(
          new Promise((resolve) => server.close(resolve)),
          "observer socket closure",
        );
        if (ownerClosed) await within(ownerClosed, "owner pipe closure");
        if (busyPid) {
          try {
            process.kill(busyPid, "SIGKILL");
          } catch {}
        }
        if (transfer) await rm(transfer, { recursive: true, force: true });
        await rm(project, { recursive: true, force: true });
        if (cleanupError) throw cleanupError;
      }
    }
  }
});

test("startup cleanup removes only marked transfers with a dead owner", async () => {
  const { reapStaleCaptures, captureOwnerScope } = await import(
    "../dist/implementation/capture-lease.js"
  );
  const { spawn } = await import("node:child_process");
  const { once } = await import("node:events");
  const { access } = await import("node:fs/promises");
  const dead = await mkdtemp(join(tmpdir(), "pym-code-process-"));
  const live = await mkdtemp(join(tmpdir(), "pym-code-process-"));
  const legacy = await mkdtemp(join(tmpdir(), "pym-code-process-"));
  const foreign = await mkdtemp(join(tmpdir(), "pym-code-process-"));
  try {
    const scope = await captureOwnerScope();
    assert.ok(
      scope,
      "this Linux cleanup test requires an observable owner scope",
    );
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await within(once(child, "exit"), "startup cleanup fixture exit", () =>
      child.kill("SIGKILL"),
    );
    await writeFile(
      join(dead, "owner.json"),
      JSON.stringify({
        schema: "pymtheg.capture-owner/v2",
        pid: child.pid,
        scope,
      }),
    );
    await writeFile(join(dead, "input.jsonl"), "private source transfer");
    await writeFile(
      join(live, "owner.json"),
      JSON.stringify({
        schema: "pymtheg.capture-owner/v2",
        pid: process.pid,
        scope,
      }),
    );
    await writeFile(join(legacy, "input.jsonl"), "unknown owner: preserve");
    await writeFile(
      join(legacy, "owner.json"),
      JSON.stringify({ schema: "pymtheg.capture-owner/v1", pid: child.pid }),
    );
    await writeFile(
      join(foreign, "owner.json"),
      JSON.stringify({
        schema: "pymtheg.capture-owner/v2",
        pid: child.pid,
        scope: "different-boot-or-pid-namespace",
      }),
    );
    await writeFile(
      join(foreign, "input.jsonl"),
      "a missing PID in this namespace cannot prove a foreign owner dead",
    );
    await reapStaleCaptures();
    await assert.rejects(access(dead), { code: "ENOENT" });
    await access(live);
    await access(legacy);
    await access(foreign);
  } finally {
    for (const root of [dead, live, legacy, foreign])
      await rm(root, { recursive: true, force: true });
  }
});

test("ordinary failures mentioning heap filenames never claim memory exhaustion or trigger fallback", async () => {
  const { observeInProcess, ObservationFallbackError } = await import(
    "../dist/implementation/capture-process.js"
  );
  const { hash } = await import("../dist/shared/identity.js");
  const root = await mkdtemp(join(tmpdir(), "pym-oom-attribution-"));
  try {
    for (const message of [
      "Error parsing heap-utils.ts",
      "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory",
    ]) {
      const runner = join(root, "ordinary-error.mjs");
      await writeFile(
        runner,
        `process.stderr.write(${JSON.stringify(message)});process.exit(1);`,
      );
      await assert.rejects(
        observeInProcess(
          [{ path: "a.ts", text: "", hash: hash("") }],
          { label: "Failure", gitCommit: null, dirty: true },
          null,
          new AbortController().signal,
          { runnerURL: pathToFileURL(runner) },
        ),
        (error) => {
          assert.ok(!(error instanceof ObservationFallbackError));
          assert.equal(error.message, message);
          return true;
        },
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
