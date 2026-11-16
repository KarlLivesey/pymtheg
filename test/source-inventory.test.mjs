// SPDX-License-Identifier: MIT
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StudioService } from "../dist/studio/service.js";
test("large source inventories remain usable and defer excess text until a file is opened", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-source-inventory-"));
  let service;
  try {
    for (let i = 0; i < 140; i++)
      await writeFile(join(root, `file${i}.pym`), "flow main() -> Unit {}");
    const big = "//" + "x".repeat(1024 * 1024) + "\nflow main() -> Unit {}";
    for (let i = 0; i < 10; i++)
      await writeFile(join(root, `large${i}.pym`), big);
    await writeFile(join(root, "broken.pym"), Buffer.from([255, 254]));
    await mkdir(join(root, "evidence"));
    await writeFile(join(root, "evidence", "old.pym"), "not a source");
    service = new StudioService(root, "file0.pym");
    const project = await service.project();
    assert.equal(project.files.length, 150);
    assert.ok(project.inventoryWarnings.some((w) => w.includes("broken.pym")));
    const unloaded = project.files.find((f) => f.loaded === false);
    assert.ok(unloaded);
    assert.equal(unloaded.text, "");
    assert.ok(
      project.files.reduce((n, f) => n + Buffer.byteLength(f.text), 0) <=
        8 * 1024 * 1024,
    );
    const loaded = await service.sourceFile(unloaded.path);
    assert.equal(loaded.text, big);
    assert.equal(loaded.loaded, true);
    assert.ok(!project.files.some((f) => f.path.startsWith("evidence/")));
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an unreadable neighbouring directory warns without taking the selected source offline", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("Root bypasses filesystem permissions");
    return;
  }
  const { chmod } = await import("node:fs/promises");
  const { analyseFile } = await import("../dist/analysis/index.js");
  const root = await mkdtemp(join(tmpdir(), "pym-inventory-denied-"));
  const restricted = join(root, "restricted");
  let service;
  try {
    await writeFile(
      join(root, "main.pym"),
      "flow main() -> Bool {return true;}",
    );
    await mkdir(restricted);
    await writeFile(join(restricted, "hidden.pym"), "broken source");
    await chmod(restricted, 0);
    service = new StudioService(root, "main.pym");
    const project = await service.project();
    assert.deepEqual(
      project.files.map((f) => f.path),
      ["main.pym"],
    );
    assert.ok(project.inventoryWarnings.some((w) => w.includes("restricted")));
    const { report } = analyseFile(join(root, "main.pym"), () => {}, {
      root,
      related: true,
    });
    assert.equal(
      report.diagnostics.filter((d) => d.severity === "error").length,
      0,
    );
    assert.ok(
      report.diagnostics.some(
        (d) => d.code === "L003" && d.span.file === restricted,
      ),
    );
  } finally {
    await service?.close();
    await chmod(restricted, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

test("generated Rust and Go folders are excluded by default and can be opted into explicitly", async () => {
  const root = await mkdtemp(join(tmpdir(), "pym-generated-inventory-"));
  let service;
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "target"));
    await mkdir(join(root, "vendor"));
    await writeFile(join(root, "src", "main.pym"), "flow main() -> Unit {}");
    await writeFile(
      join(root, "target", "generated.pym"),
      "generated template",
    );
    await writeFile(join(root, "vendor", "api.pym"), "op external() -> Unit;");
    service = new StudioService(root, "src/main.pym");
    assert.deepEqual(
      (await service.project()).files.map((f) => f.path),
      ["src/main.pym"],
    );
    await mkdir(join(root, ".pymtheg"), { recursive: true });
    await writeFile(
      join(root, ".pymtheg/settings.json"),
      JSON.stringify({
        version: 1,
        scenarios: {},
        sources: { include: ["src/**/*.pym", "vendor/**/*.pym"] },
      }),
    );
    assert.deepEqual(
      (await service.project()).files.map((f) => f.path).sort(),
      ["src/main.pym", "vendor/api.pym"],
    );
    const { analyseFile } = await import("../dist/analysis/index.js");
    await writeFile(
      join(root, "src", "main.pym"),
      'import "../vendor/api.pym"; flow main() -> Unit {call external();}',
    );
    const { report } = analyseFile(join(root, "src", "main.pym"), () => {}, {
      root,
      related: true,
    });
    assert.equal(
      report.snapshot.files.length,
      2,
      "Explicit imports remain part of the checked design",
    );
    assert.equal(
      report.diagnostics.filter((d) => d.severity === "error").length,
      0,
    );
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit source roots prune unrelated directories before attempting to read them", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("Root bypasses filesystem permissions");
    return;
  }
  const { chmod } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "pym-root-pruning-")),
    unrelated = join(root, "archive");
  let service;
  try {
    await mkdir(join(root, "src"));
    await mkdir(unrelated);
    await chmod(unrelated, 0);
    await writeFile(join(root, "src", "main.pym"), "flow main() -> Unit {}");
    await mkdir(join(root, ".pymtheg"), { recursive: true });
    await writeFile(
      join(root, ".pymtheg/settings.json"),
      JSON.stringify({
        version: 1,
        scenarios: {},
        sources: { include: ["src/**/*.pym"] },
      }),
    );
    service = new StudioService(root, "src/main.pym");
    const project = await service.project();
    assert.deepEqual(
      project.files.map((f) => f.path),
      ["src/main.pym"],
    );
    assert.deepEqual(project.inventoryWarnings, []);
    const { analyseFile } = await import("../dist/analysis/index.js");
    const { report } = analyseFile(join(root, "src", "main.pym"), () => {}, {
      root,
      related: true,
      sourcePolicy: { include: ["src/**/*.pym"] },
    });
    assert.equal(
      report.diagnostics.some((d) => d.code === "L003"),
      false,
    );
  } finally {
    await service?.close();
    await chmod(unrelated, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

test("root files stay visible above the inventory cap and interface impact discloses missing discovery", async () => {
  const { analyseFile } = await import("../dist/analysis/index.js");
  const { describeSignature, rewriteSignature } = await import(
    "../dist/studio/signature.js"
  );
  const root = await mkdtemp(join(tmpdir(), "pym-capped-inventory-"));
  let service;
  try {
    await mkdir(join(root, "aaa"));
    for (let i = 0; i < 10001; i++)
      await writeFile(
        join(root, "aaa", `${String(i).padStart(5, "0")}.pym`),
        "",
      );
    const file = join(root, "pay.pym");
    await writeFile(file, "op pay() -> Bool;");
    service = new StudioService(root);
    const view = await service.project();
    assert.equal(view.files.length, 10000);
    assert.ok(view.files.some((f) => f.path === "pay.pym"));
    assert.ok(view.inventoryWarnings.some((w) => w.includes("10,000")));
    const { ir } = analyseFile(file, () => {}, { root, related: true });
    const signature = describeSignature(ir, file + "#pay");
    const preview = rewriteSignature(
      ir,
      signature.symbolId,
      { ...signature, output: "String" },
      signature.sourceHash,
    );
    assert.equal(preview.affectedComplete, false);
    assert.ok(
      preview.notices.some((n) => /caller discovery.*incomplete/i.test(n)),
    );
  } finally {
    await service?.close();
    await rm(root, { recursive: true, force: true });
  }
});
