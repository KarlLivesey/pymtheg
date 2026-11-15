// Formatting is computed on the dev server; the returned edits are applied locally.
import { readFile } from "node:fs/promises";
import prettier from "prettier";
const result = {};
for (const path of process.argv.slice(2)) {
  result[path] = await prettier.format(await readFile(path, "utf8"), { filepath: path });
}
process.stdout.write(JSON.stringify(result));
