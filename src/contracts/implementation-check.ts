// SPDX-License-Identifier: MIT
import type { Scaffold } from "./scaffold.js";
import { isNotContractMaterial } from "./document.js";
import { z } from "zod";
export const implementationCheckOptionsSchema = z
  .object({
    target: z.enum(["typescript", "rust", "go"]),
    contractsModule: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe(
        "Generated contracts module for TypeScript/Rust. Omit for a same-package Go check.",
      ),
    implementationModule: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe("TypeScript implementation module. Omit for Rust/Go."),
    implementationType: z.string().min(1).max(256),
  })
  .strict();

export type ImplementationCheckOptions = z.infer<
  typeof implementationCheckOptionsSchema
>;
/** A separate compiler input, never an implementation or a reported compiler result. */
export function emitImplementationCheck(
  scaffold: Scaffold,
  options: ImplementationCheckOptions,
) {
  // Only an explicit not-contract-material marker is exempt; every other
  // omission (unresolved, unsupported, plugin-declared) still refuses.
  const unresolved = scaffold.omitted.filter((o) => !isNotContractMaterial(o)),
    notChecked = scaffold.omitted
      .filter(isNotContractMaterial)
      .map(({ name, reason }) => ({ name, reason }));
  if (
    scaffold.mode !== "contracts" ||
    unresolved.length ||
    scaffold.format !== options.target
  )
    throw Error(
      "Generate complete contracts before creating an implementation check." +
        (unresolved.length
          ? ` ${unresolved.length} contract declaration${unresolved.length === 1 ? " is" : "s are"} unresolved or unsupported: ` +
            unresolved
              .slice(0, 5)
              .map((o) => `${o.name} (${o.reason})`)
              .join("; ") +
            (unresolved.length > 5 ? "; …" : "") +
            ". Repair them; the check is not generated from partial contracts."
          : ""),
    );
  if (!scaffold.symbols.length && notChecked.length)
    throw Error(
      "This design has no interface contracts to check: " +
        notChecked.map((o) => o.name).join(", ") +
        " describe behaviour, which an implementation check does not cover.",
    );
  const notCheckedComment = notChecked.length
    ? `// Not part of this contract check (behaviour, not interface contracts): ${notChecked
        .map((o) => o.name.replace(/[\x00-\x1f\x7f]/g, " "))
        .join(", ")}.\n`
    : "";
  const notCheckedNote = notChecked.length
    ? ` Not part of this contract check: ${notChecked
        .map((o) => o.name)
        .join(
          ", ",
        )} (behavioural machines; check them with simulate or verify).`
    : "";
  const type = options.implementationType;
  if (
    options.target !== "typescript" &&
    options.implementationModule !== undefined
  )
    throw Error(
      "implementationModule is only used by TypeScript. For Rust use a qualified implementation type; Go checks use the same package.",
    );
  if (options.target === "go" && options.contractsModule !== undefined)
    throw Error(
      "Go implementation checks require the same package as the contracts. Do not supply a contracts module; cross-package checks are not supported here.",
    );
  const module = (value: string | undefined, name: string) => {
    if (!value || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value))
      throw Error(`Provide a valid ${name} module path.`);
    return JSON.stringify(value);
  };
  let source: string, extension: string, instructions: string;
  if (options.target === "typescript") {
    if (!/^[A-Za-z_$][\w$]*$/.test(type))
      throw Error(
        "Choose the exported TypeScript implementation type name, for example PaymentService.",
      );
    const contracts = module(options.contractsModule, "contracts"),
      implementation = module(options.implementationModule, "implementation");
    source = `// Generated interface check. Include this file in your TypeScript project.\nimport type { PymthegImplementation } from ${contracts};\nimport type { ${type} as Implementation } from ${implementation};\nexport type PymthegContractCheck = PymthegImplementation<Implementation>;\n`;
    extension = ".check.ts";
    instructions =
      "Include this file in tsconfig.json and run your normal TypeScript build. It checks exact input lists and compatible types; it does not check business behaviour.";
  } else if (options.target === "go") {
    if (!/^\*[A-Za-z_][A-Za-z_0-9]*$/.test(type))
      throw Error(
        "Choose a Go implementation type in the contracts package, for example *PaymentService.",
      );
    const packageName = scaffold.source.match(
      /^package ([A-Za-z_][A-Za-z_0-9]*)$/m,
    )?.[1];
    if (!packageName)
      throw Error("The generated Go contracts have no package declaration.");
    source = `// Generated interface assertion. Keep this file in the contracts and implementation package.\npackage ${packageName}\n\nvar _ PymthegContracts = (${type})(nil)\n`;
    extension = "_check.go";
    instructions =
      "Place this file in the same package as the generated contracts and implementation, then run go test ./... or your normal build. The assertion checks method signatures, not behaviour.";
  } else {
    const path = /^[A-Za-z_][A-Za-z_0-9]*(?:::[A-Za-z_][A-Za-z_0-9]*)*$/;
    if (!path.test(type) || !path.test(options.contractsModule ?? ""))
      throw Error(
        "Use Rust paths such as crate::contracts and crate::PaymentService.",
      );
    source = `// Generated trait check. Declare this file as a module in your crate.\nuse ${options.contractsModule}::PymthegContracts;\nconst _: fn() = || {\n    fn require_contract<T: PymthegContracts>() {}\n    require_contract::<${type}>();\n};\n`;
    extension = "_check.rs";
    instructions =
      "Declare this file as a module in the implementation crate and run cargo check. The trait bound checks signatures, not behaviour.";
  }
  return {
    source: notCheckedComment
      ? source.replace(/^(\/\/[^\n]*\n)/, `$1${notCheckedComment}`)
      : source,
    extension,
    instructions: instructions + notCheckedNote,
    notChecked,
    snapshotId: scaffold.snapshotId,
    guarantee: "compiler-input-only" as const,
  };
}
