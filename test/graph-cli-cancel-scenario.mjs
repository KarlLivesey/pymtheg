// SPDX-License-Identifier: MIT
// C-50: one cancellation scenario of the CLI's graph coordinator, run in a
// child process by test/graph-cli-cancel.test.mjs, so a regression that
// leaves a worker or a process running ends with this process (the test
// kills its process group) instead of hanging the test run. It prints one
// JSON line per fact the test checks.
//   node graph-cli-cancel-scenario.mjs <stuck|child|stretch|block> <scratch>
import { createServer } from "node:net";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runGraphInWorker } from "../dist/cli/graph-runner.js";
import { executeGraph } from "../dist/graph/commands.js";
import { LanguageRegistry, SqliteGraphStore } from "../dist/graph/index.js";
import { fixtureFiles, fixtureModule } from "./graph-kill-fixture.mjs";

const [scenario, scratch] = process.argv.slice(2);
const say = (fact) => process.stdout.write(JSON.stringify(fact) + "\n");
const root = join(scratch, "project");
await mkdir(root, { recursive: true });
for (const [path, text] of Object.entries(fixtureFiles(3)))
  await writeFile(join(root, path), text);

// [0] ready, [1] release, [2] the call that cannot finish was entered.
const flags = new SharedArrayBuffer(12);
const flag = new Int32Array(flags);
const workerData = { flag: flags };
let connections = [];
let server;
if (scenario === "child") {
  // The child and the grandchild each connect and say their pid; the
  // scenario aborts once both have, so the test can always clean up.
  workerData.socket = join(scratch, "child.sock");
  let connected;
  let reported = 0;
  const both = new Promise((resolve) => (connected = resolve));
  server = createServer((connection) => {
    connections.push(new Promise((resolve) => connection.on("close", resolve)));
    connection.setEncoding("utf8");
    connection.on("data", (text) => {
      const pid = Number.parseInt(text, 10);
      if (pid > 0) say({ pid });
      if (pid > 0 && ++reported === 2) connected();
    });
  });
  await new Promise((resolve) => server.listen(workerData.socket, resolve));
  workerData.both = both;
}
if (scenario === "block") {
  // Parsed first (the order is by path): its continuation blocks.
  await writeFile(join(root, "a-block.x"), "def block\n");
  await writeFile(join(root, "z.x"), "def stuck\n");
} else if (scenario === "stretch")
  await writeFile(join(root, "z.x"), "def stretch\n");
else await writeFile(join(root, "z.x"), "def stuck\n");

const controller = new AbortController();
const { both, ...data } = workerData;
const run = runGraphInWorker(
  { command: "index", root },
  {
    signal: controller.signal,
    workerURL: new URL("./graph-cli-stuck-worker.mjs", import.meta.url),
    workerData: data,
  },
);
// Readiness: the module is where the scenario needs it.
const waited = Atomics.waitAsync(flag, 0, 0);
if (waited.async) await waited.value;
if (both) await both;
controller.abort();
if (scenario === "block") {
  // The abort found the worker outside a module call: it asked for a
  // cooperative cancel. Now let the blocked continuation go on.
  Atomics.store(flag, 1, 1);
  Atomics.notify(flag, 1);
}
let rejected = "resolved";
try {
  await run;
} catch (error) {
  rejected = error.name;
}
say({ rejected, entered: Atomics.load(flag, 2) });

if (scenario === "child") {
  // Both processes end: each connection closes.
  await Promise.all(connections);
  say({ closed: connections.length });
  server.close();
}

if (scenario === "stuck") {
  // The store is left as a killed run leaves it; the next index (without
  // the file that cannot be analysed) repairs it to the rows of a cold one.
  await rm(join(root, "z.x"));
  const registry = () => new LanguageRegistry([fixtureModule()]);
  const after = await executeGraph(
    { command: "index", root },
    { registry: registry() },
  );
  const cold = join(scratch, "cold");
  await mkdir(cold);
  for (const [path, text] of Object.entries(fixtureFiles(3)))
    await writeFile(join(cold, path), text);
  await executeGraph(
    { command: "index", root: cold },
    { registry: registry() },
  );
  say({ status: after.status, same: rows(root) === rows(cold) });
}

/** The stored symbols and links of `at`, independent of ids. */
function rows(at) {
  const store = new SqliteGraphStore(
    join(at, ".pymtheg/rebuildable/graph.sqlite"),
  );
  try {
    const symbols = store.findSymbols();
    const name = new Map(symbols.map((s) => [s.id, `${s.file}#${s.identity}`]));
    return JSON.stringify({
      symbols: symbols.map((s) => `${s.file}#${s.identity}#${s.kind}`).sort(),
      links: store
        .links()
        .map(
          (l) =>
            `${l.file}@${l.range.start}-${l.range.end}:${l.kind}:${l.resolution}:${name.get(l.target) ?? ""}`,
        )
        .sort(),
      files: store
        .files()
        .map((f) => `${f.path}:${f.status ?? ""}`)
        .sort(),
    });
  } finally {
    store.close();
  }
}
