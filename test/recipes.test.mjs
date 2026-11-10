import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import {
  recipes,
  recipeSource,
  defaultRecipeOptions,
} from "../dist/studio/recipes.js";
async function check(source) {
  const root = await mkdtemp(join(tmpdir(), "pym-recipe-"));
  try {
    const file = join(root, "design.pym");
    await writeFile(file, source);
    return analyseFile(file).report;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("every guided recipe goes through the real language and preserves its declared teaching boundary", async () => {
  for (const recipe of recipes) {
    const r = await check(recipeSource(recipe.id, defaultRecipeOptions));
    assert.deepEqual(
      r.diagnostics.filter((d) => d.severity === "error" && d.code !== "K002"),
      [],
      recipe.id,
    );
    if (["blank", "uncertain"].includes(recipe.id))
      assert.ok(r.results.some((p) => p.completion === "incomplete"));
  }
});
test("editable recipe decisions change real inferred work and budget findings", async () => {
  const before = await check(recipeSource("work", defaultRecipeOptions));
  assert.ok(before.diagnostics.some((d) => d.code === "K002"));
  const after = await check(
    recipeSource("work", { ...defaultRecipeOptions, calls: "2" }),
  );
  assert.ok(!after.diagnostics.some((d) => d.severity === "error"));
  assert.ok(!after.diagnostics.some((d) => d.code === "K002"));
  assert.equal(
    String(
      after.results.find((r) =>
        r.propertyId.endsWith("#main/cost/remote_calls"),
      ).witnessOrDerivation.maximum,
    ),
    "400",
  );
});

test("published recipes use the real formatter and reject reserved interface names", async () => {
  const { generateRecipe } = await import("../dist/studio/generate.js");
  const { formatSource } = await import("../dist/language/format.js");
  for (const recipe of recipes) {
    const source = generateRecipe(recipe.id, defaultRecipeOptions);
    assert.equal(formatSource("recipe.pym", source), source);
  }
  for (const name of ["true", "unit", "flow", "Nat"])
    assert.throws(
      () => recipeSource("component", { ...defaultRecipeOptions, name }),
      /reserved/,
    );
});
