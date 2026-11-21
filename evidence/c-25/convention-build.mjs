// SPDX-License-Identifier: MIT
// Run on a separate copy of a compiled analyzer in dev-server scratch.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [build] = process.argv.slice(2);
const file = join(
  build,
  "dist/graph/languages/typescript/workspace-entries.js",
);
const code = readFileSync(file, "utf8");
const needle = "const match = find(root, output);";
if (
  code.split(needle).length !== 2 ||
  !code.includes("available: configs.size > 0")
)
  throw Error("Build does not have the expected C-25 resolver");
writeFileSync(
  file,
  code
    .replace(
      needle,
      `
            let match = find(root, output);
            if (match === undefined || match === false) {
                const relative = posix.relative(root, output);
                if (/^(?:dist|lib|build|out)\\//.test(relative)) {
                    const stem = relative.replace(/^[^/]+/, "src").replace(outputExtension, "");
                    const sources = [".ts", ".tsx", ".mts", ".cts"]
                        .map(extension => posix.join(root, stem + extension))
                        .filter(source => packageOf(source) === root && captured.has(source.slice(1)));
                    if (sources.length === 1)
                        match = {proof: "convention", config: "(convention)", output: output.slice(1), source: sources[0].slice(1)};
                }
            }`,
    )
    .replace(/available: configs\.size > 0[^\n]*/, "available: true,"),
);
