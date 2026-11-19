// SPDX-License-Identifier: MIT
// C-8 evidence: prints the module providers the Go module finds for one
// import, from the go.mod and go.work files of a checkout (diagnosis aid).
// Usage: node import-providers.mjs BUILD CHECKOUT IMPORTER_DIRECTORY IMPORT_PATH
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const [build, checkout, importer, path] = process.argv.slice(2);
const gomod = await import(join(build, "dist/graph/languages/go/gomod.js"));
const files = execFileSync("git", ["-C", checkout, "ls-files", "*go.mod", "*go.work"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .map((file) => ({ path: file, status: "clean", text: readFileSync(join(checkout, file), "utf8") }));
const layout = gomod.readLayout(files);
console.log(JSON.stringify(layout.modules.map((m) => ({ directory: m.directory, path: m.path, go: m.go, requires: [...m.requires.entries()].filter(([p]) => path.startsWith(p)), replacements: m.replacements })), null, 1));
console.log(JSON.stringify(gomod.directoryOfImport(layout, importer, path), null, 1));
