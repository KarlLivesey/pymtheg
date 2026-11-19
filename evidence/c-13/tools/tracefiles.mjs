// tracefiles.mjs BUILD_DIR : patches a debugging copy of the compiled
// TypeScript module to log, with the live heap, each file the taint walk
// seeds from ("TAINT"), each file extracted ("EXTRACT"), and each
// declaration whose parts the walk reads ("PARTS", every 5,000th).
import { readFileSync, writeFileSync } from "node:fs";
const [build] = process.argv.slice(2);
const heap = "Math.round(process.memoryUsage().heapUsed / 1048576), Date.now()";
const patch = (file, pairs) => {
  const path = `${build}/dist/graph/languages/typescript/${file}`;
  let text = readFileSync(path, "utf8");
  for (const [old, add] of pairs) {
    const at = text.indexOf(old);
    if (at < 0) throw Error(`not found in ${file}: ${old}`);
    text = text.slice(0, at + old.length) + add + text.slice(at + old.length);
  }
  writeFileSync(path, text);
};
patch("taint.js", [
  ["for (const source of sources) {", ` console.error("TAINT", source.fileName, ${heap});`],
  ["for (const node of declarations) {", ` if ((globalThis.__parts = (globalThis.__parts || 0) + 1) % 5000 === 0) console.error("PARTS", globalThis.__parts, node.getSourceFile().fileName, node.pos, ${heap});`],
  ["while (queue.length) {", ` if ((globalThis.__queue = (globalThis.__queue || 0) + 1) % 20000 === 1) console.error("QUEUE", globalThis.__queue, queue.length, all.size, weak.size, dependents.size, ${heap});`],
]);
patch("index.js", [
  ["const extractOnce = (session, path, data, diagnostics, renamed, skip) => {", ` console.error("EXTRACT", path, ${heap});`],
]);
console.log("patched");
