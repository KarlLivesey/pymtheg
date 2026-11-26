// C-55 test: another process's complete `graph index` of <root> with the
// production modules.
import { executeGraph } from "../../../dist/graph/commands.js";

const response = await executeGraph({
  command: "index",
  root: process.argv[2],
});
process.stdout.write(JSON.stringify({ complete: response.sync.complete }));
