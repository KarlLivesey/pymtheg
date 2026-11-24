// SPDX-License-Identifier: MIT
// node neutral.mjs DIST ROOT STORE: a cold TypeScript index of ROOT into
// STORE with DIST's module; prints the differential's counters (programs
// built without the assumed entries, files re-extracted there) and the CPU
// seconds, an observation.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dist, root, storePath] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(resolve(dist, path)).href);
const { indexProject, LanguageRegistry, SqliteGraphStore } =
  await load("graph/index.js");
const ts = await load("graph/languages/typescript/index.js");
const store = new SqliteGraphStore(storePath);
const before = { ...ts.statistics };
const start = process.cpuUsage();
await indexProject(root, new LanguageRegistry([ts.default]), store);
const cpu = process.cpuUsage(start);
store.close();
console.log(
  JSON.stringify({
    neutralPrograms: ts.statistics.neutralPrograms - before.neutralPrograms,
    neutralExtracted: ts.statistics.neutralExtracted - before.neutralExtracted,
    cpuSeconds: Math.round((cpu.user + cpu.system) / 1e6),
  }),
);
