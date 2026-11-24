// SPDX-License-Identifier: MIT
// C-50: a graph worker whose language module cannot finish. It serves the
// request with the production protocol (serveGraphRequest) and a registry
// of the storage fixture language; parsing a file that contains "stuck"
// raises a flag in shared memory and then loops forever, synchronously.
// With `socket`, it first starts a child process (through runProcess, as a
// toolchain is started) that cannot finish: the child and a grandchild in
// its process group each connect to the test's socket and wait forever.
//
// Shared flags (Int32): [0] raised when a module call is where the test
// waits for it; [1] released by the test (a blocked continuation goes on);
// [2] raised if the call that cannot finish was ever entered.
// - "stuck": synchronous code that never returns (inside the call);
// - "stretch": an async call that, after an await, spins inside
//   `synchronousStretch` (a module's synchronous stretch while awaited);
// - "block": an async call whose continuation blocks until released, in
//   the awaited section, not inside the call;
// - "awaitchild": an async call that awaits a child process (with its
//   grandchild, as above) and does not pass the abort signal to it, so only
//   a kill of its process group ends the wait;
// - with `workerData.folder` ("cleanup"): the module has an async project
//   analysis instead, which creates that folder (as the Go toolchain route
//   creates its run folder), then waits for its abort signal, removes the
//   folder and rejects. It cannot finish any other way.
import { mkdirSync, rmSync } from "node:fs";
import { workerData } from "node:worker_threads";
import { runProcess } from "../dist/backends/process.js";
import { serveGraphRequest } from "../dist/cli/graph-worker.js";
import { LanguageRegistry } from "../dist/graph/index.js";
import { synchronousStretch } from "../dist/graph/sections.js";
import { fixtureModule } from "./graph-kill-fixture.mjs";

const flag = new Int32Array(workerData.flag);
// Connects to the socket and waits forever; the first one also starts a
// grandchild in the same process group that does the same.
const CHILD = `
const net = require("node:net");
const { spawn } = require("node:child_process");
const [path, script, grand] = process.argv.slice(1);
// Each says its pid, so the test can clean up whatever survives.
net.connect(path, function () { this.write(process.pid + "\\n"); });
if (!grand)
  spawn(process.execPath, ["-e", script, path, script, "grand"], { stdio: "ignore" });
setInterval(() => {}, 1 << 30);
`;
const base = fixtureModule();
const stuck = {
  ...base,
  parse(input) {
    if (input.text.includes("awaitchild"))
      return (async () => {
        const child = runProcess(
          process.execPath,
          ["-e", CHILD, workerData.socket, CHILD],
          { cwd: process.cwd(), timeoutMs: 2 ** 31 - 1 },
        );
        // After one await the call has returned its promise, so the worker
        // has announced the awaited section.
        await null;
        Atomics.store(flag, 0, 1);
        Atomics.notify(flag, 0);
        await child.catch(() => undefined);
        return base.parse(input);
      })();
    if (input.text.includes("block"))
      return (async () => {
        await null;
        Atomics.store(flag, 0, 1);
        Atomics.notify(flag, 0);
        Atomics.wait(flag, 1, 0);
        return base.parse(input);
      })();
    if (input.text.includes("stretch"))
      return (async () => {
        await null;
        return synchronousStretch(() => {
          Atomics.store(flag, 0, 1);
          Atomics.notify(flag, 0);
          for (;;);
        });
      })();
    if (input.text.includes("stuck")) {
      Atomics.store(flag, 2, 1);
      if (workerData.socket)
        void runProcess(
          process.execPath,
          ["-e", CHILD, workerData.socket, CHILD],
          {
            cwd: process.cwd(),
            timeoutMs: 2 ** 31 - 1,
          },
        );
      Atomics.store(flag, 0, 1);
      Atomics.notify(flag, 0);
      for (;;);
    }
    return base.parse(input);
  },
};
const { parse: _parse, ...analysed } = base;
const cleanup = {
  ...analysed,
  async analyze(context) {
    mkdirSync(workerData.folder, { recursive: true });
    // After one await the call has returned its promise: the worker has
    // announced the awaited section.
    await null;
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
    return new Promise((_resolve, reject) =>
      context.signal.addEventListener(
        "abort",
        () => {
          rmSync(workerData.folder, { recursive: true, force: true });
          reject(context.signal.reason);
        },
        { once: true },
      ),
    );
  },
};
await serveGraphRequest(
  workerData.request,
  workerData.control,
  { registry: new LanguageRegistry([workerData.folder ? cleanup : stuck]) },
  workerData.childGroups,
);
