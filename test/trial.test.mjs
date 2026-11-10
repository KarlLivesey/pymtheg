import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyseFile } from "../dist/analysis/index.js";
import { tryFlow } from "../dist/behaviour/trial.js";
import { tryFlowInWorker } from "../dist/behaviour/trial-runner.js";
import { recipeSource, defaultRecipeOptions } from "../dist/studio/recipes.js";
async function withSource(source, run) {
  const root = await mkdtemp(join(tmpdir(), "pym-trial-"));
  try {
    const file = join(root, "main.pym");
    await writeFile(file, source);
    await run(analyseFile(file).ir);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("chosen inputs return actual decisions and reject invalid arguments", () =>
  withSource(recipeSource("decision", defaultRecipeOptions), async (ir) => {
    assert.equal(tryFlow(ir, "main", { age: "17" }).output, false);
    const adult = await tryFlowInWorker(
      ir,
      "main",
      { age: "18" },
      new AbortController().signal,
    );
    assert.equal(adult.completion, "complete");
    assert.equal(adult.output, true);
    assert.equal(tryFlow(ir, "main", { age: "121" }).completion, "unsupported");
    assert.equal(tryFlow(ir, "main", { age: "x" }).completion, "unsupported");
    assert.equal(
      tryFlow(ir, "main", { age: "18", typo: "1" }).completion,
      "unsupported",
    );
  }));
test("example execution preserves large integers and refuses to choose external outcomes", async () => {
  await withSource("flow main(value: Int) -> Int { return value; }", (ir) => {
    assert.equal(
      tryFlow(ir, "main", { value: "9007199254740993" }).output,
      "9007199254740993",
    );
  });
  await withSource(
    "type E = Bad; op read() -> Result<Unit,E> effects(remote.Store) atomic; flow main() -> Result<Unit,E> effects(remote.Store) { call read() as result; return result; }",
    (ir) => {
      assert.equal(tryFlow(ir, "main", {}).completion, "unsupported");
    },
  );
});
