// SPDX-License-Identifier: MIT
// A child process for the trust-lock tests (C-44): `hold <project>` takes the
// answers lock, writes "held" and waits for a line on stdin before writing
// and releasing; `write <project>` writes "start", then an answer, then
// "done". PYMTHEG_CONFIG_HOME comes from the parent.
import "./isolated-config.mjs";
import { once } from "node:events";
import {
  trustLockHooks,
  writeLocalTrust,
} from "../dist/project/local-trust.js";

const [action, project, answer = "trusted"] = process.argv.slice(2);
if (action === "hold")
  trustLockHooks.afterLock = async () => {
    process.stdout.write("held\n");
    await once(process.stdin, "data");
  };
else process.stdout.write("start\n");
await writeLocalTrust(project, answer);
process.stdout.write(action === "hold" ? "released\n" : "done\n");
process.exit(0);
