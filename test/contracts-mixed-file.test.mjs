import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { analyseFile } from "../dist/analysis/index.js";
import { scaffold } from "../dist/contracts/scaffold.js";
import { contractDocument } from "../dist/contracts/document.js";
import { emitImplementationCheck } from "../dist/contracts/implementation-check.js";
import { readContractManifest } from "../dist/contracts/manifest.js";

const fixture = (name) =>
  resolve("test/fixtures/contracts-mixed-file", name + ".pym");
const options = {
  typescript: {
    target: "typescript",
    contractsModule: "./contracts",
    implementationModule: "./implementation",
    implementationType: "Kettle",
  },
  go: { target: "go", implementationType: "*Kettle" },
  rust: {
    target: "rust",
    contractsModule: "crate::contracts",
    implementationType: "crate::Kettle",
  },
};
const contracts = (name, target) =>
  scaffold(analyseFile(fixture(name)).ir, target, "fail-fast", "contracts");

test("a machine is typed as not contract material; unresolved contracts are not", () => {
  const mixed = contractDocument(analyseFile(fixture("mixed")).ir);
  assert.deepEqual(mixed.declarations.map((d) => d.name).sort(), [
    "BoilError",
    "Reading",
    "boil",
    "readTemperature",
  ]);
  assert.deepEqual(mixed.omitted, [
    {
      name: "Kettle",
      reason:
        "Behavioural machines are specifications, not callable implementation contracts.",
      applicability: "not-contract-material",
    },
  ]);
  const unresolved = contractDocument(analyseFile(fixture("unresolved")).ir);
  const boil = unresolved.omitted.find((o) => o.name === "boil");
  assert.ok(boil, JSON.stringify(unresolved.omitted));
  assert.equal(boil.applicability, undefined);
  assert.equal(
    unresolved.omitted.find((o) => o.name === "Kettle")?.applicability,
    "not-contract-material",
  );
});

for (const target of ["go", "typescript", "rust"])
  test(`${target}: one file with a machine and contracts yields an implementation check that names what it does not cover`, () => {
    const output = contracts("mixed", target);
    const check = emitImplementationCheck(output, options[target]);
    assert.equal(check.guarantee, "compiler-input-only");
    assert.deepEqual(check.notChecked, [
      {
        name: "Kettle",
        reason:
          "Behavioural machines are specifications, not callable implementation contracts.",
      },
    ]);
    assert.match(
      check.source,
      /^\/\/ Not part of this contract check \(behaviour, not interface contracts\): Kettle\.$/m,
    );
    assert.match(check.instructions, /Not part of this contract check: Kettle/);
    if (target === "go") {
      assert.match(check.source, /^package contracts$/m);
      assert.match(
        check.source,
        /var _ PymthegContracts = \(\*Kettle\)\(nil\)/,
      );
      assert.equal(check.extension, "_check.go");
    }
    // The contracts themselves still cover exactly the interface declarations.
    assert.equal(output.symbols.length, 4);
    assert.ok(!output.symbols.some((s) => /kettle/i.test(s.name)));
  });

for (const target of ["go", "typescript", "rust"])
  test(`${target}: an unresolved contract next to a machine still refuses with its name and reason`, () => {
    const output = contracts("unresolved", target);
    assert.throws(
      () => emitImplementationCheck(output, options[target]),
      (error) => {
        assert.match(
          error.message,
          /^Generate complete contracts before creating an implementation check\. 1 contract declaration is unresolved or unsupported: boil \(/,
        );
        assert.doesNotMatch(error.message, /Kettle/);
        return true;
      },
    );
  });

test("an omission without the explicit marker refuses, so plugin and legacy omissions fail closed", () => {
  const output = contracts("mixed", "go");
  const withLegacy = {
    ...output,
    omitted: [
      ...output.omitted,
      { name: "Kettle", reason: "Plugin could not represent this." },
    ],
  };
  assert.throws(
    () => emitImplementationCheck(withLegacy, options.go),
    /unresolved or unsupported: Kettle \(Plugin could not represent this\.\)/,
  );
});

test("a machine-only file has no contracts to check and refuses instead of emitting a vacuous check", () => {
  assert.throws(
    () => emitImplementationCheck(contracts("machine-only", "go"), options.go),
    /no interface contracts to check: Kettle describe behaviour/,
  );
});

test("contract baselines keep counting machines as incomplete coverage, in the unchanged v1 shape", () => {
  const manifest = contracts("mixed", "go").contractManifest;
  assert.deepEqual(manifest.omitted, [
    {
      name: "Kettle",
      reason:
        "Behavioural machines are specifications, not callable implementation contracts.",
    },
  ]);
  assert.deepEqual(readContractManifest(manifest), manifest);
  // A plugin manifest that copies the document omission verbatim stays readable.
  readContractManifest({
    ...manifest,
    omitted: [
      { ...manifest.omitted[0], applicability: "not-contract-material" },
    ],
  });
});

test("CLI emits the Go check for a mixed file and refuses the unresolved file", () => {
  const run = (name, json) =>
    spawnSync(
      process.execPath,
      [
        resolve("dist/cli/main.js"),
        "scaffold",
        fixture(name),
        "--mode",
        "contracts",
        "--target",
        "go",
        "--implementation",
        "*Kettle",
        ...(json ? ["--format", "json"] : []),
      ],
      { encoding: "utf8" },
    );
  const ok = run("mixed", true);
  assert.equal(ok.status, 0, ok.stderr);
  const out = JSON.parse(ok.stdout);
  assert.match(out.source, /var _ PymthegContracts = \(\*Kettle\)\(nil\)/);
  assert.deepEqual(
    out.notChecked.map((o) => o.name),
    ["Kettle"],
  );
  const refused = run("unresolved", false);
  assert.equal(refused.status, 3);
  assert.equal(refused.stdout, "");
  assert.match(refused.stderr, /without errors/);
});
