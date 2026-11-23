// SPDX-License-Identifier: MIT
// C-50: a graph worker whose language module cannot finish. It serves the
// request with the production protocol (serveGraphRequest) and a registry
// of the storage fixture language; parsing a file that contains "stuck"
// raises a flag in shared memory and then loops forever, synchronously.
// With `socket`, it first starts a child process (through runProcess, as a
// toolchain is started) that cannot finish: the child and a grandchild in
// its process group each connect to the test's socket and wait forever.
import { workerData } from "node:worker_threads";
import { runProcess } from "../dist/backends/process.js";
import { serveGraphRequest } from "../dist/cli/graph-worker.js";
import { LanguageRegistry } from "../dist/graph/index.js";
import { fixtureModule } from "./graph-kill-fixture.mjs";

const flag = new Int32Array(workerData.flag);
// Connects to the socket and waits forever; the first one also starts a
// grandchild in the same process group that does the same.
const CHILD = `
const net = require("node:net");
const { spawn } = require("node:child_process");
const [path, script, grand] = process.argv.slice(1);
net.connect(path);
if (!grand)
  spawn(process.execPath, ["-e", script, path, script, "grand"], { stdio: "ignore" });
setInterval(() => {}, 1 << 30);
`;
const base = fixtureModule();
const stuck = {
  ...base,
  parse(input) {
    if (input.text.includes("stuck")) {
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
await serveGraphRequest(
  workerData.request,
  workerData.control,
  { registry: new LanguageRegistry([stuck]) },
  workerData.children,
);
