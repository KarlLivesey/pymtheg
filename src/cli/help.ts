import { identity } from "../shared/identity.js";
const commands = [
  [
    "observe FILE.ts... [--root DIRECTORY] [--label VERSION] [--retain] [--out GRAPH.json] [--format text|json]",
    "observe --list [--root DIRECTORY] [--directory SUBFOLDER] [--format text|json]",
    "Capture an immutable graph of existing TypeScript/JavaScript code; does not execute it.",
  ],
  [
    "init [DIRECTORY] [--name NAME] [--import-docs] [--resolutions FILE] [--allow-broken-links] [--format text|json]",
    "Create a project workspace without overwriting existing work.",
  ],
  [
    "studio PATH [--port PORT] [--plugin TARGET=PATH]",
    "Open the local design and architecture workspace.",
  ],
  [
    `check FILE${identity.extension} [--check-scope entry|related|project] [--format text|json] [--out REPORT.json]`,
    "Check types, outcomes, resources and work offline.",
  ],
  [
    `simulate FILE${identity.extension} --entry NAME [--seed 42 --max-steps 6 --max-samples 1000]`,
    "Explore bounded event sequences with Quint.",
  ],
  [
    `verify FILE${identity.extension} --entry NAME --backend tlc --tlc-jar PATH`,
    "Check all states of the selected finite model.",
  ],
  [
    `emit FILE${identity.extension} --entry NAME --target quint --out MODEL.qnt`,
    "Inspect a generated behavioural model.",
  ],
  [
    `scaffold FILE${identity.extension} [--target typescript|rust|go] [--plugin FILE.mjs] [--mode stubs|contracts] [--body fail-fast|empty] [--manifest BASELINE.json | --check BASELINE.json] [--allow-incomplete] [--plugin-timeout 5s]`,
    "Generate types and signatures. With --mode contracts --implementation TYPE, emit a separate compiler-check file; set (TypeScript/Rust) --contracts-module and (TypeScript) --implementation-module for its imports.",
  ],
  [
    "mcp [PROJECT_DIRECTORY] [--plugin TARGET=PATH]",
    "Let coding agents check designs and read architecture.",
  ],
  [
    "import-architecture SOURCE --into PROJECT [--name LABEL] [--source-id ID|--new-source] [--source-name LABEL] [--resolutions FILE.json] [--preview] [--format text|json] [--allow-broken-links]",
    "Retain architecture documents and their provenance.",
  ],
  [
    `fmt FILE${identity.extension} [--check|--write]`,
    "Format source, or report the first differing line.",
  ],
  [
    "doctor [--format json]",
    "Check the local toolchain and optional backends.",
  ],
] as const;
export const commandNames = commands.map(([syntax]) => syntax.split(" ")[0]!);
export function help() {
  return (
    `${identity.cli}\nStart a project: ${identity.cli} init .\nOpen the workspace: ${identity.cli} studio .\n\n` +
    commands
      .map(([syntax, purpose]) => `${identity.cli} ${syntax}\n  ${purpose}`)
      .join("\n\n") +
    `\n\nUse --scenario NAME for a saved ${identity.projectConfig} scenario. --scope FILE.json and --timeout 45s bound requested behavioural checks.\nLocal checking works offline. Simulation requires pinned Quint; verification requires the pinned TLC JAR.\n`
  );
}
