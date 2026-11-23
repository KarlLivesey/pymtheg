// SPDX-License-Identifier: MIT
// C-45 review: another process's complete `graph index` of <root> with the
// table module, run inside a session run's window before its baseline.
import { executeGraph } from "../../../dist/graph/commands.js";
import { LanguageRegistry } from "../../../dist/graph/index.js";
import { tableModule } from "./table-module.mjs";

const response = await executeGraph(
  { command: "index", root: process.argv[2] },
  { registry: new LanguageRegistry([tableModule]) },
);
process.stdout.write(JSON.stringify({ complete: response.sync.complete }));
