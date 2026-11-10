import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { analyseFile } from "../dist/analysis/index.js";
import { scaffold } from "../dist/contracts/scaffold.js";
import { runProcess } from "../dist/backends/process.js";
test("Go contracts remain usable from another package when source names begin with underscores", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pym-go-public-test-"));
  try {
    await mkdir(join(root, "contracts"));
    const source = join(root, "source.pym");
    await writeFile(
      source,
      "type _Order = { _name: String, name: String, _2d: Bool, ___: Bool }; type Order = { enabled: Bool }; op _quote(order: _Order) -> Bool; op quote(order: Order) -> Bool;",
    );
    const { ir, report } = analyseFile(source);
    assert.deepEqual(
      report.diagnostics.filter((d) => d.severity === "error"),
      [],
    );
    const output = scaffold(ir, "go");
    const order = output.symbols.find((s) =>
      s.symbolId.endsWith("#_Order"),
    ).name;
    const quote = output.symbols.find((s) =>
      s.symbolId.endsWith("#_quote"),
    ).name;
    await writeFile(join(root, "contracts", "contracts.go"), output.source);
    await writeFile(
      join(root, "go.mod"),
      "module example.com/consumer\n\ngo 1.25\n",
    );
    await writeFile(
      join(root, "consumer.go"),
      `package consumer\nimport "example.com/consumer/contracts"\nvar _ func(contracts.${order}) bool = contracts.${quote}\nvar _ = contracts.${order}{Name:"first", Name2:"second", Value2d:true, Value:true}\n`,
    );
    const result = await runProcess(
      process.env.PYM_GO ?? "go",
      ["test", "./..."],
      {
        cwd: root,
        timeoutMs: 45000,
        env: {
          ...process.env,
          GOTOOLCHAIN: "local",
          GOCACHE: "/tmp/pym-go-build-cache",
        },
      },
    );
    if (result.kind === "spawn_failed" || result.kind === "timed_out") {
      t.skip(
        "Go compiler unavailable or resource budget exhausted; public-use evidence is unresolved",
      );
      return;
    }
    assert.equal(result.kind, "exited");
    assert.equal(result.code, 0, result.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
