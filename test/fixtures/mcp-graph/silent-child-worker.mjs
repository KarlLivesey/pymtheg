// A worker that starts a child that never finishes, records it in the job's
// registry as the production worker does, and never answers an abort: the
// job manager must still end the cancel and kill the child (C-54).
import { parentPort, workerData } from "node:worker_threads";
import { useChildGroups } from "../../../dist/backends/child-groups.js";
import { runProcess } from "../../../dist/backends/process.js";

useChildGroups(workerData.childGroups);
parentPort.unref();
await runProcess(
  process.execPath,
  [
    "-e",
    `require("fs").writeFileSync(${JSON.stringify(workerData.ready)}, String(process.pid)); setInterval(() => {}, 1000);`,
  ],
  { cwd: workerData.root, timeoutMs: 2 ** 31 - 1 },
);
