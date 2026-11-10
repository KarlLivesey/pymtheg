import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { runProcess } from "../dist/backends/process.js";
import { controlledClock } from "./controlled-clock.mjs";
async function runInput(chunks) {
  const root = await mkdtemp(join(tmpdir(), "pym-runner-input-"));
  try {
    const plugin = join(root, "plugin.mjs");
    await writeFile(
      plugin,
      'export const apiVersion="pymtheg.emitter/v1",target="echo",extension=".txt";export function emit(d){return d.note;}',
    );
    const script = `const chunks=${JSON.stringify(chunks.map((c) => c.toString("base64")))};Object.defineProperty(process,'stdin',{value:(async function*(){for(const c of chunks)yield Buffer.from(c,'base64');})()});process.argv[2]=${JSON.stringify(plugin)};await import(${JSON.stringify(pathToFileURL(resolve("dist/contracts/plugin-runner.js")).href)});`;
    return await runProcess(
      process.execPath,
      ["--input-type=module", "-e", script],
      { cwd: root, timeoutMs: 5000, clock: controlledClock() },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("plugin runner preserves UTF-8 characters split across arbitrary input chunks", async () => {
  const text = "café 🌍",
    bytes = Buffer.from(
      JSON.stringify({ schema: "pymtheg.contracts/v1", note: text }),
    );
  const split = bytes.indexOf(Buffer.from("é")) + 1;
  const result = await runInput([
    bytes.subarray(0, split),
    bytes.subarray(split, split + 4),
    bytes.subarray(split + 4),
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).output, text);
});
test("plugin runner rejects malformed UTF-8 instead of silently changing contract content", async () => {
  const result = await runInput([
    Buffer.from('{"schema":"pymtheg.contracts/v1","note":"'),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('"}'),
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not valid UTF-8/);
  assert.equal(result.stdout, "");
});
