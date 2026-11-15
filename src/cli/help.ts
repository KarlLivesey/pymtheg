import { identity } from "../shared/identity.js";
const commands = [
  [
    "observe FILE.ts... [--root DIRECTORY] [--label VERSION] [--retain] [--out GRAPH.json] [--format text|json]",
    "observe --list [--root DIRECTORY] [--directory SUBFOLDER] [--format text|json]",
    "Capture an immutable graph of existing TypeScript/JavaScript code; does not execute it.",
  ],
  [
    "init [DIRECTORY] [--name NAME] [--import-docs] [--resolutions FILE] [--allow-broken-links] [--format text|json]",
    "Start here: create .pymtheg/ without overwriting existing work; old layouts are unused.",
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
    "Explore bounded event sequences with the built-in seeded sampler (default); --backend quint selects Quint.",
  ],
  [
    `verify FILE${identity.extension} --entry NAME [--backend builtin|tlc] [--state-budget 1000000]`,
    "Check all states with built-in breadth-first search (default); TLC requires --tlc-jar PATH.",
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
    `${identity.cli}\nStart here: ${identity.cli} init .\nThen: ${identity.cli} doctor; ${identity.cli} studio .; ${identity.cli} mcp .\n\n` +
    commands
      .map(([syntax, purpose]) => `${identity.cli} ${syntax}\n  ${purpose}`)
      .join("\n\n") +
    `\n\nUse --scenario NAME for a saved ${identity.projectConfig} scenario. --scope FILE.json and --timeout 45s bound requested behavioural checks.\nLocal checking works offline. Simulation and verification use built-in workers by default. Explicit Quint/TLC backends require their pinned tools.\n`
  );
}
