// livecount.mjs BUILD DIR : runs the TypeScript module over DIR (a git
// checkout, e.g. from synth.mjs) and prints, at each program build, the
// live compiler symbols, nodes and source files and the live heap, all
// after a full collection.
import { queryObjects } from "node:v8";
import { createRequire } from "node:module";
const [build, dir] = process.argv.slice(2);
const ts = createRequire(`${build}/package.json`)("typescript");
const { statistics } = await import(`${build}/dist/graph/languages/typescript/index.js`);
const counts = [];
let programs = statistics.programs;
Object.defineProperty(statistics, "programs", {
  configurable: true,
  get: () => programs,
  set(value) {
    programs = value;
    const c = {
      symbols: queryObjects(ts.objectAllocator.getSymbolConstructor(), { format: "count" }),
      types: queryObjects(ts.objectAllocator.getTypeConstructor(), { format: "count" }),
      heap: Math.round(process.memoryUsage().heapUsed / 1048576),
    };
    counts.push(c);
    console.log(value, JSON.stringify(c));
  },
});
process.argv = [process.argv[0], process.argv[1], build, dir];
await import("./analyze.mjs");
