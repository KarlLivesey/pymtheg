import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identity, sourceFileName } from "../dist/shared/identity-values.js";

test("one provisional-name definition controls discovery, imports, scenarios, recipes and command help", async () => {
  const previous = { cli: identity.cli, extension: identity.extension };
  const root = await mkdtemp(join(tmpdir(), "pym-rename-"));
  try {
    // This test models editing the compile-time constants before loading users
    // of those constants. It does not expose a runtime rename configuration.
    identity.cli = "renamed-design-tool";
    identity.extension = ".design";
    const { identity: backendIdentity } = await import(
      "../dist/shared/identity.js"
    );
    const { unusedSourceName } = await import("../dist/shared/names.js");
    const { sourceIncluded } = await import(
      "../dist/language/source-selection.js"
    );
    const { scenario } = await import("../dist/shared/config.js");
    const { loadProject } = await import("../dist/language/project.js");
    const { recipes } = await import("../dist/studio/recipes.js");
    const { help } = await import("../dist/cli/help.js");
    assert.equal(backendIdentity, identity);
    assert.equal(sourceFileName("component"), "component.design");
    assert.equal(sourceFileName("component.design"), "component.design");
    assert.equal(
      unusedSourceName("component.design", [
        "component.design",
        "component-2.design",
      ]),
      "component-3.design",
    );
    assert.equal(sourceIncluded("nested/component.design"), true);
    assert.equal(sourceIncluded("nested/component.pym"), false);
    assert.equal(
      scenario({ file: "component.design", entry: "run" }).file,
      "component.design",
    );
    assert.throws(
      () => scenario({ file: "component.pym", entry: "run" }),
      /\.design/,
    );
    assert.ok(recipes.every((recipe) => recipe.filename.endsWith(".design")));
    assert.match(help(), /^renamed-design-tool/);
    assert.match(help(), /check FILE\.design/);
    assert.doesNotMatch(help(), /FILE\.pym/);
    await writeFile(join(root, "base.design"), "op task() -> Unit;");
    await writeFile(
      join(root, "main.design"),
      'import "./base.design"; flow run() -> Unit { call task(); }',
    );
    const snapshot = loadProject(join(root, "main.design"));
    assert.deepEqual(snapshot.diagnostics, []);
    assert.equal(snapshot.sources.length, 2);
    assert.ok(
      snapshot.sources.every((source) => source.file.endsWith(".design")),
    );
    // Renaming public commands does not rename on-disk compatibility formats.
    assert.equal(identity.projectConfig, ".pymtheg.json");
    assert.equal(identity.schema, "pymtheg.report/v1");
  } finally {
    Object.assign(identity, previous);
    await rm(root, { recursive: true, force: true });
  }
});
