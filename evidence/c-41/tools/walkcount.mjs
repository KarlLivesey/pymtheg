// SPDX-License-Identifier: MIT
// node walkcount.mjs DIST ROOT STORE: a cold TypeScript index of ROOT into
// STORE; prints the receiver walk's counters and the CPU seconds.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const [dist, root, storePath] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { indexProject, LanguageRegistry, SqliteGraphStore } =
  await load("graph/index.js");
const ts = await load("graph/languages/typescript/index.js");
const store = new SqliteGraphStore(storePath);
const start = process.cpuUsage();
const wall = Date.now();
await indexProject(root, new LanguageRegistry([ts.default]), store);
const cpu = process.cpuUsage(start);
store.close();
console.log(
  JSON.stringify({
    calls: ts.receiverStatistics?.calls,
    expressions: ts.receiverStatistics?.expressions,
    maxSteps: ts.receiverStatistics?.maxSteps,
    maxDepth: ts.receiverStatistics?.maxDepth,
    budgetCuts: ts.receiverStatistics?.budgetCuts,
    depthCuts: ts.receiverStatistics?.depthCuts,
    cpuSeconds: Math.round((cpu.user + cpu.system) / 1e6),
    wallSeconds: Math.round((Date.now() - wall) / 1000),
  }),
);
