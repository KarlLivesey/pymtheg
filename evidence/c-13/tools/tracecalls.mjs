// tracecalls.mjs BUILD_DIR [FILE_PART] : patches BUILD_DIR's compiled TypeScript module so
// that every checker call made through the module's checker wrapper is
// logged to stderr with its method, the node's file, position and kind, and
// the live heap, only for nodes in files whose name contains FILE_PART if
// given (a debugging copy; never the build under test).
import { readFileSync, writeFileSync } from "node:fs";
const [build] = process.argv.slice(2);
const path = `${build}/dist/graph/languages/typescript/index.js`;
const text = readFileSync(path, "utf8");
const old = "                    return value.apply(checker, args);";
if (!text.includes(old)) throw Error("wrapper line not found");
const only = process.argv[3];
const patched = text.replace(
  old,
  `                    if (${only ? "" : "true || "}${process.env.AFTER_PARTS ? `(globalThis.__parts || 0) >= ${Number(process.env.AFTER_PARTS)} || ` : ""}(first && typeof first.kind === "number" && first.getSourceFile().fileName.includes(${JSON.stringify(only ?? "")}))) console.error("CALL", key, first && typeof first.kind === "number" ? \`\${first.getSourceFile().fileName}:\${first.getStart()}:\${ts.SyntaxKind[first.kind]}:\${first.getText().slice(0, 60).replace(/\\s+/g, " ")}\` : "", Math.round(process.memoryUsage().heapUsed / 1048576), new Error().stack.split("\\n").slice(2, 9).map((l) => l.trim().replace(/^at /, "").replace(/ \\(.*\\/([^/]+):(\\d+):\\d+\\)$/, "@$1:$2")).join(" < "));
${old}`,
);
writeFileSync(path, patched);
console.log("patched", path);
