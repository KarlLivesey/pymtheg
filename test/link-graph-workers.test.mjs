// SPDX-License-Identifier: MIT
// C-50 review: `pymtheg link touched --file F --impact` asked the graph
// runner (the CLI's worker) for every symbol of the file, although those
// queries do not sync. A query without a sync now runs in place; only a
// request that may sync reaches the runner. Counted, not timed.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  requirementsFor,
  useGraphRunner,
} from "../dist/architecture/code-links.js";
import { executeGraph } from "../dist/graph/commands.js";

const cli = join(import.meta.dirname, "..", "dist", "cli", "main.js");

test("link touched --file --impact hands the runner one request, the sync, whatever the file's symbols", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pym-link-workers-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  const functions = Array.from(
    { length: 12 },
    (_, i) => `export function f${i}(): number { return ${i}; }\n`,
  ).join("");
  await writeFile(join(root, "src", "app.ts"), functions);
  await writeFile(
    join(root, "src", "use.ts"),
    'import { f0, f1 } from "./app";\nexport const sum = f0() + f1();\n',
  );
  await promisify(execFile)(process.execPath, [
    cli,
    "init",
    root,
    "--format",
    "json",
  ]);
  const requests = [];
  useGraphRunner((request, signal) => {
    requests.push({ command: request.command, noSync: !!request.noSync });
    return executeGraph(request, signal ? { signal } : {});
  });
  const result = await requirementsFor({
    root,
    file: "src/app.ts",
    impact: true,
  });
  assert.deepEqual(result.records, []);
  // The one request that may sync; the file query and the twelve impact
  // queries ran in place.
  assert.deepEqual(requests, [{ command: "file", noSync: false }]);
});
